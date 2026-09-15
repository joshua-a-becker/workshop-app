import React, { useEffect, useMemo, useState } from "react";
import {
  DebriefView,
  buildDebriefVars,
  normalizeTabs,
} from "./components/DebriefPanel";
import { PRICE, proposalValue } from "./components/negotiationDisplay";

// Standalone preview of the Debrief stage, reached via `?debriefPreview=1`
// (see index.jsx). Renders the real DebriefView through the real
// buildDebriefVars, fed from a pasted/loaded role JSON plus a few controls
// (which role you are, agreement or not, the deal), so debrief HTML can be
// written and checked without playing a game. Nothing here touches Empirica,
// Daily or the club; scores are recomputed locally with proposalValue(), the
// same math the server uses in onStageEnded.
//
// "Load scenario" fetches /api/roles/<id>.json same-origin; the Vite dev
// server proxies that path to the club (vite.config.js). In a production
// build there is no proxy, so the fetch fails visibly and paste still works.

const STORAGE_KEY = "debriefPreview.roleJson";

const SAMPLE = {
  type: "multiple_choice",
  roles: [
    {
      role_name: "Candidate",
      RP: 2,
      scoresheet: {
        Salary: [
          { option: "$90,000", score: 0 },
          { option: "$110,000", score: 4 },
          { option: "$130,000", score: 8 },
        ],
        Start_Date: [
          { option: "June", score: 3 },
          { option: "September", score: 0 },
        ],
      },
    },
    {
      role_name: "Hiring Manager",
      RP: 1,
      scoresheet: {
        Salary: [
          { option: "$90,000", score: 8 },
          { option: "$110,000", score: 4 },
          { option: "$130,000", score: 0 },
        ],
        Start_Date: [
          { option: "June", score: 0 },
          { option: "September", score: 3 },
        ],
      },
    },
    {
      role_name: "Recruiter",
      RP: 0,
      scoresheet: {
        Salary: [
          { option: "$90,000", score: 1 },
          { option: "$110,000", score: 2 },
          { option: "$130,000", score: 3 },
        ],
        Start_Date: [
          { option: "June", score: 2 },
          { option: "September", score: 2 },
        ],
      },
    },
  ],
  debrief: {
    tabs: [
      {
        name: "Outcome",
        html:
          "<h3>Negotiation Outcome</h3>\n" +
          "{{#agreement}}\n<p>The agreement you reached was:</p>\n{{agreementDetails}}\n" +
          "<p>This was worth <strong>{{score}} points</strong> to you, {{otherScores}}.</p>\n" +
          "{{scoreTable}}\n{{/agreement}}\n" +
          "{{#noAgreement}}\n<p>No agreement was reached, so you fall back to your BATNA, worth <strong>{{score}} points</strong>.</p>\n{{/noAgreement}}",
      },
      { name: "Your Notes", type: "notes" },
    ],
  },
};

function loadInitialJson() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch (e) {
    /* storage unavailable: fall through to the sample */
  }
  return JSON.stringify(SAMPLE, null, 2);
}

function negotiationTypeOf(data) {
  return data.type || data.negotiation_type || "features";
}

function priceConfigOf(data) {
  return data.price_config || data.priceConfig || {};
}

// Mirror of the server's per-player role attributes (callbacks.js role
// assignment) so proposalValue() sees the same shape it does in-game.
function roleAttrs(role) {
  return {
    roleScoresheet: role.scoresheet,
    roleMultiplier: role.multiplier ?? 1,
    rolePriceRP: role.rp ?? 0,
  };
}

export default function DebriefPreview() {
  const [jsonText, setJsonText] = useState(loadInitialJson);
  const [data, setData] = useState(() => {
    try { return JSON.parse(loadInitialJson()); } catch (e) { return SAMPLE; }
  });
  const [jsonError, setJsonError] = useState(null);
  const [scenarioId, setScenarioId] = useState("");
  const [loadStatus, setLoadStatus] = useState(null);
  const [meIndex, setMeIndex] = useState(0);
  const [agreement, setAgreement] = useState(true);
  // Choice deals: { issue: optionIndex } overrides; price deals: string.
  const [choiceDeal, setChoiceDeal] = useState({});
  const [priceStr, setPriceStr] = useState("");

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, jsonText); } catch (e) { /* ignore */ }
  }, [jsonText]);

  // Apply new JSON text: keep the last good `data` when it doesn't parse.
  const applyJsonText = (text) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Top level must be an object");
      setData(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError(e.message);
    }
  };

  // Edits from the per-tab HTML editor flow back into the JSON text so the
  // textarea (and localStorage) always hold the current draft.
  const updateTabHtml = (i, html) => {
    const next = {
      ...data,
      debrief: {
        ...(data.debrief || {}),
        tabs: (data.debrief?.tabs || []).map((t, j) => (j === i ? { ...t, html } : t)),
      },
    };
    setData(next);
    setJsonError(null);
    setJsonText(JSON.stringify(next, null, 2));
  };

  const loadScenario = async () => {
    const id = scenarioId.trim();
    if (!id) return;
    setLoadStatus("Loading…");
    try {
      const res = await fetch(`/api/roles/${encodeURIComponent(id)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      JSON.parse(text); // validate before replacing the draft
      applyJsonText(text);
      setLoadStatus(`Loaded "${id}"`);
    } catch (e) {
      setLoadStatus(`Couldn't load "${id}": ${e.message} (dev server proxies /api/roles to the club; paste JSON instead if this isn't the dev server)`);
    }
  };

  const type = negotiationTypeOf(data);
  const priceConfig = priceConfigOf(data);
  const roles = Array.isArray(data.roles) ? data.roles : [];
  const me = roles[Math.min(meIndex, Math.max(roles.length - 1, 0))];
  const issues = Object.keys(roles[0]?.scoresheet || {});

  // The deal under test. Choice types default every issue to option 0; price
  // defaults to the midpoint of the roles' reservation prices.
  const options = useMemo(() => {
    if (type === PRICE) {
      if (priceStr !== "") return { value: priceStr };
      const rps = roles.map((r) => Number(r.rp)).filter((n) => isFinite(n));
      const mid = rps.length ? (Math.min(...rps) + Math.max(...rps)) / 2 : 0;
      return { value: String(mid) };
    }
    const o = {};
    issues.forEach((issue) => { o[issue] = choiceDeal[issue] ?? 0; });
    return o;
  }, [type, priceStr, choiceDeal, roles, issues]);

  // Same outcome rule as callbacks.js onStageEnded: deal value if agreed,
  // otherwise the BATNA value (RP; 0 for price).
  const bonusFor = (role) =>
    agreement
      ? proposalValue(type, roleAttrs(role), { options })
      : type === PRICE ? 0 : Number(role.RP) || 0;

  const tabs = normalizeTabs(data.debrief);
  const vars = me
    ? buildDebriefVars({
        me: {
          roleName: me.role_name,
          displayName: "Preview Player",
          bonus: bonusFor(me),
          reachedAgreement: agreement,
          roleScoresheet: me.scoresheet,
          finalProposal: agreement ? options : null,
        },
        others: roles
          .filter((r) => r !== me)
          .map((r) => ({ roleName: r.role_name, bonus: bonusFor(r) })),
        negotiationType: type,
        priceConfig,
      })
    : null;

  const htmlTabs = (data.debrief?.tabs || [])
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t && t.type !== "notes");

  return (
    <div className="h-screen flex bg-gray-100 text-sm">
      {/* Controls */}
      <div className="w-[38%] min-w-[360px] h-full overflow-y-auto border-r border-gray-300 bg-white p-4 space-y-5">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Debrief preview</h1>
          <p className="text-gray-600">
            Renders the real Debrief stage from role JSON. Nothing is saved to the club; copy the
            HTML back into the exercise when you're happy with it.
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800">Role JSON</h2>
          <div className="flex gap-2">
            <input
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadScenario(); }}
              placeholder="scenario id"
              className="flex-1 rounded border border-gray-300 px-2 py-1"
            />
            <button onClick={loadScenario} className="px-3 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700">
              Load scenario
            </button>
            <button
              onClick={() => applyJsonText(JSON.stringify(SAMPLE, null, 2))}
              className="px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Sample
            </button>
          </div>
          {loadStatus && <p className="text-xs text-gray-600">{loadStatus}</p>}
          <textarea
            value={jsonText}
            onChange={(e) => applyJsonText(e.target.value)}
            rows={10}
            spellCheck={false}
            className={`w-full font-mono text-xs rounded border p-2 ${jsonError ? "border-red-400" : "border-gray-300"}`}
          />
          {jsonError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              JSON doesn't parse (showing the last good version): {jsonError}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800">Outcome</h2>
          <div className="flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-1">
              <span className="text-gray-700">You are</span>
              <select
                value={Math.min(meIndex, Math.max(roles.length - 1, 0))}
                onChange={(e) => setMeIndex(Number(e.target.value))}
                className="rounded border border-gray-300 px-2 py-1"
              >
                {roles.map((r, i) => (
                  <option key={i} value={i}>{r.role_name || `Role ${i + 1}`}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={agreement} onChange={() => setAgreement(true)} /> Agreement
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={!agreement} onChange={() => setAgreement(false)} /> No agreement
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Type: <span className="font-mono">{type}</span> · {roles.length} role{roles.length === 1 ? "" : "s"}
          </p>

          {agreement && (
            <div className="space-y-1 pl-2 border-l-2 border-gray-200">
              <h3 className="text-gray-700 font-medium">Deal</h3>
              {type === PRICE ? (
                <label className="flex items-center gap-2">
                  <span className="text-gray-700">{priceConfig.label || "Price"}</span>
                  <input
                    type="number"
                    value={options.value}
                    onChange={(e) => setPriceStr(e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 w-32"
                  />
                </label>
              ) : issues.length === 0 ? (
                <p className="text-xs text-red-700">No scoresheet issues found on the first role.</p>
              ) : (
                issues.map((issue) => (
                  <label key={issue} className="flex items-center gap-2">
                    <span className="text-gray-700 w-40 truncate">{issue.replace(/_/g, " ")}</span>
                    <select
                      value={options[issue]}
                      onChange={(e) => setChoiceDeal({ ...choiceDeal, [issue]: Number(e.target.value) })}
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      {(roles[0].scoresheet[issue] || []).map((opt, idx) => (
                        <option key={idx} value={idx}>{opt.option}</option>
                      ))}
                    </select>
                  </label>
                ))
              )}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-gray-800">Tab HTML</h2>
          {htmlTabs.length === 0 && (
            <p className="text-xs text-gray-500">No html tabs in <span className="font-mono">debrief.tabs</span>.</p>
          )}
          {htmlTabs.map(({ t, i }) => (
            <div key={i}>
              <label className="block text-gray-700 font-medium mb-1">{t.name}</label>
              <textarea
                value={t.html || ""}
                onChange={(e) => updateTabHtml(i, e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full font-mono text-xs rounded border border-gray-300 p-2"
              />
            </div>
          ))}
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer">Placeholders</summary>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><code>{"{{score}}"}</code>, <code>{"{{roleName}}"}</code>, <code>{"{{displayName}}"}</code> — yours</li>
              <li><code>{"{{agreementDetails}}"}</code> — the deal terms (empty if no agreement)</li>
              <li><code>{"{{otherScores}}"}</code> — "and 3.00 points to X" / "3.00 points to X, and 4.00 points to Y"</li>
              <li><code>{"{{scoreTable}}"}</code> — table of every role's points</li>
              <li><code>{"{{#agreement}}…{{/agreement}}"}</code>, <code>{"{{#noAgreement}}…{{/noAgreement}}"}</code></li>
            </ul>
          </details>
        </section>
      </div>

      {/* Live render */}
      <div className="flex-1 h-full overflow-y-auto">
        {vars ? (
          <DebriefView
            key={`${type}-${roles.length}`}
            tabs={tabs}
            vars={vars}
            notes={
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Your Notes</h3>
                <p className="text-gray-500 italic">
                  (Notes tab: the autosaving textarea renders here in a real game.)
                </p>
              </div>
            }
          />
        ) : (
          <div className="p-6 text-red-700">The role JSON has no <span className="font-mono">roles</span> array.</div>
        )}
      </div>
    </div>
  );
}
