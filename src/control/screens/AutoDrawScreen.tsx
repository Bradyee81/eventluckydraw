import { useCallback, useEffect, useState } from "react";
import { useAppData } from "../AppDataContext";
import { emitEvent, onEvent } from "../../lib/events";
import { usePresentToggle } from "../../lib/presentWindow";
import { worstCaseRevealMs } from "../../lib/reelTiming";
import { formatSectionLabel } from "../../lib/format";
import {
  addPlannedRound,
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
  participantsForSection,
  type DrawRecord,
  type Participant,
  type PlannedRound,
  type Prize,
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

/** Every prize under a section, expanded into one entry per winner slot,
 *  e.g. [iPhone x1, Voucher x2] -> ["iPhone", "Voucher", "Voucher"]. */
function buildPrizePlan(sectionPrizes: Prize[]): string[] {
  const plan: string[] = [];
  for (const prize of sectionPrizes) {
    for (let i = 0; i < prize.winner_count; i++) plan.push(prize.name);
  }
  return plan;
}

interface WinnerEntry {
  participant: Participant;
  prizeName: string;
  section_sequence: number | null;
  revealed: boolean;
}

export function AutoDrawScreen() {
  const {
    config,
    participants,
    knownSections,
    sectionSettings,
    selectSection,
    refreshSections,
    buzzerConnected,
  } = useAppData();
  const currentSection = config?.current_section ?? "";
  const { presenting, toggle: togglePresent } = usePresentToggle();

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
  const [resultShownSection, setResultShownSection] = useState<string | null>(null);
  const [recentRecords, setRecentRecords] = useState<DrawRecord[]>([]);
  const [editingPrize, setEditingPrize] = useState<Prize | null>(null);
  const [deletingPrize, setDeletingPrize] = useState<Prize | null>(null);

  const [plannedRounds, setPlannedRounds] = useState<PlannedRound[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const prizeSections = Array.from(new Set(prizes.map((p) => p.section))).filter(Boolean);

  const sectionPrizes = prizes.filter((p) => p.section === currentSection);
  const prizePlan = buildPrizePlan(sectionPrizes);

  const refreshRecent = useCallback(() => {
    listDrawRecords().then((records) => setRecentRecords(records.slice(0, 8)));
  }, []);

  const refreshPlannedRounds = useCallback(() => {
    listPlannedRounds().then(setPlannedRounds);
  }, []);

  const refreshPrizes = useCallback(() => {
    listPrizes().then(setPrizes);
    refreshSections();
  }, [refreshSections]);

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
    selectSection(round.section);
    setActiveRoundId(round.id);
  };

  // Drives the round two presses total — on-screen button or physical
  // buzzer, both call this the same way:
  //  - no round in progress -> pick every winner for the round and start rolling
  //  - round in progress    -> reveal the whole round in one quick cascade
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

            const sectionSequence = await insertDrawRecord({
              number: digits.join(""),
              participant_id: w.participant.id,
              participant_name: w.participant.name,
              operator_note: null,
              section,
              mode: "auto",
              exclude_repeat_winners: exclude,
              prize_name: w.prizeName,
            });

            setWinners((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], section_sequence: sectionSequence, revealed: true };
              return next;
            });
            refreshRecent();
          }

          setIsDrawing(false);
          emitEvent("draw:reset", {});
          return;
        }

        setError(null);
        setNotice(null);
        setResultShownSection(null);
        await selectSection(section);
        setExcludeRepeats(exclude);
        // Read straight from settings: `config` in this closure predates selectSection.
        const slots =
          sectionSettings.find((st) => st.name === section)?.slot_count ?? config.slot_count;

        const plan = buildPrizePlan(prizes.filter((p) => p.section === section));

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
            prizeName: plan[i],
            section_sequence: null,
            revealed: false,
          }))
        );
        setRoundSlotCount(slots);
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

  // Pulls from the DB rather than in-memory `winners`, so the emcee can
  // re-reveal any past section's winner list even after moving on to a
  // later round (winners only holds the most recently drawn round).
  const toggleShowResultsFor = async (section: string) => {
    if (resultShownSection === section) {
      emitEvent("draw:hide-result", {});
      setResultShownSection(null);
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
    setResultShownSection(section);
  };

  const saveEditPrize = async (patch: {
    section: string;
    name: string;
    winner_count: number;
    description: string;
  }) => {
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
            <p className="text-white/60">Randomly draw winners for every prize in a section.</p>
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
              onSave={selectSection}
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
            Draw a round <span className="text-white/30">(prizes managed on Setup)</span>
          </h2>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/60">Section</label>
              {prizeSections.length > 0 ? (
                <select
                  value={currentSection}
                  onChange={(e) => {
                    selectSection(e.target.value);
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
            <button
              onClick={() => beginOrAdvance(currentSection, excludeRepeats)}
              disabled={busy || !currentSection || (!isDrawing && prizePlan.length === 0)}
              className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F] disabled:opacity-50"
            >
              {!isDrawing
                ? "Draw Round"
                : busy
                  ? "Revealing…"
                  : `Reveal ${winners.length} Winner${winners.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={handleSaveAsPlannedRound}
              disabled={!currentSection}
              className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              + Save as Planned Round
            </button>
            <button
              onClick={() => toggleShowResultsFor(currentSection)}
              disabled={!currentSection}
              className={`rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-40 ${
                resultShownSection === currentSection
                  ? "bg-white/10 text-white"
                  : "border border-[#F5C518]/40 text-[#F5C518]"
              }`}
            >
              {resultShownSection === currentSection ? "Hide Result" : "Show Result"}
            </button>
          </div>

          {currentSection && (
            <div className="text-sm">
              {sectionPrizes.length > 0 ? (
                <>
                  <div className="space-y-1">
                    {sectionPrizes.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5"
                      >
                        <span>
                          <span className="font-semibold text-[#F5C518]">{p.name}</span>
                          <span className="text-white/50"> × {p.winner_count}</span>
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
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/40">
                    {prizePlan.length} total winner{prizePlan.length === 1 ? "" : "s"} for "
                    {currentSection}"
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
                          resultShownSection === round.section
                            ? "bg-white/10 text-white"
                            : "border border-[#F5C518]/40 text-[#F5C518]"
                        }`}
                      >
                        {resultShownSection === round.section ? "Hide Result" : "Show Result"}
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
