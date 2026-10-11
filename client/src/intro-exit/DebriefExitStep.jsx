import React, { useContext, useEffect } from "react";
import { usePlayer } from "@empirica/core/player/classic/react";
import { DailyCallContext } from "../App";
import { saveExerciseOutcome } from "../clubApi";
import { VideoDebrief } from "../components/VideoDebrief";

// Post-negotiation debrief, run as an exit step: the game ends when the
// "Time To Negotiate" stage ends, and the group keeps the live video call (the
// Daily call lives in App.jsx, above EmpiricaContext, so it survives the switch
// from the game to the exit steps). Game and player data stay readable here.
// Terminal step — no next button.
export function DebriefExitStep() {
  const player = usePlayer();
  const { stopCapture } = useContext(DailyCallContext);

  // The call stays up in the same room, so nothing re-joins: stop the cloud
  // recording and transcription the negotiation started. Idempotent.
  useEffect(() => {
    stopCapture();
  }, [stopCapture]);

  // The outcome (agreement, vote count, points) is stashed on the player when
  // "Time To Negotiate" ends (see callbacks.js onStageEnded). Forward it to the
  // signed-in member's club profile once it has arrived. Gate on a SUCCESSFUL
  // response so it persists once and a failure retries on the next update (the
  // club endpoint upserts, so any duplicate before the flag lands is harmless).
  const reachedAgreement = player.get("reachedAgreement");
  const outcomeDb = player.get("outcomeDb");
  useEffect(() => {
    if (outcomeDb || reachedAgreement === undefined) return;
    const params = new URLSearchParams(window.location.search);
    const scenario = player.get("scenario") || params.get("scenario");
    if (!scenario) return;
    const outcome = {
      reachedAgreement: reachedAgreement ?? false,
      voteCount: player.get("voteCount") ?? 0,
      pointsEarned: player.get("bonus") ?? 0,
      jointPayoff: player.get("jointPayoff") ?? 0,
    };
    saveExerciseOutcome(scenario, outcome)
      .then((res) => { if (res && res.ok) player.set("outcomeDb", true); })
      .catch(() => {}); // best-effort; never block the debrief
  }, [player, reachedAgreement, outcomeDb]);

  return <VideoDebrief profileComponent={null} />;
}
