import React, { useState, useEffect, useContext, useMemo, useRef } from "react";
import { Users, Video, Play, X, User, AlertTriangle } from "lucide-react";
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

// Two user-facing modes. A third "balanced" option exists in theory but is
// redundant: when the configured size > 2 it produces the same result as
// Inclusive; when the size == 2 it produces the same result as Exact.
const ASSIGNMENT_MODES = [
  {
    id: "exact",
    label: "Exact Groups Only",
    summary: "Odd numbers excluded",
    description:
      "Creates as many full groups of the configured size as possible. Extras stay in the lobby.",
    chunk: chunkExact,
  },
  {
    id: "overfill",
    label: "Inclusive",
    summary: "Everybody Assigned",
    description:
      "Assigns all players to a group. Uses partial or overfilled groups when needed.",
    chunk: chunkOverfill,
  },
];

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

  // Check if video chat is available (room URL and token exist)
  const hasVideoRoom = game?.get("roomUrl") && player?.get("dailyMeetingToken");
  const hasCompletedIntro = player?.get("introDone");

  // Assignment-mode modal state. Clicking Start opens the modal; the admin
  // picks a mode; Confirm sends the mode along with requestStart.
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedMode, setSelectedMode] = useState("overfill");

  const openAssignmentModal = () => {
    if (!isAdmin || !game || !player) {
      console.warn("[CustomLobby] Cannot start - not admin or no game/player");
      return;
    }
    setShowAssignmentModal(true);
  };

  const confirmStartGame = (mode) => {
    if (!isAdmin || !game || !player) return;

    console.log("[CustomLobby] Setting requestStart on player:", {
      playerId: player.id,
      groupName: myGroupName,
      mode,
    });

    // Set attribute on PLAYER instead of game (game attribute listeners don't work in Empirica)
    player.set("requestStart", {
      groupName: myGroupName,
      timestamp: Date.now(),
      mode,
    });

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
        <AssignmentModeModal
          totalPlayers={totalGroupMembers}
          playerCount={gamePlayerCount}
          selectedMode={selectedMode}
          onSelectMode={setSelectedMode}
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

function AssignmentModeModal({
  totalPlayers,
  playerCount,
  selectedMode,
  onSelectMode,
  onCancel,
  onConfirm,
}) {
  const activeMode =
    ASSIGNMENT_MODES.find(m => m.id === selectedMode) || ASSIGNMENT_MODES[0];

  // Anonymous placeholder array: assignment is intentionally random, so the
  // admin only sees head counts, not who goes where.
  const anonMembers = useMemo(
    () => Array.from({ length: totalPlayers }, (_, i) => ({ id: i })),
    [totalPlayers]
  );
  const preview = useMemo(
    () => activeMode.chunk(anonMembers, playerCount),
    [activeMode, anonMembers, playerCount]
  );

  const gameCount = preview.games.length;
  const leftoverCount = preview.leftovers.length;
  const summary =
    gameCount === 0
      ? `No games created — all ${leftoverCount} players stay in the lobby.`
      : `${gameCount} game${gameCount === 1 ? "" : "s"}` +
        (leftoverCount > 0
          ? ` · ${leftoverCount} stay${leftoverCount === 1 ? "s" : ""} in lobby`
          : " · everyone plays");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">
              How should we split the group?
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {totalPlayers} player{totalPlayers === 1 ? "" : "s"} waiting · max game size is {playerCount}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {ASSIGNMENT_MODES.map(mode => {
            const active = mode.id === selectedMode;
            return (
              <button
                key={mode.id}
                onClick={() => onSelectMode(mode.id)}
                className={
                  "flex-1 px-4 py-3 text-sm font-medium transition-colors " +
                  (active
                    ? "text-blue-700 border-b-2 border-blue-600 bg-blue-50"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-b-2 border-transparent")
                }
              >
                <div>{mode.label}</div>
                <div className={"text-xs mt-0.5 " + (active ? "text-blue-600" : "text-gray-400")}>
                  {mode.summary}
                </div>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-sm text-gray-700 mb-4">{activeMode.description}</p>

          <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-800">
            {summary}
          </div>

          {gameCount > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {preview.games.map((g, idx) => (
                <div
                  key={idx}
                  className="border border-gray-200 rounded-lg p-3 bg-white"
                >
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Game {idx + 1}
                    {g.length > playerCount && (
                      <span className="ml-1 text-amber-600 normal-case tracking-normal">(overfilled)</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {g.map((_, i) => (
                      <User
                        key={i}
                        className="w-6 h-6 text-green-600"
                        strokeWidth={1.75}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {leftoverCount > 0 && (
            <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                Staying in Lobby
              </div>
              <div className="flex flex-wrap gap-1">
                {preview.leftovers.map((_, i) => (
                  <User
                    key={i}
                    className="w-6 h-6 text-amber-600"
                    strokeWidth={1.75}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedMode)}
            disabled={gameCount === 0}
            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Confirm and Start
          </button>
        </div>
      </div>
    </div>
  );
}
