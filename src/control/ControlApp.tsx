import { useState } from "react";
import { AppDataProvider, useAppData } from "./AppDataContext";
import { SetupScreen } from "./screens/SetupScreen";
import { ConfigScreen } from "./screens/ConfigScreen";
import { DisplayScreen } from "./screens/DisplayScreen";
import { DrawScreen } from "./screens/DrawScreen";
import { AutoDrawScreen } from "./screens/AutoDrawScreen";
import { ResultsScreen } from "./screens/ResultsScreen";

type Screen = "setup" | "config" | "display" | "draw" | "auto-draw" | "results";

const NAV: { id: Screen; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "config", label: "Config" },
  { id: "display", label: "Display Settings" },
  { id: "draw", label: "Draw" },
  { id: "auto-draw", label: "Auto Draw" },
  { id: "results", label: "Results" },
];

function Shell() {
  const [screen, setScreen] = useState<Screen>("draw");
  const { loading } = useAppData();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-white/60">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen text-sm">
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#0E1320] p-3">
        <div className="mb-4 px-2 pt-1 text-lg font-bold tracking-tight text-[#F5C518]">
          Lucky Draw
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
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {screen === "setup" && <SetupScreen />}
        {screen === "config" && <ConfigScreen />}
        {screen === "display" && <DisplayScreen />}
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
