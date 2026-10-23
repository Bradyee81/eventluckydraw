# Buzzer wiring

Board: classic ESP32 DevKit (esp32dev) with a CP2102 USB chip. Pin numbers are the GPIO numbers printed on the board (e.g. `D4` or `4`).

## Button

| Button leg | ESP32 pin |
| --- | --- |
| One leg | **GPIO4** |
| Other leg | **GND** |

No resistor needed: the firmware turns on the chip's built-in pull-up.

## Status light (RGB LED, firmware v2+)

Use a 5 mm RGB LED, **common cathode** (when buying, pick "Common Cathode"). Its longest leg is the common one and goes to GND. Each colour goes through its own resistor:

| LED leg | Resistor | ESP32 pin |
| --- | --- | --- |
| Red | 220 Ω | **GPIO25** |
| Common (longest leg) | none | **GND** |
| Green | 100 Ω | **GPIO26** |
| Blue | 100 Ω | **GPIO27** |

Leg order differs between makers, so check which leg is which before soldering. With a 3V coin cell or a multimeter in diode mode, touch the common leg to the minus side and each other leg to the plus side in turn.

Green and blue get a smaller resistor because they need almost the full 3.3 V just to light. If one colour is much brighter than the others, raise its resistor.

A **common anode** LED won't work with this firmware: its colours would show inverted.

## Pins to leave free

Don't connect anything to **GPIO0, 2, 12 or 15**. The chip reads them at start-up, and wiring on them can stop the buzzer booting or being updated. GPIO2 drives the board's own small LED, which mirrors the status light's blinking.

## What the light means

| Light | Meaning |
| --- | --- |
| Green, steady | Connected to Lucky Draw, ready |
| Yellow, slow blink | On the WiFi, looking for Lucky Draw |
| Blue, fast blink | Joining the WiFi |
| Red, steady | Can't join the WiFi |
| Red, slow blink | No WiFi saved yet: plug in and press Connect |
| Purple, fast blink | Receiving new WiFi details from Connect |
| White flash | Button pressed |

The same list is in the app under **Buzzer Setup → What the buzzer's light means**. If you change the colours in `src/main.cpp` (`patternFor`), update both.

## After changing the firmware

1. Bump `FIRMWARE_VERSION` and `FIRMWARE_VERSION_TAG` together in `src/main.cpp`.
2. Build with PlatformIO, then copy `.pio/build/esp32dev/firmware.bin` into `flash-tool/firmware/` (and `bootloader.bin` / `partitions.bin` if they changed).
3. Flash a real buzzer and check it before releasing: buzzers in the field can only be fixed with **Update buzzer firmware**.
