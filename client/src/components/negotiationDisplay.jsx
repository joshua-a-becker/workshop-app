// ---------------------------------------------------------------------------
// Negotiation display + value logic for the three negotiation types.
//
//   "features"        - include/exclude checkboxes
//   "multiple_choice" - one ordered dropdown per issue (order preserved from JSON)
//   "price"           - a single number; value = multiplier * (rp - price)
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
            <div key={category} className="flex items-center bg-white rounded px-4 py-2.5 border border-blue-300">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) =>
                  onSelectionChange({ ...selection, [category]: e.target.checked ? 0 : 1 })
                }
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer mr-3"
              />
              <span className="text-sm font-semibold text-gray-800 flex-shrink-0 w-[140px]">
                {category.replace(/_/g, " ")}
              </span>
              <span className={`text-base font-bold flex-shrink-0 w-[80px] text-center ${
                isChecked
                  ? (includeOption.score >= 0 ? 'text-blue-600' : 'text-red-600')
                  : 'text-gray-400'
              }`}>
                {includeOption.score >= 0 ? '+' : ''}{includeOption.score}
              </span>
              <span className="text-sm text-gray-600 flex-1 ml-4">
                {includeOption.reason}
              </span>
            </div>
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
          <div key={issue} className="flex items-center bg-white rounded px-4 py-2.5 border border-blue-300">
            <span className="text-sm font-semibold text-gray-800 flex-shrink-0 w-[140px]">
              {issue.replace(/_/g, " ")}
            </span>
            <select
              value={idx ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onSelectionChange({ ...selection, [issue]: val === "" ? undefined : Number(val) });
              }}
              className="flex-shrink-0 w-[180px] border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-800 bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer mr-4"
            >
              <option value="">— Select —</option>
              {options.map((opt, i) => (
                <option key={i} value={i}>{opt.option}</option>
              ))}
            </select>
            <span className={`text-base font-bold flex-shrink-0 w-[80px] text-center ${
              chosen
                ? (chosen.score >= 0 ? 'text-blue-600' : 'text-red-600')
                : 'text-gray-400'
            }`}>
              {chosen ? `${chosen.score >= 0 ? '+' : ''}${chosen.score}` : '—'}
            </span>
            <span className="text-sm text-gray-600 flex-1 ml-4">
              {chosen?.reason || ''}
            </span>
          </div>
        );
      })}
    </>
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
}) {
  const role = { roleScoresheet, roleMultiplier, rolePriceRP };
  const value = liveValue(type, role, selection, priceStr);
  const threshold = batnaThreshold(type, roleRP);
  const submittable = canSubmit(type, roleScoresheet, selection, priceStr);

  const isPrice = type === PRICE;
  const isFeatures = type === FEATURES;
  const isMultipleChoice = type === MULTIPLE_CHOICE;

  // For features, an empty selection is a meaningful value (everything
  // excluded = 0). For multiple_choice and price there is no value until the
  // input is complete, so we show a "-.--" placeholder instead of a stray 0.
  const valueReady = isFeatures ? true : submittable;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      {title && <h3 className="text-2xl font-bold text-blue-900 mb-4">{title}</h3>}

      {/* Table header (choice types only) */}
      {!isPrice && (
        <div className="flex items-center px-4 py-2 mb-1">
          {isFeatures && <span className="w-8"></span>}
          <span className="text-xs font-bold text-gray-700 uppercase flex-shrink-0 w-[140px]">
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

      <div className="flex gap-6">
        {/* Left: type-specific input rows */}
        <div className="flex-[9] space-y-2">
          {isFeatures && (
            <FeatureRows
              roleScoresheet={roleScoresheet}
              selection={selection}
              onSelectionChange={onSelectionChange}
            />
          )}
          {isMultipleChoice && (
            <ChoiceRows
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
        <div className="flex-[4] flex flex-col items-center justify-start">
          <div className="text-center bg-white rounded-lg p-6 shadow-md w-full">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {isPrice ? "Your Value" : "Total Value"}
            </h3>
            <div className="text-5xl font-bold mb-4">
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

          {footer && <div className="mt-6 w-full">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal contents (per type) — used by the pending card and history list.
// ---------------------------------------------------------------------------

export function ProposalDetails({ type, roleScoresheet, priceConfig, proposal, small }) {
  const textCls = small ? "text-xs" : "text-sm";

  if (type === PRICE) {
    return (
      <div className={`flex items-center ${textCls}`}>
        <span className="text-gray-700 font-semibold mr-2">{priceConfig?.label || "Price"}:</span>
        <span className="text-gray-900 font-bold">{formatPrice(priceConfig, proposal.options?.value)}</span>
      </div>
    );
  }

  if (type === MULTIPLE_CHOICE) {
    return (
      <div className="space-y-1">
        {Object.entries(roleScoresheet || {}).map(([issue, options]) => {
          const idx = proposal.options?.[issue];
          const chosen = (idx !== undefined && idx !== null) ? options[idx] : null;
          return (
            <div key={issue} className={`flex items-center ${textCls}`}>
              <span className="text-gray-700 font-medium mr-1">{issue.replace(/_/g, " ")}:</span>
              <span className="text-gray-900">{chosen ? chosen.option : "—"}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // features
  const dotSize = small ? "w-3 h-3" : "w-4 h-4";
  return (
    <div className="space-y-1">
      {Object.entries(roleScoresheet || {}).map(([category]) => {
        const optionIdx = proposal.options?.[category] ?? 1;
        const isIncluded = optionIdx === 0;
        return (
          <div key={category} className={`flex items-center ${textCls}`}>
            <span className={`${dotSize} mr-2 rounded ${isIncluded ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            <span className="text-gray-700">{category.replace(/_/g, " ")}</span>
          </div>
        );
      })}
    </div>
  );
}
