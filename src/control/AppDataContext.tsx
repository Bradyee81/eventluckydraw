import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  resetAllData,
  getConfig,
  listKnownSections,
  listParticipants,
  listSectionSettings,
  setSectionSlotCount as dbSetSectionSlotCount,
  updateConfig as dbUpdateConfig,
} from "../lib/db";
import { emitEvent, onEvent } from "../lib/events";
import type { AppConfig, Participant, SectionSetting } from "../types";

interface AppDataValue {
  config: AppConfig | null;
  participants: Participant[];
  // Every section name in use (settings, prizes, participant tags).
  knownSections: string[];
  sectionSettings: SectionSetting[];
  loading: boolean;
  buzzerConnected: boolean;
  refreshParticipants: () => Promise<void>;
  refreshSections: () => Promise<void>;
  updateConfig: (patch: Partial<Omit<AppConfig, "id">>) => Promise<void>;
  /** Switches the current section, and the slot count with it if the section has its own. */
  selectSection: (name: string) => Promise<void>;
  setSectionSlotCount: (name: string, slotCount: number | null) => Promise<void>;
  /** Wipes all event data and settings, and clears the Output window. */
  factoryReset: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [knownSections, setKnownSections] = useState<string[]>([]);
  const [sectionSettings, setSectionSettings] = useState<SectionSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [buzzerConnected, setBuzzerConnected] = useState(false);

  // The buzzer is purely an additional input (FR16) — its connection state
  // is tracked here so any screen can show a status indicator without each
  // one opening its own listener.
  useEffect(() => {
    const unlisten = onEvent("buzzer:status", ({ connected }) => setBuzzerConnected(connected));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const refreshSections = useCallback(async () => {
    const [known, settings] = await Promise.all([listKnownSections(), listSectionSettings()]);
    setKnownSections(known);
    setSectionSettings(settings);
  }, []);

  const refreshParticipants = useCallback(async () => {
    setParticipants(await listParticipants());
    await refreshSections();
  }, [refreshSections]);

  useEffect(() => {
    (async () => {
      const [cfg] = await Promise.all([getConfig(), refreshParticipants()]);
      setConfig(cfg);
      setLoading(false);
      emitEvent("config:updated", cfg);
    })();
  }, [refreshParticipants]);

  const updateConfig = useCallback(async (patch: Partial<Omit<AppConfig, "id">>) => {
    const next = await dbUpdateConfig(patch);
    setConfig(next);
    await emitEvent("config:updated", next);
  }, []);

  const selectSection = useCallback(
    async (name: string) => {
      const slots = sectionSettings.find((s) => s.name === name)?.slot_count ?? null;
      await updateConfig(slots === null ? { current_section: name } : { current_section: name, slot_count: slots });
    },
    [sectionSettings, updateConfig]
  );

  const setSectionSlotCount = useCallback(
    async (name: string, slotCount: number | null) => {
      await dbSetSectionSlotCount(name, slotCount);
      await refreshSections();
      if (slotCount !== null && config?.current_section === name) {
        await updateConfig({ slot_count: slotCount });
      }
    },
    [config, refreshSections, updateConfig]
  );

  const factoryReset = useCallback(
    async () => {
      await resetAllData();
      try {
        localStorage.removeItem("autoDraw.onePrizePerRound");
        localStorage.removeItem("manualDraw.skipValidation");
      } catch {
        // Nothing stored — fine.
      }
      const cfg = await getConfig();
      setConfig(cfg);
      await emitEvent("config:updated", cfg);
      await emitEvent("draw:hide-result", {});
      await emitEvent("draw:reset", {});
      await refreshParticipants();
    },
    [refreshParticipants]
  );

  return (
    <AppDataContext.Provider
      value={{
        config,
        participants,
        knownSections,
        sectionSettings,
        loading,
        buzzerConnected,
        refreshParticipants,
        refreshSections,
        updateConfig,
        selectSection,
        setSectionSlotCount,
        factoryReset,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
