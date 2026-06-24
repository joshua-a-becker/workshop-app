import {
  usePlayer,
  usePlayers,
  useStage,
} from "@empirica/core/player/classic/react";
import { Loading } from "@empirica/core/player/react";
import React from "react";
import { markExerciseComplete, saveExerciseOutcome } from "./clubApi";
import { ReadRole } from "./components/ReadRole";
import { ReadyToNegotiate } from "./components/ReadyToNegotiate";
import { VideoNegotiate } from "./components/VideoNegotiate";
import { VideoDebrief } from "./components/VideoDebrief";

export function Stage({ profileComponent }) {
  const player = usePlayer();
  const players = usePlayers();
  const stage = useStage();

  if (player.stage.get("submit")) {
    if (players.length === 1) {
      return <Loading />;
    }

    return (
      <div className="text-center text-gray-400 pointer-events-none">
        Please wait for other player(s).
      </div>
    );
  }

  const stageName = stage.get("name");

  // Render component based on stage name
  if (stageName === "Read Negotiation Role") {
    // Reaching this branch means the role content (the spoiler) is loaded for
    // this client, so mark the exercise complete in the club DB. Fire once per
    // player; the club's no-downgrade guard is a second safety net.
    console.log("Here 123")
      console.log(player.get("exerciseMarkedComplete"))
    if (!player.get("exerciseMarkedComplete")) {
      const params = new URLSearchParams(window.location.search);
      // UID is passed directly as ?uid= (set on the player in AutoPlayerIdForm);
      // no decoding of participantKey needed.
      const uid = player.get("uid") || params.get("uid");
      const scenario = player.get("scenario") || params.get("scenario");
      // Prefer the raw URL params: these are the exact values the member typed
      // in the club modal (groupName is what the club used to build this
      // participant's participantKey), so storing them lets the club rebuild the
      // same key and re-freeze both fields on a rejoin within the grace window.
      const groupName = params.get("groupName") || player.get("groupName") || "";
      const displayName = params.get("displayName") || player.get("displayName") || "";
      console.log("calling mark complete: " + uid + " / " + scenario + " / " + groupName + " / " + displayName)
      markExerciseComplete(uid, scenario, groupName, displayName);
      player.set("exerciseMarkedComplete", true);
    }
    return <ReadRole profileComponent={profileComponent} />;
  }

  if (stageName === "Ready To Negotiate") {
    return <ReadyToNegotiate profileComponent={profileComponent} />;
  }

  if (stageName === "Time To Negotiate") {
    return <VideoNegotiate profileComponent={profileComponent} />;
  }

  if (stageName === "Debrief & Discussion") {
    // The negotiation is over and the outcome (agreement, vote count, points) was
    // stashed on the player at the end of "Time To Negotiate" (see callbacks.js).
    // Forward it to the signed-in member's club profile. Fire-and-forget so the
    // debrief renders immediately; the cookie is sent so the club resolves the
    // UID. Gate on a SUCCESSFUL response so it persists once and a failure retries
    // on the next render (the club endpoint upserts, so any duplicate before the
    // flag lands is harmless).
    if (!player.get("outcomeDb")) {
      const params = new URLSearchParams(window.location.search);
      const scenario = player.get("scenario") || params.get("scenario");
      const outcome = {
        reachedAgreement: player.get("reachedAgreement") ?? false,
        voteCount: player.get("voteCount") ?? 0,
        pointsEarned: player.get("bonus") ?? 0,
        jointPayoff: player.get("jointPayoff") ?? 0,
      };
      if (scenario) {
        saveExerciseOutcome(scenario, outcome)
          .then((res) => { if (res && res.ok) player.set("outcomeDb", true); })
          .catch(() => {}); // best-effort; never block the debrief
      }
    }
    return <VideoDebrief profileComponent={profileComponent} />;
  }

  // Default fallback
  return (
    <div className="text-center text-gray-400">
      Unknown stage: {stageName}
    </div>
  );
}
