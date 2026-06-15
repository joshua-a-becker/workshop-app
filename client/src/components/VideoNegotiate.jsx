import React from "react";
import { usePlayer } from "@empirica/core/player/classic/react";
import { InteractionPanel } from "./InteractionPanel";
import { MaterialsPanel } from "./MaterialsPanel";

export function VideoNegotiate({ profileComponent }) {
  const player = usePlayer();
  const roleName = player.get("roleName");
  const roleNarrative = player.get("roleNarrative");
  const roleScoresheet = player.get("roleScoresheet");
  const roleBATNA = player.get("roleBATNA");
  const roleRP = player.get("roleRP");
  const roleMultiplier = player.get("roleMultiplier");
  const rolePriceRP = player.get("rolePriceRP");

  // Price roles have no scoresheet; they carry a multiplier + reservation price.
  const hasRoleData = roleScoresheet || roleMultiplier !== undefined;

  if (!roleName || !roleNarrative || !hasRoleData) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-gray-500">Loading your role...</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex">
      <div className="w-[70%]">
        <MaterialsPanel
          roleName={roleName}
          roleNarrative={roleNarrative}
          roleScoresheet={roleScoresheet}
          roleBATNA={roleBATNA}
          roleRP={roleRP}
          roleMultiplier={roleMultiplier}
          rolePriceRP={rolePriceRP}
        />
      </div>
      <div className="w-[30%] fixed right-0 top-0 h-screen">
        <InteractionPanel profileComponent={profileComponent} />
      </div>
    </div>
  );
}
