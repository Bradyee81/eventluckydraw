import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getConfig, listParticipants, updateConfig as dbUpdateConfig } from "../lib/db";
import { emitEvent } from "../lib/events";
import type { AppConfig, Participant } from "../types";

interface AppDataValue {
  config: AppConfig | null;
  participants: Participant[];
  loading: boolean;
  refreshParticipants: () => Promise<void>;
  updateConfig: (patch: Partial<Omit<AppConfig, "id">>) => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshParticipants = useCallback(async () => {
    setParticipants(await listParticipants());
  }, []);

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

  return (
    <AppDataContext.Provider value={{ config, participants, loading, refreshParticipants, updateConfig }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
