**What's new**

- **Updating the buzzer's firmware now works.** **Update buzzer firmware** (in Buzzer setup) and the Start menu flash tool both failed with "Communication error while flashing device" on every buzzer. The flasher was restarting the buzzer after writing the first small piece of firmware, so the rest couldn't be written. It now writes all of the firmware in one go and restarts the buzzer only at the end. Tested on a real buzzer: the update takes about a minute.

**If your buzzer was built before the WiFi set-up feature:** plug it in, open **Setup → Config → Buzzer setup**, press **Update buzzer firmware** and wait for 100% (don't unplug). Then type the WiFi password and press **Connect**.

**New install:** download the file ending in `_x64-setup.exe` below and run it. Already have Lucky Draw 0.2.0 or later? Open it and press **Update now**.
