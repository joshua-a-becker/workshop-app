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

    const player = usePlayer();

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
    }, [player, groupNameFromUrl, scenarioFromUrl]);

  }