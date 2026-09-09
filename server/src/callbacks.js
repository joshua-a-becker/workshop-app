import { ClassicListenersCollector } from "@empirica/core/admin/classic";
import fetch from "node-fetch";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import { DAILY_API_KEY } from "./secrets.js";

// import rolesData from "./roles.json" assert { type: "json" };
// const roles = rolesData.roles;

export const Empirica = new ClassicListenersCollector();

// Store context reference for polling and assignment
let globalCtx = null;
let pollingStarted = false;

// Concurrency guards. Both listeners below are async, so these must be readable
// without a flush round-trip (a game/batch attribute would not be) and must not
// survive a restart.
//
// Any group member may press Start (see the requestStart listener), so two
// clicks can race and create two games for the same people. Keyed by
// `${waitingGameId}:${groupName}`.
const startInFlight = new Set();
// Stands in for "this player has not told us their group name yet". Deliberately
// not "default": that is a name a participant may legitimately type, and the two
// must stay distinguishable — an absent name means an incomplete link and is
// refused, a chosen one is honoured. Nothing should ever run a real lobby under
// this value; it exists so absence is detectable. Must match NO_GROUP_NAME in
// client/src/intro-exit/CustomLobby.jsx.
const NO_GROUP_NAME = "null061486";
// The "batch" and "batch"/"status" listeners both call createWaitingGame, whose
// existence check is separated from addGame by an await. Keyed by batch id, and
// holding the promise so a second caller shares the first one's result.
const waitingGameInFlight = new Map();

// Configuration
const ASSIGNMENT_TIMEZONE = "America/New_York";
const ASSIGNMENT_HOUR = 18; // 6 PM
const ASSIGNMENT_MINUTE = 0;
const ENABLE_AUTO_ASSIGNMENT = false; // Set to true to enable 6 PM auto-start

// Presence sweep tuning — must pair with client heartbeat period (1s) in
// client/src/components/Heartbeat.jsx. A player is considered gone when
// `Date.now() - lastSeen.ts > PRESENCE_STALE_MS`.
const PRESENCE_STALE_MS = 5000;
const PRESENCE_SWEEP_MS = 1000;
// A freshly-assigned player needs several seconds to load the client and send
// its first heartbeat (observed: 8-17s). Until they have heartbeated even once,
// give them this longer grace before pruning, so they aren't swept out of the
// lobby roster before their first `lastSeen` ever arrives.
const NEW_JOINER_GRACE_MS = 30000;

// Which club serves this deployment's role data. The env var wins; otherwise
// sniff this machine's Caddyfile: the prod box serves platform.negotiation.education
// (→ app club), the dev box serves platformdev.negotiation.education (→ dev club).
// Resolved once at startup — the deployment's environment doesn't change at runtime.
function resolveClubBase() {
  if (process.env.CLUB_BASE) return process.env.CLUB_BASE;
  try {
    const caddy = fs.readFileSync("/etc/caddy/Caddyfile", "utf8");
    if (/^\s*platform\.negotiation\.education\b/m.test(caddy)) {
      return "https://app.negotiation.education";
    }
  } catch (err) {
    console.error(`[ROLES] Could not read /etc/caddy/Caddyfile to detect environment (set CLUB_BASE to override): ${err?.message}`);
  }
  return "https://dev.negotiation.education";
}
const CLUB_BASE = resolveClubBase();
console.log(`[ROLES] Club base for role data: ${CLUB_BASE}`);

// The role JSON for a game lives in the club app's D1, exposed at
// /api/roles/<scenario>.json. `scenario` is the bare filename from the
// player's ?scenario= URL param.
function roleDataUrlFor(scenario) {
  return `${CLUB_BASE}/api/roles/${encodeURIComponent(scenario)}.json`;
}

// Role data is fetched from the club and cached per URL, with two TTLs:
//  - positive: long enough that a lobby validation and the subsequent game
//    start(s) share a single fetch; short enough that a scenario edited in the
//    club's D1 goes live without restarting the server.
//  - negative: failures used to be re-fetched on every player connect and every
//    `scenario` write, so one bad link hammered the club. Caching the failure
//    briefly stops that, while still letting a scenario added to the club later
//    start working without a restart.
const ROLE_DATA_TTL_MS = 60000;
const ROLE_DATA_ERROR_TTL_MS = 10000;
const roleDataCache = new Map(); // url -> { ts, data } | { ts, error }

// Fetch a scenario's role JSON from the club, through the cache above. Throws on
// failure (missing scenario, unreachable club, unparseable body); callers surface
// that to the player and never fall back to another scenario.
function fetchRoleData(url) {
  const now = Date.now();
  const cached = roleDataCache.get(url);
  if (cached) {
    const ttl = cached.error ? ROLE_DATA_ERROR_TTL_MS : ROLE_DATA_TTL_MS;
    if (now - cached.ts <= ttl) {
      if (cached.error) throw new Error(cached.error);
      return cached.data;
    }
  }

  try {
    // -f: fail on HTTP errors (404 etc.) so a missing scenario throws here
    //     instead of JSON.parse-ing an error page.
    // -L: follow redirects. Without it a redirecting club returns an empty body,
    //     which then reads as a broken scenario rather than a working one.
    // --max-time: this is execSync, so an unresponsive club would otherwise block
    //     the whole Node event loop indefinitely.
    const data = JSON.parse(execSync(`curl -sfL --max-time 10 "${url}"`).toString());
    roleDataCache.set(url, { ts: now, data });
    return data;
  } catch (err) {
    const message = String(err?.message || err);
    roleDataCache.set(url, { ts: now, error: message });
    throw new Error(message);
  }
}

// Scenario metadata: the party count, and the scenario's human title (`name` in
// the role JSON — e.g. "The Vacation"). Used to validate a scenario when a player
// lands in the lobby, to size the lobby's game-split preview, and to label the
// lobby. Reads through the same cache as the game-start fetch.
function getScenarioInfo(scenario) {
  const url = roleDataUrlFor(scenario);
  try {
    const data = fetchRoleData(url);
    const size = Array.isArray(data.roles) ? data.roles.length : 0;
    if (size < 2) {
      return { ok: false, url, error: `role data has ${size} roles (need >= 2)` };
    }
    return { ok: true, url, size, name: data.name || "" };
  } catch (err) {
    return { ok: false, url, error: String(err?.message || err) };
  }
}

// Daily requests fail for two very different reasons, and only one is worth
// retrying: a transient blip (network error, rate limit, 5xx) that the next
// attempt will probably survive, versus a rejected request (bad key, a property
// the plan does not allow) that will fail identically forever. Rooms are created
// once per batch and once per game with no other retry anywhere, so without this
// a two-second outage landing at the wrong instant leaves a whole session — or a
// whole negotiation — with no video and only a line in the server log.
const DAILY_RETRY_DELAYS_MS = [500, 1500, 4000];

// No status means the request threw before any response (network, DNS, timeout).
function dailyIsTransient(status) {
  return status === undefined || status === 429 || status >= 500;
}

async function dailyRequest(label, path, body) {
  for (let attempt = 0; ; attempt++) {
    let status;
    let detail;
    try {
      const res = await fetch(`https://api.daily.co/v1/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DAILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      status = res.status;
      detail = await res.json();
      if (res.ok) return { ok: true, data: detail };
    } catch (err) {
      detail = String(err?.message || err);
    }

    const last = attempt >= DAILY_RETRY_DELAYS_MS.length;
    if (!dailyIsTransient(status) || last) {
      console.error(
        `[DAILY] ${label} failed${status ? ` (HTTP ${status})` : ""} after ${attempt + 1} attempt(s):`,
        detail
      );
      return { ok: false, status, data: detail };
    }

    const delay = DAILY_RETRY_DELAYS_MS[attempt];
    console.warn(
      `[DAILY] ${label} attempt ${attempt + 1} failed${status ? ` (HTTP ${status})` : ""}, retrying in ${delay}ms`
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Helper function to create Daily.co room for waiting game
async function createDailyRoom(roomName) {
  const roomExp = Math.round(Date.now() / 1000) + 60 * 60 * 8; // 8 hour expiry

  const res = await dailyRequest(`create waiting room ${roomName}`, "rooms", {
    name: roomName,
    properties: {
      exp: roomExp,
      enable_recording: "raw-tracks",
      enable_transcription_storage: true,
    },
  });

  if (!res.ok || !res.data?.url) {
    return null;
  }

  console.log(`[DAILY] Room created: ${res.data.url}`);
  return { url: res.data.url, roomName, expiry: roomExp };
}

// Helper function to create meeting token for a player
async function createMeetingToken(roomName, player, expiry) {
  const displayName = player.get("displayName") || "Anonymous";
  const userName = `${displayName} - Player ${player.id}`;

  // Always use a fresh expiry (8 hours from now) to avoid stale timestamps
  const freshExpiry = Math.round(Date.now() / 1000) + 60 * 60 * 8;
  const tokenExpiry = expiry > Math.round(Date.now() / 1000) ? expiry : freshExpiry;

  const res = await dailyRequest(`create token for ${displayName}`, "meeting-tokens", {
    properties: {
      room_name: roomName,
      user_name: userName,
      user_id: player.id,
      is_owner: false,
      permissions: {
        canAdmin: ["transcription"]
      },
      exp: tokenExpiry,
    },
  });

  if (!res.ok || !res.data?.token) {
    return null;
  }

  console.log(`[DAILY] Created token for player ${displayName}`);
  return res.data.token;
}

// Read the configured target game size. Prefer the treatment attached to an
// unused template game in this batch, because games created on demand via
// createAndAssignGame overwrite `treatment.playerCount` with the actual roster
// size — so reading from any filled/played game gives the wrong number. Falls
// back to batch.config if no template game is available yet.
function getTargetPlayerCount(ctx, batch) {
  const allGames = Array.from(ctx.scopesByKind("game").values());

  const unusedTemplates = allGames.filter(g => {
    if (g.get("isWaiting")) return false;
    if (g.get("hasEnded")) return false;
    if (g.get("start")) return false;
    if (g.players && g.players.length > 0) return false;
    return !!g.get("treatment");
  });

  // Only consider a template tagged with THIS batch — never a sibling batch's
  // template, or a multi-batch (per-scenario) run would read the wrong size.
  const template = unusedTemplates.find(g => g.get("batchID") === batch.id);
  const pc = template?.get("treatment")?.playerCount;
  if (typeof pc === "number" && pc > 0 && pc < 1000) {
    return pc;
  }

  return batch.get("config")?.config?.treatments?.[0]?.treatment?.factors?.playerCount || 4;
}

// Helper function to create waiting game with Daily.co room
// Serialize per batch and share the one result. Without this, the two batch
// listeners can both pass the "already exists" check inside — it is separated
// from addGame by an await for the Daily room — and create two waiting games for
// one batch, splitting players across two lobbies where they cannot see or start
// with each other.
function createWaitingGame(ctx, batch) {
  const inFlight = waitingGameInFlight.get(batch.id);
  if (inFlight) {
    console.log(`[BATCH] Waiting game creation already in progress for batch ${batch.id}, awaiting it`);
    return inFlight;
  }

  const promise = doCreateWaitingGame(ctx, batch);
  waitingGameInFlight.set(batch.id, promise);
  return promise.finally(() => waitingGameInFlight.delete(batch.id));
}

async function doCreateWaitingGame(ctx, batch) {
  const games = Array.from(ctx.scopesByKind("game").values());
  const existingWaitingGame = games.find(g =>
    g.get("batchID") === batch.id &&
    g.get("isWaiting") === true &&
    !g.get("hasEnded")
  );

  if (existingWaitingGame) {
    console.log(`[BATCH] Waiting game already exists for batch ${batch.id}`);
    return existingWaitingGame;
  }

  // Create Daily.co room for waiting game
  const d = new Date();
  const today = `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}_${String(d.getDate()).padStart(2,'0')}`;
  const roomName = `waiting_room_${batch.id}_${today}`;

  const roomData = await createDailyRoom(roomName);

  // Real per-game size, used by the lobby to preview assignment splits.
  // The `treatment.playerCount: 1000` below is a placeholder so everyone
  // fits the waiting game; actual games are created later with the real size.
  const cfgPlayerCount = getTargetPlayerCount(ctx, batch);

  // Per-scenario sizes so the lobby preview uses the right number for each
  // player's scenario (a lobby can mix 2-party and 3-party games). Starts empty:
  // validateScenario fills it in as each player's scenario resolves against the
  // club's role JSON.
  const scenarioSizes = {};
  // Per-scenario human titles (role JSON `name`), filled in by validateScenario
  // the same way. The lobby labels itself with these, never with the URL slug.
  const scenarioNames = {};

  // batch.addGame() returns a lightweight proxy without assignPlayer/id.
  // We create it, then look up the real Game object from the context.
  batch.addGame([
    {
      key: "treatment",
      value: { playerCount: 1000 },
      immutable: true
    },
    { key: "batchID", value: batch.id },
    { key: "isWaiting", value: true },
    { key: "name", value: "Waiting Room" },
    { key: "roomUrl", value: roomData?.url || null },
    { key: "dailyRoomName", value: roomData?.roomName || null },
    { key: "dailyRoomExpiry", value: roomData?.expiry || null },
    { key: "gamePlayerCount", value: cfgPlayerCount },
    { key: "scenarioSizes", value: scenarioSizes },
    { key: "scenarioNames", value: scenarioNames },
  ]);

  Empirica.flush();

  // Poll for the real Game object to appear in the context
  let waitingGame = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const allGames = Array.from(ctx.scopesByKind("game").values());
    waitingGame = allGames.find(g =>
      g.get("batchID") === batch.id &&
      g.get("isWaiting") === true &&
      !g.get("hasEnded")
    );
    if (waitingGame) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!waitingGame) {
    console.error(`[BATCH] Failed to find newly created waiting game for batch ${batch.id} after 5s`);
    return null;
  }

  console.log(`[BATCH] Created waiting game ${waitingGame.id} for batch ${batch.id} with Daily room: ${roomData?.url}`);
  return waitingGame;
}

// Check if it's time to trigger assignment (18:00 in configured timezone)
function isAssignmentTime() {
  const now = new Date();
  const options = { timeZone: ASSIGNMENT_TIMEZONE, hour: 'numeric', minute: 'numeric', hour12: false };
  const timeStr = now.toLocaleTimeString('en-US', options);
  const [hour, minute] = timeStr.split(':').map(Number);

  return hour === ASSIGNMENT_HOUR && minute === ASSIGNMENT_MINUTE;
}

// Sweep all waiting games and prune stale entries from each game's
// `waitingPlayers`. A player is stale when their `lastSeen.ts` (set by the
// client Heartbeat component) is older than PRESENCE_STALE_MS, or when
// `lastSeen` is missing but they joined more than PRESENCE_STALE_MS ago.
function sweepLobbyPresence(ctx) {
  const now = Date.now();
  const allGames = Array.from(ctx.scopesByKind("game").values());
  const players = Array.from(ctx.scopesByKind("player").values());
  const playerById = new Map(players.map(p => [p.id, p]));

  const waitingGames = allGames.filter(
    g => g.get("isWaiting") === true && !g.get("hasEnded")
  );

  for (const game of waitingGames) {
    const waitingPlayers = { ...(game.get("waitingPlayers") || {}) };
    let changed = false;

    // A player belongs in this lobby roster iff Empirica still has them
    // assigned to this waiting game AND they look present. "Present" means a
    // fresh heartbeat, or — for someone who has not heartbeated yet — still
    // within the new-joiner grace window measured from their stable join time.
    const isPresent = (p) => {
      const lastTs = p.get("lastSeen")?.ts;
      if (lastTs != null) return now - lastTs <= PRESENCE_STALE_MS;
      const joinedAt = p.get("lobbyJoinedAt") ?? 0;
      return now - joinedAt <= NEW_JOINER_GRACE_MS;
    };

    // Re-add any present, still-assigned player missing from the roster. This
    // makes the roster self-healing: a player briefly pruned (or reconnecting)
    // reappears on the next sweep instead of being stranded forever.
    for (const p of players) {
      if (p.get("gameID") !== game.id) continue;
      if (waitingPlayers[p.id] || !isPresent(p)) continue;
      waitingPlayers[p.id] = waitingPlayerEntry(p, p.get("lobbyJoinedAt") ?? now);
      changed = true;
      console.log(`[PRESENCE] Re-added ${p.id} to waiting game ${game.id} (group "${waitingPlayers[p.id].displayGroupName}")`);
    }

    // Prune players who are no longer assigned here or who have gone absent.
    for (const [playerId, info] of Object.entries(waitingPlayers)) {
      const playerScope = playerById.get(playerId);
      const stillAssigned = playerScope && playerScope.get("gameID") === game.id;
      if (stillAssigned && isPresent(playerScope)) continue;
      const groupName = info.groupName || NO_GROUP_NAME;
      delete waitingPlayers[playerId];
      changed = true;
      console.log(`[PRESENCE] Pruned ${playerId} from waiting game ${game.id} (group "${groupName}")`);
    }

    if (changed) {
      game.set("waitingPlayers", waitingPlayers);
    }
  }

  if (waitingGames.length > 0) Empirica.flush();
}

// The functional lobby identity: two players share a lobby only if they share
// BOTH the group name and the scenario, so "teamA" on the_vacation and "teamA"
// on shared_office never see each other or start together. NUL-separated so a
// group name cannot contain the separator and forge another group's identity.
// Never displayed: the lobby renders the raw name plus the scenario's title.
// `player.get("groupName")` itself stays the raw human name — the club rebuilds
// a participant's key from it (client/src/Stage.jsx).
function lobbyGroupName(groupName, scenario) {
  return `${groupName || NO_GROUP_NAME}\u0000${scenario || ""}`;
}

// One player's entry in a waiting game's `waitingPlayers` roster. `groupName` is
// the composite the lobby matches on; `displayGroupName` is the raw name, kept
// for logging and any future UI.
function waitingPlayerEntry(player, joinedAt) {
  const rawGroupName = player.get("groupName") || NO_GROUP_NAME;
  const scenario = player.get("scenario") || "";
  return {
    id: player.id,
    displayName: player.get("displayName") || "Anonymous",
    groupName: lobbyGroupName(rawGroupName, scenario),
    displayGroupName: rawGroupName,
    scenario,
    joinedAt,
  };
}

// Group players by groupName AND scenario. A game must be single-scenario:
// createAndAssignGame takes the scenario from players[0] and applies it to the
// whole game, so a mixed-scenario bucket here would hand some players a briefing
// for a negotiation they did not join. The requestStart path already filters the
// same way (see `sameScenario` there).
function groupByGroupAndScenario(players) {
  const groups = {};
  for (const player of players) {
    const groupName = player.get("groupName") || NO_GROUP_NAME;
    const scenario = player.get("scenario") || "";
    const key = lobbyGroupName(groupName, scenario);
    if (!groups[key]) {
      groups[key] = { groupName, scenario, players: [] };
    }
    groups[key].players.push(player);
  }
  return groups;
}

// Main assignment function - groups players by groupName and creates games
async function assignPlayersToGames(ctx) {
  console.log("[ASSIGNMENT] Running assignment algorithm...");

  // Get all games and waiting players
  const allGames = Array.from(ctx.scopesByKind("game").values());
  const waitingPlayers = Array.from(ctx.scopesByKind("player").values())
    .filter(p => {
      const game = allGames.find(g => g.id === p.get("gameID"));
      return p.get("introDone") &&
             !p.get("ended") &&
             game &&
             game.get("isWaiting") === true;
    });

  console.log(`[ASSIGNMENT] Total players waiting: ${waitingPlayers.length}`);

  if (waitingPlayers.length === 0) {
    console.log("[ASSIGNMENT] No players to assign");
    return;
  }

  // Get running batch
  const batches = Array.from(ctx.scopesByKind("batch").values())
    .filter(b => b.get("status") === "running");

  if (batches.length === 0) {
    console.log("[ASSIGNMENT] No running batches");
    return;
  }

  const batch = batches[0];
  const smallGroupMode = batch.get("smallGroupMode") || "skip";

  const playerCount = getTargetPlayerCount(ctx, batch);

  console.log(`[ASSIGNMENT] Small group mode: ${smallGroupMode}, playerCount: ${playerCount}`);

  // Group players by groupName and scenario
  const groups = groupByGroupAndScenario(waitingPlayers);
  console.log(`[ASSIGNMENT] Found ${Object.keys(groups).length} groups:`, Object.values(groups).map(g => `${g.groupName}/${g.scenario}(${g.players.length})`));

  // Process each group
  const processedPlayers = new Set();

  for (const [groupKey, group] of Object.entries(groups)) {
    const { groupName, scenario, players: members } = group;
    // Skip already processed players
    const unprocessed = members.filter(p => !processedPlayers.has(p.id));

    if (unprocessed.length === 0) continue;

    // Skip groups with less than 2 players (minimum requirement)
    if (unprocessed.length < 2) {
      console.log(`[ASSIGNMENT] Skipping group "${groupName}" - only ${unprocessed.length} player(s), need at least 2`);
      continue;
    }

    if (unprocessed.length >= playerCount) {
      // Full group - assign normally
      const toAssign = unprocessed.slice(0, playerCount);
      await createAndAssignGame(ctx, batch, toAssign, groupName);
      toAssign.forEach(p => processedPlayers.add(p.id));

    } else if (smallGroupMode === "undersize") {
      // Create game with fewer players
      await createAndAssignGame(ctx, batch, unprocessed, groupName);
      unprocessed.forEach(p => processedPlayers.add(p.id));

    } else if (smallGroupMode === "oversize") {
      // Pull extra players from other groups
      const needed = playerCount - unprocessed.length;
      const extras = findExtraPlayers(groups, needed, groupKey, processedPlayers, scenario);
      const toAssign = [...unprocessed, ...extras];

      if (toAssign.length > 0) {
        await createAndAssignGame(ctx, batch, toAssign, groupName);
        toAssign.forEach(p => processedPlayers.add(p.id));
      }
    }
    // "skip" mode: do nothing for incomplete groups
  }

  console.log(`[ASSIGNMENT] Assignment complete. Processed ${processedPlayers.size} players.`);
}

// Find extra players from other groups to fill a game
function findExtraPlayers(groups, needed, excludeKey, processedPlayers, scenario) {
  const extras = [];

  for (const [key, group] of Object.entries(groups)) {
    if (key === excludeKey) continue;
    // Oversize pulls players from other groups, but never across scenarios.
    if (group.scenario !== scenario) continue;

    for (const player of group.players) {
      if (!processedPlayers.has(player.id) && extras.length < needed) {
        extras.push(player);
      }
    }

    if (extras.length >= needed) break;
  }

  return extras;
}

// Create a real game and assign players to it
async function createAndAssignGame(ctx, batch, players, groupName) {
  console.log(`[ASSIGNMENT] Creating game for group "${groupName}" with ${players.length} players`);

  // All games share the batch's single generic treatment; the scenario from the
  // players' URL names the role JSON at this deployment's club (CLUB_BASE). No
  // fallback: without a scenario we can't build the role URL, so we flag the
  // players and abort (we never create a game whose roles can't be fetched).
  const scenario = players[0]?.get("scenario");
  const treatment = getBatchTreatment(batch);
  if (!scenario) {
    console.error(`[ASSIGNMENT] Missing scenario — aborting game for group "${groupName}"`);
    for (const p of players) {
      p.set("scenarioError", `Could not determine the scenario for your game. Please use the link provided for your session.`);
    }
    Empirica.flush();
    return;
  }

  // A game is single-scenario: roleDataURL below is derived from this one
  // scenario and applies to everyone in the game. Callers are expected to have
  // grouped by scenario already; if one slips through, start only the matching
  // subset rather than silently handing the others a briefing for a negotiation
  // they did not join.
  const mismatched = players.filter(p => p.get("scenario") !== scenario);
  if (mismatched.length > 0) {
    console.error(
      `[ASSIGNMENT] Group "${groupName}" mixes scenarios — starting only "${scenario}", excluding ${mismatched.length} player(s):`,
      mismatched.map(p => p.id)
    );
    for (const p of mismatched) {
      p.set("scenarioError", `Could not start your negotiation: your group mixed scenarios. Please use the link provided for your session.`);
    }
    Empirica.flush();
    players = players.filter(p => p.get("scenario") === scenario);
    if (players.length < 2) {
      console.error(`[ASSIGNMENT] Only ${players.length} player(s) share scenario "${scenario}" — aborting game for group "${groupName}"`);
      return;
    }
  }

  const roleDataURL = roleDataUrlFor(scenario);

  // Tag the game we are about to create so we can find it unambiguously below.
  // Matching on groupName alone is not enough: one requestStart can create
  // several games for the same group (one per chunk), so a groupName match can
  // resolve to a sibling chunk's game instead of ours.
  const createToken = randomUUID();

  // batch.addGame() returns a lightweight {get, set} proxy, NOT a full Game
  // instance — it lacks assignPlayer, id, etc. We create the game, then look
  // up the real Game object from the context.
  batch.addGame([
    {
      key: "treatment",
      value: treatment?.factors ?
        { ...treatment.factors, playerCount: players.length } :
        { playerCount: players.length },
      immutable: true
    },
    { key: "batchID", value: batch.id },
    { key: "treatmentName", value: treatment?.name || "default" },
    { key: "groupName", value: groupName },
    { key: "scenario", value: scenario },
    { key: "roleDataURL", value: roleDataURL },
    { key: "isWaiting", value: false },
    { key: "createToken", value: createToken },
  ]);

  Empirica.flush();

  // Poll for the real Game object to appear in the context
  let game = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const allGames = Array.from(ctx.scopesByKind("game").values());
    game = allGames.find(g => g.get("createToken") === createToken);
    if (game) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!game) {
    throw new Error(`[ASSIGNMENT] Failed to find newly created game for group "${groupName}" after 5s`);
  }

  console.log(`[ASSIGNMENT] Found real Game object: ${game.id}`);
  console.log(`[DIAG][createGame] new game`, {
    gameId: game.id,
    groupName,
    treatmentName: treatment?.name,
    isWaiting: game.get("isWaiting"),
    players: players.map(p => p.id),
  });

  // Assign players to game
  for (const player of players) {
    if (!player || !player.id) {
      console.error(`[ASSIGNMENT] Invalid player object:`, player);
      throw new Error(`Invalid player object - cannot assign to game`);
    }
    await game.assignPlayer(player);
    console.log(`[ASSIGNMENT] Assigned player ${player.id} (${player.get("displayName")}) to game ${game.id}`);
  }

  // Start the game. Game.start() is idempotent (it no-ops if `start` is already
  // set) and also records actualPlayerCount, which a raw set("start", true) skips.
  game.start();
  Empirica.flush();

  console.log(`[ASSIGNMENT] Game ${game.id} started with ${players.length} players`);
  console.log(`[DIAG][createGame] start=true set`, {
    gameId: game.id,
    groupName,
    assignedPlayers: players.map(p => ({ id: p.id, gameID: p.get("gameID") })),
  });
}

// ============================================================================
// BATCH EVENTS - Create waiting game when batch starts
// ============================================================================

Empirica.on("batch", async (ctx, { batch }) => {
  console.log(`[BATCH] Batch ${batch.id} created with status: ${batch.get("status")}`);

  const status = batch.get("status");
  if (status === "created" || status === "running") {
    await createWaitingGame(ctx, batch);
  }
});

Empirica.on("batch", "status", async (ctx, { batch }) => {
  const status = batch.get("status");
  console.log(`[BATCH] Batch ${batch.id} status changed to: ${status}`);

  if (status === "running") {
    await createWaitingGame(ctx, batch);
  }
});

// Listen for manual assignment trigger (all groups)
Empirica.on("batch", "triggerAssignment", async (ctx, { batch }) => {
  const trigger = batch.get("triggerAssignment");
  if (trigger) {
    console.log(`[BATCH] Manual assignment triggered for batch ${batch.id}`);
    await assignPlayersToGames(ctx);
    batch.set("triggerAssignment", false);
    Empirica.flush();
  }
});

// Listen for single group start trigger from any group member (using player attribute)
Empirica.on("player", "requestStart", async (ctx, { player }) => {
  const requestStart = player.get("requestStart");
  console.log(`[PLAYER] requestStart listener triggered! Player ${player?.id}`, requestStart);

  if (!requestStart) {
    console.log(`[PLAYER] requestStart is null/undefined, ignoring`);
    return;
  }

  // The client sends the composite lobby identity (group name + scenario); it is
  // what the roster is keyed on, so it is what we match against below. The raw
  // name is only for logging and for the game record.
  const groupName = requestStart.groupName;
  const rawGroupName = player.get("groupName") || NO_GROUP_NAME;
  const requestingPlayerId = player.id;

  console.log(`[PLAYER] Start requested for group "${rawGroupName}" (scenario "${player.get("scenario") || ""}") by player ${requestingPlayerId}`);

  // The client refuses to render a lobby for a player with no group name, so
  // this should be unreachable — but a start is destructive and cheap to guard.
  if (rawGroupName === NO_GROUP_NAME) {
    console.error(`[PLAYER] Player ${requestingPlayerId} requested start with no group name — ignoring`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }
  console.log(`[DIAG][requestStart] received`, {
    requestingPlayerId,
    requestStart,
    gameID: player.get("gameID"),
    scenario: player.get("scenario"),
  });

  // Get the waiting game for this player
  const gameId = player.get("gameID");
  if (!gameId) {
    console.log(`[PLAYER] Player ${requestingPlayerId} not in a game, ignoring`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }

  const game = Array.from(ctx.scopesByKind("game").values())
    .find(g => g.id === gameId);

  if (!game || !game.get("isWaiting")) {
    console.log(`[PLAYER] Game ${gameId} not found or not waiting, ignoring`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }

  console.log(`[PLAYER] Found waiting game ${game.id}`);

  // Starting is not gated on any per-group role — any group member may start.
  console.log(`[DIAG][requestStart] start requested`, {
    groupName: rawGroupName,
    scenario: player.get("scenario"),
    requestingPlayerId,
    rosterIds: Object.keys(game.get("waitingPlayers") || {}),
  });

  // Get players in this group
  const waitingPlayers = game.get("waitingPlayers") || {};
  const groupMembers = Object.values(waitingPlayers).filter(p => p.groupName === groupName);

  if (groupMembers.length === 0) {
    console.log(`[PLAYER] No players in group "${rawGroupName}"`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }

  // Require minimum 2 players to start a game
  if (groupMembers.length < 2) {
    console.log(`[PLAYER] Cannot start with only ${groupMembers.length} player(s), need at least 2`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }

  console.log(`[PLAYER] Starting game for group "${rawGroupName}" with ${groupMembers.length} players`);

  // Get the batch
  const batch = Array.from(ctx.scopesByKind("batch").values())
    .find(b => b.id === game.get("batchID"));

  if (!batch) {
    console.log(`[PLAYER] Could not find batch for game`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }

  // Get actual player objects
  const allPlayers = Array.from(ctx.scopesByKind("player").values());
  console.log(`[PLAYER] Looking up ${groupMembers.length} players:`, groupMembers.map(gm => gm.id));
  console.log(`[PLAYER] Available player IDs:`, allPlayers.map(p => p.id));

  // Put the requesting player at the front so the server's split matches the
  // preview they saw in the modal (the client lists the viewer first).
  const orderedMembers = [
    ...groupMembers.filter(gm => gm.id === requestingPlayerId),
    ...groupMembers.filter(gm => gm.id !== requestingPlayerId),
  ];

  const playersToAssign = orderedMembers
    .map(gm => {
      const foundPlayer = allPlayers.find(p => p.id === gm.id);
      if (!foundPlayer) {
        console.error(`[PLAYER] Could not find player object for ID: ${gm.id}`);
      }
      return foundPlayer;
    })
    .filter(p => p);

  console.log(`[PLAYER] Found ${playersToAssign.length} player objects to assign`);

  if (playersToAssign.length === 0) {
    console.error(`[PLAYER] No valid player objects found! Cannot create game.`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }

  // A game must be single-scenario. If the group somehow mixes scenarios, only start
  // the requesting player's scenario; differently-scenario'd players stay in the lobby.
  const startScenario = player.get("scenario");
  const sameScenario = playersToAssign.filter(p => p.get("scenario") === startScenario);
  if (sameScenario.length !== playersToAssign.length) {
    console.log(`[PLAYER] Group mixes scenarios; starting only "${startScenario}" (${sameScenario.length}/${playersToAssign.length})`);
  }

  // Per-scenario game size from the scenario's role JSON.
  const playerCount = scenarioPlayerCount(ctx, batch, startScenario);

  // The starting player assigns players to rooms by hand in the lobby modal and
  // sends the result as `assignments`: an array (one entry per game room) of playerId
  // arrays. Anyone not listed — explicitly parked in the "Stay in Lobby" room or
  // otherwise omitted — stays in the lobby as a leftover. We fall back to the
  // legacy `mode` chunking only if a client sends no explicit assignments.
  const explicitAssignments = Array.isArray(requestStart.assignments)
    ? requestStart.assignments
    : null;

  let chunks;
  let leftovers;

  if (explicitAssignments) {
    const byId = new Map(sameScenario.map(p => [p.id, p]));
    const usedIds = new Set();
    chunks = [];
    for (const group of explicitAssignments) {
      if (!Array.isArray(group)) continue;
      const groupPlayers = [];
      for (const id of group) {
        const p = byId.get(id);
        if (p && !usedIds.has(id)) {
          groupPlayers.push(p);
          usedIds.add(id);
        }
      }
      // A game needs at least 2 real players. A room that resolves to fewer
      // (e.g. a player left, or wrong scenario) is dropped; those players fall
      // through to leftovers below rather than starting a degenerate game.
      if (groupPlayers.length >= 2) {
        chunks.push(groupPlayers);
      } else {
        for (const p of groupPlayers) usedIds.delete(p.id);
      }
    }
    leftovers = sameScenario.filter(p => !usedIds.has(p.id));
    console.log(`[PLAYER] Distributing with playerCount=${playerCount}, explicit assignments`);
  } else {
    // Legacy fallback: chunk by mode. Default to "overfill" (nobody waits).
    const mode = requestStart.mode === "exact" ? "exact" : "overfill";
    console.log(`[PLAYER] Distributing with playerCount=${playerCount}, mode=${mode}`);
    ({ games: chunks, leftovers } = chunkByMode(sameScenario, playerCount, mode));
  }

  console.log(`[DIAG][requestStart] chunked`, {
    startScenario,
    playerCount,
    explicit: !!explicitAssignments,
    playersToAssign: playersToAssign.map(p => p.id),
    sameScenario: sameScenario.map(p => p.id),
    chunkSizes: chunks.map(c => c.length),
    leftovers: leftovers.map(p => p.id),
  });

  console.log(
    `[PLAYER] ${playersToAssign.length} players → ${chunks.length} game(s) of sizes [${chunks.map(c => c.length).join(", ")}]` +
    (leftovers.length > 0 ? `, ${leftovers.length} stay in lobby (${leftovers.map(p => p.id).join(", ")})` : "")
  );

  // Starting is not gated on any per-group role, so two members can press Start
  // at once. Both would reach here off the same `waitingPlayers` snapshot, chunk
  // it identically, and create a second set of games for the same people —
  // assignPlayer would move everyone to the later games, leaving the earlier
  // ones started with an empty roster. Everything above this point is read-only,
  // so the lock only needs to cover game creation.
  const startKey = `${game.id}:${groupName}`;
  if (startInFlight.has(startKey)) {
    console.log(`[PLAYER] Start already in progress for group "${rawGroupName}", ignoring`);
    player.set("requestStart", null);
    Empirica.flush();
    return;
  }
  startInFlight.add(startKey);

  try {
    for (const chunkPlayers of chunks) {
      // Raw name, not the composite: the game's stored `groupName` and the
      // [ASSIGNMENT] logs stay human-readable.
      await createAndAssignGame(ctx, batch, chunkPlayers, rawGroupName);
    }

    // Remove assigned players from waitingPlayers; leftovers stay. Re-read the
    // roster rather than reusing the snapshot taken before the awaits above: the
    // presence sweep and newly-joining players write this same object while games
    // are being created, and reusing the stale copy would discard their edits.
    const assignedIds = new Set(chunks.flat().map(p => p.id));
    const latestWaitingPlayers = { ...(game.get("waitingPlayers") || {}) };
    for (const pid of assignedIds) {
      delete latestWaitingPlayers[pid];
    }
    game.set("waitingPlayers", latestWaitingPlayers);

    // Clear requestStart for every involved player (assigned and leftovers).
    for (const p of playersToAssign) {
      p.set("requestStart", null);
    }

    Empirica.flush();
    console.log(`[PLAYER] Game creation complete for group "${rawGroupName}"`);
  } finally {
    startInFlight.delete(startKey);
  }
});

// Three assignment strategies for splitting a lobby group into games.
// All three share the same greedy base: fill as many full groups of `P` as
// possible. They differ only in how the trailing remainder R = N mod P is
// handled. Each returns { games: Player[][], leftovers: Player[] }.

// Exact: full groups only; anyone not in a full group stays in the lobby.
function chunkExact(players, P) {
  const n = players.length;
  const fullGroups = Math.floor(n / P);
  const games = [];
  for (let i = 0; i < fullGroups; i++) {
    games.push(players.slice(i * P, (i + 1) * P));
  }
  const leftovers = players.slice(fullGroups * P);
  return { games, leftovers };
}

// Balanced: nobody waits, except a single unavoidable singleton when P === 2
// and N is odd (because the hard cap of 2 makes rebalancing impossible).
// R === 1 with P > 2: take one from the last full group so the tail is
// [P-1, 2] instead of [P, 1].
function chunkPartial(players, P) {
  const n = players.length;
  if (n === 0) return { games: [], leftovers: [] };
  if (n === 1) return { games: [], leftovers: [players[0]] };
  if (n <= P) return { games: [players], leftovers: [] };

  const fullGroups = Math.floor(n / P);
  const remainder = n % P;

  if (remainder === 0) {
    const games = [];
    for (let i = 0; i < fullGroups; i++) {
      games.push(players.slice(i * P, (i + 1) * P));
    }
    return { games, leftovers: [] };
  }

  if (remainder >= 2) {
    const games = [];
    for (let i = 0; i < fullGroups; i++) {
      games.push(players.slice(i * P, (i + 1) * P));
    }
    games.push(players.slice(fullGroups * P));
    return { games, leftovers: [] };
  }

  // remainder === 1
  if (P === 2) {
    const games = [];
    for (let i = 0; i < fullGroups; i++) {
      games.push(players.slice(i * P, (i + 1) * P));
    }
    return { games, leftovers: [players[fullGroups * P]] };
  }

  // P > 2, remainder === 1 → rebalance tail to [P-1, 2]
  const games = [];
  for (let i = 0; i < fullGroups - 1; i++) {
    games.push(players.slice(i * P, (i + 1) * P));
  }
  const lastFullStart = (fullGroups - 1) * P;
  games.push(players.slice(lastFullStart, lastFullStart + P - 1));
  games.push(players.slice(lastFullStart + P - 1));
  return { games, leftovers: [] };
}

// Inclusive: same as Balanced, except when Balanced would leave a singleton
// (only possible when P === 2 and N is odd), append that person to the last
// group, overfilling it by 1.
function chunkOverfill(players, P) {
  const partial = chunkPartial(players, P);
  if (partial.leftovers.length === 0) return partial;
  if (partial.games.length === 0) return partial; // N === 1 → still a leftover.
  const games = partial.games.map(g => g.slice());
  games[games.length - 1] = games[games.length - 1].concat(partial.leftovers);
  return { games, leftovers: [] };
}

// Only "exact" and "overfill" are exposed as user-facing modes. The third
// strategy (`chunkPartial`) is kept as an internal helper for `chunkOverfill`
// because it handles the P>2 rebalance rule — but it's redundant with `exact`
// when P===2 and redundant with `overfill` when P>2, so we don't offer it.
function chunkByMode(players, P, mode) {
  if (mode === "exact") return chunkExact(players, P);
  return chunkOverfill(players, P);
}

// ============================================================================
// PLAYER EVENTS - Assign to waiting game and handle groupName
// ============================================================================

// Treatments no longer encode scenarios: every batch carries ONE generic
// treatment (see .empirica/treatments.yaml) and all scenario-specific data
// comes from the role JSON named by the player's ?scenario= URL param.
function getBatchTreatment(batch) {
  return batch.get("config")?.config?.treatments?.[0]?.treatment || null;
}

// Per-scenario game size = the number of roles in the scenario's JSON. Falls
// back to the batch default when the role data can't be resolved (so chunking
// still has a number).
function scenarioPlayerCount(ctx, batch, scenario) {
  if (scenario) {
    const info = getScenarioInfo(scenario);
    if (info.ok) return info.size;
  }
  return getTargetPlayerCount(ctx, batch);
}

// Validate a player's scenario by checking its role JSON exists at the club
// (CLUB_BASE — resolved server-side for this deployment), and surface an error
// for the lobby to show (no silent fallback). Also records the scenario's party
// count on the player's waiting game so the lobby preview splits with the
// right size.
function validateScenario(ctx, batch, player) {
  const clear = () => { if (player.get("scenarioError")) player.set("scenarioError", null); };
  const scenario = player.get("scenario");
  if (!scenario) {
    player.set("scenarioError", "No scenario was specified in your link. Please use the link provided for your session.");
    return;
  }
  const info = getScenarioInfo(scenario);
  if (!info.ok) {
    console.error(`[SCENARIO] Could not resolve "${scenario}" at ${info.url}: ${info.error}`);
    player.set("scenarioError", `Unknown scenario "${scenario}". Please use the link provided for your session.`);
    return;
  }
  clear();

  const gameId = player.get("gameID");
  const game = gameId && Array.from(ctx.scopesByKind("game").values()).find(g => g.id === gameId);
  if (game && game.get("isWaiting")) {
    const sizes = game.get("scenarioSizes") || {};
    if (sizes[scenario] !== info.size) {
      game.set("scenarioSizes", { ...sizes, [scenario]: info.size });
    }
    // Fall back to the slug when the role JSON carries no `name`: an ugly label
    // still tells two same-named lobbies apart, an empty one does not.
    const names = game.get("scenarioNames") || {};
    const title = info.name || scenario;
    if (names[scenario] !== title) {
      game.set("scenarioNames", { ...names, [scenario]: title });
    }
  }
}

// Assign a player to the batch's shared waiting room on connect. This does NOT
// depend on `scenario` — Empirica gives the browser no reliable hook to set a player
// attribute before assignment, so gating the room on the URL deadlocks. The scenario
// is captured during intro and applied to the real game at creation time; here we
// only validate it so the lobby can flag a missing/unknown scenario.
async function assignToWaitingGame(ctx, player) {
  // Skip if player already assigned to a game
  if (player.get("gameID")) {
    const existingId = player.get("gameID");
    const existing = Array.from(ctx.scopesByKind("game").values()).find(g => g.id === existingId);
    console.log(`[PLAYER] Player ${player.id} already has gameID: ${existingId}`);
    console.log(`[DIAG][assign] EARLY RETURN - player has gameID`, {
      playerId: player.id,
      gameID: existingId,
      foundGame: !!existing,
      isWaiting: existing?.get("isWaiting"),
      hasEnded: existing?.get("hasEnded"),
      groupName: existing?.get("groupName"),
    });
    return;
  }

  // Get running batches
  const batches = Array.from(ctx.scopesByKind("batch").values())
    .filter(b => b.get("status") === "running");

  if (batches.length === 0) {
    console.log(`[PLAYER] No running batches found for player ${player.id}`);
    return;
  }

  const batch = batches[0];
  console.log(`[PLAYER] Using batch ${batch.id} for player ${player.id}`);

  // Find the batch's waiting game (create it if it doesn't exist yet).
  const allGames = Array.from(ctx.scopesByKind("game").values());
  let waitingGame = allGames.find(g =>
    g.get("batchID") === batch.id &&
    g.get("isWaiting") === true &&
    !g.get("hasEnded")
  );

  if (!waitingGame) {
    console.log(`[PLAYER] No waiting game for batch ${batch.id}, creating one...`);
    waitingGame = await createWaitingGame(ctx, batch);
  }

  if (!waitingGame) {
    console.log(`[PLAYER] Could not obtain waiting game for player ${player.id}`);
    return;
  }

  // Assign player to waiting game
  console.log(`[PLAYER] Assigning player ${player.id} to waiting game ${waitingGame.id}`);
  await waitingGame.assignPlayer(player);

  // Refresh gamePlayerCount in case template games have appeared since the
  // waiting game was created (or the initial read fell back to the default).
  const currentPC = waitingGame.get("gamePlayerCount");
  const targetPC = getTargetPlayerCount(ctx, batch);
  if (currentPC !== targetPC) {
    waitingGame.set("gamePlayerCount", targetPC);
    console.log(`[PLAYER] Updated gamePlayerCount on waiting game: ${currentPC} → ${targetPC}`);
  }

  // Store player info on the waiting game for client-side visibility
  // (usePlayers() doesn't work reliably in lobby context)
  const waitingPlayers = waitingGame.get("waitingPlayers") || {};
  const joinedAt = Date.now();
  // Stable join time on the player scope: survives roster pruning so the lobby
  // sweep can grant a consistent new-joiner grace and re-add the player.
  player.set("lobbyJoinedAt", joinedAt);
  // groupName and scenario are both still unset at this point — the client can
  // only write them after assignment — so this entry is provisional. The
  // groupName/scenario listeners rewrite it as each value arrives.
  waitingPlayers[player.id] = waitingPlayerEntry(player, joinedAt);
  const playerGroupName = waitingPlayers[player.id].displayGroupName;
  waitingGame.set("waitingPlayers", waitingPlayers);

  Empirica.flush();
  console.log(`[PLAYER] Updated waitingPlayers on game, now ${Object.keys(waitingPlayers).length} players`);
  console.log(`[DIAG][assign] assigned to waiting game`, {
    playerId: player.id,
    waitingGameId: waitingGame.id,
    groupName: playerGroupName,
    rosterIds: Object.keys(waitingPlayers),
  });

  // Create meeting token for player if room exists
  const roomName = waitingGame.get("dailyRoomName");
  const roomExpiry = waitingGame.get("dailyRoomExpiry");

  if (roomName && roomExpiry) {
    const token = await createMeetingToken(roomName, player, roomExpiry);
    if (token) {
      player.set("dailyMeetingToken", token);
      Empirica.flush();
    }
  }

  // Surface a missing/unknown scenario in the lobby (the player is now in the room,
  // so CustomLobby can render the error). Only matters for multi-treatment batches.
  validateScenario(ctx, batch, player);
  Empirica.flush();
}

Empirica.on("player", async (ctx, { player }) => {
  // Start polling on first player connection (only if auto-assignment is enabled)
  if (!pollingStarted) {
    globalCtx = ctx;
    pollingStarted = true;

    if (ENABLE_AUTO_ASSIGNMENT) {
      // Poll every minute to check for 18:00 assignment time
      setInterval(async () => {
        if (isAssignmentTime()) {
          console.log("[POLLING] Assignment time reached (18:00)!");
          await assignPlayersToGames(globalCtx);
        }
      }, 60000); // Check every minute

      console.log("[POLLING] Started polling for assignment time");
    } else {
      console.log("[POLLING] Auto-assignment disabled - using manual Start button only");
    }

    // Sweep waiting-game rosters against each player's `lastSeen` heartbeat.
    setInterval(() => {
      try {
        sweepLobbyPresence(globalCtx);
      } catch (err) {
        console.error("[PRESENCE] Lobby sweep error:", err);
      }
    }, PRESENCE_SWEEP_MS);
    console.log(`[PRESENCE] Started lobby presence sweep (every ${PRESENCE_SWEEP_MS}ms, stale >${PRESENCE_STALE_MS}ms)`);
  }

  console.log(`[PLAYER] Player ${player.id} connected`);
  console.log(`[DIAG][connect] player connected`, {
    playerId: player.id,
    gameID: player.get("gameID"),
    scenario: player.get("scenario"),
    groupName: player.get("groupName"),
    displayName: player.get("displayName"),
    ended: player.get("ended"),
  });

  await assignToWaitingGame(ctx, player);
});

// Rewrite a player's roster entry from their current attributes.
//
// A player is assigned to the waiting game on connect, before the client has had
// a chance to write `groupName` or `scenario` (Empirica offers the browser no
// hook to set an attribute before assignment — see assignToWaitingGame). So the
// entry written there is provisional, and every attribute the lobby identity
// depends on must call this when it lands. Since the identity is now
// (groupName, scenario), that means BOTH of those, not just groupName.
function refreshWaitingPlayerEntry(ctx, player, reason) {
  const gameId = player.get("gameID");
  if (!gameId) return;

  const game = Array.from(ctx.scopesByKind("game").values()).find(g => g.id === gameId);
  if (!game || !game.get("isWaiting")) return;

  const waitingPlayers = game.get("waitingPlayers") || {};
  const existing = waitingPlayers[player.id];
  // Not in the roster yet — assignToWaitingGame will add them with current values.
  if (!existing) return;

  waitingPlayers[player.id] = waitingPlayerEntry(player, existing.joinedAt);
  game.set("waitingPlayers", waitingPlayers);
  Empirica.flush();
  console.log(`[PLAYER] Refreshed roster entry for ${player.id} (${reason}): group "${waitingPlayers[player.id].displayGroupName}", scenario "${waitingPlayers[player.id].scenario}"`);
}

// When a player's scenario arrives/changes (set during intro), (re)validate it so
// the lobby can flag a missing/unknown scenario, and refresh their roster entry —
// the scenario is half of the lobby identity, so until this runs the player sits
// in a lobby keyed on an empty scenario and cannot see their own group.
Empirica.on("player", "scenario", async (ctx, { player }) => {
  console.log(`[PLAYER] Player ${player.id} set scenario to: ${player.get("scenario")}`);
  // Validate against the running batch directly. Do NOT gate on gameID: with a fast
  // connection (e.g. ?devKey=oandi bypasses the club auth round-trip) the client can
  // set `scenario` before assignToWaitingGame has assigned a gameID. Gating here would
  // silently skip validation, and since `scenario` only changes once this listener
  // never re-fires — leaving the "No scenario" error stamped at connect (callbacks
  // line ~1059) permanently uncleared. Resolve the batch the same way assignment does.
  const batch = Array.from(ctx.scopesByKind("batch").values())
    .find(b => b.get("status") === "running");
  if (batch) {
    validateScenario(ctx, batch, player);
    Empirica.flush();
  }

  refreshWaitingPlayerEntry(ctx, player, "scenario");
});

// Listen for groupName changes and update waitingPlayers on the game
Empirica.on("player", "groupName", async (ctx, { player }) => {
  console.log(`[PLAYER] Player ${player.id} set groupName to: ${player.get("groupName") || NO_GROUP_NAME}`);
  refreshWaitingPlayerEntry(ctx, player, "groupName");
});

// Listen for displayName changes and update waitingPlayers on the game
Empirica.on("player", "displayName", async (ctx, { player }) => {
  console.log(`[PLAYER] Player ${player.id} set displayName to: ${player.get("displayName")}`);
  refreshWaitingPlayerEntry(ctx, player, "displayName");
});

// When player completes intro, mark them ready
Empirica.on("player", "introDone", async (ctx, { player }) => {
  if (!player.get("introDone")) return;
  console.log(`[PLAYER] Player ${player.id} completed intro`);

  // Create token if not already created (in case they completed intro before assignment)
  if (!player.get("dailyMeetingToken")) {
    const game = Array.from(ctx.scopesByKind("game").values())
      .find(g => g.id === player.get("gameID"));

    if (game && game.get("isWaiting") && game.get("dailyRoomName")) {
      const token = await createMeetingToken(
        game.get("dailyRoomName"),
        player,
        game.get("dailyRoomExpiry")
      );
      if (token) {
        player.set("dailyMeetingToken", token);
        Empirica.flush();
      }
    }
  }
});

// ============================================================================
// GAME EVENTS - Existing game start logic
// ============================================================================

Empirica.onStageEnded(({ stage }) => {
  // Score at the end of the live negotiation stage — the last stage of the
  // Negotiation Game round — so the outcome (bonus + agreement) is on each
  // player before the Debrief round/stage renders. Every other stage end is a
  // no-op here and must NOT touch the computed bonus.
  if (stage.get("name") !== "Time To Negotiate") {
    return;
  }

  const round = stage.round;
  const game = round.currentGame;
  const history = round.get("proposalHistory") || [];
  const finalProposal = history.length > 0 ? history[history.length - 1] : null;

  // Check if agreement was reached (all players voted to finalize)
  const finalVotes = finalProposal?.finalVotes || {};
  const playerCount = game.get("treatment")?.playerCount || game.players.length;
  const finalVoteCount = Object.keys(finalVotes).length;
  const allFinalized = finalVoteCount === playerCount &&
                      Object.values(finalVotes).every(vote => vote === "finalize");
  const reachedAgreement = finalProposal && allFinalized;

  console.log("negotiate stage end - Agreement check:", {
    historyLength: history.length,
    finalVoteCount,
    playerCount,
    allFinalized,
    reachedAgreement
  });

  const negotiationType = game.get("negotiationType") || "features";

  // Joint payoff = sum of every player's individual bonus; accumulated as we go
  // and stashed on each player below so the Debrief stage can forward it too.
  let jointPayoff = 0;

  // Calculate and save bonus (the negotiated "value") for each player
  game.players.forEach((player) => {
    let bonus = 0;

    if (reachedAgreement) {
      if (negotiationType === "price") {
        // value = multiplier * (rp - price)
        const k = player.get("roleMultiplier") ?? 1;
        const rp = player.get("rolePriceRP") ?? 0;
        const price = parseFloat(finalProposal.options?.value);
        bonus = isFinite(price) ? k * (rp - price) : 0;
      } else {
        // features / multiple_choice: sum of the chosen option's score per issue.
        const roleScoresheet = player.get("roleScoresheet");
        const proposalOptions = finalProposal.options;

        if (roleScoresheet && proposalOptions) {
          bonus = Object.entries(roleScoresheet).reduce((sum, [category, options]) => {
            let optionIdx = proposalOptions[category];
            if (optionIdx === undefined || optionIdx === null) {
              if (negotiationType === "features") optionIdx = 1; // default to Exclude
              else return sum; // multiple_choice: unset issue contributes nothing
            }
            return sum + (options?.[optionIdx]?.score || 0);
          }, 0);
        }
      }
    } else {
      // No agreement reached, use BATNA value (0 for price negotiations).
      bonus = player.get("roleRP") || 0;
    }

    player.set("bonus", bonus);
    // Persist the agreement flag per-player so the post-negotiation Debrief stage
    // can show the correct outcome without re-deriving it from the bonus.
    player.set("reachedAgreement", reachedAgreement);
    // Stash the final-vote count too, so the Debrief stage can forward the full
    // outcome (agreement + votes + points) to the club profile (see Stage.jsx).
    player.set("voteCount", finalVoteCount);
    jointPayoff += bonus;
    console.log(`Player ${player.id} bonus: ${bonus} (agreement: ${reachedAgreement})`);
  });

  // Stash the joint payoff (sum of individual bonuses) on each player now that
  // every bonus is known, so the Debrief stage can forward it to the club.
  game.players.forEach((player) => player.set("jointPayoff", jointPayoff));

  // Save whether agreement was reached to the round
  round.set("agreementReached", reachedAgreement);
  Empirica.flush();
});

Empirica.onGameStart(({ game }) => {
  // Empirica's own de-duplication (the `unique()` wrapper behind onGameStart)
  // records that it ran only AFTER this callback returns, so its guard window is
  // exactly as wide as our runtime — and setupGameOnStart blocks on a role fetch.
  // A second delivery of the same `start` attribute lands inside that window and
  // re-runs the whole setup: a second Daily room ("room already exists"), a fresh
  // random role draw overwriting the first, and a duplicate set of rounds and
  // stages. Close the window ourselves, synchronously, before any I/O —
  // Attribute.set() updates the local value immediately, so a second delivery
  // reads this back with no server round-trip.
  if (game.get("setupStarted")) {
    console.log(`[GAME START] Game ${game.id} already set up, ignoring duplicate start`);
    return;
  }
  game.set("setupStarted", true);

  try {
    setupGameOnStart(game);
  } catch (err) {
    // The guard above is deliberately NOT released here: re-running setup is
    // what produces duplicate rounds, and fetchRoleData caches failures for
    // ROLE_DATA_ERROR_TTL_MS anyway, so an immediate retry would fail the same
    // way. Surface it instead of leaving players in a game with no stages.
    console.error(`[GAME START] Game ${game.id} setup failed:`, err);
    (game.players || []).forEach(p => p.set("scenarioError", "Something went wrong setting up your negotiation. Please contact your session host."));
    Empirica.flush();
  }
});

// Full game setup: role data, Daily room, role assignment, rounds and stages.
// Split out of the listener above so that listener stays small enough to carry
// the duplicate-start guard and the failure path.
function setupGameOnStart(game) {

  const treatment = game.get("treatment");
  // Set at game creation from the players' ?scenario= and this deployment's CLUB_BASE.
  const roleDataURL = game.get("roleDataURL");
  console.log(`[GAME START] Game ${game.id} treatment:`, JSON.stringify(treatment));
  console.log(`[DIAG][gameStart]`, {
    gameId: game.id,
    groupName: game.get("groupName"),
    isWaiting: game.get("isWaiting"),
    players: (game.players || []).map(p => p.id),
    scenario: game.get("scenario"),
    // Labelled `roleSource`, NOT `roleDataURL`: the line above dumps the whole
    // treatment, and batches created before treatments.yaml was cleaned up still
    // carry an inert `roleDataURL` factor with a different (never-fetched) value.
    // Two identical key names in adjacent log lines read as an override that
    // isn't happening. This one is the URL actually fetched.
    roleSource: roleDataURL,
    clubBase: CLUB_BASE,
  });

  if (!roleDataURL) {
    console.error(`[GAME START] Game ${game.id} has no roleDataURL — cannot fetch roles`);
    (game.players || []).forEach(p => p.set("scenarioError", "Could not determine the scenario for your game. Please use the link provided for your session."));
    Empirica.flush();
    return;
  }

  let rolesData;
  try {
    rolesData = fetchRoleData(roleDataURL);
  } catch (err) {
    console.error(`[GAME START] Game ${game.id} failed to load role data from ${roleDataURL}:`, err);
    (game.players || []).forEach(p => p.set("scenarioError", `Could not load scenario "${game.get("scenario")}". Please use the link provided for your session.`));
    Empirica.flush();
    return;
  }
  const roles = rolesData.roles;

  // Negotiation type drives how the client interprets the role data and how
  // scoring works. Absent => "features" (the original include/exclude form).
  const negotiationType = rolesData.type || rolesData.negotiation_type || "features";
  game.set("negotiationType", negotiationType);

  // Store tips in game state for client access
  game.set("tips", rolesData.tips || "");

  // Store the post-negotiation debrief content for the client (the data-driven
  // `tabs` array). Stored verbatim and shared across all roles, like tips.
  game.set("debrief", rolesData.debrief || {});

  // Price negotiations carry a scenario-level display config (label, prefix, …).
  if (negotiationType === "price") {
    game.set("priceConfig", rolesData.price_config || rolesData.priceConfig || {});
  }

  console.log(`Fetched ${roles.length} roles (type: ${negotiationType}) from ${roleDataURL}`);

  // Create Daily.co room for this game
  (async () => {
    const d = new Date();
    const today = `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}_${String(d.getDate()).padStart(2,'0')}`;
    const roomName = `${game.id}_video_room_${today}`;

    console.log("Creating Daily.co room for game:", game.id);
    try {
      const roomExp = Math.round(Date.now() / 1000) + 60 * 60 * 4; // 4 hour expiry

      // Create the Daily room. dailyRequest retries transient failures, so a
      // brief Daily blip no longer costs this negotiation its video for good.
      const res = await dailyRequest(`create game room ${roomName}`, "rooms", {
        name: roomName,
        properties: {
          exp: roomExp,
          enable_recording: "raw-tracks",
          enable_transcription_storage: true,
        },
      });

      if (!res.ok || !res.data?.url) {
        return;
      }

      // Save the room URL to the game
      game.set("roomUrl", res.data.url);
      Empirica.flush();
      console.log(`Room created for game: ${res.data.url}`);

      console.log("Creating meeting tokens for players");
      // Same token creation as the waiting room uses, so it gets the same retry.
      const tokenPromises = game.players.map(async (player) => {
        const token = await createMeetingToken(roomName, player, roomExp);
        if (token) {
          player.set("dailyMeetingToken", token);
          Empirica.flush();
        }
      });

      await Promise.all(tokenPromises);
      Empirica.flush();
      console.log(`Tokens generated for ${game.players.length} players`);
    } catch (error) {
      console.error("Failed to create Daily room or tokens:", error);
    }
  })();


  // STANDARD GAME SETUP HERE

  // Prep time comes from the scenario's role JSON (top-level `prep_time`, in
  // minutes) like all other scenario data — treatments stay generic.
  const prepMinutes = Number(rolesData.prep_time);
  const readRoleTime = Number.isFinite(prepMinutes) && prepMinutes > 0 ? prepMinutes * 60 : 300;
  // Negotiation time is effectively unlimited — the impasse button (forceQuit)
  // and reaching agreement are how the stage ends, not the clock.
  const negotiateTime = 1000000;
  const debriefTime = game.get("treatment")?.debriefTime ?? 1800;


  // Randomly assign roles to players
  // Shuffle players array
  const players = [...game.players];
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  // Assign roles by cycling through roles array
  // Store role data in individual player variables for client access
  players.forEach((player, index) => {
    if (roles.length > 0) {
      const assignedRole = roles[index % roles.length];
      player.set("roleName", assignedRole.role_name);
      player.set("roleNarrative", assignedRole.narrative);
      player.set("roleBATNA", assignedRole.BATNA);

      if (negotiationType === "price") {
        // Price negotiation: value = multiplier * (rp - price). The no-agreement
        // value (negotiator's surplus of walking away) is 0.
        player.set("roleMultiplier", assignedRole.multiplier ?? 1);
        player.set("rolePriceRP", assignedRole.rp ?? 0);
        player.set("roleRP", 0);
      } else {
        // features / multiple_choice: payoff-per-option-per-issue table.
        player.set("roleScoresheet", assignedRole.scoresheet);
        player.set("roleRP", assignedRole.RP);
      }
      console.log(`Assigned role "${assignedRole.role_name}" to player ${player.id}`);
    } else {
      console.warn(`No roles available to assign to player ${player.id}`);
    }
  });


  // initialize rounds and stages
    // ROUND 1 -- Assign actual task based on flipOrder
  const round = game.addRound({
    name: "Negotiation Game",
  });

    // ROUND 2 STAGE 1 -- TASK DESCRIPTION
  round.addStage({
    name: "Read Negotiation Role",
    duration: readRoleTime,
  });

  round.addStage({
    name: "Ready To Negotiate",
    duration: 15,
  });

  round.addStage({
    name: "Time To Negotiate",
    duration: negotiateTime,
  });

  // ROUND 2 -- Post-negotiation debrief. A separate round so the negotiation
  // round ends first — each player's bonus is computed when the "Time To
  // Negotiate" stage ends (onStageEnded) — before the Debrief stage renders its
  // data-driven tabs (which can show the outcome).
  const debriefRound = game.addRound({
    name: "Debrief",
  });

  debriefRound.addStage({
    name: "Debrief & Discussion",
    duration: debriefTime,
  });

  console.log("game started?")

}

// NOTE: there is deliberately no onStageStart presence monitor. It polled Daily's
// presence API every 5s per stage to maintain `participantTimestamps`,
// `activeDailyCalls` and `leftAt` — none of which were ever read. Its timers were
// also never cleared, so finished games kept calling Daily for weeks. In-game
// presence is Daily's own concern; lobby presence uses the client heartbeat
// (`lastSeen`) via sweepLobbyPresence above.
