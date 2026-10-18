import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "error";

/**
 * Checks GitHub Releases for a newer version. Never installs on its own —
 * the operator has to press Update, so nothing changes mid-event.
 */
export function useAppUpdater() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkNow = useCallback(async (manual: boolean) => {
    setStatus("checking");
    setError(null);
    try {
      const found = await check();
      setUpdate(found);
      setStatus(found ? "available" : "up-to-date");
      if (found) setDismissed(false);
    } catch (err) {
      // The launch check stays quiet — venues are often offline.
      setStatus(manual ? "error" : "idle");
      if (manual) setError(String(err));
    }
  }, []);

  useEffect(() => {
    getVersion().then(setCurrentVersion);
    checkNow(false);
  }, [checkNow]);

  const install = useCallback(async () => {
    if (!update) return;
    setStatus("downloading");
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) setProgress(Math.round((received / total) * 100));
        }
      });
      await relaunch();
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }, [update]);

  return {
    currentVersion,
    status,
    update,
    progress,
    error,
    dismissed,
    dismiss: () => setDismissed(true),
    show: () => setDismissed(false),
    checkNow: () => checkNow(true),
    install,
  };
}

export type AppUpdater = ReturnType<typeof useAppUpdater>;
