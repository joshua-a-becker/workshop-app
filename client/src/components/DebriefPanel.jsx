import React, { useState, useEffect, useRef } from "react";
import { usePlayer, useGame } from "@empirica/core/player/classic/react";
import { saveExerciseNote } from "../clubApi";

// The Debrief stage is fully data-driven from the role data's `debrief.tabs`
// array. Each tab is { name, type?, html? }:
//   - type "html" (default): `html` is rendered as-is (with template
//     substitution), so authors control all content and layout from JSON.
//   - type "notes": the standardized "Your Notes" component (autosaving
//     textarea) — the one tab that can't be expressed as static HTML.
// The "Continue to <next tab>" button is generated from the next tab's name;
// the last tab gets none. If no valid tabs are configured, we fall back to a
// single Notes tab so every scenario at least captures reflection notes.
const DEFAULT_TABS = [{ name: "Your Notes", type: "notes" }];

function normalizeTabs(debrief) {
  const tabs = debrief && debrief.tabs;
  if (
    Array.isArray(tabs) &&
    tabs.length > 0 &&
    tabs.every((t) => t && typeof t.name === "string" && t.name.length > 0)
  ) {
    return tabs;
  }
  return DEFAULT_TABS;
}

// Lightweight template substitution for `html` tabs. Supports:
//   {{#agreement}}…{{/agreement}} / {{#noAgreement}}…{{/noAgreement}} blocks
//   {{score}} {{roleName}} {{displayName}} simple vars
// Deliberately tiny — no templating dependency.
function renderTemplate(html, vars) {
  if (!html) return "";
  const keep = vars.reachedAgreement ? "agreement" : "noAgreement";
  const drop = vars.reachedAgreement ? "noAgreement" : "agreement";
  const blockRe = (name) =>
    new RegExp(`{{#${name}}}([\\s\\S]*?){{/${name}}}`, "g");
  return html
    .replace(blockRe(keep), "$1")
    .replace(blockRe(drop), "")
    .replace(/{{\s*score\s*}}/g, vars.score)
    .replace(/{{\s*roleName\s*}}/g, vars.roleName)
    .replace(/{{\s*displayName\s*}}/g, vars.displayName);
}

export function DebriefPanel() {
  const player = usePlayer();
  const game = useGame();

  const [activeIndex, setActiveIndex] = useState(0);

  const tabs = normalizeTabs(game.get("debrief"));
  // Clamp in case the tab set ever shrinks under us.
  const index = Math.min(activeIndex, tabs.length - 1);
  const tab = tabs[index];
  const nextTab = tabs[index + 1];

  const scenario = player.get("scenario") || "";

  const bonus = player.get("bonus") || 0;
  // Set per-player in onRoundEnded; fall back to the score for older games.
  const reachedAgreement = player.get("reachedAgreement") ?? bonus > 0;
  const vars = {
    reachedAgreement,
    score: bonus.toFixed(2),
    roleName: player.get("roleName") || "",
    displayName: player.get("displayName") || "",
  };

  return (
    <div className="w-full bg-gray-300 p-6 flex flex-col relative min-h-screen">
      {/* Bottom fade overlay (matches the negotiation materials panel) */}
      <div className="fixed left-0 bottom-0 w-[70%] h-12 bg-gradient-to-t from-gray-300 to-transparent pointer-events-none z-10"></div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-2 flex-wrap">
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setActiveIndex(i)}
            className={`px-4 py-2 rounded font-medium transition-all border ${
              i === index
                ? "bg-white text-blue-600 border-blue-400 shadow"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1">
        <div className="space-y-4">
          {tab.type === "notes" ? (
            <NotesTab scenario={scenario} />
          ) : (
            <div
              className="bg-white rounded-lg shadow-md p-6 prose prose-gray max-w-none"
              dangerouslySetInnerHTML={{
                __html: renderTemplate(tab.html || "", vars),
              }}
            />
          )}
          {nextTab && (
            <ProceedButton onClick={() => setActiveIndex(index + 1)}>
              Continue to {nextTab.name}
            </ProceedButton>
          )}
        </div>
      </div>
    </div>
  );
}

// Save at most once per this interval while typing (plus once on unmount), so we
// never hit the server on every keystroke.
const SAVE_DEBOUNCE_MS = 3000;

function NotesTab({ scenario }) {
  const player = usePlayer();
  // Seed from the player attribute so the note survives a page reload (Empirica
  // rehydrates player state on reconnect). The remote club save is the durable
  // copy; this is the local/offline-resilient draft.
  const initial = player.get("exerciseNote") || "";
  const [note, setNote] = useState(initial);
  // "idle" | "editing" | "saving" | "saved" | "error"
  const [status, setStatus] = useState("idle");
  const timerRef = useRef(null);
  // Latest text + last-saved text live in refs so the debounce timer always
  // reads current values without restarting on every keystroke.
  const noteRef = useRef(initial);
  const savedRef = useRef(initial);

  // Persist the current draft: write the player attribute (survives reload/tab
  // change) and the remote club save. Called at most once per SAVE_DEBOUNCE_MS,
  // plus once on unmount — never on every keystroke.
  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const current = noteRef.current;
    if (current === savedRef.current) return; // nothing new to persist
    savedRef.current = current;
    player.set("exerciseNote", current);
    setStatus("saving");
    saveExerciseNote(scenario, current)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Don't flip to "saved" if the user kept typing while we were saving.
        setStatus(noteRef.current === current ? "saved" : "editing");
      })
      .catch(() => setStatus("error"));
  };

  const handleChange = (e) => {
    const value = e.target.value;
    setNote(value);
    noteRef.current = value;
    setStatus("editing");
    // Throttle: schedule a save only if one isn't already pending, so a burst of
    // typing produces at most one save per SAVE_DEBOUNCE_MS.
    if (!timerRef.current) {
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }
  };

  // Flush any pending edits when the component unmounts (e.g. tab switch).
  useEffect(() => {
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Your Notes</h3>
        <p className="text-gray-700 mb-4">
          Please enter any notes you'd like to save about this exercise. Enter at
          least 1 thing you did well, and 1 thing you'd do differently next time.
        </p>

        <textarea
          value={note}
          onChange={handleChange}
          rows={10}
          placeholder="Type your notes here…"
          className="w-full rounded-lg border border-gray-300 p-4 text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-y"
        />

        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-gray-500 italic">
            This note will be saved to your profile.
          </p>
          <SaveIndicator status={status} />
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ status }) {
  switch (status) {
    case "editing":
      return <span className="text-sm text-gray-400">Editing…</span>;
    case "saving":
      return <span className="text-sm text-gray-400">Saving…</span>;
    case "saved":
      return <span className="text-sm text-green-600">✓ Saved</span>;
    case "error":
      return (
        <span className="text-sm text-red-600">
          Couldn't save — check your connection
        </span>
      );
    default:
      return null;
  }
}

function ProceedButton({ onClick, children }) {
  return (
    <div className="flex justify-center pt-2 pb-8">
      <button
        onClick={onClick}
        className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors"
      >
        {children} →
      </button>
    </div>
  );
}
