import {
  usePlayer,
  usePlayers,
  useStage,
} from "@empirica/core/player/classic/react";
import { Loading } from "@empirica/core/player/react";
import React from "react";
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
    return <ReadRole profileComponent={profileComponent} />;
  }

  if (stageName === "Ready To Negotiate") {
    return <ReadyToNegotiate profileComponent={profileComponent} />;
  }

  if (stageName === "Time To Negotiate") {
    return <VideoNegotiate profileComponent={profileComponent} />;
  }

  if (stageName === "Debrief & Discussion") {
    return <VideoDebrief profileComponent={profileComponent} />;
  }

  // Default fallback
  return (
    <div className="text-center text-gray-400">
      Unknown stage: {stageName}
    </div>
  );
}
