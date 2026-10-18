# Lucky Draw

A Windows desktop app for running lucky draws at live events: a slot-machine reveal on a green-screen output window, ready to feed straight into your video switcher.

It runs **fully offline**. Participants, prizes and results are all stored on the laptop, so a draw never depends on venue internet.

---

## Download

1. Open the [**latest release**](https://github.com/Bradyee81/eventdraw/releases/latest).
2. Under **Assets**, download the file ending in **`_x64-setup.exe`**.
3. Run it and follow the installer.

The installer includes everything the app needs:

| Included | What it's for |
| --- | --- |
| Lucky Draw app | The control and output windows |
| Microsoft WebView2 | The engine the app's screens run on. Only installed if the PC doesn't already have it (Windows 10/11 usually do). |
| Silicon Labs CP210x USB driver | Lets the PC talk to the buzzer over USB. Windows asks for admin permission once; skip it if you don't use a buzzer. |
| Buzzer flash tool | For loading firmware onto a new buzzer. Start menu → **Lucky Draw - Flash Buzzer**. |
| CSV templates | Participant and prize list examples. Start menu → **Lucky Draw - CSV Templates**. |

> Windows may show a blue "Windows protected your PC" screen because the installer isn't code-signed. Click **More info → Run anyway**.

## Updating

Lucky Draw checks for a new version each time it opens (when the PC is online). If there is one, a yellow **Update available** bar appears at the top of the Control window:

- **Update now** downloads the new version, installs it and restarts the app.
- **Later** hides the bar until next launch.
- **What's new** shows the release notes.

Your current version and a **Check for updates** button are at the bottom of the left-hand menu.

The app never updates by itself, so it won't restart during a show. Just don't press **Update now** mid-event. Your participants, prizes and results are kept when you update.

> Installed version **0.1.0** or earlier? Those versions can't update themselves. Download and run the installer above once; updates are automatic from then on.

---

## Features

**Two draw modes**
- **Manual Draw**: the emcee announces a number and the operator types it in. Digits lock in one by one, left to right, with undo for typos. If a participant list is loaded, the number is checked against it and the winner's name is shown. A manual-mode toggle skips the list entirely as a fail-safe.
- **Auto Draw**: the app picks winners at random from the participant list, in rounds. Plan rounds before the event from your prize list (section, prizes, winner count) and choose whether past winners can win again. One press reveals the whole round, and you can re-show the winner list at any time.

**Output for the big screen**
- A separate Output window that goes fullscreen with **Present**, for a projector or capture card.
- 4–12 digit slots to match your ticket numbers, with staggered slot-machine landing.
- Chroma-key background presets (greens and blues) so the switcher can key it out cleanly.
- Title and footer/sponsor text with their own font, size, colour and alignment.

**Event setup**
- Import participants (ticket number + name) and prizes from CSV or Excel, or add and edit them in the app for last-minute changes.
- Draw sections (e.g. "Consolation", "Grand Prize") with draws numbered within each section.
- Results log with every winner, time and section, exportable to CSV/Excel.

**Physical buzzer (optional)**
- An ESP32 push-button buzzer starts the roll and reveal over the local WiFi.
- Set-up is plug-and-play: connect the buzzer by USB, open **Config → Buzzer Setup**, press **Connect**. The app sends it the laptop's current WiFi and address, with no reflashing needed for a new venue.
- The on-screen buttons always work too, so a disconnected buzzer never stops the show.

## Typical event flow

1. **Setup**: import the participant list and prize list (or download the templates from this screen).
2. **Config**: set the number of slots to match your ticket length, and connect the buzzer if you're using one.
3. **Display Settings**: pick a background colour and set the title and footer text.
4. **Draw** or **Auto Draw**: press **Present** to send the Output window fullscreen on the second display, then run the draws.
5. **Results**: export the winner list when you're done.

Closing the Control window closes the whole app, including the Output window.

## Where data is stored

Everything lives in a local database at `%APPDATA%\com.brad.luckydraw`. Updating or reinstalling the app keeps it. Uninstalling only removes it if you tick **Delete the application data** in the uninstaller.

---

## For developers

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript + Tailwind, with SQLite for storage.

```
src/                 React UI: control/ (operator window), output/ (audience window)
src-tauri/           Rust side: database migrations, buzzer server, USB provisioning
src-tauri/resources/ Files bundled into the installer (driver, templates, flash tool)
src-tauri/windows/   Installer hooks and license page
ESP32 Buzzer/        Buzzer firmware (PlatformIO) and the standalone flash tool
.github/workflows/   Release build
```

### Run locally

Requires Node.js 22+ and Rust (stable).

```bash
npm install
npm run tauri dev
```

The first run also builds the buzzer flash tool, which takes a few minutes. Later runs are quick.

### Releasing a new version

1. Bump `version` in `package.json` and `src-tauri/Cargo.toml`.
2. Commit and push to `main`.
3. In GitHub, open **Actions → Release → Run workflow**.

The workflow builds the installer on Windows, signs the update, and publishes release `v<version>` with the installer and `latest.json`. Installed apps pick it up the next time they open.

Update signing uses a private key that is **not** in this repo. It's stored in the repository's GitHub Actions secrets as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a backup of the key. If it's lost, already-installed copies can no longer accept updates and everyone has to reinstall manually.

### Third-party components

The CP210x USB driver in `src-tauri/resources/drivers/cp210x` is © Silicon Labs and distributed under its own license (`SLAB_License_Agreement_VCP_Windows.txt`), which the installer shows before installing.
