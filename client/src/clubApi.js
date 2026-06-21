// Shared client helpers for talking to the negotiation-club app.
//
// CLUB_BASE is the base URL of the club app, used to verify the participant's
// login session / resolve their club user id (UID) and to mark exercises
// complete. Override per-env with VITE_CLUB_BASE (e.g.
// https://wranglerdev.negotiation.education for local club work).
function defaultClubBase() {
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  // Production Empirica → production club.
  if (h === "platform.negotiation.education") return "https://app.negotiation.education";
  // Dev/local Empirica (platformdev) → deployed dev club by default.
  return "https://dev.negotiation.education";
}

export const CLUB_BASE = import.meta.env.VITE_CLUB_BASE || defaultClubBase();

// The club appends a YYYYMMDDHHMM stamp to participantKey (see
// negotiation-club/lib/club.js); the real club UID is the value without that
// 12-digit suffix. Strip it before using the value as a club identity
// (mark-complete, UID match).
export function clubUid(key) {
  return key ? key.replace(/\d{12}$/, "") : key;
}

// Mark the given exercise (scenario === club exercise id) as completed for the
// signed-in member. Best-effort, fire-and-forget: the session cookie is sent so
// the club resolves the real UID server-side; failures must never block the
// workshop. Returns the fetch promise (or undefined if inputs are missing).
//
// groupName / displayName are the values this participant launched with. The
// club stores them so that, if the member rejoins within the post-completion
// grace window, it can rebuild the identical participantKey and re-freeze both
// fields, returning them to this same game.
export function markExerciseComplete(uid, scenario, groupName, displayName) {
  if (!uid || !scenario) return;
  let url = `${CLUB_BASE}/api/exercise-complete/${encodeURIComponent(uid)}/${encodeURIComponent(scenario)}`;
  const qs = new URLSearchParams();
  if (groupName) qs.set("groupName", groupName);
  if (displayName) qs.set("displayName", displayName);
  if ([...qs].length) url += `?${qs.toString()}`;
  console.log("marking complete")
  console.log(url)
  return fetch(url, { method: "POST", credentials: "include" })
    .catch(() => {}); // best-effort; never block the workshop on this
}

// Save a free-text reflection note for the given exercise to the signed-in
// member's profile. Like markExerciseComplete, the session cookie is sent so the
// club resolves the real UID server-side. Returns the fetch promise so callers
// can surface a saved/error indicator.
export function saveExerciseNote(scenario, note) {
  return fetch(`${CLUB_BASE}/api/exercise-note`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, note }),
  });
}
