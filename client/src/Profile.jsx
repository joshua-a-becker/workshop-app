import {
  usePlayer,
  useRound,
  useStage,
} from "@empirica/core/player/classic/react";
import React from "react";
import { Avatar } from "./components/Avatar";
import { Timer } from "./components/Timer";

export function Profile() {
  const player = usePlayer();
  const round = useRound();
  const stage = useStage();

  const score = player.get("score") || 0;

  // The SKIP button is gated on the devKey URL param ONLY — not NODE_ENV, so a
  // dev-server build behaves like production unless the key is in the URL.
  const isDevMode =
    new URLSearchParams(window.location.search).get('devKey') === 'oandi';

  // Dev mode skip stage handler
  const handleSkipStage = () => {
    player.stage.set("submit", true);
  };

  // The negotiation stage runs on unlimited time (the impasse button ends it),
  // so there's no stage label or countdown — the right column is just the video
  // chat. Dev mode keeps the SKIP button.
  if (stage && stage.get("name") === "Time To Negotiate") {
    if (!isDevMode) return null;
    return (
      <div className="w-full px-3 py-0.5 flex justify-end border-b border-gray-300">
        <button
          onClick={handleSkipStage}
          className="text-white bg-red-600 px-4 py-0 text-base font-medium rounded hover:bg-red-700 transition-colors border border-red-700"
        >
          SKIP
        </button>
      </div>
    );
  }

  return (
    <div className="w-full px-3 py-0.5 text-gray-500 grid grid-cols-3 items-center border-b border-gray-300">
      <div className="leading-tight">
        <div className="text-empirica-500 font-medium">
          {stage ? stage.get("name") : ""}
        </div>
      </div>

      <Timer />

      <div className="flex space-x-3 items-center justify-end">
        {/* Dev-only Skip Stage button */}
        {isDevMode && (
          <button
            onClick={handleSkipStage}
            className="text-white bg-red-600 px-4 py-0 text-base font-medium rounded hover:bg-red-700 transition-colors border border-red-700"
          >
            SKIP
          </button>
        )}
      </div>
    </div>
  );
}
