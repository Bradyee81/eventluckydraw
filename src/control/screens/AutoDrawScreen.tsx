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
  const { config, participants, updateConfig } = useAppData();
  const currentSection = config?.current_section ?? "";
  const { presenting, toggle: togglePresent } = usePresentToggle();

  const [excludeRepeats, setExcludeRepeats] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [winners, setWinners] = useState<WinnerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resultShown, setResultShown] = useState(false);
  const [recentRecords, setRecentRecords] = useState<DrawRecord[]>([]);

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
    if (prizePlan.length === 0) {
      setError("No prizes found for this section. Add some on the Setup screen first.");
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

    const picks = pickRandom(pool, prizePlan.length);
    if (picks.length < prizePlan.length) {
      setNotice(
        `Only ${picks.length} eligible participant${picks.length === 1 ? "" : "s"} available — drawing ${picks.length} instead of ${prizePlan.length}.`
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
    setWinners(
      picks.map((participant, i) => ({
        participant,
        prizeName: prizePlan[i],
        section_sequence: null,
        revealed: false,
      }))
    );

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
        prize_name: prizePlan[i],
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
    // prizePlan is derived fresh each render from prizes/currentSection, safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, isDrawing, participants, excludeRepeats, currentSection, refreshRecent]);

  const toggleShowResults = () => {
    if (resultShown) {
      emitEvent("draw:hide-result", {});
      setResultShown(false);
      return;
    }
    const revealed = winners.filter((w) => w.revealed);
    if (revealed.length === 0) return;
    emitEvent("draw:show-result", {
      title: currentSection || "Winners",
      entries: revealed.map((w) => ({
        number: w.participant.ticket_number,
        name: w.participant.name,
        prize: w.prizeName,
      })),
    });
    setResultShown(true);
  };

  return (
    <div className="mx-auto flex max-w-6xl gap-8 p-8">
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Auto Draw</h1>
            <p className="text-white/60">Randomly draw winners for every prize in a section.</p>
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
            Draw a round <span className="text-white/30">(prizes managed on Setup)</span>
          </h2>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/60">Section</label>
              {prizeSections.length > 0 ? (
                <select
                  value={currentSection}
                  onChange={(e) => updateConfig({ current_section: e.target.value })}
                  style={dropdownStyle}
                  className="w-44 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
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
              onClick={runRound}
              disabled={isDrawing || !currentSection}
              className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F] disabled:opacity-50"
            >
              {isDrawing ? "Drawing…" : "Draw Round"}
            </button>
            <button
              onClick={handleSaveAsPlannedRound}
              disabled={!currentSection}
              className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              + Save as Planned Round
            </button>
          </div>

          {currentSection && (
            <div className="text-sm">
              {sectionPrizes.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {sectionPrizes.map((p) => (
                      <span
                        key={p.id}
                        className="rounded-full border border-[#F5C518]/30 bg-[#F5C518]/10 px-3 py-1 text-xs text-[#F5C518]"
                      >
                        {p.name} × {p.winner_count}
                      </span>
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
                    className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <button
                      onClick={() => loadPlannedRound(round)}
                      className="flex flex-1 items-center gap-3 text-left hover:text-[#F5C518]"
                    >
                      <span className="font-semibold">{round.section}</span>
                      <span className="text-xs text-white/50">
                        {roundPrizes.length} prize{roundPrizes.length === 1 ? "" : "s"}, {total} winner
                        {total === 1 ? "" : "s"}
                      </span>
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
                );
              })}
            </ul>
          </section>
        )}

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
    </div>
  );
}
