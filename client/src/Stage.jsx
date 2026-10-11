import {
  usePlayer,
  usePlayers,
  useStage,
  useGame,
} from "@empirica/core/player/classic/react";
import { Loading } from "@empirica/core/player/react";
import React, { useContext, useEffect } from "react";
import { DailyCallContext } from "./App";
import { markExerciseComplete } from "./clubApi";
import { ReadRole } from "./components/ReadRole";
import { ReadyToNegotiate } from "./components/ReadyToNegotiate";
import { VideoNegotiate } from "./components/VideoNegotiate";

export function Stage({ profileComponent }) {
  const player = usePlayer();
  const players = usePlayers();
  const stage = useStage();
  const game = useGame();
  const { teardownCall } = useContext(DailyCallContext);

  const stageName = stage.get("name");

  // Force submit if an impasse was declared (game force-quit). Only during the
  // negotiation stage.
  useEffect(() => {
    if (
      game.get("forceQuit") === true &&
      stage.get("name") === "Time To Negotiate" &&
      !player.stage.get("submit")
    ) {
      player.stage.set("submit", true);
    }
  }, [game.get("forceQuit"), stage, player]);

  // The prep stages show no video, so fully release the Daily call and the local
  // camera/mic here: the recording indicator goes dark and nothing is recorded.
  // VideoChat re-acquires media and rejoins the game room when the negotiation
  // stage mounts it. (This effect must run before any early return below to keep
  // hook order stable.)
  const isPrepStage =
    stageName === "Read Negotiation Role" || stageName === "Ready To Negotiate";
  useEffect(() => {
    if (isPrepStage) teardownCall();
  }, [isPrepStage, teardownCall]);

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

  // Render component based on stage name
  if (stageName === "Read Negotiation Role") {
    // Reaching this branch means the role content (the spoiler) is loaded for
    // this client, so mark the exercise complete in the club DB. Fire once per
    // player; the club's no-downgrade guard is a second safety net.
    
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

  // Default fallback
  return (
    <div className="text-center text-gray-400">
      Unknown stage: {stageName}
    </div>
  );
}
