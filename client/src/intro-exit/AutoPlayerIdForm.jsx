import React, { useEffect } from "react";

import { usePlayer } from "@empirica/core/player/classic/react";

export function AutoPlayerIdForm({ onPlayerID }) {
    const urlParams = new URLSearchParams(window.location.search);
    const paramsObj = Object.fromEntries(urlParams?.entries());
    const playerIdFromUrl = paramsObj?.participantKey || "undefined";
    const groupNameFromUrl = paramsObj?.groupName || "default";
    // Scenario routing key (e.g. ?scenario=price_example). The server uses this
    // to route the player to the matching batch's waiting room. Empty if absent.
    const scenarioFromUrl = paramsObj?.scenario || "";
    // Club user id, passed directly as ?uid=. Replaces the old practice of
    // decoding it out of participantKey (strip 12-digit stamp).
    const uidFromUrl = paramsObj?.uid || "";

    const player = usePlayer();

    // [DIAG] Capture the Empirica player identity as soon as it resolves, plus any
    // pre-existing gameID (a stale gameID on a stable authed ns is a prime suspect).
    useEffect(() => {
      if (!player) return;
      console.log("[DIAG][autoid] player resolved", {
        playerId: player.id,
        gameID: player.get("gameID"),
        ended: player.get("ended"),
        participantKey: playerIdFromUrl,
        groupName: groupNameFromUrl,
        scenario: scenarioFromUrl,
      });
    }, [player?.id]);

    useEffect(() => {
      onPlayerID(playerIdFromUrl);
    }, [playerIdFromUrl]);

    // Set groupName + scenario on player object when player becomes available
    useEffect(() => {
      if (player && groupNameFromUrl) {
        console.log(`[AutoPlayerIdForm] Setting groupName to "${groupNameFromUrl}" on player ${player.id}`);
        player.set("groupName", groupNameFromUrl);
      }
      if (player) {
        console.log(`[AutoPlayerIdForm] Setting scenario to "${scenarioFromUrl}" on player ${player.id}`);
        player.set("scenario", scenarioFromUrl);
      }
      if (player && uidFromUrl) {
        console.log(`[AutoPlayerIdForm] Setting uid to "${uidFromUrl}" on player ${player.id}`);
        player.set("uid", uidFromUrl);
      }
    }, [player, groupNameFromUrl, scenarioFromUrl, uidFromUrl]);

  }