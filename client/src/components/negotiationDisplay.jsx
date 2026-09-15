// ---------------------------------------------------------------------------
// Negotiation display + value logic for the three negotiation types.
//
//   "features"        - include/exclude checkboxes
//   "multiple_choice" - one ordered dropdown per issue (order preserved from JSON)
//   "price"           - a single number; value = multiplier * (rp - price)
//
// Display-only variant (never stored on the game, never sent to the server):
//   "multiple_choice_table" - multiple_choice rendered as a full payoff table:
//                             one block per issue, one radio row per option, so
//                             the whole scoresheet is visible at once. Used on
//                             the Read Negotiation Role stage. All value logic
//                             treats it exactly like "multiple_choice".
//
// "value" is the single unifying concept across all three (it replaces the old
// "points"). The same rule applies everywhere: never accept a deal worth < 0.
//
// This module keeps MaterialsPanel and ReadRoleContent small: they hand it role
// data + calculator state and it renders the type-appropriate UI and math.
// Keep the value logic in sync with server/src/callbacks.js.
// ---------------------------------------------------------------------------

import React from "react";

export const FEATURES = "features";
export const MULTIPLE_CHOICE = "multiple_choice";
export const PRICE = "price";
export const MULTIPLE_CHOICE_TABLE = "multiple_choice_table";

// Collapse the display-only table variant back to the underlying value type.
export function valueType(type) {
  return type === MULTIPLE_CHOICE_TABLE ? MULTIPLE_CHOICE : type;
}

// ---------------------------------------------------------------------------
// Value logic
// ---------------------------------------------------------------------------

// Value of a choice selection ({ issue: optionIndex }) for features/multiple_choice.
export function choiceValue(type, roleScoresheet, selection) {
  return Object.entries(roleScoresheet || {}).reduce((sum, [issue, options]) => {
    let idx = selection?.[issue];
    if (idx === undefined || idx === null) {
      if (type === FEATURES) idx = 1; // unchecked feature = Exclude
      else return sum; // multiple_choice: unchosen issue contributes nothing
    }
    return sum + (options?.[idx]?.score || 0);
  }, 0);
}

// Value of a price = multiplier * (rp - price) (the negotiator's surplus).
export function priceValue(roleMultiplier, rolePriceRP, price) {
  const v = parseFloat(price);
  if (!isFinite(v)) return 0;
  return (roleMultiplier ?? 1) * ((rolePriceRP ?? 0) - v);
}

// Value of a stored proposal. `role` = { roleScoresheet, roleMultiplier, rolePriceRP }.
export function proposalValue(type, role, proposal) {
  if (!proposal) return 0;
  if (type === PRICE) return priceValue(role.roleMultiplier, role.rolePriceRP, proposal.options?.value);
  return choiceValue(type, role.roleScoresheet, proposal.options || {});
}

// Live value from the current calculator state.
export function liveValue(type, role, selection, priceStr) {
  if (type === PRICE) return priceValue(role.roleMultiplier, role.rolePriceRP, priceStr);
  return choiceValue(type, role.roleScoresheet, selection);
}

// "Beats your BATNA" threshold: choice types use roleRP; price surplus uses 0.
export function batnaThreshold(type, roleRP) {
  return type === PRICE ? 0 : roleRP ?? 0;
}

// Whether the current calculator state can be submitted as a proposal.
export function canSubmit(type, roleScoresheet, selection, priceStr) {
  if (type === PRICE) return priceStr !== "" && priceStr !== null && isFinite(parseFloat(priceStr));
  if (type === MULTIPLE_CHOICE) {
    return Object.keys(roleScoresheet || {}).every((issue) => {
      const idx = selection?.[issue];
      return idx !== undefined && idx !== null;
    });
  }
  return Object.values(selection || {}).some((idx) => idx === 0);
}

export function submitErrorMessage(type) {
  if (type === PRICE) return "Please enter a number before submitting.";
  if (type === MULTIPLE_CHOICE) return "You must choose an option for every issue.";
  return "You must select at least one item.";
}

// Build the `options` payload stored on a proposal from calculator state.
export function buildProposalOptions(type, roleScoresheet, selection, priceStr) {
  if (type === PRICE) return { value: parseFloat(priceStr) };
  if (type === MULTIPLE_CHOICE) {
    const options = {};
    Object.keys(roleScoresheet || {}).forEach((issue) => {
      options[issue] = selection[issue];
    });
    return options;
  }
  return { ...selection };
}

function formatPrice(priceConfig, value) {
  if (value === undefined || value === null || value === "" || !isFinite(Number(value))) return "—";
  const prefix = priceConfig?.prefix || "";
  const suffix = priceConfig?.suffix || "";
  return `${prefix}${Number(value).toLocaleString()}${suffix}`;
}

// ---------------------------------------------------------------------------
// Calculator input rows (per type)
// ---------------------------------------------------------------------------

function FeatureRows({ roleScoresheet, selection, onSelectionChange }) {
  return (
    <>
      {Object.entries(roleScoresheet)
        .sort(([, optionsA], [, optionsB]) => optionsB[0].score - optionsA[0].score)
        .map(([category, options]) => {
          const includeOption = options[0];
          const isChecked = selection[category] === 0;
          return (
            <label key={category} className="flex items-center bg-white rounded px-3 py-1 border border-blue-300 cursor-pointer hover:bg-blue-50">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) =>
                  onSelectionChange({ ...selection, [category]: e.target.checked ? 0 : 1 })
                }
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer mr-2"
              />
              <span className="text-sm font-semibold text-gray-800 flex-shrink-0 w-[200px]">
                {category.replace(/_/g, " ")}
              </span>
              <span className={`text-sm font-bold flex-shrink-0 w-[80px] text-center ${
                isChecked
                  ? 'text-blue-600'
                  : 'text-gray-400'
              }`}>
                {includeOption.score >= 0 ? '+' : ''}{includeOption.score}
              </span>
              <span className="text-sm text-gray-600 flex-1 ml-3">
                {includeOption.reason}
              </span>
            </label>
          );
        })}
    </>
  );
}

function ChoiceRows({ roleScoresheet, selection, onSelectionChange }) {
  return (
    <>
      {Object.entries(roleScoresheet).map(([issue, options]) => {
        const idx = selection[issue];
        const chosen = (idx !== undefined && idx !== null) ? options[idx] : null;
        return (
          <div key={issue} className="flex items-center bg-white rounded px-3 py-1 border border-blue-300">
            <span className="text-sm font-semibold text-gray-800 flex-shrink-0 w-[140px]">
              {issue.replace(/_/g, " ")}
            </span>
            <select
              value={idx ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onSelectionChange({ ...selection, [issue]: val === "" ? undefined : Number(val) });
              }}
              className="flex-shrink-0 w-[180px] border border-gray-300 rounded px-2 py-1 text-sm text-gray-800 bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer mr-3"
            >
              <option value="">— Select —</option>
              {options.map((opt, i) => (
                <option key={i} value={i}>{opt.option}</option>
              ))}
            </select>
            <span className={`text-sm font-bold flex-shrink-0 w-[80px] text-center ${
              chosen
                ? 'text-blue-600'
                : 'text-gray-400'
            }`}>
              {chosen ? `${chosen.score >= 0 ? '+' : ''}${chosen.score}` : '—'}
            </span>
            <span className="text-sm text-gray-600 flex-1 ml-3">
              {chosen?.reason || ''}
            </span>
          </div>
        );
      })}
    </>
  );
}

// One block per issue with one row per option. In readOnly mode there are no
// radios and no selection state: every score is shown in its full color.
function ChoiceTableRows({ roleScoresheet, selection = {}, onSelectionChange, readOnly = false }) {
  return (
    <>
      {Object.entries(roleScoresheet).map(([issue, options]) => {
        const idx = selection[issue];
        return (
          <div key={issue} className="flex bg-white rounded border border-blue-300">
            {/* Issue name: one cell spanning all option rows of this block */}
            <div className="flex-shrink-0 w-[140px] px-3 py-1 text-sm font-semibold text-gray-800 border-r border-gray-100">
              {issue.replace(/_/g, " ")}
            </div>
            <div className="flex-1 divide-y divide-gray-100">
              {options.map((opt, i) => {
                const isChecked = !readOnly && idx === i;
                const scoreCls = 'text-blue-600';
                const Row = readOnly ? 'div' : 'label';
                return (
                  <Row
                    key={i}
                    className={`flex items-center px-3 py-1 ${
                      readOnly ? '' : 'cursor-pointer hover:bg-blue-50'
                    } ${isChecked ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`text-sm flex-1 ${readOnly ? 'whitespace-nowrap pr-4' : ''} ${
                      isChecked ? 'font-semibold text-gray-900' : 'text-gray-800'
                    }`}>
                      {opt.option}
                    </span>
                    <span className="flex items-center justify-end flex-shrink-0 w-[90px]">
                      {!readOnly && (
                        <input
                          type="radio"
                          name={`mc-table-${issue}`}
                          checked={isChecked}
                          onChange={() => onSelectionChange({ ...selection, [issue]: i })}
                          className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer mr-2"
                        />
                      )}
                      <span className={`text-sm font-bold w-[50px] text-center ${
                        readOnly || isChecked ? scoreCls : 'text-gray-400'
                      }`}>
                        {opt.score >= 0 ? '+' : ''}{opt.score}
                      </span>
                    </span>
                  </Row>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ChoiceTableHeader() {
  return (
    <div className="flex items-center px-3 py-1">
      <span className="text-xs font-bold text-gray-700 uppercase flex-shrink-0 w-[140px]">
        Issue
      </span>
      <span className="text-xs font-bold text-gray-700 uppercase flex-1">
        Option
      </span>
      <span className="text-xs font-bold text-gray-700 uppercase flex-shrink-0 w-[90px] text-right">
        Value
      </span>
    </div>
  );
}

// View-only payoff table for multiple_choice: issues / options / values, no
// selection and no calculator. Shown under the narrative on the negotiate page.
export function ScoresheetTable({ roleScoresheet, title }) {
  // Full-width blue panel; inside it, the title + table sit as one centered
  // column that is only as wide as the longest option row (blocks share the
  // width of the widest one), capped at the panel width.
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex justify-center">
      <div className="w-fit max-w-full">
        {title && <h3 className="text-2xl font-bold text-blue-900 mb-4">{title}</h3>}
        <ChoiceTableHeader />
        <div className="space-y-1.5">
          <ChoiceTableRows roleScoresheet={roleScoresheet} readOnly />
        </div>
      </div>
    </div>
  );
}

function PriceInput({ priceConfig, priceStr, onPriceChange }) {
  return (
    <div className="bg-white rounded-lg px-5 py-5 border border-blue-300">
      <label className="block text-sm font-bold text-gray-800 mb-3">
        {priceConfig.label || "Your Offer"}
      </label>
      <div className="flex items-center gap-2">
        {priceConfig.prefix && (
          <span className="text-2xl text-gray-700 font-semibold">{priceConfig.prefix}</span>
        )}
        <input
          type="number"
          value={priceStr}
          onChange={(e) => onPriceChange(e.target.value)}
          min={priceConfig.min}
          max={priceConfig.max}
          step={priceConfig.step ?? "any"}
          placeholder="Enter a number"
          className="flex-1 w-full border border-gray-300 rounded px-3 py-2 text-2xl text-gray-900 focus:ring-2 focus:ring-blue-500"
        />
        {priceConfig.suffix && (
          <span className="text-2xl text-gray-700 font-semibold">{priceConfig.suffix}</span>
        )}
      </div>
      {priceConfig.description && (
        <p className="text-sm text-gray-500 mt-3">{priceConfig.description}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full scoring calculator (blue box): input rows + live value card + footer.
// Used by both the live negotiation panel and the read-role practice screen.
// ---------------------------------------------------------------------------

export function ScoringCalculator({
  type,
  roleScoresheet,
  priceConfig = {},
  roleMultiplier,
  rolePriceRP,
  roleRP,
  selection = {},
  onSelectionChange,
  priceStr = "",
  onPriceChange,
  title,
  footer,
  // Tailwind width class for the right-hand value/actions panel. The live
  // negotiation panel uses the default; read-role passes a narrower one.
  valuePanelWidth = "w-[300px]",
}) {
  // `type` may be the display-only table variant; value logic uses the base type.
  const vType = valueType(type);
  const role = { roleScoresheet, roleMultiplier, rolePriceRP };
  const value = liveValue(vType, role, selection, priceStr);
  const threshold = batnaThreshold(vType, roleRP);
  const submittable = canSubmit(vType, roleScoresheet, selection, priceStr);

  const isPrice = vType === PRICE;
  const isFeatures = vType === FEATURES;
  const isMultipleChoice = vType === MULTIPLE_CHOICE;
  const isChoiceTable = type === MULTIPLE_CHOICE_TABLE;

  // For features, an empty selection is a meaningful value (everything
  // excluded = 0). For multiple_choice and price there is no value until the
  // input is complete, so we show a "-.--" placeholder instead of a stray 0.
  const valueReady = isFeatures ? true : submittable;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      {title && <h3 className="text-2xl font-bold text-blue-900 mb-4">{title}</h3>}

      {/* Table header (choice types only) */}
      {isChoiceTable ? (
        <ChoiceTableHeader />
      ) : !isPrice && (
        <div className="flex items-center px-3 py-1">
          {isFeatures && <span className="w-6"></span>}
          <span className={`text-xs font-bold text-gray-700 uppercase flex-shrink-0 ${isFeatures ? 'w-[200px]' : 'w-[140px]'}`}>
            {isFeatures ? "Feature" : "Issue"}
          </span>
          {isMultipleChoice && (
            <span className="text-xs font-bold text-gray-700 uppercase flex-shrink-0 w-[180px]">
              Your Choice
            </span>
          )}
          <span className="text-xs font-bold text-gray-700 uppercase flex-shrink-0 w-[80px] text-center">
            Value
          </span>
          <span className="text-xs font-bold text-gray-700 uppercase flex-1 ml-4">
            Reason
          </span>
        </div>
      )}

      <div className="flex gap-4">
        {/* Left: type-specific input rows */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {isFeatures && (
            <FeatureRows
              roleScoresheet={roleScoresheet}
              selection={selection}
              onSelectionChange={onSelectionChange}
            />
          )}
          {isMultipleChoice && !isChoiceTable && (
            <ChoiceRows
              roleScoresheet={roleScoresheet}
              selection={selection}
              onSelectionChange={onSelectionChange}
            />
          )}
          {isChoiceTable && (
            <ChoiceTableRows
              roleScoresheet={roleScoresheet}
              selection={selection}
              onSelectionChange={onSelectionChange}
            />
          )}
          {isPrice && (
            <PriceInput
              priceConfig={priceConfig}
              priceStr={priceStr}
              onPriceChange={onPriceChange}
            />
          )}
        </div>

        {/* Right: live value card + footer actions */}
        <div className={`flex-shrink-0 ${valuePanelWidth} flex flex-col items-center justify-start`}>
          <div className="text-center bg-white rounded-lg p-4 shadow-md w-full">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {isPrice ? "Your Value" : "Total Value"}
            </h3>
            <div className="text-4xl font-bold mb-3">
              <span className={valueReady ? "text-blue-600" : "text-gray-300"}>
                {valueReady ? value.toFixed(2) : "-.--"}
              </span>
            </div>
            {valueReady && (
              <div className={`text-sm font-semibold ${
                value >= threshold ? 'text-green-600' : 'text-red-600'
              }`}>
                {value >= threshold ? '✓ Beats your BATNA!' : '✗ Below your BATNA'}
              </div>
            )}
            {isMultipleChoice && !submittable && (
              <p className="text-xs text-gray-500 mt-3">Choose every issue to submit.</p>
            )}
            {isPrice && !submittable && (
              <p className="text-xs text-gray-500 mt-3">Enter a number to see your value.</p>
            )}
          </div>

          {footer && <div className="mt-4 w-full">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal contents (per type) — used by the pending card and history list.
// ---------------------------------------------------------------------------

// Resolve a proposal's options into display terms: [{ label, value, included? }].
// Shared by ProposalDetails (React) and agreementHtml (string, for the
// Debrief template) so the two never disagree about what a deal says.
//   price:           one row, value = formatted price
//   multiple_choice: one row per issue, value = chosen option's text (or "—")
//   features:        one row per feature, included = true/false (unset = Exclude)
export function proposalTerms(type, roleScoresheet, priceConfig, options) {
  const opts = options || {};
  if (type === PRICE) {
    return [{ label: priceConfig?.label || "Price", value: formatPrice(priceConfig, opts.value) }];
  }
  return Object.entries(roleScoresheet || {}).map(([issue, issueOptions]) => {
    const label = issue.replace(/_/g, " ");
    const idx = opts[issue];
    if (type === MULTIPLE_CHOICE) {
      const chosen = (idx !== undefined && idx !== null) ? issueOptions[idx] : null;
      return { label, value: chosen ? chosen.option : "—" };
    }
    return { label, included: (idx ?? 1) === 0 };
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// HTML-string rendering of a deal for the Debrief `html` tabs, which are
// string templates (dangerouslySetInnerHTML) and so can't host a React
// component. Content mirrors ProposalDetails; markup is plain so it inherits
// the surrounding prose styles. Returns "" when there is no deal.
export function agreementHtml(type, roleScoresheet, priceConfig, options) {
  if (!options) return "";
  const terms = proposalTerms(type, roleScoresheet, priceConfig, options);
  if (type === PRICE) {
    const t = terms[0];
    return `<strong>${escapeHtml(t.label)}:</strong> ${escapeHtml(t.value)}`;
  }
  if (type === MULTIPLE_CHOICE) {
    const items = terms.map(
      (t) => `<li><strong>${escapeHtml(t.label)}:</strong> ${escapeHtml(t.value)}</li>`
    );
    return `<ul>${items.join("")}</ul>`;
  }
  // features: list the included ones; say so explicitly if there are none.
  const included = terms.filter((t) => t.included).map((t) => escapeHtml(t.label));
  if (included.length === 0) return "<em>no features included</em>";
  return `<ul>${included.map((l) => `<li>${l}</li>`).join("")}</ul>`;
}

export function ProposalDetails({ type, roleScoresheet, priceConfig, proposal, small }) {
  const textCls = small ? "text-xs" : "text-sm";
  const terms = proposalTerms(type, roleScoresheet, priceConfig, proposal.options);

  if (type === PRICE) {
    return (
      <div className={`flex items-center ${textCls}`}>
        <span className="text-gray-700 font-semibold mr-2">{terms[0].label}:</span>
        <span className="text-gray-900 font-bold">{terms[0].value}</span>
      </div>
    );
  }

  if (type === MULTIPLE_CHOICE) {
    return (
      <div className="space-y-1">
        {terms.map((t) => (
          <div key={t.label} className={`flex items-center ${textCls}`}>
            <span className="text-gray-700 font-medium mr-1">{t.label}:</span>
            <span className="text-gray-900">{t.value}</span>
          </div>
        ))}
      </div>
    );
  }

  // features
  const dotSize = small ? "w-3 h-3" : "w-4 h-4";
  return (
    <div className="space-y-1">
      {terms.map((t) => (
        <div key={t.label} className={`flex items-center ${textCls}`}>
          <span className={`${dotSize} mr-2 rounded ${t.included ? 'bg-green-500' : 'bg-gray-300'}`}></span>
          <span className="text-gray-700">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
