/*
  Lucky Draw Buzzer — Phase 1 Firmware (PlatformIO version)
  ESP32 DevKit (CP2102)

  What this does:
  - Reads a single button on GPIO4 (switch wires only — LED not wired yet, that's Phase 2)
  - Debounces the button in software
  - Tracks a 2-stage press sequence: 1st press = ROLL, 2nd press = REVEAL, then resets
  - Prints every event to the Serial Monitor (115200 baud) so you can verify it works
    even before the main app exists to receive these events
  - Attempts to connect to WiFi and send each event as an HTTP POST — if this fails
    (no WiFi, no server yet), it logs the failure but keeps working locally, since the
    button logic must never depend on the network being available

  WiFi provisioning:
  - SSID / password / server URL are NOT compiled in. They're stored in flash (NVS)
    and loaded on boot. The Lucky Draw app pushes them over this same USB serial
    connection (see handleProvisioning()) so re-provisioning for a new venue is just
    "plug in USB-C, press Connect in the app" — no reflashing needed.
  - On a factory-fresh board with nothing stored yet, falls back to the constants
    below so it's still testable standalone before the app provisions it.
*/
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>

// Only used on a truly blank board before it's ever been provisioned from
// the Lucky Draw app — real values always come from NVS after that. Not
// real credentials; fill in your own if you want standalone testing without
// the app.
const char *FALLBACK_WIFI_SSID = "";
const char *FALLBACK_WIFI_PASSWORD = "";
const char *FALLBACK_SERVER_URL = "http://192.168.1.100:3000/buzzer-event";

const int BUTTON_PIN = 4;
const unsigned long DEBOUNCE_DELAY_MS = 50;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000; // lets the app show a live connected/disconnected indicator

Preferences prefs;
String wifiSsid;
String wifiPassword;
String serverUrl;

unsigned long lastHeartbeatTime = 0;
String serialLine;

// Sequence state: 0 = idle (waiting for first press), 1 = rolled (waiting for second press)
int sequenceState = 0;

int lastRawReading = HIGH;
int debouncedState = HIGH;
unsigned long lastChangeTime = 0;

void loadProvisioning();
void connectToWiFi();
void checkButton();
void onButtonPressed();
void sendEvent(const char *eventName);
void sendHeartbeatIfDue();
void checkForProvisioning();
void handleProvisioningLine(const String &line);

void setup()
{
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("Lucky Draw Buzzer — Phase 1 starting up...");

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  prefs.begin("buzzer", false);
  loadProvisioning();
  connectToWiFi();
}

void loop()
{
  checkButton();
  sendHeartbeatIfDue();
  checkForProvisioning();
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

  WiFi.disconnect(true);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20)
  {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println();
    Serial.print("WiFi connected. IP address: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println();
    Serial.println("WiFi connection failed — continuing without it. Button events will still print to Serial.");
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
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"event\":\"") + eventName + "\"}";
  int responseCode = http.POST(payload);

  if (responseCode > 0)
  {
    Serial.print("   sent to app, response code: ");
    Serial.println(responseCode);
  }
  else
  {
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
  if (now - lastHeartbeatTime < HEARTBEAT_INTERVAL_MS)
  {
    return;
  }
  lastHeartbeatTime = now;
  sendEvent("heartbeat");
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
