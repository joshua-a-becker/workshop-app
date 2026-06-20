import React, { useEffect } from "react";
import { usePlayer } from "@empirica/core/player/classic/react";

// Best-effort URL-param capture used as Empirica's `consent` slot.
//
// IMPORTANT: when Empirica renders the consent slot the player scope does not yet
// exist, so `usePlayer()` is typically null here and we cannot reliably write player
// attributes before assignment. The authoritative capture of `scenario` happens in
// the intro steps (DisplayNameEntry / the skip-intro path), and the server applies
// the scenario's treatment at game creation. This component just records any params
// it can and proceeds.
export function ConsentUrlRouter({ onConsent }) {
  const player = usePlayer();

  useEffect(() => {
    if (!player) return;
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of params.entries()) {
      if (key !== "participantKey") player.set(key, value);
    }
  }, [player]);

  // Auto-proceed (consent itself is handled by CustomConsent inside the intro steps).
  useEffect(() => {
    onConsent?.();
  }, []);

  return null;
}
