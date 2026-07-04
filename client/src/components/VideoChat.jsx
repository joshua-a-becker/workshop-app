import React, { useEffect, useRef, useState, useContext } from "react";
import { usePlayer, usePlayers, useGame } from "@empirica/core/player/classic/react";
import { DailyCallContext } from "../App";
import { VolumeX, MicOff, VideoOff, Video } from "lucide-react";

// Layout constants for the best-fit grid search: the grid's gap (gap-2 = 8px)
// and the vertical space each tile spends on its name row under the video.
const GRID_GAP = 8;
const TILE_LABEL_H = 36;

// Memoized components outside the main component to prevent recreation
const LocalVideoComponent = React.memo(({ localVideoRef, displayName, isHidden, onToggleHide, isAudioEnabled, isVideoEnabled, onToggleAudio, onToggleVideo }) => {

  return (
    <div className="w-full h-full flex flex-col items-center justify-center py-1">
      <div className="flex flex-col items-center justify-center w-full h-full relative">
        {/* Video container with controls */}
        <div className="relative w-full max-w-[640px] max-h-[75%] aspect-video mx-auto">
          {/* Video element - ALWAYS rendered for Daily.co stream continuity */}
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={isHidden ? 'hidden' : 'w-full h-full border border-black rounded object-cover'}
          />

          {/* Camera Off Overlay - shown when camera is disabled */}
          {!isHidden && !isVideoEnabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded">
              <div className="flex flex-col items-center text-white">
                {/* Camera off icon */}
                <VideoOff className="h-5 w-5 text-white" />
                <span className="text-sm">Camera Off</span>
              </div>
            </div>
          )}

          {/* Audio/Video toggle buttons - positioned at bottom center inside video */}
          {!isHidden && (
            <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-2">
            {/* Microphone toggle */}
            <button
              onClick={onToggleAudio}
              className={`p-2 rounded-full ${isAudioEnabled ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-500'} text-white transition-colors`}
              title={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {isAudioEnabled ? (
                // Microphone icon
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              ) : (
                // Microphone muted icon
                <MicOff className="h-5 w-5 text-white" />
              )}
            </button>

            {/* Camera toggle */}
            <button
              onClick={onToggleVideo}
              className={`p-2 rounded-full ${isVideoEnabled ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-500'} text-white transition-colors`}
              title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {isVideoEnabled ? (
                // Video camera icon
                <Video className="h-5 w-5 text-white" />
              ) : (
                // Video camera off icon
                <VideoOff className="h-5 w-5 text-white" />
              )}
            </button>
            </div>
          )}
        </div>

        {isHidden && (
          <>
            <div className="w-full mb-2 border border-black"> 
              <div className="bg-gray-200 border border-gray-400 rounded px-3 py-1 flex items-center justify-center gap-2"> 
                <span style={{color:"red"}}>Recording ●</span>
                <button
                  onClick={onToggleHide}
                  className="text-gray-600 hover:text-black cursor-pointer"
                >
                  Show Self ▼
                </button>
              </div>
            </div>
          </>
        )}

        {/* Name/rep text - always visible */}
        <div className="mt-1 text-[clamp(0.75rem,10vh,1rem)] font-semibold">
          {displayName} (You)
          {!isHidden && (
            <>
              {" "}
              <span style={{color:"red"}}>●</span>
              {" "}
              <button
                onClick={onToggleHide}
                className="text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                Hide Self ▲
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - check all props
  return (
    prevProps.localVideoRef === nextProps.localVideoRef &&
    prevProps.displayName === nextProps.displayName &&
    prevProps.isHidden === nextProps.isHidden &&
    prevProps.onToggleHide === nextProps.onToggleHide &&
    prevProps.isAudioEnabled === nextProps.isAudioEnabled &&
    prevProps.isVideoEnabled === nextProps.isVideoEnabled &&
    prevProps.onToggleAudio === nextProps.onToggleAudio &&
    prevProps.onToggleVideo === nextProps.onToggleVideo
  );
});

const RemoteVideoComponent = React.memo(({ stream, name, sessionId, onRequestRefresh, videoState, audioState }) => {
  const ref = useRef();
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  useEffect(() => {
    const videoTrack = stream ? stream.getVideoTracks()[0] : null;
    const videoReadyState = videoTrack ? videoTrack.readyState : null;

    // Detect bad state: has stream but video track readyState is null
    if (stream && videoTrack && videoReadyState === null && retryCountRef.current < maxRetries) {
      retryCountRef.current += 1;

      // Wait a bit before requesting refresh to avoid rapid retries
      const timer = setTimeout(() => {
        if (onRequestRefresh) {
          onRequestRefresh(sessionId);
        }
      }, 2000);

      return () => clearTimeout(timer);
    }

    // Reset retry count if we get a good state
    if (videoReadyState === 'live') {
      retryCountRef.current = 0;
    }

    if (ref.current && stream && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
    }
  }, [stream, name, sessionId, onRequestRefresh]);

  const isVideoOff = videoState === "off" || videoState === "blocked";
  const isAudioOff = audioState === "off" || audioState === "blocked";



  return (
    <div className="w-full h-full flex flex-col items-center justify-center py-1">
      <div className="flex flex-col items-center justify-center w-full h-full">
        {/* Video container with overlays */}
        <div className="relative w-full max-w-[640px] max-h-[75%] aspect-video mx-auto">
          <video
            ref={ref}
            autoPlay
            playsInline
            className="w-full h-full border border-blue-500 rounded object-cover"
          />

          {/* Camera Off Overlay */}
          {isVideoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded">
              <div className="flex flex-col items-center text-white">
                {/* Camera off icon */}
                <VideoOff className="h-5 w-5 text-white" />
                <span className="text-sm">Camera Off</span>
              </div>
            </div>
          )}

          {/* Muted Microphone Icon - bottom left corner */}
          {isAudioOff && (
            <div className="absolute bottom-3 left-3 bg-red-600 rounded-full p-2 shadow-lg" title="Microphone muted">
<VolumeX className="h-5 w-5 text-white" />

            </div>
          )}
        </div>

        <div className="mt-1 text-[clamp(0.5rem,10vw,1rem)] font-semibold text-center">{name}</div>
      </div>
    </div>
  );
});

  const RemoteVideosComponent = React.memo(({ allDailyParticipants, remoteStreams, participantNames, participantVideoStates, participantAudioStates, onRequestRefresh }) => {

  const hasRemoteParticipants = Object.keys(allDailyParticipants).length > 0;

  return (
    <div className="flex flex-col justify-center gap-2 h-full w-full">
      {!hasRemoteParticipants ? (
        <div className="flex items-center justify-center h-full w-full text-gray-500">
          Remote participants loading...
        </div>
      ) : (
        Object.entries(allDailyParticipants).map(([sessionId, participant]) => {
          const stream = remoteStreams[sessionId];
          const name = participantNames[sessionId] || participant.userData?.displayName || "Participant";
          const videoState = participantVideoStates[sessionId] || participant.tracks?.video?.state || "unknown";
          const audioState = participantAudioStates[sessionId] || participant.tracks?.audio?.state || "unknown";

          return (
            <div key={sessionId} className="flex-1 min-h-0 w-full">
              <RemoteVideoComponent
                stream={stream}
                name={name}
                sessionId={sessionId}
                onRequestRefresh={onRequestRefresh}
                videoState={videoState}
                audioState={audioState}
              />
            </div>
          );
        })
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    Object.keys(prevProps.allDailyParticipants).length === Object.keys(nextProps.allDailyParticipants).length &&
    Object.keys(prevProps.remoteStreams).length === Object.keys(nextProps.remoteStreams).length &&
    Object.keys(prevProps.participantNames).length === Object.keys(nextProps.participantNames).length &&
    Object.keys(prevProps.participantVideoStates).length === Object.keys(nextProps.participantVideoStates).length &&
    Object.keys(prevProps.participantAudioStates).length === Object.keys(nextProps.participantAudioStates).length &&
    Object.keys(prevProps.allDailyParticipants).every(id =>
      prevProps.allDailyParticipants[id] === nextProps.allDailyParticipants[id]
    ) &&
    Object.keys(prevProps.remoteStreams).every(id =>
      prevProps.remoteStreams[id] === nextProps.remoteStreams[id]
    ) &&
    Object.keys(prevProps.participantNames).every(id =>
      prevProps.participantNames[id] === nextProps.participantNames[id]
    ) &&
    Object.keys(prevProps.participantVideoStates).every(id =>
      prevProps.participantVideoStates[id] === nextProps.participantVideoStates[id]
    ) &&
    Object.keys(prevProps.participantAudioStates).every(id =>
      prevProps.participantAudioStates[id] === nextProps.participantAudioStates[id]
    )
  );
});

// filterPlayerIds: optional Set of player IDs to show (if provided, only show these participants)
export function VideoChat({ defaultHideSelf = false, filterPlayerIds = null }) {
  const localVideoRef = useRef();
  const player = usePlayer();
  const players = usePlayers();
  const game = useGame();

  // Get Daily.co context
  const {
    mediaStream,
    setMediaStream,
    callObject,
    callState,
    registerCallData,
    setCallState,
    refreshRemoteParticipant,
    isAudioEnabled,
    setIsAudioEnabled,
    isVideoEnabled,
    setIsVideoEnabled,
    setIsVideoChatMounted,
  } = useContext(DailyCallContext);

  const roomUrl = game?.get("roomUrl");
  const meetingToken = player?.get("dailyMeetingToken");
  const [isSelfVideoHidden, setIsSelfVideoHidden] = useState(defaultHideSelf);

  // Track all Daily.co participants (not just those with streams)
  const [allDailyParticipants, setAllDailyParticipants] = useState({});

  // Measured size of the video grid container — drives the best-fit layout.
  // Callback ref (not useRef) because the grid div only mounts after the
  // loading states resolve, and the observer must attach when it appears.
  const [containerEl, setContainerEl] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!containerEl) return;
    const update = () =>
      setContainerSize({ width: containerEl.clientWidth, height: containerEl.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  // Get local player info
  const localDisplayName = player?.get("displayName") || "You";

  // Destructure call state from context
  const { remoteStreams, participantNames, participantVideoStates, participantAudioStates, localVideoTrack } = callState;

  // Ensure media stream is available (handles page refresh after intro)
  // VideoChat only mounts when user is in game stages (past intro/DisplayNameEntry)
  const hasRequestedMediaRef = useRef(false);
  useEffect(() => {
    if (mediaStream || hasRequestedMediaRef.current) {
      return;
    }

    hasRequestedMediaRef.current = true;

    const requestMedia = async () => {
      try {
        // console.log("VideoChat: Requesting media stream (page refresh scenario)");

        // Try to use stored device IDs if available
        const storedVideoDeviceId = player?.get("videoDeviceId");
        const storedAudioDeviceId = player?.get("audioDeviceId");

        const constraints = {
          video: storedVideoDeviceId ? { deviceId: { exact: storedVideoDeviceId } } : true,
          audio: storedAudioDeviceId ? { deviceId: { exact: storedAudioDeviceId } } : true
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setMediaStream(stream);
        // console.log("VideoChat: Media stream acquired");
      } catch (err) {
        console.error("VideoChat: Failed to get media stream:", err);
        // If specific devices fail, try with defaults
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
          setMediaStream(stream);
          console.log("VideoChat: Media stream acquired with default devices");
        } catch (fallbackErr) {
          console.error("VideoChat: Failed to get media stream with defaults:", fallbackErr);
        }
      }
    };

    requestMedia();
  }, [mediaStream, setMediaStream, player]);

  // Toggle function for hiding/showing self video
  const toggleSelfVideoVisibility = () => {
    setIsSelfVideoHidden(!isSelfVideoHidden);
  };

  // Toggle functions for audio/video
  const toggleAudio = () => {
    const newValue = !isAudioEnabled;
    setIsAudioEnabled(newValue);

    // Save state to player
    player?.set("audioEnabled", newValue);

    // Append to history
    const existingHistory = player?.get("audioHistory") || [];
    const newHistory = [...existingHistory, [newValue ? "on" : "off", Date.now()]];
    player?.set("audioHistory", newHistory);
  };

  const toggleVideo = () => {
    const newValue = !isVideoEnabled;
    setIsVideoEnabled(newValue);

    // Save state to player
    player?.set("videoEnabled", newValue);

    // Append to history
    const existingHistory = player?.get("videoHistory") || [];
    const newHistory = [...existingHistory, [newValue ? "on" : "off", Date.now()]];
    player?.set("videoHistory", newHistory);
  };

  // Signal mount/unmount to App.jsx and restore saved audio/video states
  useEffect(() => {
    setIsVideoChatMounted(true);

    // Read saved states from player, default to true if not set (first time)
    const savedAudioEnabled = player?.get("audioEnabled");
    const savedVideoEnabled = player?.get("videoEnabled");

    const audioEnabled = savedAudioEnabled !== undefined ? savedAudioEnabled : true;
    const videoEnabled = savedVideoEnabled !== undefined ? savedVideoEnabled : true;

    // If this is first time (no saved state), save the defaults
    if (savedAudioEnabled === undefined) {
      player?.set("audioEnabled", true);
      player?.set("audioHistory", [["on", Date.now()]]);
    }
    if (savedVideoEnabled === undefined) {
      player?.set("videoEnabled", true);
      player?.set("videoHistory", [["on", Date.now()]]);
    }

    // Apply the states (will enable tracks via App.jsx effect)
    setIsAudioEnabled(audioEnabled);
    setIsVideoEnabled(videoEnabled);

    return () => {
      setIsVideoChatMounted(false);
    };
  }, [setIsVideoChatMounted, setIsAudioEnabled, setIsVideoEnabled, player]);

  // Register call data with App.jsx when available (only once or when critical data changes)
  useEffect(() => {
    if (roomUrl && meetingToken && player && game && registerCallData) {
      // console.log("VideoChat: Registering call data with App.jsx");
      // Get current values at registration time
      // Only pass data needed for Daily.co join: roomUrl, token, displayName, participantIdentifier
      const currentDisplayName = player.get("displayName") || "You";
      const currentParticipantIdentifier = player.get("participantIdentifier");

      registerCallData({
        roomUrl,
        meetingToken,
        displayName: currentDisplayName,
        participantIdentifier: currentParticipantIdentifier,
      });
    }
    // Only re-register if critical join data changes (roomUrl, token)
    // Note: displayName should not change during a game session
  }, [roomUrl, meetingToken, player, game, registerCallData]);

  // Set local video track when available
  useEffect(() => {
    // Use localVideoTrack from Daily.co if available, otherwise use mediaStream directly
    if (localVideoRef.current) {
      if (localVideoTrack) {
        localVideoRef.current.srcObject = new MediaStream([localVideoTrack]);
      } else if (mediaStream) {
        // Fallback: use the original mediaStream video track
        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack) {
          localVideoRef.current.srcObject = new MediaStream([videoTrack]);
        }
      }
    }
  }, [localVideoTrack, mediaStream, isVideoEnabled]);


  // Poll Daily.co for all participants (including those without tracks)
  useEffect(() => {
    if (!callObject || !player) return;

    const updateAllParticipants = () => {
      try {
        const participants = callObject.participants();
        if (!participants) return;

        const localPlayerId = player.id;

        // First pass: group by user_id and filter out local
        const participantsByUserId = {};
        Object.entries(participants).forEach(([sessionId, participant]) => {
          // Filter out local participant by session, local flag, AND user_id
          if (sessionId !== "local" &&
              !participant.local &&
              participant.user_id !== localPlayerId) {

            const userId = participant.user_id;
            if (!participantsByUserId[userId]) {
              participantsByUserId[userId] = [];
            }
            participantsByUserId[userId].push({ sessionId, participant });
          }
        });

        // Second pass: deduplicate by user_id, prioritizing most recent session with playable tracks
        const remoteParticipants = {};
        Object.entries(participantsByUserId).forEach(([userId, sessions]) => {
          let selectedSession = sessions[0]; // Default to first session

          if (sessions.length > 1) {
            // Filter sessions with playable tracks
            const sessionsWithTracks = sessions.filter(({ participant }) => {
              const hasPlayableVideo = participant.tracks?.video?.state === "playable";
              const hasPlayableAudio = participant.tracks?.audio?.state === "playable";
              return hasPlayableVideo || hasPlayableAudio;
            });

            // If we have sessions with tracks, use the most recent one
            if (sessionsWithTracks.length > 0) {
              sessionsWithTracks.sort((a, b) => {
                const timeA = a.participant.joined_at ? new Date(a.participant.joined_at).getTime() : 0;
                const timeB = b.participant.joined_at ? new Date(b.participant.joined_at).getTime() : 0;
                return timeB - timeA; // Descending - most recent first
              });
              selectedSession = sessionsWithTracks[0];
            } else {
              // No sessions with tracks, use most recent session anyway
              sessions.sort((a, b) => {
                const timeA = a.participant.joined_at ? new Date(a.participant.joined_at).getTime() : 0;
                const timeB = b.participant.joined_at ? new Date(b.participant.joined_at).getTime() : 0;
                return timeB - timeA; // Descending - most recent first
              });
              selectedSession = sessions[0];
            }
          }

          remoteParticipants[selectedSession.sessionId] = selectedSession.participant;
        });

        setAllDailyParticipants(remoteParticipants);
      } catch (error) {
        console.error("[VideoChat] Error getting participants:", error);
      }
    };

    // Update immediately
    updateAllParticipants();

    // Poll every 2 seconds to catch participants with no tracks
    const intervalId = setInterval(updateAllParticipants, 2000);

    return () => clearInterval(intervalId);
  }, [callObject, player]);

  window.player=player;

  // Pick the column count that yields the largest possible 16:9 video per tile
  // in the measured container — a tall narrow panel stacks, a wide one goes
  // side-by-side. Falls back to a single column before the first measurement.
  const calculateGridLayout = (totalParticipants, width, height) => {
    if (totalParticipants <= 1 || !width || !height) return { cols: 1 };
    let best = { cols: 1, size: 0 };
    for (let cols = 1; cols <= totalParticipants; cols++) {
      const rows = Math.ceil(totalParticipants / cols);
      const cellW = (width - GRID_GAP * (cols - 1)) / cols;
      const cellH = (height - GRID_GAP * (rows - 1)) / rows - TILE_LABEL_H;
      if (cellW <= 0 || cellH <= 0) continue;
      const videoW = Math.min(cellW, cellH * (16 / 9));
      if (videoW > best.size) best = { cols, size: videoW };
    }
    return best;
  };

  // Show loading state while room is being created, token is being generated, or media stream is being set up
  if (!roomUrl || !meetingToken) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
          <p className="text-gray-600">Preparing video call...</p>
        </div>
      </div>
    );
  }

  if (!mediaStream) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
          <p className="text-gray-600">Waiting for media stream... you may need to refresh your browser page.</p>
        </div>
      </div>
    );
  }


  // Filter remote participants
  const filteredParticipants = Object.entries(allDailyParticipants)
    .filter(([sessionId, participant]) => {
      // If no filter provided, show all
      if (!filterPlayerIds) return true;
      // Check if participant's user_id is in the filter set
      const participantPlayerId = participant.user_id;
      return filterPlayerIds.has(participantPlayerId);
    });

  // Calculate grid layout (local + remote participants)
  const totalParticipants = 1 + filteredParticipants.length;
  const { cols } = calculateGridLayout(totalParticipants, containerSize.width, containerSize.height);

  // Double the columns into half-columns so a partial last row can be
  // centered with a half-column offset. Each tile spans 2 half-columns.
  const partial = totalParticipants % cols;
  const firstPartialIndex = partial > 0 ? totalParticipants - partial : -1;
  const partialOffset = partial > 0 ? cols - partial : 0;
  const tileStyle = (index) =>
    index === firstPartialIndex
      ? { gridColumn: `${partialOffset + 1} / span 2` }
      : { gridColumn: 'span 2' };

  return (
    <div
      ref={setContainerEl}
      className="grid gap-2 h-full w-full overflow-hidden p-2"
      style={{
        gridTemplateColumns: `repeat(${cols * 2}, 1fr)`,
        gridAutoRows: '1fr',
      }}
    >
      {/* Local Video */}
      <div className="min-h-0 overflow-hidden" style={tileStyle(0)}>
        <LocalVideoComponent
          localVideoRef={localVideoRef}
          displayName={localDisplayName}
          isHidden={isSelfVideoHidden}
          onToggleHide={toggleSelfVideoVisibility}
          isAudioEnabled={isAudioEnabled}
          isVideoEnabled={isVideoEnabled}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
        />
      </div>

      {/* Remote Videos */}
      {filteredParticipants.map(([sessionId, participant], idx) => {
        const stream = remoteStreams[sessionId];
        const name = participantNames[sessionId] || participant.userData?.displayName || "Participant";
        const videoState = participantVideoStates[sessionId] || participant.tracks?.video?.state || "unknown";
        const audioState = participantAudioStates[sessionId] || participant.tracks?.audio?.state || "unknown";

        return (
          <div key={sessionId} className="min-h-0 overflow-hidden" style={tileStyle(idx + 1)}>
            <RemoteVideoComponent
              stream={stream}
              name={name}
              sessionId={sessionId}
              onRequestRefresh={refreshRemoteParticipant}
              videoState={videoState}
              audioState={audioState}
            />
          </div>
        );
      })}
    </div>
  );
}