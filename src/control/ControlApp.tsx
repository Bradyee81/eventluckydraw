import { useState } from "react";
import { AppDataProvider, useAppData } from "./AppDataContext";
import { SetupHubScreen } from "./screens/SetupHubScreen";
import { DrawScreen } from "./screens/DrawScreen";
import { AutoDrawScreen } from "./screens/AutoDrawScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { UpdateBanner, UpdateStatusFooter } from "../components/UpdateBanner";
import { PresentControl } from "../components/PresentControl";
import { useAppUpdater } from "../lib/updater";
import { useCollectionPointPublisher } from "../lib/collectionPoint";

type Screen = "setup" | "draw" | "auto-draw" | "results";

const NAV: { id: Screen; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "draw", label: "Manual Draw" },
  { id: "auto-draw", label: "Auto Draw" },
  { id: "results", label: "Results" },
];

function Shell() {
  const [screen, setScreen] = useState<Screen>("draw");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const { loading } = useAppData();
  const updater = useAppUpdater();
  useCollectionPointPublisher();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-white/60">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen text-sm">
      {navCollapsed ? (
        <div className="flex w-8 shrink-0 flex-col items-center border-r border-white/10 bg-[#0E1320] pt-3">
          <button
            onClick={() => setNavCollapsed(false)}
            title="Expand menu"
            className="rounded-md p-1 text-white/50 hover:bg-white/5 hover:text-[#F5C518]"
          >
            ›
          </button>
          <div className="mt-auto mb-3">
            <PresentControl compact />
          </div>
        </div>
      ) : (
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#0E1320] p-3">
          <div className="mb-4 flex items-center justify-between px-2 pt-1">
            <span className="text-lg font-bold tracking-tight text-[#F5C518]">Lucky Draw</span>
            <button
              onClick={() => setNavCollapsed(true)}
              title="Collapse menu"
              className="rounded-md px-1 text-white/40 hover:bg-white/5 hover:text-white"
            >
              ‹
            </button>
          </div>
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`rounded-md px-3 py-2 text-left transition-colors ${
                screen === item.id
                  ? "bg-[#F5C518] font-semibold text-[#10141F]"
                  : "text-white/75 hover:bg-white/5"
              }`}
            >
              {item.label}
            </button>
          ))}
          <div className="mt-auto mb-3">
            <PresentControl />
          </div>
          <UpdateStatusFooter updater={updater} />
        </nav>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <UpdateBanner updater={updater} />
        {screen === "setup" && <SetupHubScreen />}
        {screen === "draw" && <DrawScreen />}
        {screen === "auto-draw" && <AutoDrawScreen />}
        {screen === "results" && <ResultsScreen />}
      </main>
    </div>
  );
}

export function ControlApp() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  );
}
