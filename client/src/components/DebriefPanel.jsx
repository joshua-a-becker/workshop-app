import React, { useState, useEffect, useRef } from "react";
import { usePlayer, usePlayers, useGame } from "@empirica/core/player/classic/react";
import { saveExerciseNote } from "../clubApi";
import { agreementHtml } from "./negotiationDisplay";

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

export function normalizeTabs(debrief) {
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
//   {{score}} {{roleName}} {{displayName}} — the viewing player's own values
//   {{agreementDetails}} — the agreed terms (empty if no agreement)
//   {{otherScores}} — every OTHER player's points, joined into a phrase that
//       drops into a sentence after a comma, with the "and" placed for the
//       count: "and 3 points to Tim" / "3 points to Tim, and 10 points to Jo"
//       / "3 points to Tim, 10 points to Jo, and 4 points to Al". So authors
//       write "…worth {{score}} points to you, {{otherScores}}." once and it
//       reads correctly for 2 players or more.
//   {{scoreTable}} — an HTML table of every role's points, viewer marked (you)
//   {{scoringTable}} — the full scoresheet: one row per option per issue, one
//       score column per role (viewer's headed "You:"), agreed row highlighted.
//       Built from live player attributes, so it can't drift from the club data.
//       Empty for price scenarios (no scoresheet).
// Deliberately tiny — no templating dependency.
function renderTemplate(html, vars) {
  if (!html) return "";
  const keep = vars.reachedAgreement ? "agreement" : "noAgreement";
  const drop = vars.reachedAgreement ? "noAgreement" : "agreement";
  const blockRe = (name) =>
    new RegExp(`{{#${name}}}([\\s\\S]*?){{/${name}}}`, "g");
  // Substitutions are plain strings (not regex replacement patterns), so a "$"
  // in a value (e.g. a price) can't be misread as a backreference.
  const sub = (name, value) =>
    (h) => h.replace(new RegExp(`{{\\s*${name}\\s*}}`, "g"), () => value);
  return [
    (h) => h.replace(blockRe(keep), "$1").replace(blockRe(drop), ""),
    sub("score", vars.score),
    sub("roleName", vars.roleName),
    sub("displayName", vars.displayName),
    sub("agreementDetails", vars.agreementDetails),
    sub("otherScores", vars.otherScores),
    sub("scoreTable", vars.scoreTable),
    sub("scoringTable", vars.scoringTable),
  ].reduce((h, f) => f(h), html);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const formatScore = (n) => (Number(n) || 0).toFixed(2);

// "and 3 points to Tim" | "3 points to Tim, and 10 points to Jo" | "a, b, and c"
function otherScoresPhrase(others) {
  const parts = others.map(
    (o) => `${formatScore(o.score)} points to ${escapeHtml(o.roleName)}`
  );
  if (parts.length === 0) return "";
  if (parts.length === 1) return `and ${parts[0]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function scoreTableHtml(me, others) {
  const row = (roleName, score, isMe) =>
    `<tr><td>${escapeHtml(roleName)}${isMe ? " (you)" : ""}</td>` +
    `<td>${formatScore(score)}</td></tr>`;
  const rows = [row(me.roleName, me.score, true)]
    .concat(others.map((o) => row(o.roleName, o.score, false)))
    .join("");
  return `<table><thead><tr><th>Role</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Full scoresheet table for {{scoringTable}}. `roles` = every player in game
// order, each { roleName, roleScoresheet, isMe }. Issues and option labels come
// from the viewer's scoresheet; each role's score is looked up by the same
// option index in its own sheet ("—" if it lacks that issue/option). `deal` is
// the agreed { issue: optionIndex } map, or null when there was no agreement.
// Styled by .debrief-scoring-table in index.css.
function scoringTableHtml(roles, deal) {
  const me = roles.find((r) => r.isMe);
  const sheet = me && me.roleScoresheet;
  if (!sheet || Object.keys(sheet).length === 0) return "";

  const head = roles
    .map(
      (r) =>
        `<th class="num">${r.isMe ? "You:<br>" : ""}${escapeHtml(r.roleName)}</th>`
    )
    .join("");

  const bodies = Object.entries(sheet).map(([issue, options]) => {
    const label = escapeHtml(issue.replace(/_/g, " "));
    const agreedIdx = deal ? deal[issue] : undefined;
    const rows = options.map((opt, idx) => {
      const first =
        idx === 0 ? `<td rowspan="${options.length}"><strong>${label}</strong></td>` : "";
      const scores = roles
        .map((r) => {
          const score = r.roleScoresheet?.[issue]?.[idx]?.score;
          return `<td class="num">${score === undefined || score === null ? "—" : escapeHtml(score)}</td>`;
        })
        .join("");
      const cls = agreedIdx === idx ? ' class="agreed"' : "";
      return `<tr${cls}>${first}<td>${escapeHtml(opt.option)}</td>${scores}</tr>`;
    });
    return `<tbody>${rows.join("")}</tbody>`;
  });

  return (
    `<table class="debrief-scoring-table"><thead><tr><th>Issue</th><th>Outcome</th>${head}</tr></thead>` +
    bodies.join("") +
    `</table>`
  );
}

// Build the template vars from plain data, so the Empirica-connected wrapper
// below and the standalone preview page (DebriefPreview.jsx) go through one
// code path and can't drift.
//   me:     { roleName, displayName, bonus, reachedAgreement, roleScoresheet, finalProposal }
//   others: [{ roleName, bonus, roleScoresheet? }] — in game order; `before`
//           marks the ones listed ahead of the viewer so every player sees the
//           scoring table's columns in the same order.
export function buildDebriefVars({ me, others, negotiationType, priceConfig }) {
  const roleName = me.roleName || "";
  const bonus = me.bonus || 0;
  const otherRows = (others || []).map((o) => ({
    roleName: o.roleName,
    score: o.bonus || 0,
  }));
  return {
    reachedAgreement: !!me.reachedAgreement,
    score: formatScore(bonus),
    roleName,
    displayName: me.displayName || "",
    agreementDetails: agreementHtml(
      negotiationType || "features",
      me.roleScoresheet,
      priceConfig || {},
      me.finalProposal
    ),
    otherScores: otherScoresPhrase(otherRows),
    scoreTable: scoreTableHtml({ roleName, score: bonus }, otherRows),
    scoringTable: scoringTableHtml(
      [
        ...(others || []).filter((o) => o.before).map((o) => ({ ...o, isMe: false })),
        { roleName, roleScoresheet: me.roleScoresheet, isMe: true },
        ...(others || []).filter((o) => !o.before).map((o) => ({ ...o, isMe: false })),
      ],
      // Features: an unset issue means Exclude (index 1), as in the server's scoring.
      me.reachedAgreement && me.finalProposal
        ? Object.fromEntries(
            Object.keys(me.roleScoresheet || {}).map((issue) => [
              issue,
              me.finalProposal[issue] ?? (negotiationType === "features" ? 1 : undefined),
            ])
          )
        : null
    ),
  };
}

// Pure presentation: tab strip, the rendered html tab (or `notes` for a notes
// tab), and the Continue button. No Empirica hooks, so it can be rendered
// standalone by the preview page.
export function DebriefView({ tabs, vars, notes }) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Clamp in case the tab set ever shrinks under us.
  const index = Math.min(activeIndex, tabs.length - 1);
  const tab = tabs[index];
  const nextTab = tabs[index + 1];

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
            notes
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

export function DebriefPanel() {
  const player = usePlayer();
  const players = usePlayers();
  const game = useGame();

  const tabs = normalizeTabs(game.get("debrief"));
  const scenario = player.get("scenario") || "";

  const bonus = player.get("bonus") || 0;
  // Bonus/roleName are ordinary (game-visible) player attributes, set for
  // everyone in the same server callback, so the other players' outcomes are
  // readable here without any extra plumbing. Role names fall back to display
  // names so a missing role never yields "3 points to ".
  const all = players || [];
  const myPos = all.findIndex((p) => p.id === player.id);
  const others = all
    .filter((p) => p.id !== player.id)
    .map((p) => ({
      roleName: p.get("roleName") || p.get("displayName") || "another player",
      bonus: p.get("bonus") || 0,
      roleScoresheet: p.get("roleScoresheet"),
      before: all.indexOf(p) < myPos,
    }));

  const vars = buildDebriefVars({
    me: {
      roleName: player.get("roleName"),
      displayName: player.get("displayName"),
      bonus,
      // Set per-player in onStageEnded; fall back to the score for older games.
      reachedAgreement: player.get("reachedAgreement") ?? bonus > 0,
      roleScoresheet: player.get("roleScoresheet"),
      finalProposal: player.get("finalProposal"),
    },
    others,
    negotiationType: game.get("negotiationType"),
    priceConfig: game.get("priceConfig"),
  });

  return (
    <DebriefView tabs={tabs} vars={vars} notes={<NotesTab scenario={scenario} />} />
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
