# Handoff Manifest — Negotiation Types + Timer Work

**Date:** 2026-06-14
**Status:** In progress, paused mid-task by user (a fresh agent will resume).
**App:** Group Negotiation Experiment Platform (Empirica + Daily.co), in `/home/claude/workshop-app`.

---

## Full conversation transcript (most detailed record)

```
/home/claude/.claude/projects/-home-claude-workshop-app/ef038c0c-53fc-4b3d-a83c-dd21145bf505.jsonl
```

This JSONL is the complete turn-by-turn history (every tool call, file read, edit, and the user's exact instructions/corrections). Read it for nuance beyond this manifest. Memory dir for this project: `/home/claude/.claude/projects/-home-claude-workshop-app/memory/`.

---

## Big picture — what the user asked for

Three modifications to the app, in order:

### 1. Timer: allow "unlimited time" (DONE ✅)
If `negotiateTime` (treatment factor, in seconds) is **over 5 hours (> 18000s)**, **hide the countdown timer during the negotiate stage only** — "effectively invisible, so no design around it changes." (Used Tailwind `invisible`, which keeps the element's layout footprint so nothing shifts.)

### 2. Three negotiation types (IN PROGRESS 🔨 — core code written, not yet verified/tested)
The negotiation is currently a list of **either/or features** (include/exclude). Add two more, identifiable by the JSON:
- **Type 1 — price (single number):** people type a number in a box.
- **Type 2 — multiple-choice (multi-issue):** one **dropdown per issue**, options **ordered as in JSON**, careful default (no biasing default).
- **Type 3 — features (existing):** include/exclude. Must keep working unchanged.

### 3. Load role data from a file OR a URL (DONE ✅ server-side)
Currently role data JSON is fetched only from a remote URL (`roleDataURL` treatment factor, via `curl`). Make it accept **either a URL (existing flow) or a local file path** so example scenarios can live in the repo.

---

## CRITICAL: the agreed scoring/design model (from user, after discussion)

The user **rejected** an initial standalone helpers file and an initial AskUserQuestion, then **specified the model precisely**. Honor this exactly:

- **One unifying concept: "value"** — replaces the word "points" everywhere in the UI. Same rule for all three types: **never accept a deal worth < 0**.
- **features & multiple_choice** = the *same* logic, different display. Each carries a **"payoff per option per issue" table** (the existing `scoresheet`: each issue → ordered array of options, each `{ option, score, reason }`). **value = sum of the chosen option's `score` across all issues.** Features is just the 2-option (Include/Exclude) special case shown with checkboxes; multiple_choice shows an ordered dropdown.
- **price** = each role carries a **`multiplier`** (k = +1 or −1) and an **`rp`** (reservation price). **value = k·rp − k·price = k·(rp − price)** (negotiator's surplus). Buyer k=+1 → `rp − price`; seller k=−1 → `price − rp`. No-agreement value = 0.
- The **JSON carries the data + a `type` label**; display interprets type first, then reads values. Absent `type` ⇒ `"features"` (backward compatible).
- The user's later instruction: **break the 3-type display logic into a small separate module** so the main components don't get ugly. (Done — see `negotiationDisplay.jsx`. NOTE: this reverses the earlier "no extra helper file" comment — the user changed their mind and explicitly asked for a display module.)

### JSON schemas
**features** (unchanged, legacy): `{ "roles": [ { role_name, narrative, BATNA, RP, scoresheet: { Issue: [ {option:"Include",score,reason}, {option:"Exclude",score,reason} ] } } ], "tips": "..." }`

**multiple_choice**: `{ "type":"multiple_choice", "roles":[ { role_name, narrative, BATNA, RP, scoresheet: { Issue: [ {option,score,reason}, ... ordered ... ] } } ], "tips":"..." }`

**price**: `{ "type":"price", "price_config": { label, prefix, suffix?, min?, max?, step?, description? }, "roles":[ { role_name, narrative, BATNA, multiplier, rp } ], "tips":"..." }`

---

## Files changed / created so far

Working tree (`git status --short`):
```
 M README.md                                    (NOT yet updated for these changes — TODO)
 M client/src/components/MaterialsPanel.jsx      (rewritten: type-aware, uses module)
 M client/src/components/ReadRoleContent.jsx     (rewritten: type-aware, uses module)
 M client/src/components/Timer.jsx               (timer hiding — DONE)
 M client/src/components/VideoNegotiate.jsx      (passes roleMultiplier/rolePriceRP, type-aware loading guard)
 M server/src/callbacks.js                       (file/URL loader, type-aware role assignment + scoring)
?? client/src/components/negotiationDisplay.jsx  (NEW shared module: value logic + per-type display)
?? roles_multiplechoice_example.json             (NEW example)
?? roles_price_example.json                      (NEW example)
?? _HOW_TO_Empirica_Guide.md                     (pre-existing untracked, unrelated to this task)
?? _HANDOFF_MANIFEST.md                          (this file)
```

### Detail per file

- **`client/src/components/Timer.jsx`** — added `useStage`/`useGame`; `UNLIMITED_NEGOTIATE_THRESHOLD = 5*60*60`. When stage name is `"Time To Negotiate"` and `treatment.negotiateTime > 18000`, the `<h1>` gets class `invisible` (kept, not removed, so layout is unchanged). ✅ Complete.

- **`client/src/components/negotiationDisplay.jsx`** (NEW) — the shared module the user asked for. Exports:
  - Constants `FEATURES`, `MULTIPLE_CHOICE`, `PRICE`.
  - Value logic: `choiceValue(type, sheet, sel)`, `priceValue(k, rp, price)`, `proposalValue(type, role, proposal)`, `liveValue(...)`, `batnaThreshold(type, roleRP)` (price ⇒ 0), `canSubmit(...)`, `submitErrorMessage(type)`, `buildProposalOptions(type, sheet, sel, priceStr)`.
  - Display: internal `FeatureRows` (checkboxes, sorted by score desc — preserves existing features behavior), `ChoiceRows` (dropdowns, **JSON order preserved**, placeholder `— Select —`), `PriceInput` (number box w/ prefix/suffix/min/max/step). Exported `ScoringCalculator` (the full blue "Scoring" box: header + rows + live value card + footer slot) and `ProposalDetails` (per-type proposal contents for pending card + history).
  - `proposal.options` shape by type: features `{issue:0|1}` (missing⇒Exclude); multiple_choice `{issue:idx}` (all issues required before submit); price `{value:number}`.

- **`client/src/components/MaterialsPanel.jsx`** — rewritten to import from the module. All proposal lifecycle (submit / initial votes / finalize / dismiss / modify / history / flashing tab / welcome modal) is **unchanged**. Scoring now goes through `proposalValue`/`canSubmit`/`buildProposalOptions`. Calculator tab renders `<ScoringCalculator>` with a footer of Submit+Reset buttons. "points/pts" → "value" in display. Negative-accept guard now uses `proposalValue(...) < 0` for all types. Incomplete-submit modal message is type-specific via `submitErrorMessage`.

- **`client/src/components/ReadRoleContent.jsx`** (the read-role *practice* screen) — rewritten to use the same `<ScoringCalculator>` (title="Scoring", footer = Reset only). Reads `negotiationType`, `priceConfig`, `roleMultiplier`, `rolePriceRP` from game/player. Loading guard fixed to `roleName && roleNarrative && (roleScoresheet || roleMultiplier !== undefined)` so price roles (no scoresheet) don't get stuck on "Loading…".

- **`client/src/components/VideoNegotiate.jsx`** — reads + passes `roleMultiplier`, `rolePriceRP` to MaterialsPanel; loading guard made type-aware (same pattern as ReadRoleContent).

- **`server/src/callbacks.js`**:
  - Added `import fs from "fs"; import path from "path";`.
  - New `loadRoleData(source)`: if `source` matches `^https?://` → existing `curl` path; else treat as local file, trying candidates `[source, resolve(cwd, source), resolve(cwd, "..", source)]` (works whether launched from project root via `empirica` or from `server/` via npm).
  - `onGameStart`: replaced the curl line with `loadRoleData`; reads `negotiationType = rolesData.type || rolesData.negotiation_type || "features"`; `game.set("negotiationType", ...)`; for price `game.set("priceConfig", rolesData.price_config || ...)`. Per-role assignment branches: price ⇒ `player.set("roleMultiplier", role.multiplier ?? 1)`, `player.set("rolePriceRP", role.rp ?? 0)`, `player.set("roleRP", 0)`; else ⇒ `player.set("roleScoresheet", role.scoresheet)`, `player.set("roleRP", role.RP)`. (Always sets roleName/roleNarrative/roleBATNA.)
  - `onRoundEnded`: reads `negotiationType`; bonus branch — price ⇒ `k*(rp - price)` from `finalProposal.options.value`; choice ⇒ sum of chosen option scores (features missing⇒idx 1, multiple_choice missing⇒skip). No-agreement ⇒ `roleRP || 0` (0 for price).

- **`roles_price_example.json`** (NEW) — 2-party used-car sale. Buyer k=+1 rp=20000, Seller k=−1 rp=12000 ⇒ ZOPA $12,000–$20,000. Has `price_config` (label "Sale Price", prefix "$", step 250).

- **`roles_multiplechoice_example.json`** (NEW) — 2-party job offer; 4 issues (Salary, Start_Date, Annual_Leave, Remote_Days) × 3 ordered options each; asymmetric scores create integrative ("logrolling") trades; RP 0 each.

---

## Validation done

- JSON valid for all three (`roles_v1.json`, both new examples). ✅
- `esbuild` parse of `negotiationDisplay.jsx`, `MaterialsPanel.jsx`, `ReadRoleContent.jsx`, `VideoNegotiate.jsx`, `Timer.jsx` → **no syntax errors**. ✅
- `node --check server/src/callbacks.js` → OK. ✅
- **NOT yet done:** the user interrupted right as I was about to run a numerical scoring/ZOPA sanity check (a throwaway node script mirroring the value formulas against both example JSONs). No runtime/UI test, no full client build, no multiplayer test has been run.

---

## TODO to finish (for the resuming agent)

1. **Numerical sanity check** of value math vs. the two example JSONs (price ZOPA $12k–$20k; MC additive + integrative trade). This is the step that was interrupted.
2. **Run/verify in the real app** — at minimum a client build (`cd client && npm run build`) to catch import/JSX issues esbuild's parse-only check won't; ideally launch (`empirica`) and click through each of the 3 types with a treatment pointing `roleDataURL` at the example files (local path now supported, e.g. `roleDataURL: roles_price_example.json`). Test multiplayer (≥2 windows) since stages are synchronous.
3. **Update `README.md`** — it was already separately updated earlier this session for *other* drift, but it does NOT yet document: the 3 negotiation types + their JSON schemas, the "value" terminology, local-file role loading, and the timer-hiding rule. Add a "Negotiation Types" section and update "Role Data Format", "Treatment Configuration"/URL notes, and "Negotiation Mechanics" (scoring).
4. **Decisions the user may still want to weigh in on:** price scoring is `k·(rp−price)` per their spec (settled). Confirm the multiple_choice **placeholder/required-selection** UX (currently `— Select —` + can't submit until every issue chosen) matches their "careful about the default" intent. Confirm "value" wording in all visible strings reads well.
5. **Dead code note:** `client/src/components/ReadRoleContentProlific.jsx` still uses the old shape but is **not imported anywhere** (only `ReadRoleContent` is used, via `ReadRole.jsx`). Left untouched. If Prolific variants get re-enabled later, it'll need the same treatment.

---

## Working-style notes (the user corrected me 3×; respect these)

- The user prefers to **discuss design before big builds**, especially anything affecting the experiment's payoffs/data schema. They rejected a premature implementation and a premature multi-question prompt.
- They asked questions be **reformulated/discussed**, not fired off as a rigid form, when the framing might be wrong.
- They initially said **"don't need an extra helper file" / keep logic inline**, then later **reversed** and asked for a **small separate display module** — so `negotiationDisplay.jsx` is what they want now. Don't re-inline it.
- Keep existing design changes **minimal**; preserve current visuals for the features type.
