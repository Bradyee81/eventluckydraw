import { useEffect, useState } from "react";
import { Window } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export interface PresentableWindow {
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  listen(event: string, handler: () => void): Promise<() => void>;
}

async function getOrCreateOutputWindow(): Promise<PresentableWindow> {
  const existing = await Window.getByLabel("output");
  if (existing) return existing;
  const win = new WebviewWindow("output", {
    url: "index.html",
    title: "Lucky Draw — Output",
    width: 1280,
    height: 720,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(e));
  });
  return win;
}

/** Present/Exit Present toggle, resilient to the Output window being closed externally. */
export function usePresentToggle() {
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = await Window.getByLabel("output");
      if (win) {
        unlisten = await win.listen("tauri://destroyed", () => setPresenting(false));
      }
    })();
    return () => unlisten?.();
  }, []);

  const toggle = async () => {
    const win = await getOrCreateOutputWindow();
    const isFull = await win.isFullscreen().catch(() => false);
    if (isFull) {
      await win.setFullscreen(false);
      setPresenting(false);
    } else {
      await win.show();
      await win.setFullscreen(true);
      await win.setFocus();
      setPresenting(true);
      await win.listen("tauri://destroyed", () => setPresenting(false));
    }
  };

  return { presenting, toggle };
}
