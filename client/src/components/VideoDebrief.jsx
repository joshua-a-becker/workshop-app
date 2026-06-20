import React from "react";
import { InteractionPanel } from "./InteractionPanel";
import { DebriefPanel } from "./DebriefPanel";

// Post-negotiation debrief stage. Keeps the same split-screen layout as
// VideoNegotiate (materials on the left, live video call on the right), but the
// left side now walks the group through three tabs: the negotiation Outcome,
// a set of Discussion Questions to talk through together, and a Debrief Video.
export function VideoDebrief({ profileComponent }) {
  return (
    <div className="w-full min-h-screen flex">
      <div className="w-[70%]">
        <DebriefPanel />
      </div>
      <div className="w-[30%] fixed right-0 top-0 h-screen">
        <InteractionPanel profileComponent={profileComponent} />
      </div>
    </div>
  );
}
