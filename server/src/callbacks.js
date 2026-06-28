import { ClassicListenersCollector } from "@empirica/core/admin/classic";
import fetch from "node-fetch";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// import rolesData from "./roles.json" assert { type: "json" };
// const roles = rolesData.roles;

export const Empirica = new ClassicListenersCollector();

// Daily.co API key for creating rooms and tokens
const DAILY_API_KEY = "d9ff4a046f2a0c3571efa7655fbf80907ad2ffd4d7c89cae0a89e89424d63642";

// Store context reference for polling and assignment
let globalCtx = null;
let pollingStarted = false;

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

// Absolute base directory for resolving relative role-data filenames. A bundled
// Empirica server runs from its own extract/deploy dir, so `process.cwd()` no
// longer points at the repo and bare filenames in treatments.yaml stop resolving.
// Anchoring against this absolute base keeps short names like
// `roles_price_example.json` working regardless of cwd. Override with ROLE_DATA_DIR.
const ROLE_DATA_BASE_DIR = process.env.ROLE_DATA_DIR || "/home/claude/workshop-app";

// Load role data from either a remote URL (http/https) or a local file path.
// Absolute paths are read as-is. Relative names are resolved against
// ROLE_DATA_BASE_DIR first (survives bundling), then a few cwd-relative bases so
// it still works when launched from the project root or the server/ directory.
function loadRoleData(source) {
  if (/^https?:\/\//i.test(source)) {
    return JSON.parse(execSync(`curl -s "${source}"`).toString());
  }

  const candidates = [
    source,
    path.resolve(ROLE_DATA_BASE_DIR, source),
    path.resolve(process.cwd(), source),
    path.resolve(process.cwd(), "..", source),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log(`[ROLES] Loading role data from local file: ${candidate}`);
        return JSON.parse(fs.readFileSync(candidate, "utf8"));
      }
    } catch (err) {
      // try the next candidate
    }
  }

  throw new Error(
    `[ROLES] Could not locate role data file from "${source}" (tried: ${candidates.join(", ")})`
  );
}

// Helper function to create Daily.co room for waiting game
async function createDailyRoom(roomName) {
  const roomExp = Math.round(Date.now() / 1000) + 60 * 60 * 8; // 8 hour expiry

  try {
    const res = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: roomName,
        properties: {
          exp: roomExp,
          enable_recording: "raw-tracks",
          enable_transcription_storage: true,
        },
      }),
    });

    const data = await res.json();
    if (!data.url) {
      console.error("[DAILY] Failed to create room:", data);
      return null;
    }
    console.log(`[DAILY] Room created: ${data.url}`);
    return { url: data.url, roomName, expiry: roomExp };
  } catch (error) {
    console.error("[DAILY] Error creating room:", error);
    return null;
  }
}

// Helper function to create meeting token for a player
async function createMeetingToken(roomName, player, expiry) {
  try {
    const displayName = player.get("displayName") || "Anonymous";
    const userName = `${displayName} - Player ${player.id}`;

    // Always use a fresh expiry (8 hours from now) to avoid stale timestamps
    const freshExpiry = Math.round(Date.now() / 1000) + 60 * 60 * 8;
    const tokenExpiry = expiry > Math.round(Date.now() / 1000) ? expiry : freshExpiry;

    const res = await fetch("https://api.daily.co/v1/meeting-tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
    });

    const tokenData = await res.json();
    if (tokenData.token) {
      console.log(`[DAILY] Created token for player ${displayName}`);
      return tokenData.token;
    } else {
      console.error(`[DAILY] Failed to create token for ${displayName}:`, tokenData);
      return null;
    }
  } catch (err) {
    console.error(`[DAILY] Error creating token for player ${player.id}:`, err);
    return null;
  }
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
async function createWaitingGame(ctx, batch) {
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

  // Per-scenario sizes so the lobby preview uses the right number for each player's
  // scenario (a multi-treatment batch can mix 2-party and 3-party games).
  const scenarioSizes = {};
  for (const e of (batch.get("config")?.config?.treatments || [])) {
    const t = e.treatment;
    const key = t?.factors?.scenario || t?.name;
    const pc = t?.factors?.playerCount;
    if (key && typeof pc === "number" && pc > 0) scenarioSizes[key] = pc;
  }

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
    const groupAdmins = { ...(game.get("groupAdmins") || {}) };
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
      const groupName = p.get("groupName") || "default";
      waitingPlayers[p.id] = {
        id: p.id,
        displayName: p.get("displayName") || "Anonymous",
        groupName,
        joinedAt: p.get("lobbyJoinedAt") ?? now,
      };
      if (!groupAdmins[groupName]) groupAdmins[groupName] = p.id;
      changed = true;
      console.log(`[PRESENCE] Re-added ${p.id} to waiting game ${game.id} (group "${groupName}")`);
    }

    // Prune players who are no longer assigned here or who have gone absent.
    for (const [playerId, info] of Object.entries(waitingPlayers)) {
      const playerScope = playerById.get(playerId);
      const stillAssigned = playerScope && playerScope.get("gameID") === game.id;
      if (stillAssigned && isPresent(playerScope)) continue;
      const groupName = info.groupName || "default";
      delete waitingPlayers[playerId];
      reassignAdmin(waitingPlayers, groupAdmins, groupName, playerId);
      changed = true;
      console.log(`[PRESENCE] Pruned ${playerId} from waiting game ${game.id} (group "${groupName}")`);
    }

    if (changed) {
      game.set("waitingPlayers", waitingPlayers);
      game.set("groupAdmins", groupAdmins);
    }
  }

  if (waitingGames.length > 0) Empirica.flush();
}

// Reassign (or clear) the admin for a group after `removedPlayerId` has been
// removed from `waitingPlayers`. Mutates `groupAdmins` in place. Safe to call
// even when the removed player wasn't the admin.
function reassignAdmin(waitingPlayers, groupAdmins, groupName, removedPlayerId) {
  if (groupAdmins[groupName] !== removedPlayerId) return;
  const next = Object.values(waitingPlayers).find(
    p => p.groupName === groupName && p.id !== removedPlayerId
  );
  if (next) {
    groupAdmins[groupName] = next.id;
    console.log(`[ADMIN] Reassigned admin of group "${groupName}" to ${next.id}`);
  } else {
    delete groupAdmins[groupName];
    console.log(`[ADMIN] Removed admin for empty group "${groupName}"`);
  }
}

// Group players by groupName
function groupByGroupName(players) {
  const groups = {};
  for (const player of players) {
    const groupName = player.get("groupName") || "default";
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(player);
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

  // Group players by groupName
  const groups = groupByGroupName(waitingPlayers);
  console.log(`[ASSIGNMENT] Found ${Object.keys(groups).length} groups:`, Object.keys(groups).map(k => `${k}(${groups[k].length})`));

  // Process each group
  const processedPlayers = new Set();

  for (const [groupName, members] of Object.entries(groups)) {
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
      const extras = findExtraPlayers(groups, needed, groupName, processedPlayers);
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
function findExtraPlayers(groups, needed, excludeGroup, processedPlayers) {
  const extras = [];

  for (const [groupName, members] of Object.entries(groups)) {
    if (groupName === excludeGroup) continue;

    for (const player of members) {
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

  // Pick the treatment for this game from the players' scenario (set during intro).
  // In a single-treatment batch this is just that treatment; in a multi-treatment
  // batch it's the one whose `scenario` factor matches. No fallback: an unresolved
  // scenario flags the players and aborts (we never create a wrong-treatment game).
  const scenario = players[0]?.get("scenario");
  const treatment = getScenarioTreatment(batch, scenario);
  if (!treatment) {
    console.error(`[ASSIGNMENT] No treatment for scenario "${scenario}" — aborting game for group "${groupName}"`);
    for (const p of players) {
      p.set("scenarioError", `Unknown scenario "${scenario}". Please use the link provided for your session.`);
    }
    Empirica.flush();
    return;
  }

  // Snapshot existing game IDs so we can identify the newly created one
  const existingGameIds = new Set(
    Array.from(ctx.scopesByKind("game").values()).map(g => g.id)
  );

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
    { key: "isWaiting", value: false },
  ]);

  Empirica.flush();

  // Poll for the real Game object to appear in the context
  let game = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const allGames = Array.from(ctx.scopesByKind("game").values());
    game = allGames.find(g =>
      !existingGameIds.has(g.id) &&
      g.get("groupName") === groupName
    );
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

  // Start the game
  game.set("start", true);
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

// Listen for single group start trigger from group admin (using player attribute)
Empirica.on("player", "requestStart", async (ctx, { player }) => {
  const requestStart = player.get("requestStart");
  console.log(`[PLAYER] requestStart listener triggered! Player ${player?.id}`, requestStart);

  if (!requestStart) {
    console.log(`[PLAYER] requestStart is null/undefined, ignoring`);
    return;
  }

  const groupName = requestStart.groupName;
  const requestingPlayerId = player.id;

  console.log(`[PLAYER] Start requested for group "${groupName}" by player ${requestingPlayerId}`);
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

  // The admin machinery still runs (we read/track groupAdmins below), but the
  // start request is no longer gated on it — any group member may start the game.
  const groupAdmins = game.get("groupAdmins") || {};
  console.log(`[DIAG][requestStart] start requested`, {
    groupName,
    adminForGroup: groupAdmins[groupName],
    requestingPlayerId,
    rosterIds: Object.keys(game.get("waitingPlayers") || {}),
  });

  // Get players in this group
  const waitingPlayers = game.get("waitingPlayers") || {};
  const groupMembers = Object.values(waitingPlayers).filter(p => p.groupName === groupName);

  if (groupMembers.length === 0) {
    console.log(`[PLAYER] No players in group "${groupName}"`);
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

  console.log(`[PLAYER] Starting game for group "${groupName}" with ${groupMembers.length} players`);

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

  // Put the requesting admin at the front so the server's split matches the
  // preview the admin saw in the modal (the client lists the admin first).
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
  // the admin's scenario; differently-scenario'd players stay in the lobby.
  const startScenario = player.get("scenario");
  const sameScenario = playersToAssign.filter(p => p.get("scenario") === startScenario);
  if (sameScenario.length !== playersToAssign.length) {
    console.log(`[PLAYER] Group mixes scenarios; starting only "${startScenario}" (${sameScenario.length}/${playersToAssign.length})`);
  }

  // Per-scenario game size from the matching treatment.
  const playerCount = scenarioPlayerCount(ctx, batch, startScenario);

  // The admin assigns players to rooms by hand in the lobby modal and sends the
  // result as `assignments`: an array (one entry per game room) of playerId
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

  for (const chunkPlayers of chunks) {
    await createAndAssignGame(ctx, batch, chunkPlayers, groupName);
  }

  // Remove assigned players from waitingPlayers; leftovers stay.
  const assignedIds = new Set(chunks.flat().map(p => p.id));
  for (const pid of assignedIds) {
    delete waitingPlayers[pid];
  }
  game.set("waitingPlayers", waitingPlayers);

  if (leftovers.length > 0) {
    // Prefer the original requester as the new admin if they're among the
    // leftovers; otherwise pick the first leftover.
    const newAdmin = leftovers.find(p => p.id === requestingPlayerId) || leftovers[0];
    groupAdmins[groupName] = newAdmin.id;
    console.log(`[PLAYER] Admin of group "${groupName}" is now leftover ${newAdmin.id}`);
  } else {
    delete groupAdmins[groupName];
  }
  game.set("groupAdmins", groupAdmins);

  // Clear requestStart for every involved player (assigned and leftovers).
  for (const p of playersToAssign) {
    p.set("requestStart", null);
  }

  Empirica.flush();
  console.log(`[PLAYER] Game creation complete for group "${groupName}"`);
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

// A batch may hold several treatments (one per scenario). Resolve the treatment a
// player's `scenario` maps to: match on the treatment's `scenario` factor (fallback
// to its name). Matching is strict for EVERY batch — including single-treatment ones,
// which only resolve when the param matches their `scenario`/`name`. Returns null when
// no treatment in the batch matches, so an invalid scenario can be gated everywhere.
function getScenarioTreatment(batch, scenario) {
  const entries = batch.get("config")?.config?.treatments || [];
  const match = entries.find(e => {
    const t = e.treatment;
    return (t?.factors?.scenario || t?.name) === scenario;
  });
  return match?.treatment || null;
}

// Per-scenario game size, from the matching treatment. Falls back to the batch
// default when the scenario can't be resolved (so chunking still has a number).
function scenarioPlayerCount(ctx, batch, scenario) {
  const pc = getScenarioTreatment(batch, scenario)?.factors?.playerCount;
  return (typeof pc === "number" && pc > 0) ? pc : getTargetPlayerCount(ctx, batch);
}

// Validate a player's scenario against the batch's treatments and surface an error
// for the lobby to show (no silent fallback). Enforced for EVERY batch: the scenario
// must map to one of the batch's treatments (matched by `scenario` factor, or name).
function validateScenario(ctx, batch, player) {
  const clear = () => { if (player.get("scenarioError")) player.set("scenarioError", null); };
  const scenario = player.get("scenario");
  if (!scenario) {
    player.set("scenarioError", "No scenario was specified in your link. Please use the link provided for your session.");
    return;
  }
  if (!getScenarioTreatment(batch, scenario)) {
    player.set("scenarioError", `Unknown scenario "${scenario}". Please use the link provided for your session.`);
    return;
  }
  clear();
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
  const playerGroupName = player.get("groupName") || "default";
  const joinedAt = Date.now();
  // Stable join time on the player scope: survives roster pruning so the lobby
  // sweep can grant a consistent new-joiner grace and re-add the player.
  player.set("lobbyJoinedAt", joinedAt);
  waitingPlayers[player.id] = {
    id: player.id,
    displayName: player.get("displayName") || "Anonymous",
    groupName: playerGroupName,
    joinedAt,
  };
  waitingGame.set("waitingPlayers", waitingPlayers);

  // Track admin per group - first person in a group becomes admin
  const groupAdmins = waitingGame.get("groupAdmins") || {};
  if (!groupAdmins[playerGroupName]) {
    groupAdmins[playerGroupName] = player.id;
    waitingGame.set("groupAdmins", groupAdmins);
    console.log(`[PLAYER] Player ${player.id} is now admin of group "${playerGroupName}"`);
  }

  Empirica.flush();
  console.log(`[PLAYER] Updated waitingPlayers on game, now ${Object.keys(waitingPlayers).length} players`);
  console.log(`[DIAG][assign] assigned to waiting game`, {
    playerId: player.id,
    waitingGameId: waitingGame.id,
    groupName: playerGroupName,
    rosterIds: Object.keys(waitingPlayers),
    groupAdmins,
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

// When a player's scenario arrives/changes (set during intro), (re)validate it so
// the lobby can flag a missing/unknown scenario. The scenario is applied to the real
// game at creation time, not here — so no (re)assignment is needed.
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
});

// Listen for groupName changes and update waitingPlayers on the game
Empirica.on("player", "groupName", async (ctx, { player }) => {
  const newGroupName = player.get("groupName") || "default";
  console.log(`[PLAYER] Player ${player.id} set groupName to: ${newGroupName}`);

  // Update waitingPlayers on the game so client can see the change
  const gameId = player.get("gameID");
  if (gameId) {
    const game = Array.from(ctx.scopesByKind("game").values())
      .find(g => g.id === gameId);

    if (game && game.get("isWaiting")) {
      const waitingPlayers = game.get("waitingPlayers") || {};
      const oldGroupName = waitingPlayers[player.id]?.groupName;

      if (waitingPlayers[player.id]) {
        waitingPlayers[player.id].groupName = newGroupName;
        waitingPlayers[player.id].displayName = player.get("displayName") || "Anonymous";
        game.set("waitingPlayers", waitingPlayers);
      }

      // Update group admins
      const groupAdmins = game.get("groupAdmins") || {};

      if (oldGroupName) {
        reassignAdmin(waitingPlayers, groupAdmins, oldGroupName, player.id);
      }

      // If new group has no admin, make this player admin
      if (!groupAdmins[newGroupName]) {
        groupAdmins[newGroupName] = player.id;
        console.log(`[PLAYER] Player ${player.id} is now admin of group "${newGroupName}"`);
      }

      game.set("groupAdmins", groupAdmins);
      Empirica.flush();
      console.log(`[PLAYER] Updated waitingPlayers for player ${player.id} with groupName: ${newGroupName}`);
    }
  }
});

// Listen for displayName changes and update waitingPlayers on the game
Empirica.on("player", "displayName", async (ctx, { player }) => {
  const displayName = player.get("displayName");
  console.log(`[PLAYER] Player ${player.id} set displayName to: ${displayName}`);

  // Update waitingPlayers on the game so client can see the change
  const gameId = player.get("gameID");
  if (gameId) {
    const game = Array.from(ctx.scopesByKind("game").values())
      .find(g => g.id === gameId);

    if (game && game.get("isWaiting")) {
      const waitingPlayers = game.get("waitingPlayers") || {};
      if (waitingPlayers[player.id]) {
        waitingPlayers[player.id].displayName = displayName || "Anonymous";
        game.set("waitingPlayers", waitingPlayers);
        Empirica.flush();
        console.log(`[PLAYER] Updated waitingPlayers for player ${player.id} with displayName: ${displayName}`);
      }
    }
  }
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

  const treatment = game.get("treatment");
  const roleDataURL = treatment?.roleDataURL;
  console.log(`[GAME START] Game ${game.id} treatment:`, JSON.stringify(treatment));
  console.log(`[DIAG][gameStart]`, {
    gameId: game.id,
    groupName: game.get("groupName"),
    isWaiting: game.get("isWaiting"),
    players: (game.players || []).map(p => p.id),
    roleDataURL,
  });

  if (!roleDataURL) {
    console.error(`[GAME START] Game ${game.id} has no roleDataURL in treatment — cannot fetch roles`);
    return;
  }

  const rolesData = loadRoleData(roleDataURL);
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
    const DAILY_API_KEY = "d9ff4a046f2a0c3571efa7655fbf80907ad2ffd4d7c89cae0a89e89424d63642";
    const roomName = `${game.id}_video_room_${today}`;

    console.log("Creating Daily.co room for game:", game.id);
    try {
      const roomExp = Math.round(Date.now() / 1000) + 60 * 60 * 4; // 4 hour expiry

      // Create the Daily room
      const res = await fetch("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DAILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: roomName,
          properties: {
            exp: roomExp,
            enable_recording: "raw-tracks",
            enable_transcription_storage: true,
          },
        }),
      });

      const data = await res.json();

      if (!data.url) {
        console.error("Failed to create Daily room:", data);
        return;
      }

      // Save the room URL to the game
      game.set("roomUrl", data.url);
      Empirica.flush();
      console.log(`Room created for game: ${data.url}`);

      console.log("Creating meeting tokens for players");
      // Create meeting tokens for each player with transcription permissions
      const tokenPromises = game.players.map(async (player) => {
        try {
          const displayName = player.get("displayName") 
          const user_name = player.get("displayName")  + " - " + `Player ${player.id}`;

          const tokenRes = await fetch("https://api.daily.co/v1/meeting-tokens", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${DAILY_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              properties: {
                room_name: roomName,
                user_name: user_name,
                user_id: player.id,
                is_owner: false,
                permissions: {
                  canAdmin: ["transcription"]
                },
                exp: roomExp,
              },
            }),
          });

          const tokenData = await tokenRes.json();

          if (tokenData.token) {
            player.set("dailyMeetingToken", tokenData.token);
            Empirica.flush();
            console.log(`Created token for player ${displayName}`);
          } else {
            console.error(`Failed to create token for player ${displayName}:`, tokenData);
          }
        } catch (err) {
          console.error(`Error creating token for player ${player.id}:`, err);
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

  const readRoleTime = game.get("treatment")?.readRoleTime ?? 300;
  const negotiateTime = game.get("treatment")?.negotiateTime ?? 1800;
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


  // Initialize participant timestamps for presence tracking via Daily.co API
  game.set("participantTimestamps", {});

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

});

// Handle stage start for video stages
Empirica.onStageStart(({ stage }) => {
  
  console.log("stage starting")

  // this code block keeps track of whether players have left the game
  // piggybacking on daily.co tracking
  // Initialize timestamps for all players at stage start
  const game = stage.round.currentGame;
  const initialTimestamps = {};
  game.players.forEach(player => {
    initialTimestamps[player.id] = Date.now();
  });
  game.set("participantTimestamps", initialTimestamps);
  Empirica.flush();

  // Monitor Daily.co participant presence every 5 seconds
  const monitorInterval = setInterval(async () => {

    const currentGame = stage.round.currentGame;
    const currentStage = currentGame.currentStage;

    // Check if we're still on the stage that created this interval
    if (!currentStage || currentStage.id !== stage.id) {
      return; // This interval is for an old stage, don't run
    }

    const game = stage.round.currentGame;
    const timestamps = game.get("participantTimestamps") || {};
    const now = Date.now();

    // Get Daily.co participants to update timestamps
    const DAILY_API_KEY = "4a8717f69efe0168244b69d4d4aa0aad4faafbe31c94d69853d590eeeb916290";
    const roomUrl = game.get("roomUrl");

    if (roomUrl) {
      try {
        // Extract room name from URL (e.g., "https://company.daily.co/roomname" -> "roomname")
        const roomName = roomUrl.split('/').pop();

        // Fetch current participants from Daily.co presence API
        const res = await fetch(`https://api.daily.co/v1/rooms/${roomName}/presence`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${DAILY_API_KEY}`,
          }
        });

        const data = await res.json();


        if (data && data.data) {
          // Get list of player IDs currently in the call

          const activePlayerIds = data.data.map(p => p.userId);

          game.set("activeDailyCalls", data.data)

          // Update timestamps for players who are in the Daily call
          game.players.forEach(player => {
            if (activePlayerIds.includes(player.id)) {
              // LOOK HERE FOR MYSTERY
              // console.log(player.id + " is active")
              timestamps[player.id] = now;
              // console.log(timestamps)
            }
          });

          // Save updated timestamps
          // console.log("Saved timestamps:", timestamps);
          game.set("participantTimestamps", timestamps);
          Empirica.flush();
          // Object.entries(game.get("participantTimestamps")).forEach(([k,v]) => console.log(k + " : " + ((v-Date.now())/1000) ))
        }
      } catch (error) {
        console.error("Error fetching Daily participants:", error);
        // Continue with existing timestamps if API call fails
      }
    }

    // Staleness check against each player's self-heartbeat (`lastSeen`,
    // written by client/src/components/Heartbeat.jsx). `participantTimestamps`
    // above is kept as a parallel Daily-side cross-check.
    game.players.forEach(player => {
      if (player.get("leftAt")) return; // Already marked; don't re-fire.

      const lastSeen = player.get("lastSeen");
      const lastTs = lastSeen?.ts;
      if (!lastTs) return; // Never heartbeated yet — wait for first tick.

      if (now - lastTs > PRESENCE_STALE_MS) {
        player.set("leftAt", now);
        const displayName = player.get("displayName") || "Unknown";
        console.log(`[PRESENCE] Player ${player.id} (${displayName}) marked as left (last seen ${Math.round((now - lastTs)/1000)}s ago)`);
      }
    });
    Empirica.flush();
  }, 5000);

});