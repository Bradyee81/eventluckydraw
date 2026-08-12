import { useCallback, useEffect, useState } from "react";
import { useAppData } from "../AppDataContext";
import { emitEvent } from "../../lib/events";
import { usePresentToggle } from "../../lib/presentWindow";
import { worstCaseRevealMs } from "../../lib/reelTiming";
import { formatSectionLabel } from "../../lib/format";
import {
  addPlannedRound,
  deletePlannedRound,
  insertDrawRecord,
  listDrawRecords,
  listPlannedRounds,
  listPrizes,
  listPriorWinnerIds,
} from "../../lib/db";
import { SectionControl } from "../../components/SectionControl";
import { RecentDraws } from "../../components/RecentDraws";
import type { DrawRecord, Participant, PlannedRound, Prize } from "../../types";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function ticketToDigits(ticket: string, slotCount: number): number[] | null {
  const cleaned = ticket.replace(/\D/g, "");
  if (cleaned.length === 0 || cleaned.length > slotCount) return null;
  return cleaned.padStart(slotCount, "0").split("").map(Number);
}

function pickRandom<T>(pool: T[], count: number): T[] {
  const arr = [...pool];
  const n = Math.min(count, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

interface WinnerEntry {
  participant: Participant;
  section_sequence: number | null;
  revealed: boolean;
}

export function AutoDrawScreen() {
  const { config, participants, updateConfig } = useAppData();
  const currentSection = config?.current_section ?? "";
  const { presenting, toggle: togglePresent } = usePresentToggle();

  const [winnerCount, setWinnerCount] = useState(1);
  const [excludeRepeats, setExcludeRepeats] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [winners, setWinners] = useState<WinnerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resultShown, setResultShown] = useState(false);
  const [recentRecords, setRecentRecords] = useState<DrawRecord[]>([]);

  const [plannedRounds, setPlannedRounds] = useState<PlannedRound[]>([]);
  const [newRoundSection, setNewRoundSection] = useState("");
  const [newRoundCount, setNewRoundCount] = useState(1);
  const [newRoundExclude, setNewRoundExclude] = useState(true);
  const [newRoundPrize, setNewRoundPrize] = useState("");

  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [activePrizeName, setActivePrizeName] = useState("");
  const prizeSections = Array.from(new Set(prizes.map((p) => p.section))).filter(Boolean);

  const refreshRecent = useCallback(() => {
    listDrawRecords().then((records) => setRecentRecords(records.slice(0, 8)));
  }, []);

  const refreshPlannedRounds = useCallback(() => {
    listPlannedRounds().then(setPlannedRounds);
  }, []);

  const refreshPrizes = useCallback(() => {
    listPrizes().then(setPrizes);
  }, []);

  useEffect(() => {
    refreshRecent();
    refreshPlannedRounds();
    refreshPrizes();
  }, [refreshRecent, refreshPlannedRounds, refreshPrizes]);

  const handleSelectRoundSection = (section: string) => {
    setNewRoundSection(section);
    const prize = prizes.find((p) => p.section === section);
    setNewRoundPrize(prize?.name ?? "");
    if (prize) setNewRoundCount(prize.winner_count);
  };

  const handleAddPlannedRound = async () => {
    if (!newRoundSection.trim()) return;
    await addPlannedRound({
      section: newRoundSection.trim(),
      winner_count: Math.max(1, newRoundCount),
      exclude_repeat_winners: newRoundExclude,
      prize_name: newRoundPrize,
    });
    setNewRoundSection("");
    setNewRoundCount(1);
    setNewRoundExclude(true);
    setNewRoundPrize("");
    refreshPlannedRounds();
  };

  const handleDeletePlannedRound = async (id: number) => {
    await deletePlannedRound(id);
    refreshPlannedRounds();
  };

  const loadPlannedRound = (round: PlannedRound) => {
    setWinnerCount(round.winner_count);
    setExcludeRepeats(!!round.exclude_repeat_winners);
    setActivePrizeName(round.prize_name);
    updateConfig({ current_section: round.section });
  };

  const runRound = useCallback(async () => {
    if (!config || isDrawing) return;
    setError(null);
    setNotice(null);
    setResultShown(false);

    if (participants.length === 0) {
      setError("No participant list loaded. Import one on the Setup screen first.");
      return;
    }

    let pool = participants;
    if (excludeRepeats) {
      const priorWinnerIds = await listPriorWinnerIds();
      pool = participants.filter((p) => !priorWinnerIds.has(p.id));
    }
    if (pool.length === 0) {
      setError("No eligible participants left to draw from (everyone has already won).");
      return;
    }

    const picks = pickRandom(pool, winnerCount);
    if (picks.length < winnerCount) {
      setNotice(
        `Only ${picks.length} eligible participant${picks.length === 1 ? "" : "s"} available — drawing ${picks.length} instead of ${winnerCount}.`
      );
    }

    for (const p of picks) {
      if (ticketToDigits(p.ticket_number, config.slot_count) === null) {
        setError(
          `Ticket "${p.ticket_number}" (${p.name}) doesn't fit the configured slot count (${config.slot_count}). Fix Config before running Auto Mode.`
        );
        return;
      }
    }

    setIsDrawing(true);
    setWinners(picks.map((participant) => ({ participant, section_sequence: null, revealed: false })));

    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const digits = ticketToDigits(p.ticket_number, config.slot_count)!;

      emitEvent("draw:reset", {});
      await sleep(250);
      digits.forEach((digit, index) => emitEvent("draw:digit-set", { index, digit }));
      await sleep(worstCaseRevealMs(config.slot_count) + 500);

      const sectionSequence = await insertDrawRecord({
        number: digits.join(""),
        participant_id: p.id,
        participant_name: p.name,
        operator_note: null,
        section: currentSection,
        mode: "auto",
        exclude_repeat_winners: excludeRepeats,
        prize_name: activePrizeName,
      });

      setWinners((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], section_sequence: sectionSequence, revealed: true };
        return next;
      });
      refreshRecent();
    }

    emitEvent("draw:reset", {});
    setIsDrawing(false);
  }, [
    config,
    isDrawing,
    participants,
    excludeRepeats,
    winnerCount,
    currentSection,
    activePrizeName,
    refreshRecent,
  ]);

  const toggleShowResults = () => {
    if (resultShown) {
      emitEvent("draw:hide-result", {});
      setResultShown(false);
      return;
    }
    const revealed = winners.filter((w) => w.revealed);
    if (revealed.length === 0) return;
    emitEvent("draw:show-result", {
      title: activePrizeName || currentSection || "Winners",
      entries: revealed.map((w) => ({ number: w.participant.ticket_number, name: w.participant.name })),
    });
    setResultShown(true);
  };

  return (
    <div className="mx-auto flex max-w-6xl gap-8 p-8">
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Auto Draw</h1>
            <p className="text-white/60">Randomly draw one or more winners from the participant pool.</p>
          </div>
          <div className="flex items-center gap-2">
            <SectionControl
              section={currentSection}
              onSave={(name) => updateConfig({ current_section: name })}
            />
            <button
              onClick={togglePresent}
              className={`rounded-md px-4 py-2 font-semibold ${
                presenting ? "bg-white/10 text-white" : "bg-[#F5C518] text-[#10141F]"
              }`}
            >
              {presenting ? "Exit Present" : "Present"}
            </button>
          </div>
        </div>

        <section className="mb-6 rounded-md border border-white/10 bg-white/[0.02] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white/60">
            Planned rounds{" "}
            <span className="text-white/30">
              (set up before the event, load when ready — manage prizes on Setup)
            </span>
          </h2>

          {plannedRounds.length > 0 && (
            <ul className="mb-4 space-y-2">
              {plannedRounds.map((round) => (
                <li
                  key={round.id}
                  className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <button
                    onClick={() => loadPlannedRound(round)}
                    className="flex flex-1 items-center gap-3 text-left hover:text-[#F5C518]"
                  >
                    <span className="font-semibold">{round.section}</span>
                    {round.prize_name && (
                      <span className="text-xs text-[#F5C518]">{round.prize_name}</span>
                    )}
                    <span className="text-xs text-white/50">{round.winner_count} winner{round.winner_count === 1 ? "" : "s"}</span>
                    <span className="text-xs text-white/50">
                      {round.exclude_repeat_winners ? "exclude repeats" : "repeats allowed"}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDeletePlannedRound(round.id)}
                    className="ml-3 rounded-md border border-[#E27676]/30 px-2 py-1 text-xs text-[#E27676] hover:bg-[#E27676]/10"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/60">Section</label>
              {prizeSections.length > 0 ? (
                <select
                  value={newRoundSection}
                  onChange={(e) => handleSelectRoundSection(e.target.value)}
                  className="w-44 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
                >
                  <option value="">Select a section…</option>
                  {prizeSections.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={newRoundSection}
                  onChange={(e) => setNewRoundSection(e.target.value)}
                  placeholder="e.g. Grand Prize"
                  className="w-40 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
                />
              )}
              {prizeSections.length === 0 && (
                <p className="mt-1 text-[10px] text-white/30">
                  No prizes yet — add some on Setup to pick from a list here.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Prize (auto-filled)</label>
              <div className="flex h-[38px] w-40 items-center rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-white/70">
                {newRoundPrize || "—"}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Winners</label>
              <input
                type="number"
                min={1}
                value={newRoundCount}
                onChange={(e) => setNewRoundCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={newRoundExclude}
                onChange={(e) => setNewRoundExclude(e.target.checked)}
                className="h-4 w-4"
              />
              Exclude repeats
            </label>
            <button
              onClick={handleAddPlannedRound}
              disabled={!newRoundSection.trim()}
              className="rounded-md bg-[#F5C518] px-4 py-2 text-sm font-semibold text-[#10141F] disabled:opacity-40"
            >
              + Add Round
            </button>
          </div>
        </section>

        <div className="mb-6 flex flex-wrap items-end gap-6 rounded-md border border-white/10 bg-white/[0.02] p-4">
          <div>
            <label className="mb-1 block text-xs text-white/60">Prize</label>
            <div className="flex h-[38px] items-center gap-2">
              {activePrizeName ? (
                <>
                  <span className="rounded-md border border-[#F5C518]/40 bg-[#F5C518]/10 px-3 py-2 text-sm font-semibold text-[#F5C518]">
                    {activePrizeName}
                  </span>
                  <button
                    onClick={() => setActivePrizeName("")}
                    disabled={isDrawing}
                    className="text-xs text-white/40 hover:text-white/70 disabled:opacity-40"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-sm text-white/30">None — load a planned round</span>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Winner count</label>
            <input
              type="number"
              min={1}
              value={winnerCount}
              disabled={isDrawing}
              onChange={(e) => setWinnerCount(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518] disabled:opacity-50"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={excludeRepeats}
              disabled={isDrawing}
              onChange={(e) => setExcludeRepeats(e.target.checked)}
              className="h-4 w-4"
            />
            Exclude previous winners
          </label>
          <button
            onClick={runRound}
            disabled={isDrawing}
            className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F] disabled:opacity-50"
          >
            {isDrawing ? "Drawing…" : "Draw Round"}
          </button>
          <span className="pb-2 text-xs text-white/40">{participants.length} participants loaded</span>
        </div>

        {error && <p className="mb-4 text-sm text-[#E27676]">{error}</p>}
        {notice && <p className="mb-4 text-sm text-[#F5C518]">{notice}</p>}

        {winners.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white/60">
                {isDrawing ? "Revealing winners…" : "Round results"}
                {currentSection && <span className="text-white/30"> — {currentSection}</span>}
              </h2>
              {!isDrawing && (
                <button
                  onClick={toggleShowResults}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    resultShown ? "bg-white/10 text-white" : "bg-[#F5C518] text-[#10141F]"
                  }`}
                >
                  {resultShown ? "Hide Result" : "Show Result"}
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {winners.map((w, i) => (
                <li
                  key={`${w.participant.id}-${i}`}
                  className={`flex items-center justify-between rounded-md border p-3 ${
                    w.revealed
                      ? "border-[#F5C518]/40 bg-[#F5C518]/10"
                      : "border-white/10 bg-white/[0.02] text-white/30"
                  }`}
                >
                  <span className="font-semibold">
                    {w.revealed ? w.participant.name : "Rolling…"}
                  </span>
                  <span className="flex items-center gap-3">
                    {w.revealed && w.section_sequence !== null && (
                      <span className="text-xs text-white/40">
                        {formatSectionLabel(currentSection, w.section_sequence)}
                      </span>
                    )}
                    <span className="font-mono">
                      {w.revealed ? w.participant.ticket_number : "— — — —"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {!isDrawing && (
              <p className="mt-3 text-xs text-white/40">
                {winners.length} winner{winners.length === 1 ? "" : "s"} logged
                {excludeRepeats ? " (excluding repeat winners)" : " (repeat winners allowed)"}. See
                Results to review or export.
              </p>
            )}
          </div>
        )}
      </div>

      <RecentDraws records={recentRecords} />
    </div>
  );
}
