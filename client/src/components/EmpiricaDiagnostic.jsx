import React, { useEffect } from "react";
import {
  useTajribaConnected,
  useGlobal,
  usePlayerID,
  useConsent,
  useParticipantContext,
} from "@empirica/core/player/react";
import {
  usePlayer,
  usePlayers,
  useGame,
  useRound,
  useStage,
} from "@empirica/core/player/classic/react";

// Read-only diagnostic. EmpiricaContext decides intro/lobby/game/loading
// internally and renders several *silent* <Loading> branches (no logging, faint
// near-invisible spinner) — so when a cold reconnect parks on one of them the
// page looks blank with nothing in the console. This probe reads the same hooks
// EmpiricaContext branches on, recomputes which branch it would render, and logs
// it as [DIAG][empctx]. It renders nothing and changes no behavior.
export function EmpiricaDiagnostic() {
  const ctx = useParticipantContext();
  const tajribaConnected = useTajribaConnected();
  const globals = useGlobal();
  const [connecting, playerID] = usePlayerID();
  const [consented] = useConsent();
  const player = usePlayer();
  const players = usePlayers();
  const game = useGame();
  const round = useRound();
  const stage = useStage();

  // Snapshot (not reactive on its own, but re-read every render — the other
  // hooks above trigger renders frequently enough for this to track state).
  const participantConnected = ctx?.connected?.getValue?.() ?? undefined;
  const hasPlayer = Boolean(playerID);

  // Mirror EmpiricaContext.tsx's branch order (defaults: consent + nogames on,
  // game managed). Stops at the first matching branch, same as the real one.
  let branch;
  if (!tajribaConnected || connecting) {
    branch = "Connecting (tajriba down or still connecting)";
  } else if (player && player.get("ended")) {
    branch = "Exit (player.ended)";
  } else if (
    !globals ||
    (hasPlayer && (!participantConnected || !player || game === undefined))
  ) {
    branch = "Loading-A (no globals / partConn / player / game===undefined)";
  } else if (
    globals &&
    !globals.get("experimentOpen") &&
    (!hasPlayer || !player?.get("gameID"))
  ) {
    branch = "NoGames";
  } else if (!consented) {
    branch = "Consent slot";
  } else if (!hasPlayer) {
    branch = "PlayerCreate slot";
  } else if (!player || !game) {
    branch = "Loading-B (no player / no game)";
  } else if (!game.get("status")) {
    branch = "Lobby";
  } else if (game.hasEnded) {
    branch = player?.get("ended") ? "Exit (game ended)" : "Loading (game ended, player not ended)";
  } else {
    // InnerContext allReady gate.
    const actualPlayerCount = game.get("actualPlayerCount");
    const allScopes =
      player && players && stage && round && game &&
      player.game && player.round && player.stage;
    const enoughPlayers =
      actualPlayerCount === undefined || (players && players.length >= actualPlayerCount);
    const everyoneSynced =
      players && players.every((p) => p.game && p.round && p.stage);
    branch =
      allScopes && enoughPlayers && everyoneSynced
        ? "children (Game)"
        : "Loading-C (allReady false)";
  }

  useEffect(() => {
    console.log("[DIAG][empctx] inputs", {
      wouldRender: branch,
      tajribaConnected,
      participantConnected,
      connecting,
      hasPlayer,
      hasGlobals: !!globals,
      experimentOpen: globals?.get?.("experimentOpen"),
      consented,
      playerId: player?.id,
      gameID: player?.get?.("gameID"),
      ended: player?.get?.("ended"),
      gameDefined: game !== undefined,
      gameNull: game === null,
      gameStatus: game?.get?.("status"),
      gameHasEnded: game?.hasEnded,
      actualPlayerCount: game?.get?.("actualPlayerCount"),
      playersLen: players?.length,
      roundName: round?.get?.("name"),
      stageName: stage?.get?.("name"),
      playerGame: !!player?.game,
      playerRound: !!player?.round,
      playerStage: !!player?.stage,
    });
  });

  return null;
}
