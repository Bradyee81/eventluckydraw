/*
  Lucky Draw Buzzer firmware (PlatformIO)
  ESP32 DevKit (CP2102)

  What this does:
  - Reads a single button on GPIO4 (to GND), debounced in software
  - Sends each press to the Lucky Draw app as an HTTP POST, plus a 5s heartbeat
    so the app can show a live connected/disconnected indicator
  - Finds the app by itself: the app broadcasts "LUCKYDRAW <port>" on UDP 3001
    every couple of seconds, and the buzzer sends to whoever announced it. So a
    different laptop, or the laptop getting a new address, needs no re-setup.
  - Shows its state on an RGB LED (common cathode) and mirrors it on the
    board's own LED, so staff can check a buzzer at a glance
  - Reports its firmware version (startup line + every message to the app) so
    the app can tell when a buzzer needs updating

  WiFi provisioning:
  - SSID / password / server URL are NOT compiled in. They're stored in flash (NVS)
    and loaded on boot. The Lucky Draw app pushes them over this same USB serial
    connection (see handleProvisioningLine()) so a new venue is just
    "plug in USB, press Connect in the app" — no reflashing needed.
  - The app's Connect step waits for this firmware's startup lines ("Lucky Draw
    Buzzer", "Connecting to WiFi", "WiFi connected" / "WiFi connection failed")
    and the PROV_* replies, so keep those prefixes unchanged.
*/
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiUdp.h>

// Bump on every firmware change. The app reads this tag out of the bundled
// firmware file to know which version it ships, so keep the exact format.
#define FIRMWARE_VERSION 2
const char *FIRMWARE_VERSION_TAG = "LDFW_VERSION=2";

// Only used on a truly blank board before it's ever been provisioned from
// the Lucky Draw app — real values always come from NVS after that.
const char *FALLBACK_WIFI_SSID = "";
const char *FALLBACK_WIFI_PASSWORD = "";
const char *FALLBACK_SERVER_URL = "http://192.168.1.100:3000/buzzer-event";

const int BUTTON_PIN = 4;
const unsigned long DEBOUNCE_DELAY_MS = 50;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000; // lets the app show a live connected/disconnected indicator

// RGB LED, common cathode (long leg to GND, each colour through its resistor).
const int LED_RED_PIN = 25;
const int LED_GREEN_PIN = 26;
const int LED_BLUE_PIN = 27;
// Most ESP32 DevKits have a small LED on GPIO2. It shows the same blink
// pattern (in its own colour), so even a buzzer without the RGB LED shows state.
const int ONBOARD_LED_PIN = 2;

// The app's announcement, so the buzzer can find it on the WiFi.
const uint16_t DISCOVERY_PORT = 3001;
const char *DISCOVERY_PREFIX = "LUCKYDRAW ";

Preferences prefs;
String wifiSsid;
String wifiPassword;
String serverUrl;

WiFiUDP discoveryUdp;
bool discoveryListening = false;

unsigned long lastHeartbeatTime = 0;
bool appReachable = false; // last message to the app got an answer
String serialLine;

// Sequence state: 0 = idle (waiting for first press), 1 = rolled (waiting for second press)
int sequenceState = 0;

int lastRawReading = HIGH;
int debouncedState = HIGH;
unsigned long lastChangeTime = 0;

// --- Status LED ---------------------------------------------------------

enum LedColor
{
  OFF,
  RED,
  GREEN,
  BLUE,
  YELLOW,
  PURPLE,
  WHITE
};

struct LedPattern
{
  LedColor color;
  unsigned long onMs;  // 0 = solid
  unsigned long offMs;
};

enum BuzzerState
{
  NEEDS_SETUP,      // no WiFi saved: plug into the app and press Connect
  CONNECTING_WIFI,  // trying to join the saved WiFi
  WIFI_FAILED,      // couldn't join (wrong password, out of range, router off)
  LOOKING_FOR_APP,  // on WiFi, but Lucky Draw isn't answering yet
  READY,            // talking to Lucky Draw
  RECEIVING_SETUP   // got new WiFi details over USB, joining
};

BuzzerState buzzerState = NEEDS_SETUP;
unsigned long pressFlashUntil = 0;

LedPattern patternFor(BuzzerState state)
{
  switch (state)
  {
  case NEEDS_SETUP:
    return {RED, 1000, 1000};
  case CONNECTING_WIFI:
    return {BLUE, 200, 200};
  case WIFI_FAILED:
    return {RED, 0, 0};
  case LOOKING_FOR_APP:
    return {YELLOW, 1000, 1000};
  case READY:
    return {GREEN, 0, 0};
  case RECEIVING_SETUP:
    return {PURPLE, 200, 200};
  }
  return {OFF, 0, 0};
}

void writeLed(LedColor color, bool onboardOn)
{
  bool r = color == RED || color == YELLOW || color == PURPLE || color == WHITE;
  bool g = color == GREEN || color == YELLOW || color == WHITE;
  bool b = color == BLUE || color == PURPLE || color == WHITE;
  digitalWrite(LED_RED_PIN, r ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, g ? HIGH : LOW);
  digitalWrite(LED_BLUE_PIN, b ? HIGH : LOW);
  digitalWrite(ONBOARD_LED_PIN, onboardOn ? HIGH : LOW);
}

void writeLed(LedColor color)
{
  writeLed(color, color != OFF);
}

// Non-blocking: call often. A button press shows a short white flash on top
// of whatever state the buzzer is in. The single-colour board LED can't show
// white, and is usually already on (ready), so it blinks off instead.
void updateLed()
{
  unsigned long now = millis();
  if (now < pressFlashUntil)
  {
    writeLed(WHITE, false);
    return;
  }
  LedPattern p = patternFor(buzzerState);
  if (p.onMs == 0)
  {
    writeLed(p.color);
    return;
  }
  bool on = (now % (p.onMs + p.offMs)) < p.onMs;
  writeLed(on ? p.color : OFF);
}

void setBuzzerState(BuzzerState state)
{
  buzzerState = state;
  updateLed();
}

// delay() that keeps the LED pattern running.
void ledDelay(unsigned long ms)
{
  unsigned long start = millis();
  while (millis() - start < ms)
  {
    updateLed();
    delay(10);
  }
}

// ------------------------------------------------------------------------

void loadProvisioning();
void connectToWiFi();
void checkButton();
void onButtonPressed();
void sendEvent(const char *eventName);
void sendHeartbeatIfDue();
void checkForDiscovery();
void checkForProvisioning();
void handleProvisioningLine(const String &line);
void refreshNetworkState();

void setup()
{
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  pinMode(ONBOARD_LED_PIN, OUTPUT);
  writeLed(OFF);

  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.print("Lucky Draw Buzzer firmware v");
  Serial.print(FIRMWARE_VERSION);
  Serial.println(" starting up...");
  Serial.print("FW_VERSION:");
  Serial.println(FIRMWARE_VERSION);
  Serial.println(FIRMWARE_VERSION_TAG);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  prefs.begin("buzzer", false);
  loadProvisioning();
  connectToWiFi();
}

void loop()
{
  checkButton();
  checkForDiscovery();
  sendHeartbeatIfDue();
  checkForProvisioning();
  refreshNetworkState();
  updateLed();
}

void loadProvisioning()
{
  wifiSsid = prefs.getString("ssid", FALLBACK_WIFI_SSID);
  wifiPassword = prefs.getString("pass", FALLBACK_WIFI_PASSWORD);
  serverUrl = prefs.getString("url", FALLBACK_SERVER_URL);
}

void checkButton()
{
  int rawReading = digitalRead(BUTTON_PIN);

  // Reset the debounce timer whenever the raw reading changes
  if (rawReading != lastRawReading)
  {
    lastChangeTime = millis();
  }

  // Only trust the reading once it's been stable for DEBOUNCE_DELAY_MS
  if ((millis() - lastChangeTime) > DEBOUNCE_DELAY_MS)
  {
    if (rawReading != debouncedState)
    {
      debouncedState = rawReading;

      // Button is wired with INPUT_PULLUP, so LOW = pressed
      if (debouncedState == LOW)
      {
        onButtonPressed();
      }
    }
  }

  lastRawReading = rawReading;
}

void onButtonPressed()
{
  pressFlashUntil = millis() + 300;
  updateLed();

  if (sequenceState == 0)
  {
    Serial.println(">> ROLL event");
    sendEvent("roll");
    sequenceState = 1;
  }
  else
  {
    Serial.println(">> REVEAL event");
    sendEvent("reveal");
    sequenceState = 0; // reset, ready for the next round
  }
}

void connectToWiFi()
{
  Serial.print("Connecting to WiFi: ");
  Serial.println(wifiSsid);

  discoveryListening = false;
  appReachable = false;

  if (wifiSsid.length() == 0)
  {
    Serial.println("WiFi connection failed — no WiFi saved yet. Plug into the Lucky Draw app and press Connect.");
    setBuzzerState(NEEDS_SETUP);
    return;
  }

  if (buzzerState != RECEIVING_SETUP)
  {
    setBuzzerState(CONNECTING_WIFI);
  }

  WiFi.disconnect(true);
  WiFi.setAutoReconnect(true);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20)
  {
    ledDelay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println();
    Serial.print("WiFi connected. IP address: ");
    Serial.println(WiFi.localIP());
    setBuzzerState(LOOKING_FOR_APP);
    lastHeartbeatTime = 0; // say hello straight away
  }
  else
  {
    Serial.println();
    Serial.println("WiFi connection failed — continuing without it. Button events will still print to Serial.");
    setBuzzerState(WIFI_FAILED);
  }
}

// Keeps the LED honest when the WiFi drops or comes back by itself
// (auto-reconnect), outside of connectToWiFi().
void refreshNetworkState()
{
  if (buzzerState == NEEDS_SETUP || buzzerState == RECEIVING_SETUP)
  {
    return;
  }
  if (WiFi.status() != WL_CONNECTED)
  {
    appReachable = false;
    discoveryListening = false;
    setBuzzerState(WIFI_FAILED);
  }
  else
  {
    setBuzzerState(appReachable ? READY : LOOKING_FOR_APP);
  }
}

void sendEvent(const char *eventName)
{
  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("   (skipped sending — no WiFi connection)");
    return;
  }

  HTTPClient http;
  // Short timeouts: while waiting, the button isn't being read.
  http.setConnectTimeout(1000);
  http.setTimeout(1500);
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"event\":\"") + eventName + "\",\"fw\":" + FIRMWARE_VERSION + "}";
  int responseCode = http.POST(payload);

  if (responseCode > 0)
  {
    appReachable = true;
    Serial.print("   sent to app, response code: ");
    Serial.println(responseCode);
  }
  else
  {
    appReachable = false;
    Serial.print("   send failed (this is expected if the app isn't running yet), error: ");
    Serial.println(http.errorToString(responseCode));
  }

  http.end();
}

// Pings the app every HEARTBEAT_INTERVAL_MS so it can show a live
// connected/disconnected indicator even between button presses.
void sendHeartbeatIfDue()
{
  unsigned long now = millis();
  if (lastHeartbeatTime != 0 && now - lastHeartbeatTime < HEARTBEAT_INTERVAL_MS)
  {
    return;
  }
  lastHeartbeatTime = now == 0 ? 1 : now;
  sendEvent("heartbeat");
}

// Listens for the app's "LUCKYDRAW <port>" broadcast and points the buzzer
// at whichever laptop sent it. Saved, so a restart goes straight there.
void checkForDiscovery()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    return;
  }
  if (!discoveryListening)
  {
    discoveryListening = discoveryUdp.begin(DISCOVERY_PORT);
    if (!discoveryListening)
    {
      return;
    }
  }

  int size = discoveryUdp.parsePacket();
  if (size <= 0)
  {
    return;
  }
  char buf[64];
  int len = discoveryUdp.read(buf, sizeof(buf) - 1);
  if (len <= 0)
  {
    return;
  }
  buf[len] = '\0';
  String message(buf);
  if (!message.startsWith(DISCOVERY_PREFIX))
  {
    return;
  }
  int port = message.substring(strlen(DISCOVERY_PREFIX)).toInt();
  if (port <= 0 || port > 65535)
  {
    return;
  }

  String url = String("http://") + discoveryUdp.remoteIP().toString() + ":" + port + "/buzzer-event";
  if (url != serverUrl)
  {
    serverUrl = url;
    prefs.putString("url", serverUrl);
    Serial.print("Found Lucky Draw at ");
    Serial.println(serverUrl);
    lastHeartbeatTime = 0; // say hello to the new address straight away
  }
}

// Non-blocking: accumulates characters from the app over USB serial until a
// newline, then hands the complete line off for parsing. Runs every loop()
// alongside the button/heartbeat logic, never blocking either of them.
void checkForProvisioning()
{
  while (Serial.available() > 0)
  {
    char c = (char)Serial.read();
    if (c == '\n')
    {
      serialLine.trim();
      if (serialLine.length() > 0)
      {
        handleProvisioningLine(serialLine);
      }
      serialLine = "";
    }
    else if (c != '\r')
    {
      serialLine += c;
      if (serialLine.length() > 512)
      {
        // Runaway line (noise on the wire, wrong baud rate, etc.) — drop it
        // rather than growing this buffer forever.
        serialLine = "";
      }
    }
  }
}

void handleProvisioningLine(const String &line)
{
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, line);

  if (err)
  {
    Serial.print("PROV_ERROR:bad json (");
    Serial.print(err.c_str());
    Serial.println(")");
    return;
  }

  if (!doc["ssid"].is<const char *>() || !doc["password"].is<const char *>() ||
      !doc["server_url"].is<const char *>())
  {
    Serial.println("PROV_ERROR:missing ssid/password/server_url");
    return;
  }

  wifiSsid = doc["ssid"].as<String>();
  wifiPassword = doc["password"].as<String>();
  serverUrl = doc["server_url"].as<String>();

  prefs.putString("ssid", wifiSsid);
  prefs.putString("pass", wifiPassword);
  prefs.putString("url", serverUrl);

  Serial.println("PROV_OK");
  Serial.println("PROV_CONNECTING");
  setBuzzerState(RECEIVING_SETUP);
  connectToWiFi();

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.print("PROV_CONNECTED:");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("PROV_FAILED");
  }
}
