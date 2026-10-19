import { useState } from "react";
import type { AppUpdater } from "../lib/updater";

/** Shown across the top of the Control window when a newer version is out. */
export function UpdateBanner({ updater }: { updater: AppUpdater }) {
  const [showNotes, setShowNotes] = useState(false);
  const { update, status, progress, error, currentVersion } = updater;

  const visible =
    update && !updater.dismissed && (status === "available" || status === "downloading" || status === "error");
  if (!visible) return null;

  const downloading = status === "downloading";

  return (
    <div className="border-b border-[#F5C518]/30 bg-[#F5C518]/10 px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-[#F5C518]">Update available</span>
        <span className="text-white/75">
          Lucky Draw {update.version} is ready (you have {currentVersion}). The app will restart — don't
          update during a live draw.
        </span>
        <div className="ml-auto flex items-center gap-2">
          {update.body && (
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="rounded-md px-3 py-1.5 text-white/60 hover:bg-white/5 hover:text-white"
            >
              {showNotes ? "Hide notes" : "What's new"}
            </button>
          )}
          {!downloading && (
            <button
              onClick={updater.dismiss}
              className="rounded-md border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/5"
            >
              Later
            </button>
          )}
          <button
            onClick={updater.install}
            disabled={downloading}
            className="rounded-md bg-[#F5C518] px-4 py-1.5 font-semibold text-[#10141F] disabled:opacity-60"
          >
            {downloading ? `Updating… ${progress ?? 0}%` : "Update now"}
          </button>
        </div>
      </div>
      {showNotes && update.body && (
        <pre className="mt-3 whitespace-pre-wrap font-sans text-xs text-white/60">{update.body}</pre>
      )}
      {status === "error" && error && <p className="mt-2 text-xs text-red-300">Update failed: {error}</p>}
    </div>
  );
}

/** Version + manual check, pinned to the bottom of the side menu. */
export function UpdateStatusFooter({ updater }: { updater: AppUpdater }) {
  const { status, currentVersion, update, error } = updater;

  let message: string | null = null;
  if (status === "checking") message = "Checking…";
  else if (status === "up-to-date") message = "You're up to date.";
  else if (status === "available" && update) message = `Version ${update.version} available.`;
  else if (status === "error" && !update) message = "Couldn't check — are you online?";

  return (
    <div className="border-t border-white/10 px-2 pt-3 text-xs text-white/40">
      <div>Version {currentVersion ?? "…"}</div>
      <button
        onClick={update ? updater.show : updater.checkNow}
        disabled={status === "checking" || status === "downloading"}
        className="mt-1 text-white/60 underline-offset-2 hover:text-[#F5C518] hover:underline disabled:opacity-50"
      >
        {update ? "Show update" : "Check for updates"}
      </button>
      {message && <div className="mt-1" title={error ?? undefined}>{message}</div>}
    </div>
  );
}
