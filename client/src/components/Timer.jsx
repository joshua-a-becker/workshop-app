import { useStageTimer, useStage } from "@empirica/core/player/classic/react";
import React from "react";

// The countdown is only shown while participants read their role. Every other
// stage that renders the Profile bar hides it.
const TIMER_STAGE = "Read Negotiation Role";

export function Timer() {
  const timer = useStageTimer();
  const stage = useStage();

  // Hide (but keep occupying space, so the surrounding layout is unchanged).
  const hideTimer = stage?.get("name") !== TIMER_STAGE;

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
