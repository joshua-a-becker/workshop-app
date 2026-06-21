import { useGame, usePlayer, useRound, useStage } from "@empirica/core/player/classic/react";

import React, { useEffect } from "react";
import { Profile } from "./Profile";
import { Stage } from "./Stage";
import { Heartbeat } from "./components/Heartbeat";

export function Game() {
  const game = useGame();
  const player = usePlayer();
  const round = useRound();
  const stage = useStage();
  const { playerCount } = game.get("treatment");

  // [DIAG] Definitive signal that the client transitioned out of the lobby into
  // the started game. If this never logs for an authed user, the lobby→game
  // switch is the failure point.
  useEffect(() => {
    console.log("[DIAG][game] Game MOUNTED", {
      playerId: player?.id,
      gameId: game?.id,
      isWaiting: game?.get("isWaiting"),
      groupName: game?.get("groupName"),
      roundName: round?.get("name"),
      stageName: stage?.get("name"),
    });
    return () => console.log("[DIAG][game] Game UNMOUNTED", { playerId: player?.id, gameId: game?.id });
  }, []);

  return (
    <div className="w-full flex flex-col">
      <Heartbeat />
      <div className="w-full">
        <Stage profileComponent={<Profile />} />
      </div>
    </div>
  );
}
