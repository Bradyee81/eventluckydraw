import { useState } from "react";
import { SetupScreen } from "./SetupScreen";
import { ConfigScreen } from "./ConfigScreen";
import { DisplayScreen } from "./DisplayScreen";

type SetupTab = "setup" | "config" | "display";

const TABS: { id: SetupTab; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "config", label: "Config" },
  { id: "display", label: "Display Settings" },
];

const TAB_KEY = "setupHub.tab";

function loadTab(): SetupTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as SetupTab) : "setup";
  } catch {
    return "setup";
  }
}

/** Setup, Config and Display Settings on one page, one tab each. */
export function SetupHubScreen() {
  const [tab, setTab] = useState<SetupTab>(loadTab);

  const changeTab = (next: SetupTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Tab just won't be remembered.
    }
  };

  return (
    <div>
      <div className="mx-auto max-w-2xl px-8 pt-8">
        <div role="tablist" className="flex gap-1 border-b border-white/10">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => changeTab(t.id)}
              className={`-mb-px rounded-t-md border-b-2 px-4 py-2 font-semibold transition-colors ${
                tab === t.id
                  ? "border-[#F5C518] text-[#F5C518]"
                  : "border-transparent text-white/60 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "setup" && <SetupScreen />}
      {tab === "config" && <ConfigScreen />}
      {tab === "display" && <DisplayScreen />}
    </div>
  );
}
