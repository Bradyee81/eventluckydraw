// Builds the standalone buzzer flasher (ESP32 Buzzer/flash-tool) and drops it
// into src-tauri/resources/tools so the installer ships it. Runs before every
// Tauri dev/build; cargo makes repeat runs a fast no-op.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "ESP32 Buzzer", "flash-tool");

execFileSync("cargo", ["build", "--release", "--manifest-path", join(crate, "Cargo.toml")], {
  stdio: "inherit",
});

const outDir = join(root, "src-tauri", "resources", "tools");
mkdirSync(outDir, { recursive: true });
copyFileSync(join(crate, "target", "release", "flash-buzzer.exe"), join(outDir, "Flash Buzzer.exe"));
