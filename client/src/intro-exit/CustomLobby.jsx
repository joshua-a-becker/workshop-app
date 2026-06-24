import React, { useState, useEffect, useContext, useMemo, useRef } from "react";
import { Users, Video, Play, X, AlertTriangle, Shuffle } from "lucide-react";
import { usePlayer, useGame } from "@empirica/core/player/classic/react";
import { DailyCallContext } from "../App.jsx";
import { VideoChat } from "../components/VideoChat.jsx";
import { Heartbeat } from "../components/Heartbeat.jsx";

// Client-side mirror of the server's three chunking strategies. Same rules;
// same inputs. Used to render the preview inside the assignment modal so the
// admin can see exactly what will happen before confirming.
function chunkExact(members, P) {
  const n = members.length;
  const fullGroups = Math.floor(n / P);
  const games = [];
  for (let i = 0; i < fullGroups; i++) games.push(members.slice(i * P, (i + 1) * P));
  return { games, leftovers: members.slice(fullGroups * P) };
}

function chunkPartial(members, P) {
  const n = members.length;
  if (n === 0) return { games: [], leftovers: [] };
  if (n === 1) return { games: [], leftovers: [members[0]] };
  if (n <= P) return { games: [members], leftovers: [] };

  const fullGroups = Math.floor(n / P);
  const remainder = n % P;

  if (remainder === 0) {
    const games = [];
    for (let i = 0; i < fullGroups; i++) games.push(members.slice(i * P, (i + 1) * P));
    return { games, leftovers: [] };
  }

  if (remainder >= 2) {
    const games = [];
    for (let i = 0; i < fullGroups; i++) games.push(members.slice(i * P, (i + 1) * P));
    games.push(members.slice(fullGroups * P));
    return { games, leftovers: [] };
  }

  // remainder === 1
  if (P === 2) {
    const games = [];
    for (let i = 0; i < fullGroups; i++) games.push(members.slice(i * P, (i + 1) * P));
    return { games, leftovers: [members[fullGroups * P]] };
  }

  const games = [];
  for (let i = 0; i < fullGroups - 1; i++) games.push(members.slice(i * P, (i + 1) * P));
  const lastFullStart = (fullGroups - 1) * P;
  games.push(members.slice(lastFullStart, lastFullStart + P - 1));
  games.push(members.slice(lastFullStart + P - 1));
  return { games, leftovers: [] };
}

function chunkOverfill(members, P) {
  const partial = chunkPartial(members, P);
  if (partial.leftovers.length === 0) return partial;
  if (partial.games.length === 0) return partial;
  const games = partial.games.map(g => g.slice());
  games[games.length - 1] = games[games.length - 1].concat(partial.leftovers);
  return { games, leftovers: [] };
}

// Fisher–Yates shuffle, returns a new array. Used by Random Assign so the
// auto-fill is genuinely random rather than roster-order.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic avatar color from a player id, so the same person keeps the
// same color across renders and across the roster/room views.
function colorForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 60% 48%)`;
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

// A colored circle with the player's initials. `empty` renders a dashed
// placeholder slot instead — an open seat the admin can drop someone into.
function Avatar({ player, empty = false, size = "w-9 h-9 text-xs" }) {
  if (empty || !player) {
    return (
      <div
        className={`${size} rounded-full border-2 border-dashed border-gray-300 flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}
      style={{ backgroundColor: colorForId(player.id) }}
      title={player.displayName}
    >
      {initials(player.displayName)}
    </div>
  );
}

// Selectable avatar+name token for a single player.
function PlayerChip({ player, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-center gap-2 w-full text-left rounded-lg border px-2 py-1.5 transition-colors " +
        (selected
          ? "border-blue-500 ring-2 ring-blue-400 bg-blue-50"
          : "border-gray-200 bg-white hover:bg-gray-50")
      }
    >
      <Avatar player={player} />
      <span className="text-sm text-gray-800 truncate">
        {player.displayName}
        {player.isSelf && <span className="text-gray-400"> (You)</span>}
      </span>
    </button>
  );
}

// Shown when a player has no scenario in their link, or the server flagged the
// scenario as invalid. Rendered instead of the lobby — these players are never
// assigned to a game, so they never reach the exit steps.
function ScenarioErrorPanel({ message }) {
  return (
    <div className="h-screen w-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-center mb-4">
          <AlertTriangle className="w-12 h-12 text-amber-500" strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-semibold text-center text-gray-900 mb-2">
          Can't join this session
        </h2>
        <p className="text-center text-gray-600">{message}</p>
      </div>
    </div>
  );
}

// Thin wrapper: validate the player's scenario before rendering the lobby. This
// keeps the guard out of CustomLobbyInner's hook list (the wrapper only ever calls
// usePlayer), so the Rules of Hooks are respected across renders.
export function CustomLobby() {
  const player = usePlayer();
  // The server validates the scenario against the batch's treatments and sets
  // `scenarioError` when it's missing/unknown (only for multi-treatment batches).
  const scenarioError = player?.get("scenarioError");

  if (scenarioError) {
    return <ScenarioErrorPanel message={scenarioError} />;
  }

  return <CustomLobbyInner />;
}

function CustomLobbyInner() {
  const player = usePlayer();
  const game = useGame();

  const { groupName: contextGroupName } = useContext(DailyCallContext);

  // Get player's groupName (from URL params set on player, or from context)
  const myGroupName = player?.get("groupName") || contextGroupName || "default";

  // Get waitingPlayers from game (stored by server since usePlayers() doesn't work in lobby)
  const waitingPlayersObj = game?.get("waitingPlayers") || {};

  // Check if current player is admin of their group
  const groupAdmins = game?.get("groupAdmins") || {};
  const adminId = groupAdmins[myGroupName];
  const isAdmin = adminId === player?.id;

  // Filter players to show only those in the same group (excluding self)
  const groupMembers = useMemo(() => {
    const members = [];
    for (const [playerId, playerInfo] of Object.entries(waitingPlayersObj)) {
      const theirGroupName = playerInfo.groupName || "default";
      const isInMyGroup = theirGroupName === myGroupName;
      const isNotMe = playerId !== player?.id;

      if (isInMyGroup && isNotMe) {
        members.push({ id: playerId, ...playerInfo });
      }
    }
    return members;
  }, [waitingPlayersObj, myGroupName, player?.id]);

  // Calculate total group members and whether game can start
  const totalGroupMembers = groupMembers.length + 1; // +1 for current player
  const canStartGame = isAdmin && totalGroupMembers >= 2;

  // Real per-game size, surfaced by the server on the waiting game so the
  // lobby can preview how the group would be split. In a multi-treatment batch
  // the size depends on the player's scenario, so prefer the per-scenario value.
  const myScenario = player?.get("scenario");
  const scenarioSizes = game?.get("scenarioSizes") || {};
  const gamePlayerCount = scenarioSizes[myScenario] || game?.get("gamePlayerCount") || 4;

  // Find the admin's display name (if admin is someone other than the current player)
  const adminName = adminId && !isAdmin
    ? (groupMembers.find(p => p.id === adminId)?.displayName || "Anonymous")
    : null;

  // Create a Set of player IDs for video filtering
  const groupMemberIds = useMemo(() => {
    const ids = new Set();
    groupMembers.forEach(p => ids.add(p.id));
    return ids;
  }, [groupMembers]);

  // Flat roster (self first) for the assignment modal: id + display name, plus
  // a flag marking which one is the admin doing the assigning.
  const myDisplayName = player?.get("displayName");
  const assignmentPlayers = useMemo(() => {
    const list = [];
    if (player?.id) {
      list.push({ id: player.id, displayName: myDisplayName || "You", isSelf: true });
    }
    for (const p of groupMembers) {
      list.push({ id: p.id, displayName: p.displayName || "Anonymous", isSelf: false });
    }
    return list;
  }, [player?.id, myDisplayName, groupMembers]);

  // Check if video chat is available (room URL and token exist)
  const hasVideoRoom = game?.get("roomUrl") && player?.get("dailyMeetingToken");
  const hasCompletedIntro = player?.get("introDone");

  // [DIAG] Full lobby snapshot every render: who am I, what game am I attached to,
  // am I admin, and the roster the client sees.
  console.log("[DIAG][lobby] render", {
    playerId: player?.id,
    gameID: player?.get("gameID"),
    lobbyGameId: game?.id,
    isWaitingGame: game?.get("isWaiting"),
    ended: player?.get("ended"),
    introDone: player?.get("introDone"),
    scenario: player?.get("scenario"),
    myGroupName,
    adminId,
    isAdmin,
    totalGroupMembers,
    canStartGame,
    rosterIds: Object.keys(waitingPlayersObj),
  });

  // [DIAG] Capture the exact moment the client's game attachment changes (or never
  // does). If gameID/lobbyGameId/isWaiting never change after Confirm, the
  // lobby→game transition is the failure.
  useEffect(() => {
    console.log("[DIAG][lobby] attachment changed", {
      playerId: player?.id,
      gameID: player?.get("gameID"),
      lobbyGameId: game?.id,
      isWaitingGame: game?.get("isWaiting"),
    });
  }, [player?.get("gameID"), game?.id, game?.get("isWaiting")]);

  // [DIAG] Mount/unmount of the lobby itself.
  useEffect(() => {
    console.log("[DIAG][lobby] CustomLobby MOUNTED", { playerId: player?.id });
    return () => console.log("[DIAG][lobby] CustomLobby UNMOUNTED", { playerId: player?.id });
  }, []);

  // Assignment modal state. Clicking Start opens the modal; the admin assigns
  // players to rooms by hand (or via Random Assign); Confirm sends the explicit
  // room→player mapping along with requestStart.
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);

  const openAssignmentModal = () => {
    console.log("[DIAG][lobby] openAssignmentModal click", {
      playerId: player?.id, isAdmin, hasGame: !!game, hasPlayer: !!player,
    });
    if (!isAdmin || !game || !player) {
      console.warn("[DIAG][lobby] openAssignmentModal BLOCKED - not admin or no game/player");
      return;
    }
    setShowAssignmentModal(true);
  };

  // `assignments` is an array (one entry per game room) of playerId arrays.
  // Players left unassigned are simply omitted — they stay in the lobby.
  const confirmStartGame = (assignments) => {
    console.log("[DIAG][lobby] confirmStartGame click", {
      playerId: player?.id, isAdmin, gameId: game?.id, gameID: player?.get("gameID"), assignments,
    });
    if (!isAdmin || !game || !player) {
      console.warn("[DIAG][lobby] confirmStartGame BLOCKED - not admin or no game/player");
      return;
    }

    const payload = { groupName: myGroupName, timestamp: Date.now(), assignments };
    console.log("[DIAG][lobby] setting requestStart", payload);

    // Set attribute on PLAYER instead of game (game attribute listeners don't work in Empirica)
    player.set("requestStart", payload);
    console.log("[DIAG][lobby] requestStart set, value now:", player.get("requestStart"));

    setShowAssignmentModal(false);
  };

  // Show a modal the first time this player transitions into admin
  // (e.g. when the previous admin is pruned by the presence sweep).
  const [showAdminModal, setShowAdminModal] = useState(false);
  const prevIsAdminRef = useRef(false);
  const adminInitializedRef = useRef(false);

  useEffect(() => {
    // Wait until we have both a resolved player and a known admin for the group.
    if (!player?.id || !adminId) return;

    if (!adminInitializedRef.current) {
      adminInitializedRef.current = true;
      prevIsAdminRef.current = isAdmin;
      return;
    }

    if (prevIsAdminRef.current === false && isAdmin === true) {
      setShowAdminModal(true);
    }
    prevIsAdminRef.current = isAdmin;
  }, [isAdmin, player?.id, adminId]);

  return (
    <div className="h-screen w-screen bg-gray-100 flex">
      <Heartbeat />
      {showAdminModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex justify-center mb-4">
              <Users className="w-12 h-12 text-green-500" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-semibold text-center text-gray-900 mb-2">
              You are now the group admin
            </h2>
            <p className="text-center text-gray-600 mb-6">
              You can start the game whenever your group is ready.
            </p>
            <button
              onClick={() => setShowAdminModal(false)}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {showAssignmentModal && (
        <AssignmentModal
          players={assignmentPlayers}
          playerCount={gamePlayerCount}
          onCancel={() => setShowAssignmentModal(false)}
          onConfirm={confirmStartGame}
        />
      )}
      {/* Left sidebar - Info */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col p-6 overflow-y-auto">
        {/* Group header */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Users className="w-10 h-10 text-blue-500" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">
            {myGroupName}
          </h1>
        </div>

        {/* Start button for admin */}
        {isAdmin && (
          <>
            <button
              onClick={openAssignmentModal}
              disabled={!canStartGame}
              className="w-full mb-6 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <Play className="w-5 h-5" />
              Start Game ({totalGroupMembers} player{totalGroupMembers !== 1 ? 's' : ''})
            </button>
            {!canStartGame && (
              <p className="text-xs text-amber-600 mb-4 -mt-4">
                Need at least 2 players to start
              </p>
            )}
          </>
        )}

        {/* Group members list */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Members ({groupMembers.length + 1})
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span>{player?.get("displayName") || "You"} (You){isAdmin && " - Admin"}</span>
            </div>
            {groupMembers.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span>{p.displayName || "Anonymous"}{p.id === adminId && " - Admin"}</span>
              </div>
            ))}
            {groupMembers.length === 0 && (
              <p className="text-xs text-gray-400 italic">
                Waiting for teammates...
              </p>
            )}
          </div>
        </div>

        {/* Waiting info */}
        <div className="text-sm text-gray-600 mb-6">
          <p className="mb-2">
            {isAdmin
              ? "Click 'Start Game' when everyone is ready."
              : adminName
                ? `Waiting for ${adminName} (group admin) to start the game.`
                : "Waiting for the group admin to start the game."}
          </p>
        </div>

      </div>

      {/* Main area - Video chat */}
      <div className="flex-1 p-4">
        {hasVideoRoom && hasCompletedIntro ? (
          <div className="h-full rounded-lg overflow-hidden">
            <VideoChat defaultHideSelf={false} filterPlayerIds={groupMemberIds} />
          </div>
        ) : (
          <div className="h-full bg-gray-200 rounded-lg flex items-center justify-center">
            <div className="text-center text-gray-500">
              <Video className="w-16 h-16 mx-auto mb-3 opacity-50" />
              <p className="text-lg">
                {!hasCompletedIntro
                  ? "Complete intro to enable video chat"
                  : "Setting up video room..."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact selectable token for a player sitting inside a room.
function RoomMemberToken({ player, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={
        "flex items-center gap-1.5 rounded-full pl-0.5 pr-2.5 py-0.5 border transition-colors " +
        (selected
          ? "border-blue-500 ring-2 ring-blue-400 bg-blue-50"
          : "border-gray-200 bg-white hover:bg-gray-100")
      }
    >
      <Avatar player={player} size="w-7 h-7 text-[10px]" />
      <span className="text-xs text-gray-800 max-w-[7rem] truncate">
        {player.displayName}
        {player.isSelf && " (You)"}
      </span>
    </button>
  );
}

// Manual assignment modal. The admin selects a player, then clicks a room (or
// the unassigned pool) to place them there. Rooms start empty; there are as
// many as could ever be needed — floor(N/2), since a game needs >= 2 players —
// so the admin can leave some empty if they want fewer/larger games. Anyone left
// in the unassigned pool simply stays in the lobby for this round. Random Assign
// auto-fills the rooms for review.
function AssignmentModal({ players, playerCount, onCancel, onConfirm }) {
  const roomCount = Math.max(1, Math.floor(players.length / 2));

  // assignments: { [playerId]: "g0" | "g1" | ... }. Missing = the unassigned
  // pool (stays in lobby).
  const [assignments, setAssignments] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  // When set, holds the shuffled roster awaiting the admin's answer to the
  // exact-vs-double-up question before Random Assign fills the rooms.
  const [pendingShuffle, setPendingShuffle] = useState(null);

  // Drop assignments for players who left, or for rooms that no longer exist
  // (the roster can change while the modal is open).
  useEffect(() => {
    const valid = (key) =>
      typeof key === "string" && key[0] === "g" && Number(key.slice(1)) < roomCount;
    setAssignments((prev) => {
      const next = {};
      let changed = false;
      for (const p of players) {
        if (prev[p.id] && valid(prev[p.id])) next[p.id] = prev[p.id];
      }
      for (const k of Object.keys(prev)) {
        if (next[k] !== prev[k]) changed = true;
      }
      if (Object.keys(next).length !== Object.keys(prev).length) changed = true;
      return changed ? next : prev;
    });
  }, [players, roomCount]);

  const place = (roomKey) => {
    if (!selectedId) return;
    setAssignments((prev) => ({ ...prev, [selectedId]: roomKey }));
    setSelectedId(null);
  };
  const unassignSelected = () => {
    if (!selectedId) return;
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
    setSelectedId(null);
  };
  const toggleSelect = (id) => setSelectedId((s) => (s === id ? null : id));

  const unassigned = players.filter((p) => !assignments[p.id]);
  const gameRooms = Array.from({ length: roomCount }, (_, i) =>
    players.filter((p) => assignments[p.id] === `g${i}`)
  );

  const startableGames = gameRooms.filter((g) => g.length >= 2);
  const hasUnderfilled = gameRooms.some((g) => g.length === 1);
  // Unassigned players are allowed — they simply stay in the lobby for this
  // round. The only hard requirements are at least one real game and no solo
  // game rooms.
  const canConfirm = startableGames.length >= 1 && !hasUnderfilled;

  const validationMessage = hasUnderfilled
    ? "Each game needs at least 2 players. Move or remove any solo player."
    : startableGames.length === 0
      ? "Put at least one game room together to start."
      : null;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(gameRooms.filter((g) => g.length >= 2).map((g) => g.map((p) => p.id)));
  };

  const applyResult = (result) => {
    const next = {};
    result.games.forEach((g, i) => g.forEach((p) => (next[p.id] = `g${i}`)));
    // Leftovers stay unassigned (no entry) — they remain in the lobby pool.
    setAssignments(next);
    setSelectedId(null);
    setPendingShuffle(null);
  };

  const runRandom = () => {
    const shuffled = shuffle(players);
    const exact = chunkExact(shuffled, playerCount);
    // Only ask the exact-vs-double-up question when it actually matters — i.e.
    // when the players don't divide evenly into games of the configured size.
    if (exact.leftovers.length > 0) {
      setPendingShuffle(shuffled);
    } else {
      applyResult(exact);
    }
  };

  const capacity = Math.max(2, playerCount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-[100px]">
      <div className="bg-white rounded-xl shadow-2xl w-full h-full flex flex-col">
        {/* Header: the instructions are the title, close X on the right */}
        <div className="flex items-start justify-between px-6 py-4 bg-blue-50 border-b border-blue-200 rounded-t-xl">
          <p className="text-2xl font-bold text-blue-900 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>To assign players:</span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-lg">1</span>
              click a player
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-lg">2</span>
              click a room
            </span>
          </p>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-blue-100 text-blue-700 flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 px-6 py-3 border-b border-gray-200 bg-gray-50">
          <span className="text-lg text-gray-900"><strong>Players per game:</strong> {playerCount}</span>
          <span className="text-lg text-gray-900"><strong>Total players:</strong> {players.length}</span>
        </div>

        {/* Body: unassigned pool + rooms */}
        <div className="flex-1 overflow-y-auto flex min-h-0">
          {/* Unassigned pool */}
          <div
            onClick={unassignSelected}
            className={
              "w-64 flex-shrink-0 border-r border-gray-200 p-4 overflow-y-auto " +
              (selectedId ? "cursor-pointer hover:bg-blue-50/40" : "")
            }
          >
            <button
              onClick={(e) => { e.stopPropagation(); runRandom(); }}
              className="w-full mb-4 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-lg shadow-sm transition-colors"
            >
              <Shuffle className="w-5 h-5" />
              Random Assign
            </button>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Unassigned ({unassigned.length})
            </h3>
            <div className="space-y-2">
              {unassigned.map((p) => (
                <div key={p.id} onClick={(e) => e.stopPropagation()}>
                  <PlayerChip
                    player={p}
                    selected={selectedId === p.id}
                    onClick={() => toggleSelect(p.id)}
                  />
                </div>
              ))}
              {unassigned.length === 0 && (
                <p className="text-xs text-gray-400 italic">Everyone is assigned.</p>
              )}
            </div>
          </div>

          {/* Rooms */}
          <div className="flex-1 p-4 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {gameRooms.map((members, idx) => {
                const overfilled = members.length > playerCount;
                const underfilled = members.length === 1;
                const emptySlots = Math.max(0, capacity - members.length);
                return (
                  <div
                    key={idx}
                    onClick={() => place(`g${idx}`)}
                    className={
                      "border rounded-lg p-3 bg-white transition-colors min-h-[5.5rem] " +
                      (selectedId
                        ? "cursor-pointer border-blue-300 hover:border-blue-500 hover:bg-blue-50/40 "
                        : "border-gray-200 ") +
                      (underfilled ? "ring-1 ring-amber-300" : "")
                    }
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Game {idx + 1}
                      </span>
                      <span className="text-xs text-gray-400">
                        {members.length}/{playerCount}
                        {overfilled && (
                          <span className="ml-1 text-amber-600">overfilled</span>
                        )}
                        {underfilled && (
                          <span className="ml-1 text-amber-600">needs 2+</span>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {members.map((p) => (
                        <RoomMemberToken
                          key={p.id}
                          player={p}
                          selected={selectedId === p.id}
                          onSelect={() => toggleSelect(p.id)}
                        />
                      ))}
                      {Array.from({ length: emptySlots }, (_, i) => (
                        <Avatar key={`e${i}`} empty />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-amber-600 min-h-[1rem]">{validationMessage}</p>
          <div className="flex gap-3 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Confirm and Start
            </button>
          </div>
        </div>
      </div>

      {pendingShuffle && (
        <RandomOptionsDialog
          onCancel={() => setPendingShuffle(null)}
          onExact={() => applyResult(chunkExact(pendingShuffle, playerCount))}
          onDoubleUp={() => applyResult(chunkOverfill(pendingShuffle, playerCount))}
        />
      )}
    </div>
  );
}

// Asked when Random Assign can't split everyone into evenly-sized games: either
// keep games exact (extras wait in the lobby) or double up roles so everyone
// gets into a game.
function RandomOptionsDialog({ onCancel, onExact, onDoubleUp }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          The players don't divide evenly
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Would you like to exactly match the number of people required for each
          game, or double up roles to get everyone into a game?
        </p>
        <div className="space-y-3">
          <button
            onClick={onExact}
            className="w-full text-left border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:bg-blue-50/40 transition-colors"
          >
            <div className="font-semibold text-gray-900">Exact match</div>
            <div className="text-sm text-gray-500 mt-0.5">
              Make full games only. Anyone left over waits in the lobby.
            </div>
          </button>
          <button
            onClick={onDoubleUp}
            className="w-full text-left border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:bg-blue-50/40 transition-colors"
          >
            <div className="font-semibold text-gray-900">Double up roles</div>
            <div className="text-sm text-gray-500 mt-0.5">
              Get everyone into a game by adding extra players to a group.
            </div>
          </button>
        </div>
        <div className="flex justify-end mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
