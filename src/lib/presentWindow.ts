import { useCallback, useEffect, useState } from "react";
import { availableMonitors, PhysicalPosition, Window, type Monitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const OUTPUT_LABEL = "output";
const MONITOR_KEY = "present.monitor";

export interface DisplayOption {
  key: string;
  label: string;
  monitor: Monitor;
}

/** A stable-ish key so the chosen display is remembered across launches. */
function monitorKey(m: Monitor): string {
  return `${m.name ?? "display"}@${m.position.x},${m.position.y}`;
}

function loadSavedMonitor(): string {
  try {
    return localStorage.getItem(MONITOR_KEY) ?? "";
  } catch {
    return "";
  }
}

async function listDisplays(): Promise<DisplayOption[]> {
  const monitors = await availableMonitors();
  return monitors.map((m, i) => ({
    key: monitorKey(m),
    label: `Display ${i + 1} — ${m.size.width}×${m.size.height}${m.position.x === 0 && m.position.y === 0 ? " (main)" : ""}`,
    monitor: m,
  }));
}

/** Opens the Output window (hidden) if it isn't already, waiting until it exists. */
async function getOrCreateOutputWindow(): Promise<Window> {
  const existing = await Window.getByLabel(OUTPUT_LABEL);
  if (existing) return existing;
  const win = new WebviewWindow(OUTPUT_LABEL, {
    url: "index.html",
    title: "Lucky Draw — Output",
    width: 1280,
    height: 720,
    visible: false,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(e));
  });
  return win;
}

/**
 * Present / Exit Present for the audience-facing Output window.
 * Present opens it fullscreen on the chosen display; Exit Present closes it.
 */
export function usePresent() {
  const [presenting, setPresenting] = useState(false);
  const [displays, setDisplays] = useState<DisplayOption[]>([]);
  const [selectedKey, setSelectedKey] = useState(loadSavedMonitor);

  const refreshDisplays = useCallback(async () => {
    const found = await listDisplays().catch(() => []);
    setDisplays(found);
    // Default to a secondary display if there is one (usually the projector).
    setSelectedKey((prev) => {
      if (found.some((d) => d.key === prev)) return prev;
      const secondary = found.find((d) => d.monitor.position.x !== 0 || d.monitor.position.y !== 0);
      return (secondary ?? found[0])?.key ?? "";
    });
  }, []);

  // Pick up an Output window that's already open (e.g. presented from the other draw screen).
  useEffect(() => {
    refreshDisplays();
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = await Window.getByLabel(OUTPUT_LABEL);
      if (win) {
        setPresenting(true);
        unlisten = await win.listen("tauri://destroyed", () => setPresenting(false));
      }
    })();
    return () => unlisten?.();
  }, [refreshDisplays]);

  const selectDisplay = (key: string) => {
    setSelectedKey(key);
    try {
      localStorage.setItem(MONITOR_KEY, key);
    } catch {
      // Choice just won't be remembered.
    }
  };

  const start = useCallback(async () => {
    const display = displays.find((d) => d.key === selectedKey) ?? displays[0];
    const win = await getOrCreateOutputWindow();
    if (display) {
      // Leave fullscreen first so the window can move, then fill the chosen display.
      await win.setFullscreen(false);
      await win.setPosition(new PhysicalPosition(display.monitor.position.x, display.monitor.position.y));
    }
    await win.show();
    await win.setFullscreen(true);
    await win.setFocus();
    setPresenting(true);
    await win.listen("tauri://destroyed", () => setPresenting(false));
  }, [displays, selectedKey]);

  const stop = useCallback(async () => {
    const win = await Window.getByLabel(OUTPUT_LABEL);
    if (win) await win.close();
    setPresenting(false);
  }, []);

  return {
    presenting,
    displays,
    selectedKey,
    selectDisplay,
    refreshDisplays,
    toggle: presenting ? stop : start,
  };
}
