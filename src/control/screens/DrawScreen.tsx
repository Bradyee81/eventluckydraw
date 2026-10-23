import { useCallback, useEffect, useRef, useState } from "react";
import { useAppData } from "../AppDataContext";
import { emitEvent, onEvent } from "../../lib/events";
import { findParticipantByTicket, insertDrawRecord, listDrawRecords } from "../../lib/db";
import { SectionControl } from "../../components/SectionControl";
import { RecentDraws } from "../../components/RecentDraws";
import { Toggle } from "../../components/Toggle";
import { formatSectionLabel } from "../../lib/format";
import { participantsForSection, type DrawRecord, type Participant } from "../../types";

function nextEmptyIndex(digits: (number | null)[], from: number): number {
  for (let step = 1; step <= digits.length; step++) {
    const idx = (from + step) % digits.length;
    if (digits[idx] === null) return idx;
  }
  return from;
}

const BUZZ_FLASH_MS = 1500;

const SKIP_VALIDATION_KEY = "manualDraw.skipValidation";

function loadSkipValidation(): boolean {
  try {
    return localStorage.getItem(SKIP_VALIDATION_KEY) === "1";
  } catch {
    return false;
  }
}

export function DrawScreen() {
  const { config, participants, knownSections, selectSection, activateMode, buzzerConnected } =
    useAppData();
  const slotCount = config?.slot_count ?? 6;
  const currentSection = config?.current_section ?? "";
  // Only this draw's tickets (plus untagged ones) count for validation.
  const hasList = participantsForSection(participants, currentSection).length > 0;

  const [digits, setDigits] = useState<(number | null)[]>(() => Array(slotCount).fill(null));
  const [activeIndex, setActiveIndex] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [redoStack, setRedoStack] = useState<{ index: number; digit: number }[]>([]);
  const [confirmedNumber, setConfirmedNumber] = useState<string | null>(null);
  const [match, setMatch] = useState<Participant | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [recentRecords, setRecentRecords] = useState<DrawRecord[]>([]);
  const [sectionSequence, setSectionSequence] = useState<number | null>(null);
  const [resultShown, setResultShown] = useState(false);
  const [skipValidation, setSkipValidationState] = useState(loadSkipValidation);
  const [buzzed, setBuzzed] = useState(false);
  const buzzFlashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What a buzzer press does right now; reassigned every render (below) so
  // the listener, registered once, always sees current state.
  const buzzerAction = useRef<() => void>(() => {});

  useEffect(() => {
    const unlisten = onEvent("buzzer:pressed", () => {
      setBuzzed(true);
      if (buzzFlashTimeout.current) clearTimeout(buzzFlashTimeout.current);
      buzzFlashTimeout.current = setTimeout(() => setBuzzed(false), BUZZ_FLASH_MS);
      buzzerAction.current();
    });
    return () => {
      unlisten.then((fn) => fn());
      if (buzzFlashTimeout.current) clearTimeout(buzzFlashTimeout.current);
    };
  }, []);

  const refreshRecent = useCallback(() => {
    listDrawRecords().then((records) => setRecentRecords(records.slice(0, 8)));
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  // Opening Manual Draw switches the Output window to this screen's draw (its
  // slot count) and gets the reels spinning, ready for the first number.
  useEffect(() => {
    activateMode("manual")
      .then(() => emitEvent("draw:reset", {}))
      .then(() => emitEvent("draw:roll", {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A freshly presented Output window starts idle; get it rolling unless a
  // confirmed number is on show.
  useEffect(() => {
    const unlisten = onEvent("output:ready", () => {
      if (!confirmedNumber) emitEvent("draw:roll", {});
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [confirmedNumber]);

  // Fail-safe stays on/off for the whole event (remembered across tabs and
  // restarts) until someone switches it back.
  const setSkipValidation = (value: boolean) => {
    setSkipValidationState(value);
    try {
      localStorage.setItem(SKIP_VALIDATION_KEY, value ? "1" : "0");
    } catch {
      // Preference just won't persist — the switch still works.
    }
  };

  // Resize the entry array whenever slot_count changes and we're not mid-entry.
  useEffect(() => {
    if (history.length === 0 && !confirmedNumber) {
      setDigits(Array(slotCount).fill(null));
      setActiveIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotCount]);

  const isComplete = digits.length === slotCount && digits.every((d) => d !== null);

  const validate = useCallback(
    async (fullDigits: (number | null)[]) => {
      setNotFound(false);
      setMatch(null);
      if (fullDigits.some((d) => d === null)) return;
      const number = fullDigits.join("");
      const found = await findParticipantByTicket(number, currentSection);
      if (found) {
        setMatch(found);
      } else {
        setNotFound(true);
      }
    },
    [currentSection]
  );

  useEffect(() => {
    if (isComplete && hasList && !skipValidation && !confirmedNumber) {
      validate(digits);
    } else if (!isComplete || skipValidation) {
      setMatch(null);
      setNotFound(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, digits, hasList, skipValidation]);

  const enterDigit = useCallback(
    (d: number) => {
      if (confirmedNumber) return;
      const index = activeIndex;
      const next = [...digits];
      next[index] = d;
      setDigits(next);
      setHistory((h) => [...h, index]);
      setRedoStack([]);
      setActiveIndex(nextEmptyIndex(next, index));
      emitEvent("draw:digit-set", { index, digit: d });
    },
    [activeIndex, digits, confirmedNumber]
  );

  const selectSlot = useCallback(
    (index: number) => {
      if (confirmedNumber) return;
      setActiveIndex(index);
    },
    [confirmedNumber]
  );

  const undo = useCallback(() => {
    if (confirmedNumber) return;
    setHistory((h) => {
      if (h.length === 0) return h;
      const index = h[h.length - 1];
      const digit = digits[index];
      if (digit !== null) {
        setRedoStack((r) => [...r, { index, digit }]);
      }
      setDigits((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
      setActiveIndex(index);
      emitEvent("draw:digit-undo", { index });
      return h.slice(0, -1);
    });
  }, [confirmedNumber, digits]);

  const redo = useCallback(() => {
    if (confirmedNumber) return;
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const { index, digit } = r[r.length - 1];
      setDigits((prev) => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });
      setHistory((h) => [...h, index]);
      setActiveIndex(nextEmptyIndex(digits, index));
      emitEvent("draw:digit-set", { index, digit });
      return r.slice(0, -1);
    });
  }, [confirmedNumber, digits]);

  const startNewDraw = useCallback(() => {
    setDigits(Array(slotCount).fill(null));
    setActiveIndex(0);
    setHistory([]);
    setRedoStack([]);
    setConfirmedNumber(null);
    setMatch(null);
    setNotFound(false);
    setNote("");
    setSaveMsg(null);
    setSectionSequence(null);
    setResultShown(false);
    // Clear the last result, then start rolling for the next number.
    emitEvent("draw:reset", {}).then(() => emitEvent("draw:roll", {}));
  }, [slotCount]);

  const confirm = useCallback(async () => {
    if (!isComplete || confirmedNumber) return;
    if (hasList && !skipValidation && notFound) return;
    const number = digits.join("");
    const sequence = await insertDrawRecord({
      number,
      participant_id: match?.id ?? null,
      participant_name: match?.name ?? null,
      operator_note: note.trim() || null,
      section: currentSection,
      mode: "manual",
      exclude_repeat_winners: null,
      prize_name: "",
    });
    setConfirmedNumber(number);
    setSectionSequence(sequence);
    emitEvent("draw:confirmed", { number, participantName: match?.name ?? null });
    setSaveMsg("Draw logged.");
    refreshRecent();
  }, [
    isComplete,
    confirmedNumber,
    hasList,
    skipValidation,
    notFound,
    digits,
    match,
    note,
    currentSection,
    refreshRecent,
  ]);

  // The buzzer steps through a draw like the Enter key: once the number is
  // typed it logs the winner, after that it starts the next draw. Before any
  // digit is typed it rolls; mid-entry it does nothing, so a stray press
  // can't disturb a half-typed number.
  buzzerAction.current = () => {
    if (confirmedNumber) startNewDraw();
    else if (isComplete) confirm();
    else if (history.length === 0) emitEvent("draw:roll", {});
  };

  const toggleShowResult = () => {
    if (resultShown) {
      emitEvent("draw:hide-result", {});
      setResultShown(false);
    } else if (confirmedNumber) {
      emitEvent("draw:show-result", {
        title: formatSectionLabel(currentSection, sectionSequence ?? 1),
        entries: [{ number: confirmedNumber, name: match?.name ?? null }],
      });
      setResultShown(true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key >= "0" && e.key <= "9") {
        enterDigit(Number(e.key));
      } else if (e.key === "Backspace") {
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && e.shiftKey) {
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        redo();
      } else if (e.key === "Enter") {
        if (confirmedNumber) {
          startNewDraw();
        } else {
          confirm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enterDigit, undo, redo, confirm, confirmedNumber, startNewDraw]);

  return (
    <div className="mx-auto flex max-w-5xl gap-8 p-8">
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Manual Draw</h1>
            <p className="text-white/60">
              Click a slot to target it, then type the announced number.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span
              className="flex items-center gap-1.5 text-xs text-white/60"
              title={buzzerConnected ? "Buzzer connected" : "Buzzer disconnected — on-screen controls still work"}
            >
              <span
                className={`h-2 w-2 rounded-full ${buzzerConnected ? "bg-[#7CD992]" : "bg-white/25"}`}
              />
              Buzzer {buzzerConnected ? "connected" : "disconnected"}
            </span>
            <Toggle
              checked={skipValidation}
              onChange={setSkipValidation}
              label="Fail-safe (skip list check)"
            />
            <SectionControl
              section={currentSection}
              suggestions={knownSections}
              onSave={(name) => selectSection(name, "manual")}
            />
          </div>
        </div>

        {buzzed && (
          <div className="mb-4 inline-block rounded-md border border-[#F5C518]/40 bg-[#F5C518]/10 px-3 py-1.5 text-sm font-semibold text-[#F5C518]">
            🔔 Buzzed in!
          </div>
        )}

        <div className="mb-4">
          <button
            onClick={() => emitEvent("draw:roll", {})}
            disabled={!!confirmedNumber}
            className="rounded-md border border-[#F5C518]/40 px-5 py-2 font-semibold text-[#F5C518] hover:bg-[#F5C518]/10 disabled:opacity-30"
          >
            Draw
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {Array.from({ length: slotCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => selectSlot(i)}
              disabled={!!confirmedNumber}
              className={`flex h-14 w-11 items-center justify-center rounded-md border text-xl font-bold transition-colors disabled:cursor-default ${
                digits[i] !== null
                  ? "border-[#F5C518] bg-[#F5C518]/10 text-[#F5C518]"
                  : "border-white/10 text-white/20 hover:border-white/25"
              } ${i === activeIndex && !confirmedNumber ? "ring-2 ring-[#F5C518] ring-offset-2 ring-offset-[#0B0F17]" : ""}`}
            >
              {digits[i] ?? "–"}
            </button>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => (
            <button
              key={d}
              onClick={() => enterDigit(d)}
              disabled={!!confirmedNumber}
              className="h-11 w-11 rounded-md border border-white/15 text-lg font-semibold hover:bg-white/5 disabled:opacity-30"
            >
              {d}
            </button>
          ))}
          <button
            onClick={undo}
            disabled={!!confirmedNumber || history.length === 0}
            className="rounded-md border border-white/15 px-3 text-white/70 hover:bg-white/5 disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!!confirmedNumber || redoStack.length === 0}
            className="rounded-md border border-white/15 px-3 text-white/70 hover:bg-white/5 disabled:opacity-30"
          >
            Redo
          </button>
        </div>

        {hasList && !skipValidation && isComplete && !confirmedNumber && (
          <div className="mb-4">
            {match && (
              <p className="text-[#7CD992]">
                Matched: <span className="font-semibold">{match.name}</span> (#{match.ticket_number})
              </p>
            )}
            {notFound && (
              <p className="text-[#E27676]">
                No participant found with number {digits.join("")}. Fix the entry before confirming.
              </p>
            )}
          </div>
        )}
        {!hasList && isComplete && !confirmedNumber && (
          <p className="mb-4 text-white/50">
            No participant list loaded — this number will be logged without a matched name.
          </p>
        )}
        {hasList && skipValidation && isComplete && !confirmedNumber && (
          <p className="mb-4 text-[#F5C518]">
            Fail-safe mode on — skipping the participant list check. This number will be logged
            without a matched name.
          </p>
        )}

        <div className="mb-6 flex items-center gap-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Operator note (optional)"
            disabled={!!confirmedNumber}
            className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518] disabled:opacity-50"
          />
          {!confirmedNumber ? (
            <button
              onClick={confirm}
              disabled={!isComplete || (hasList && notFound)}
              className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F] disabled:opacity-30"
            >
              Confirm
            </button>
          ) : (
            <button
              onClick={startNewDraw}
              className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F]"
            >
              Start New Draw
            </button>
          )}
        </div>

        {confirmedNumber && (
          <div className="rounded-md border border-[#F5C518]/40 bg-[#F5C518]/10 p-4">
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold tracking-widest text-[#F5C518]">
                {confirmedNumber}
              </div>
              <button
                onClick={toggleShowResult}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  resultShown
                    ? "bg-white/10 text-white"
                    : "bg-[#F5C518] text-[#10141F]"
                }`}
              >
                {resultShown ? "Hide Result" : "Show Result"}
              </button>
            </div>
            {match && <div className="mt-1 text-white/80">{match.name}</div>}
            {saveMsg && (
              <div className="mt-2 text-xs text-white/40">
                {saveMsg} Press Enter or "Start New Draw" to continue.
              </div>
            )}
          </div>
        )}
      </div>

      <RecentDraws records={recentRecords} />
    </div>
  );
}
