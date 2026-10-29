import { useCallback, useEffect, useState } from "react";
import { useAppData } from "../AppDataContext";
import { emitEvent, onEvent } from "../../lib/events";
import { worstCaseRevealMs } from "../../lib/reelTiming";
import { formatSectionLabel } from "../../lib/format";
import {
  addPlannedRound,
  deleteDrawRecords,
  deletePlannedRound,
  deletePrize,
  insertDrawRecord,
  listDrawRecords,
  listPlannedRounds,
  listPrizes,
  listPriorWinnerIds,
  updatePrize,
} from "../../lib/db";
import { SectionControl } from "../../components/SectionControl";
import { RecentDraws } from "../../components/RecentDraws";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PrizeFormModal } from "../../components/PrizeFormModal";
import {
  buildPrizePlan,
  nextRoundPrizes,
  prizeProgress,
  type PrizeSlot,
  type RoundSize,
} from "../../lib/prizes";
import {
  participantsForSection,
  type DrawRecord,
  type Participant,
  type PlannedRound,
  type Prize,
  type PrizeInput,
} from "../../types";

const dropdownStyle = { backgroundColor: "#10141F", color: "#E6E9EF" };
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

// The old single "One prize per round" switch, still read as the default for
// draws without groups that have no choice saved yet.
const ONE_PRIZE_KEY = "autoDraw.onePrizePerRound";
// Round size chosen per draw (section), e.g. { "Lucky Draw": "group" }.
const ROUND_SIZE_KEY = "autoDraw.roundSize";

function loadRoundSizes(): Record<string, RoundSize> {
  try {
    return JSON.parse(localStorage.getItem(ROUND_SIZE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function legacyRoundSize(): RoundSize {
  try {
    return localStorage.getItem(ONE_PRIZE_KEY) === "1" ? "prize" : "all";
  } catch {
    return "all";
  }
}

const ROUND_SIZE_OPTIONS: { value: RoundSize; label: string }[] = [
  { value: "prize", label: "One prize" },
  { value: "group", label: "One group" },
  { value: "all", label: "Whole draw" },
];

interface WinnerEntry {
  participant: Participant;
  prizeName: string;
  drawGroup: string;
  section_sequence: number | null;
  // Its draw record once revealed, so the round can be undone.
  record_id: number | null;
  revealed: boolean;
}

export function AutoDrawScreen() {
  const {
    config,
    participants,
    knownSections,
    sectionSettings,
    selectSection,
    activateMode,
    refreshSections,
    buzzerConnected,
  } = useAppData();
  const currentSection = config?.auto_section ?? "";

  const [excludeRepeats, setExcludeRepeats] = useState(true);
  // isDrawing = a round has been rolled and is waiting for (or running) its reveal.
  // busy = the reveal cascade is actively animating — ignore presses until it settles.
  const [isDrawing, setIsDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeRoundId, setActiveRoundId] = useState<number | null>(null);
  // Slot count the in-progress round was drawn with, so the reveal matches it.
  const [roundSlotCount, setRoundSlotCount] = useState<number | null>(null);
  const [winners, setWinners] = useState<WinnerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which result is on the Output window: "latest" (the last round) or
  // "section:<name>" (everything drawn in that section).
  const [resultShown, setResultShown] = useState<string | null>(null);
  const [recentRecords, setRecentRecords] = useState<DrawRecord[]>([]);
  const [allRecords, setAllRecords] = useState<DrawRecord[]>([]);
  // How much each round draws, per section; can be changed between any two
  // rounds (e.g. one prize at a time, then whole groups when time runs short).
  const [roundSizes, setRoundSizes] = useState(loadRoundSizes);
  // Section + prize of the most recent round, for "Show Result".
  const [lastRound, setLastRound] = useState<{ section: string; prizeName: string | null } | null>(null);
  const [editingPrize, setEditingPrize] = useState<Prize | null>(null);
  const [deletingPrize, setDeletingPrize] = useState<Prize | null>(null);

  const [plannedRounds, setPlannedRounds] = useState<PlannedRound[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const prizeSections = Array.from(new Set(prizes.map((p) => p.section))).filter(Boolean);

  // A draw's saved choice, else one group per round if it uses groups, else
  // whatever the old switch was set to.
  const roundSizeFor = useCallback(
    (section: string): RoundSize => {
      const saved = roundSizes[section];
      const usesGroups = prizes.some((p) => p.section === section && p.draw_group);
      if (saved && (saved !== "group" || usesGroups)) return saved;
      return usesGroups ? "group" : legacyRoundSize();
    },
    [roundSizes, prizes]
  );

  const sectionPrizes = prizes.filter((p) => p.section === currentSection);
  const sectionUsesGroups = sectionPrizes.some((p) => p.draw_group);
  const roundSize = roundSizeFor(currentSection);
  const prizePlan = buildPrizePlan(sectionPrizes);
  const progress = prizeProgress(
    sectionPrizes,
    allRecords.filter((r) => r.section === currentSection),
    "auto"
  );
  const nextRound = nextRoundPrizes(progress, roundSize);
  const nextPrize = nextRound[0] ?? null;
  const nextRoundWinners = nextRound.reduce((n, p) => n + p.remaining, 0);
  const nextRoundGroup = roundSize === "group" ? (nextPrize?.prize.draw_group ?? "") : "";

  const changeRoundSize = (size: RoundSize) => {
    const next = { ...roundSizes, [currentSection]: size };
    setRoundSizes(next);
    try {
      localStorage.setItem(ROUND_SIZE_KEY, JSON.stringify(next));
    } catch {
      // Choice just won't persist — it still applies now.
    }
  };

  const refreshRecent = useCallback(() => {
    listDrawRecords().then((records) => {
      setAllRecords(records);
      setRecentRecords(records.slice(0, 8));
    });
  }, []);

  const refreshPlannedRounds = useCallback(() => {
    listPlannedRounds().then(setPlannedRounds);
  }, []);

  const refreshPrizes = useCallback(() => {
    listPrizes().then(setPrizes);
    refreshSections();
  }, [refreshSections]);

  // Switch the Output window to this screen's draw (its slot count) on open.
  useEffect(() => {
    activateMode("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshRecent();
    refreshPlannedRounds();
    refreshPrizes();
  }, [refreshRecent, refreshPlannedRounds, refreshPrizes]);

  const handleSaveAsPlannedRound = async () => {
    if (!currentSection) return;
    await addPlannedRound({
      section: currentSection,
      winner_count: prizePlan.length,
      exclude_repeat_winners: excludeRepeats,
      prize_name: sectionPrizes.map((p) => p.name).join(", "),
    });
    refreshPlannedRounds();
  };

  const handleDeletePlannedRound = async (id: number) => {
    await deletePlannedRound(id);
    refreshPlannedRounds();
  };

  const loadPlannedRound = (round: PlannedRound) => {
    setExcludeRepeats(!!round.exclude_repeat_winners);
    selectSection(round.section, "auto");
    setActiveRoundId(round.id);
  };

  // Drives the round two presses total — on-screen button or physical
  // buzzer, both call this the same way:
  //  - no round in progress -> pick every winner for the round and start rolling
  //  - round in progress    -> reveal the whole round in one quick cascade
  // A round is every prize in the section, or with "One prize per round" on,
  // just the next prize that still needs winners (or its whole group).
  const beginOrAdvance = useCallback(
    async (section: string, exclude: boolean) => {
      if (!config || busy || !section) return;
      setBusy(true);
      try {
        if (isDrawing) {
          const slots = roundSlotCount ?? config.slot_count;
          for (let i = 0; i < winners.length; i++) {
            const w = winners[i];
            const digits = ticketToDigits(w.participant.ticket_number, slots);
            if (!digits) continue; // validated when the round started, shouldn't happen

            if (i > 0) emitEvent("draw:roll", {});
            digits.forEach((digit, index) => emitEvent("draw:digit-set", { index, digit }));
            await sleep(worstCaseRevealMs(slots) + 500);

            const { id: recordId, sequence: sectionSequence } = await insertDrawRecord({
              number: digits.join(""),
              participant_id: w.participant.id,
              participant_name: w.participant.name,
              operator_note: null,
              section,
              mode: "auto",
              exclude_repeat_winners: exclude,
              prize_name: w.prizeName,
              draw_group: w.drawGroup,
            });

            setWinners((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], section_sequence: sectionSequence, record_id: recordId, revealed: true };
              return next;
            });
            refreshRecent();
          }

          // No reset here: the last winner's number stays on the Output window
          // until the next round's roll starts the reels spinning again.
          setIsDrawing(false);
          return;
        }

        setError(null);
        setNotice(null);
        if (resultShown) emitEvent("draw:hide-result", {});
        setResultShown(null);
        await selectSection(section, "auto");
        setExcludeRepeats(exclude);
        // Read straight from settings: `config` in this closure predates selectSection.
        const slots =
          sectionSettings.find((st) => st.name === section)?.slot_count ?? config.slot_count;

        const allSectionPrizes = prizes.filter((p) => p.section === section);
        let plan: PrizeSlot[] = [];
        let roundPrizeName: string | null = null;
        if (allSectionPrizes.length > 0) {
          const size = roundSizeFor(section);
          const sectionRecords = (await listDrawRecords()).filter((r) => r.section === section);
          const round = nextRoundPrizes(prizeProgress(allSectionPrizes, sectionRecords, "auto"), size);
          if (round.length === 0) {
            setError(
              `Every prize in "${section}" has been drawn. Clear its results on the Results screen to draw it again.`
            );
            return;
          }
          plan = buildPrizePlan(
            round.map((p) => p.prize),
            (prize) => round.find((p) => p.prize.id === prize.id)?.remaining ?? 0
          );
          roundPrizeName =
            size === "prize"
              ? round[0].prize.name
              : size === "group"
                ? round[0].prize.draw_group || round[0].prize.name
                : null;
        }

        const sectionParticipants = participantsForSection(participants, section);
        if (sectionParticipants.length === 0) {
          setError(
            `No participants for "${section}". Import its list on the Setup screen first.`
          );
          return;
        }
        if (plan.length === 0) {
          setError("No prizes found for this section. Add some on the Setup screen first.");
          return;
        }

        let pool = sectionParticipants;
        if (exclude) {
          const priorWinnerIds = await listPriorWinnerIds();
          pool = sectionParticipants.filter((p) => !priorWinnerIds.has(p.id));
        }
        if (pool.length === 0) {
          setError("No eligible participants left to draw from (everyone has already won).");
          return;
        }

        const picks = pickRandom(pool, plan.length);
        if (picks.length < plan.length) {
          setNotice(
            `Only ${picks.length} eligible participant${picks.length === 1 ? "" : "s"} available — drawing ${picks.length} instead of ${plan.length}.`
          );
        }

        for (const p of picks) {
          if (ticketToDigits(p.ticket_number, slots) === null) {
            setError(
              `Ticket "${p.ticket_number}" (${p.name}) has more digits than "${section}" has slots (${slots}). Set its slot count under Setup → Draws.`
            );
            return;
          }
        }

        setWinners(
          picks.map((participant, i) => ({
            participant,
            prizeName: plan[i].name,
            drawGroup: plan[i].group,
            section_sequence: null,
            record_id: null,
            revealed: false,
          }))
        );
        setRoundSlotCount(slots);
        setLastRound({ section, prizeName: roundPrizeName });
        setIsDrawing(true);
        emitEvent("draw:roll", {});
      } finally {
        setBusy(false);
      }
    },
    [
      config,
      busy,
      isDrawing,
      winners,
      roundSlotCount,
      roundSizeFor,
      resultShown,
      participants,
      prizes,
      sectionSettings,
      selectSection,
      refreshRecent,
    ]
  );

  // The physical buzzer drives the same flow as the on-screen button — first
  // press rolls the round, second press reveals every winner in it.
  useEffect(() => {
    const unlisten = onEvent("buzzer:pressed", () => {
      beginOrAdvance(currentSection, excludeRepeats);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [beginOrAdvance, currentSection, excludeRepeats]);

  // Enter does the same as the Draw/Reveal button: first press draws, next reveals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (editingPrize || deletingPrize) return;
      // Stop Enter also "clicking" whichever button has focus.
      e.preventDefault();
      beginOrAdvance(currentSection, excludeRepeats);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beginOrAdvance, currentSection, excludeRepeats, editingPrize, deletingPrize]);

  // Pulls from the DB rather than in-memory `winners`, so the emcee can
  // re-reveal any past section's winner list even after moving on to a
  // later round (winners only holds the most recently drawn round).
  const toggleShowResultsFor = async (section: string) => {
    const key = `section:${section}`;
    if (resultShown === key) {
      emitEvent("draw:hide-result", {});
      setResultShown(null);
      return;
    }
    if (!section) return;
    const records = (await listDrawRecords())
      .filter((r) => r.section === section)
      .sort((a, b) => a.section_sequence - b.section_sequence);
    if (records.length === 0) return;
    emitEvent("draw:show-result", {
      title: section,
      entries: records.map((r) => ({
        number: r.number,
        name: r.participant_name,
        prize: r.prize_name || undefined,
      })),
    });
    setResultShown(key);
  };

  // Just the most recent round, e.g. one prize's winner(s) in one-prize mode.
  const toggleShowLatest = () => {
    if (resultShown === "latest") {
      emitEvent("draw:hide-result", {});
      setResultShown(null);
      return;
    }
    const revealed = winners.filter((w) => w.revealed);
    if (!lastRound || revealed.length === 0) return;
    emitEvent("draw:show-result", {
      title: lastRound.prizeName ? `${lastRound.section} — ${lastRound.prizeName}` : lastRound.section,
      entries: revealed.map((w) => ({
        number: w.participant.ticket_number,
        name: w.participant.name,
        prize: w.prizeName || undefined,
      })),
    });
    setResultShown("latest");
  };
  const canShowLatest = !isDrawing && winners.some((w) => w.revealed);

  // Panic button, for a round started with the wrong setting. Before the
  // reveal nothing is logged yet, so cancelling just drops the round. After
  // it, undoing deletes that round's records: the prizes need winners again
  // and those people can be drawn again.
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const revealedRecordIds = winners.flatMap((w) => (w.record_id !== null ? [w.record_id] : []));
  const canUndoRound = !isDrawing && !busy && revealedRecordIds.length > 0;

  const clearRound = () => {
    setWinners([]);
    setIsDrawing(false);
    setRoundSlotCount(null);
    setLastRound(null);
    if (resultShown) emitEvent("draw:hide-result", {});
    setResultShown(null);
    emitEvent("draw:reset", {});
  };

  const cancelRound = () => {
    if (!isDrawing || busy) return;
    clearRound();
    setError(null);
    setNotice("Round cancelled — nothing was logged. Change the setting and draw again.");
  };

  const undoLastRound = async () => {
    setConfirmingUndo(false);
    if (!canUndoRound) return;
    const count = revealedRecordIds.length;
    await deleteDrawRecords(revealedRecordIds);
    clearRound();
    refreshRecent();
    setError(null);
    setNotice(
      `Last round undone — ${count} winner${count === 1 ? "" : "s"} removed from the results. Their prizes are back in the list.`
    );
  };

  const saveEditPrize = async (patch: PrizeInput) => {
    if (!editingPrize) return;
    await updatePrize(editingPrize.id, patch);
    setEditingPrize(null);
    refreshPrizes();
  };

  const confirmDeletePrize = async () => {
    if (!deletingPrize) return;
    await deletePrize(deletingPrize.id);
    setDeletingPrize(null);
    refreshPrizes();
  };

  return (
    <div className="mx-auto flex max-w-6xl gap-8 p-8">
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Auto Draw</h1>
            <p className="text-white/60">Randomly draw winners for every prize in a section. Press Enter to draw, then Enter again to reveal.</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="flex items-center gap-1.5 text-xs text-white/60"
              title={
                buzzerConnected
                  ? "Buzzer connected — first press rolls, second press reveals the whole round"
                  : "Buzzer disconnected — on-screen controls still work"
              }
            >
              <span
                className={`h-2 w-2 rounded-full ${buzzerConnected ? "bg-[#7CD992]" : "bg-white/25"}`}
              />
              Buzzer {buzzerConnected ? "connected" : "disconnected"}
            </span>
            <SectionControl
              section={currentSection}
              suggestions={knownSections}
              onSave={(name) => selectSection(name, "auto")}
            />
          </div>
        </div>

        <section className="mb-6 rounded-md border border-white/10 bg-white/[0.02] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white/60">
            Draw a round <span className="text-white/30">(prizes managed on Setup)</span>
          </h2>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/60">Section</label>
              {prizeSections.length > 0 ? (
                <select
                  value={currentSection}
                  onChange={(e) => {
                    selectSection(e.target.value, "auto");
                    setActiveRoundId(null);
                  }}
                  disabled={isDrawing}
                  style={dropdownStyle}
                  className="w-44 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518] disabled:opacity-50"
                >
                  <option value="" style={dropdownStyle}>
                    Select a section…
                  </option>
                  {prizeSections.map((section) => (
                    <option key={section} value={section} style={dropdownStyle}>
                      {section}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-white/30">
                  No prizes yet — add some on Setup to pick a section here.
                </p>
              )}
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
            <div className="pb-1">
              <div className="mb-1 text-xs text-white/50">Each round draws</div>
              <div className="inline-flex overflow-hidden rounded-md border border-white/15">
                {ROUND_SIZE_OPTIONS.map((opt) => {
                  const unavailable = opt.value === "group" && !sectionUsesGroups;
                  const active = roundSize === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => changeRoundSize(opt.value)}
                      disabled={isDrawing || unavailable}
                      title={unavailable ? "No groups set for this draw's prizes" : undefined}
                      className={`px-3 py-1.5 text-sm disabled:opacity-30 ${
                        active ? "bg-[#F5C518] font-semibold text-[#10141F]" : "text-white/70 hover:bg-white/5"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => beginOrAdvance(currentSection, excludeRepeats)}
              disabled={busy || !currentSection || (!isDrawing && !nextPrize)}
              className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F] disabled:opacity-50"
            >
              {!isDrawing
                ? !nextPrize
                  ? "All prizes drawn"
                  : roundSize === "prize" || nextRoundWinners === 1
                    ? "Draw Next Prize"
                    : nextRoundGroup
                      ? `Draw ${nextRoundGroup} (${nextRoundWinners} prizes)`
                      : `Draw ${nextRoundWinners} Prizes`
                : busy
                  ? "Revealing…"
                  : `Reveal ${winners.length} Winner${winners.length === 1 ? "" : "s"}`}
            </button>
            {isDrawing && !busy && (
              <button
                onClick={cancelRound}
                title="Stop this round before revealing. Nothing has been logged yet."
                className="rounded-md border border-[#E27676]/60 px-3 py-2 text-sm font-semibold text-[#E27676] hover:bg-[#E27676]/10"
              >
                ✕ Cancel round
              </button>
            )}
            {canUndoRound && (
              <button
                onClick={() => setConfirmingUndo(true)}
                title="Remove the round you just drew from the results"
                className="rounded-md border border-[#E27676]/60 px-3 py-2 text-sm font-semibold text-[#E27676] hover:bg-[#E27676]/10"
              >
                ↶ Undo last round
              </button>
            )}
            <button
              onClick={handleSaveAsPlannedRound}
              disabled={!currentSection}
              className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              + Save as Planned Round
            </button>
            <button
              onClick={toggleShowLatest}
              disabled={!canShowLatest && resultShown !== "latest"}
              title="Show the winners of the round you just drew"
              className={`rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-40 ${
                resultShown === "latest"
                  ? "bg-white/10 text-white"
                  : "border border-[#F5C518]/40 text-[#F5C518]"
              }`}
            >
              {resultShown === "latest" ? "Hide Result" : "Show Result"}
            </button>
            <button
              onClick={() => toggleShowResultsFor(currentSection)}
              disabled={!currentSection}
              title="Show every winner drawn so far in this section"
              className={`rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-40 ${
                resultShown === `section:${currentSection}`
                  ? "bg-white/10 text-white"
                  : "border border-white/15 text-white/70 hover:bg-white/5"
              }`}
            >
              {resultShown === `section:${currentSection}` ? "Hide All" : "Show All"}
            </button>
          </div>

          {currentSection && (
            <div className="text-sm">
              {sectionPrizes.length > 0 ? (
                <>
                  <div className="space-y-1">
                    {progress.map(({ prize: p, drawn, remaining }) => {
                      const isNext = nextRound.some((n) => n.prize.id === p.id);
                      return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${
                          isNext
                            ? "border-[#F5C518]/60 bg-[#F5C518]/10"
                            : "border-white/10 bg-white/[0.02]"
                        } ${remaining === 0 ? "opacity-50" : ""}`}
                      >
                        <span>
                          {isNext && (
                            <span className="mr-2 rounded bg-[#F5C518] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#10141F]">
                              Next
                            </span>
                          )}
                          {p.draw_group && (
                            <span className="mr-2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60">
                              {p.draw_group}
                            </span>
                          )}
                          <span className="font-semibold text-[#F5C518]">{p.name}</span>
                          <span className="text-white/50"> × {p.winner_count}</span>
                          <span className="ml-2 text-xs text-white/40">
                            {remaining === 0 ? "✓ drawn" : drawn > 0 ? `${drawn}/${p.winner_count} drawn` : ""}
                          </span>
                          {p.description && (
                            <span className="ml-2 text-xs text-white/40">{p.description}</span>
                          )}
                        </span>
                        <span className="flex gap-3 text-xs">
                          <button
                            onClick={() => setEditingPrize(p)}
                            className="text-white/50 hover:text-[#F5C518] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeletingPrize(p)}
                            className="text-white/50 hover:text-[#E27676] hover:underline"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-white/40">
                    {prizePlan.length} total winner{prizePlan.length === 1 ? "" : "s"} for "
                    {currentSection}"
                    {progress.length > 0 &&
                      ` — ${progress.filter((x) => x.remaining === 0).length} of ${progress.length} prizes drawn`}
                  </p>
                </>
              ) : (
                <p className="text-xs text-[#E27676]">No prizes found for this section.</p>
              )}
            </div>
          )}
        </section>

        {plannedRounds.length > 0 && (
          <section className="mb-6 rounded-md border border-white/10 bg-white/[0.02] p-4">
            <h2 className="mb-3 text-sm font-semibold text-white/60">
              Planned rounds <span className="text-white/30">(click to load)</span>
            </h2>
            <ul className="space-y-2">
              {plannedRounds.map((round) => {
                const roundPrizes = prizes.filter((p) => p.section === round.section);
                const total = buildPrizePlan(roundPrizes).length;
                return (
                  <li
                    key={round.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <button
                      onClick={() => loadPlannedRound(round)}
                      disabled={isDrawing}
                      className="flex flex-1 items-center gap-3 text-left hover:text-[#F5C518] disabled:opacity-50"
                      title="Load into the controls above"
                    >
                      <span
                        className={`w-4 shrink-0 text-center ${round.id === activeRoundId ? "text-[#F5C518]" : "text-transparent"}`}
                        title={round.id === activeRoundId ? "Currently loaded round" : undefined}
                      >
                        ✓
                      </span>
                      <span className="font-semibold">{round.section}</span>
                      <span className="text-xs text-white/50">
                        {roundPrizes.length} prize{roundPrizes.length === 1 ? "" : "s"}, {total} winner
                        {total === 1 ? "" : "s"}
                      </span>
                      <span className="text-xs text-white/50">
                        {round.exclude_repeat_winners ? "exclude repeats" : "repeats allowed"}
                      </span>
                    </button>
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          loadPlannedRound(round);
                          beginOrAdvance(round.section, !!round.exclude_repeat_winners);
                        }}
                        disabled={isDrawing}
                        className="rounded-md bg-[#F5C518] px-3 py-1.5 text-xs font-semibold text-[#10141F] disabled:opacity-40"
                      >
                        Draw Round
                      </button>
                      <button
                        onClick={() => toggleShowResultsFor(round.section)}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                          resultShown === `section:${round.section}`
                            ? "bg-white/10 text-white"
                            : "border border-[#F5C518]/40 text-[#F5C518]"
                        }`}
                      >
                        {resultShown === `section:${round.section}` ? "Hide All" : "Show All"}
                      </button>
                      <button
                        onClick={() => handleDeletePlannedRound(round.id)}
                        className="rounded-md border border-[#E27676]/30 px-2 py-1.5 text-xs text-[#E27676] hover:bg-[#E27676]/10"
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {error && <p className="mb-4 text-sm text-[#E27676]">{error}</p>}
        {notice && <p className="mb-4 text-sm text-[#F5C518]">{notice}</p>}

        {winners.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-white/60">
              {busy ? "Revealing winners…" : isDrawing ? "Rolled — press Reveal" : "Round results"}
              {currentSection && <span className="text-white/30"> — {currentSection}</span>}
            </h2>
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
                  <div>
                    <div className="font-semibold">
                      {w.revealed ? w.participant.name : "Rolling…"}
                    </div>
                    <div className="text-xs text-[#F5C518]/80">{w.prizeName}</div>
                  </div>
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

      {editingPrize && (
        <PrizeFormModal
          prize={editingPrize}
          onSave={saveEditPrize}
          onClose={() => setEditingPrize(null)}
        />
      )}

      {confirmingUndo && (
        <ConfirmModal
          title="Undo the last round?"
          message={`${revealedRecordIds.length} winner${revealedRecordIds.length === 1 ? "" : "s"} from the round you just drew will be removed from the results. Their prizes go back in the list, and those people can be drawn again.`}
          confirmLabel="Undo round"
          onConfirm={undoLastRound}
          onCancel={() => setConfirmingUndo(false)}
        />
      )}

      {deletingPrize && (
        <ConfirmModal
          title="Delete this prize?"
          message={`"${deletingPrize.name}" under "${deletingPrize.section}" will be removed from the catalog. Past draw records aren't affected.`}
          confirmLabel="Delete"
          onConfirm={confirmDeletePrize}
          onCancel={() => setDeletingPrize(null)}
        />
      )}
    </div>
  );
}
