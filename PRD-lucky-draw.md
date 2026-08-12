# PRD: Lucky Draw App

**Module:** Lucky Draw (part of the Event Management Software suite)
**Audience:** Build brief for Claude Code
**Status:** Ready to build — MVP scope defined
**Author:** Brad (Yee Jeng Tat)
**Last updated:** August 11, 2026

---

## 1. Problem statement

Event teams currently rely on third-party lucky draw tools (e.g. log-lottery) that are buggy, not customizable to brand/event visuals, and don't cleanly support the two real-world draw scenarios teams actually run: a fully automated random draw from a registered guest list, and a manually-operated draw where numbers are announced on stage and typed in live. There is no single tool that handles both scenarios reliably, works fully offline, and outputs a broadcast-ready visual on a green screen for compositing into a live event feed.

## 2. Goals

- Replace unreliable third-party lucky draw software with a tool built for the exact way this team runs draws
- Must run **fully offline** — no internet dependency at the venue
- Output must be **broadcast/switcher-ready** (green screen, external display support)
- One shared codebase supporting **two draw modes**, not two separate apps
- Ship a working MVP fast, then layer on visual polish via Figma-designed assets later

## 3. Non-goals (explicitly out of scope for this PRD)

- CRM integration (participant lists are imported manually via file for now; live sync from the CRM module comes later once that module exists)
- Freeform drag/resize Canvas Designer (deferred — MVP uses fixed-slot layout only)
- 3D ball and card-flip animation styles (deferred — MVP ships with slot-machine style only)
- Auto Mode's full feature set is scoped as a fast-follow, not MVP (see Section 6)

## 4. Users

**Primary user: Draw Operator** — a staff member running the draw live on stage or at an event booth. Non-technical, needs a simple, low-error-rate interface they can operate under time pressure with an audience watching.

## 5. Core concept

One desktop app (Tauri), two modes, sharing the same participant/prize data model, animation engine, and dual-window (control + output) architecture.

|                | Manual Mode (MVP)                                                                                               | Auto Mode (fast-follow)                         |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Trigger        | Operator types the announced number                                                                             | App randomly selects from participant pool      |
| Validation     | If a participant list is loaded: validate number exists. If no list loaded: accept any number, no name attached | N/A                                             |
| Winner count   | Always 1 per draw action                                                                                        | Configurable per round (e.g. 5, 10)             |
| Repeat winners | N/A                                                                                                             | Toggle per round: exclude past winners or allow |

---

## 6. MVP scope (V1) — Manual Mode only

### 6.1 Screens

| Screen               | Purpose                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Setup**            | Import participant list (CSV/Excel) — optional. If skipped, Manual Mode runs with no validation                                                                                                                                      |
| **Config**           | Set number of slots (5–12, based on ticket digit length for this event); set slot design (digit strip image)                                                                                                                         |
| **Draw**             | Operator control: text input for the number being announced, "Confirm" action, live status of which slots have locked                                                                                                                |
| **Display Settings** | Background chroma key color, selectable from a curated palette of 6–8 preset options (see FR19); fixed text slots (title, footer/sponsor line) with font, size, color, alignment controls                                            |
| **Output Window**    | Fullscreen, hardware-facing (routes to switcher/capture card). Idle state = slots spinning continuously. "Present" button on Draw screen pushes to fullscreen on this window; "Exit Present" returns to idle without closing the app |

### 6.2 Functional requirements

- **FR1 — Slot count:** App supports 5 to 12 configurable slots per event, set on the Config screen
- **FR2 — Digit strip rendering:** Each slot renders a vertical sprite strip image (digits 0–9, stacked in order, equal height per digit, no gaps). One strip design is shared across all slots
- **FR3 — Idle animation:** On the Output Window, all configured slots spin continuously on loop when no draw is in progress
- **FR4 — Sequential lock-in:** When the operator types a number (e.g. `234781`), each corresponding slot locks to its digit **in left-to-right sequence**, matching the order typed — not all at once
- **FR5 — Landing motion:** Each slot performs several full rotations before decelerating and landing on its target digit (not an instant stop, not an ease-out from a static position) — dramatic, realistic slot-machine deceleration. Deceleration is staggered slot-to-slot: slot 1 fully lands before slot 2 begins slowing
- **FR6 — Validation (conditional):** If a participant list was imported in Setup, the app validates the typed number exists in that list before confirming. If no list was imported, any typed number is accepted and logged without a name attached
- **FR7 — Dual window architecture:** Control window (operator-facing, has all inputs/buttons) and Output window (audience/hardware-facing, fullscreen, no controls) run as separate windows within the same app instance, communicating via in-app events (not network calls) — so there is zero latency and no internet dependency
- **FR8 — Present/Exit Present:** A "Present" action sends the Output Window fullscreen; "Exit Present" returns it to idle. The app itself never closes when exiting present mode
- **FR9 — Results log:** Every confirmed draw is logged locally with: number drawn, timestamp, operator note (optional), and matched participant name if applicable. Exportable to CSV/Excel at any time
- **FR10 — Fully offline:** No feature in MVP scope requires an internet connection at any point during setup or operation. (Note: the ESP32 buzzer uses the venue's local WiFi network for device-to-app communication — this is a local network connection, not internet access, so it does not violate this requirement. The app must still function with the on-screen Draw controls if the buzzer is unavailable or disconnected.)
- **FR15 — Physical buzzer input (ESP32, WiFi):** The app listens for button-press events from an ESP32 buzzer over the local WiFi network. A single press triggers the same "start roll" action as the on-screen control:
  - **Manual Mode:** buzzer press starts the slots rolling; the operator still types the number manually to lock in each digit, exactly as already specified in FR4–FR6. The buzzer does not affect number entry
  - **Auto Mode (V1.1):** first buzzer press starts the roll; a second press triggers the reveal — the app randomly draws from the participant pool and displays the result (see Section 7)
- **FR16 — Buzzer connection status & fail-safe:** The Draw screen must show a clear connected/disconnected indicator for the buzzer. The on-screen controls (Start Roll, and Reveal in Auto Mode) are always active regardless of buzzer state — the buzzer is purely an additional input, never the only way to trigger an action. If the buzzer disconnects, it simply goes idle/non-functional ("dummy") and the operator retains full control from the Draw screen with no interruption to the draw flow
- **FR17 — Network setup:** The venue WiFi network is provided by the operator's own portable router/hotspot (not venue infrastructure), so the app can assume a WiFi network will be available and stable at every event
- **FR19 — Chroma key color palette:** Instead of a single fixed background color, the Display Settings screen offers a curated palette of 6–8 chroma key color presets (standard broadcast greens/blues, e.g. pure green `#00FF00`, broadcast green `#00B140`, a couple of blue-based options). The operator picks whichever preset doesn't visually clash with the digit strip design's own colors, so the switcher can key out the background cleanly without confusing it with digit artwork
- **FR18 — Undo/redo during entry:** While typing a number in Manual Mode, the operator can undo one digit at a time (removing the last locked slot and returning it to a rolling state) rather than resetting the whole entry. Redo restores the last undone digit if not yet overwritten by a new entry. This applies only before the draw is confirmed — once confirmed and logged, use the results log to correct/annotate instead of altering a completed draw record

- **FR20 — DMX lighting cue configuration:** The Config/Display Settings screen includes a lighting cue editor, letting the operator define a cue (color, intensity, and effect where applicable) for each draw stage: Idle, Rolling, Reveal. This is configurable per event, since different events want different lighting treatments. See the companion ESP32 hardware spec for how these cues are transmitted and executed
- **FR21 — Cue sync to buzzer hardware:** When lighting cues are set or changed, the app pushes the full cue set to the ESP32 buzzer/DMX controller over WiFi. The ESP32 executes the correct cue locally the instant it registers a button press, independent of app round-trip latency at that moment

### 6.3 Non-functional requirements

- **Platform:** Windows only for MVP (macOS support can be added later if needed)
- **Hybrid performance target:** primary machine is a high-spec laptop, but the app must also run acceptably on a mid-range rental laptop as a fallback if the primary is unavailable. Practically, this means the animation system should be built with a **performance mode toggle** (e.g. reduced rotation complexity or frame rate) rather than assuming high-spec hardware is guaranteed — so a rental laptop on the day doesn't cause visible stutter during a live reveal
- Animation must run smoothly (no visible stutter) on the target hardware above — this is a live, on-stage tool, so dropped frames during the reveal are a visible failure, not a minor bug
- App must never crash mid-draw; a corrupted/missing digit asset should fail gracefully with a clear error, not a blank output screen during a live event

### 6.4 Out of scope for MVP (explicitly deferred)

- Auto Mode (random draw, winner count, exclusion toggle)
- 3D ball and card-flip animation styles
- Freeform Canvas Designer (drag/resize/rotate visual elements)
- Separate Results Display screen for side projector
- Live sync from the CRM module (manual file import only, for now)

---

## 7. Fast-follow scope (V1.1) — Auto Mode

Adds to the same app, reusing Manual Mode's animation engine and display pipeline:

- **FR11:** Round config with configurable winner count per draw (e.g. Draw 1 → 5 winners, Draw 2 → 10 winners)
- **FR12:** Random selection engine draws from the imported participant pool
- **FR13:** Per-round toggle: exclude participants who already won a prior round, or allow repeat wins
- **FR14:** Audit trail per round: mode used, exclusion setting on/off, full winner list, timestamp — exportable

## 8. Later enhancements (post-V1.1, design-driven)

- Additional animation styles: card flip, then 3D ball (highest complexity, sequenced last per earlier risk discussion)
- Freeform Canvas Designer to replace fixed-slot layout, once Figma design direction is finalized
- Separate Results Display template for side projector
- Live CRM sync replacing manual CSV/Excel import

---

## 9. Data model (conceptual)

| Entity                                   | Key fields                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Participant (optional, if list imported) | id, name, reference/ticket number                                                                           |
| DrawRecord                               | id, mode (manual), number drawn, matched participant (nullable), timestamp, operator note                   |
| DisplayConfig                            | background color, slot count, digit strip asset reference, text slot contents (title/footer), font settings |

## 10. Assets required before build

- One digit strip image: 0–9 stacked vertically, equal height per digit, no gaps, sized to match the intended on-screen slot dimensions (e.g. 200×300px per digit, or 2x for sharpness)
- Final digit strip color palette, so the 6–8 chroma key presets (FR19) can be chosen to avoid clashing with it

## 11. Success criteria for MVP

- A full draw (idle → operator types number → sequential animated reveal → result logged) runs start to finish with zero internet connectivity
- Output window displays cleanly on an external display/capture card with a clean green screen key
- Operator can complete a draw and export results without needing developer support

## 12. Open questions

- What's the rough spec of the mid-range rental laptop, so the "performance mode" fallback can be tested against a realistic worst case (not just assumed)?
- The exact 6–8 colors for the chroma key palette (FR19) need to be finalized once the digit strip design is complete in Figma/Canva, so presets can be chosen to specifically avoid clashing with the final artwork

## 13. Tech notes (reference from prior planning)

- **Framework:** Tauri (desktop shell) — matches reasoning from reviewing github.com/LOG1997/log-lottery as prior art
- **Frontend:** React (or Vue) + Tailwind — consistent with the rest of the module suite
- **Local storage:** results log and config stored locally (file-based or embedded SQLite), no backend dependency for MVP
- **Buzzer communication:** app runs a lightweight local WebSocket (or HTTP) listener; the ESP32 connects to the venue's local WiFi and sends button-press events to it. Low-latency, LAN-only — no internet required
- **Development environment:** VS Code with the Claude Code extension
