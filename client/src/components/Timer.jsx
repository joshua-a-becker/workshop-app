import { useStageTimer, useStage, useGame } from "@empirica/core/player/classic/react";
import React from "react";

// Negotiations longer than this are treated as "unlimited time": the countdown
// is hidden during the negotiation stage so participants aren't watching a clock.
const UNLIMITED_NEGOTIATE_THRESHOLD = 5 * 60 * 60; // 5 hours, in seconds

export function Timer() {
  const timer = useStageTimer();
  const stage = useStage();
  const game = useGame();

  // Hide (but keep occupying space, so the surrounding layout is unchanged) when
  // we're in the negotiation stage and the configured time exceeds 5 hours.
  const negotiateTime = game?.get("treatment")?.negotiateTime;
  const isNegotiateStage = stage?.get("name") === "Time To Negotiate";
  const hideTimer =
    isNegotiateStage &&
    typeof negotiateTime === "number" &&
    negotiateTime > UNLIMITED_NEGOTIATE_THRESHOLD;

  let remaining;
  if (timer?.remaining || timer?.remaining === 0) {
    remaining = Math.round(timer?.remaining / 1000);
  }

  return (
    <div className="flex flex-col items-center">
      <h1
        className={`tabular-nums text-3xl text-gray-500 font-semibold ${
          hideTimer ? "invisible" : ""
        }`}
      >
        {humanTimer(remaining)}
      </h1>
    </div>
  );
}

function humanTimer(seconds) {
  if (seconds === null || seconds === undefined) {
    return "--:--";
  }

  let out = "";
  const s = seconds % 60;
  out += s < 10 ? "0" + s : s;

  const min = (seconds - s) / 60;
  if (min === 0) {
    return `00:${out}`;
  }

  const m = min % 60;
  out = `${m < 10 ? "0" + m : m}:${out}`;

  const h = (min - m) / 60;
  if (h === 0) {
    return out;
  }

  return `${h}:${out}`;
}
