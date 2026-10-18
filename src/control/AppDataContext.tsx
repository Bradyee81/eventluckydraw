import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  deleteSection,
  renameSection,
  resetAllData,
  getConfig,
  listKnownSections,
  listParticipants,
  listSectionSettings,
  setSectionSlotCount as dbSetSectionSlotCount,
  updateConfig as dbUpdateConfig,
} from "../lib/db";
import { emitEvent, onEvent } from "../lib/events";
import type { AppConfig, DrawMode, Participant, SectionSetting } from "../types";

/** The config column holding each draw screen's selected section. */
const SECTION_KEY: Record<DrawMode, "current_section" | "auto_section"> = {
  manual: "current_section",
  auto: "auto_section",
};

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
  /** Switches one draw screen's section, and the slot count with it if the section has its own. */
  selectSection: (name: string, mode: DrawMode) => Promise<void>;
  /** Called when a draw screen opens: applies that screen's section slot count to the Output window. */
  activateMode: (mode: DrawMode) => Promise<void>;
  renameDraw: (oldName: string, newName: string) => Promise<void>;
  deleteDraw: (name: string) => Promise<void>;
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

  // Which draw screen is in use, so a slot-count change applies to the right section.
  const activeModeRef = useRef<DrawMode>("manual");

  const slotsFor = useCallback(
    (name: string) => sectionSettings.find((s) => s.name === name)?.slot_count ?? null,
    [sectionSettings]
  );

  const selectSection = useCallback(
    async (name: string, mode: DrawMode) => {
      activeModeRef.current = mode;
      const slots = slotsFor(name);
      const key = SECTION_KEY[mode];
      await updateConfig(slots === null ? { [key]: name } : { [key]: name, slot_count: slots });
    },
    [slotsFor, updateConfig]
  );

  const activateMode = useCallback(
    async (mode: DrawMode) => {
      activeModeRef.current = mode;
      const section = config?.[SECTION_KEY[mode]] ?? "";
      const slots = section ? slotsFor(section) : null;
      if (slots !== null && slots !== config?.slot_count) {
        await updateConfig({ slot_count: slots });
      }
    },
    [config, slotsFor, updateConfig]
  );

  const setSectionSlotCount = useCallback(
    async (name: string, slotCount: number | null) => {
      await dbSetSectionSlotCount(name, slotCount);
      await refreshSections();
      if (slotCount !== null && config?.[SECTION_KEY[activeModeRef.current]] === name) {
        await updateConfig({ slot_count: slotCount });
      }
    },
    [config, refreshSections, updateConfig]
  );

  const reloadConfig = useCallback(async () => {
    const cfg = await getConfig();
    setConfig(cfg);
    await emitEvent("config:updated", cfg);
  }, []);

  const renameDraw = useCallback(
    async (oldName: string, newName: string) => {
      await renameSection(oldName, newName);
      await reloadConfig();
      await refreshParticipants();
    },
    [reloadConfig, refreshParticipants]
  );

  const deleteDraw = useCallback(
    async (name: string) => {
      await deleteSection(name);
      await reloadConfig();
      await refreshParticipants();
    },
    [reloadConfig, refreshParticipants]
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
        activateMode,
        renameDraw,
        deleteDraw,
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
