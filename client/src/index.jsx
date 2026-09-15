import React from "react";
import { createRoot } from "react-dom/client";
import "@unocss/reset/tailwind-compat.css";
import "virtual:uno.css";
import "../node_modules/@empirica/core/dist/player.css";
import App from "./App";
import DebriefPreview from "./DebriefPreview";
import "./index.css";

// `?debriefPreview=1` swaps in the standalone Debrief preview page instead of
// the Empirica app, so debrief HTML can be authored without playing a game.
// Decided here (not inside App) so none of App's effects — club auth, Daily —
// run for the preview.
const isDebriefPreview =
  new URLSearchParams(window.location.search).get("debriefPreview") === "1";

const container = document.getElementById("root");
const root = createRoot(container); // createRoot(container!) if you use TypeScript
root.render(
  <React.StrictMode>
    {isDebriefPreview ? <DebriefPreview /> : <App />}
  </React.StrictMode>
);
