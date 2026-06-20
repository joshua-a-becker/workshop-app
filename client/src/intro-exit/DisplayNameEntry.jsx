import React, { useState, useEffect, useContext, useRef } from "react";
import { Button } from "../components/Button.jsx";
import { MediaPermissionGate } from "../components/MediaPermissionGate.jsx";
import { DailyCallContext } from "../App.jsx";

import { usePlayer } from "@empirica/core/player/classic/react";

export function DisplayNameEntry({ next }) {
  const { setMediaStream } = useContext(DailyCallContext);

  const player = usePlayer();

  const urlParams = new URLSearchParams(window.location.search);

  // Display name from URL (?displayName=john+smith). URLSearchParams already
  // decodes "+" and "%20" to spaces, so no manual decoding is needed.
  const urlDisplayName = (urlParams.get("displayName") || "").trim();
  const urlDisplayNameValid =
    urlDisplayName.length >= 2 && urlDisplayName.length <= 20;

  // Pre-fill the input with the URL value (if any). If it's valid we auto-submit
  // once camera/mic permission is granted; if it's present but invalid we just
  // show the pre-filled form with normal validation.
  const [displayName, setDisplayName] = useState(urlDisplayName);
  const [error, setError] = useState("");
  const autoSubmittedRef = useRef(false);

  // Extract all URL parameters except participantKey
  // Note: This runs on every render but Empirica handles duplicates gracefully
  for (const [key, value] of urlParams.entries()) {
    if (key !== "participantKey") {
      player.set(key, value);
      console.log("[DisplayNameEntry] setting " + key + " : " + value)
    }
  }

  // Explicitly ensure groupName is set (critical for group filtering)
  const groupNameFromUrl = urlParams.get("groupName");
  if (groupNameFromUrl && player.get("groupName") !== groupNameFromUrl) {
    player.set("groupName", groupNameFromUrl);
    console.log("[DisplayNameEntry] Explicitly set groupName:", groupNameFromUrl);
  }


  // Get stored device IDs if they exist (for page refresh)
  const storedVideoDeviceId = player?.get("videoDeviceId");
  const storedAudioDeviceId = player?.get("audioDeviceId");

  console.log("student ID: " + player.get("studentId"))

  const handleSubmit = () => {
    if (!displayName.trim()) {
      setError("Please enter a display name");
      return;
    }

    if (displayName.trim().length < 2) {
      setError("Display name must be at least 2 characters");
      return;
    }

    if (displayName.trim().length > 20) {
      setError("Display name must be 20 characters or less");
      return;
    }

    // Save display name to player data
    player.set("displayName", displayName.trim());
    next();
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  // Handle permissions granted with device IDs
  const handlePermissionsGranted = (stream, videoDeviceId, audioDeviceId) => {
    setMediaStream(stream);

    // Store device IDs in player data for later use
    if (videoDeviceId) {
      player.set("videoDeviceId", videoDeviceId);
    }
    if (audioDeviceId) {
      player.set("audioDeviceId", audioDeviceId);
    }

    // If a valid display name was supplied in the URL, auto-submit this step now
    // that media permission is granted (the mediaStream is needed downstream).
    if (urlDisplayNameValid && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      player.set("displayName", urlDisplayName);
      next();
    }
  };

  return (
    <MediaPermissionGate
      onPermissionsGranted={handlePermissionsGranted}
      storedVideoDeviceId={storedVideoDeviceId}
      storedAudioDeviceId={storedAudioDeviceId}
    >
      <div className="mt-3 sm:mt-5 p-10 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          Welcome to the Study!
        </h2>

        <div className="text-sm text-gray-700 space-y-4 mb-8">
          <p>
            Before we begin, we'd like you to choose a display name that will be visible to your teammates during the video calls.
          </p>
          <p>
            <strong>Please enter a display name, e.g. your first name.</strong>
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
              Display Name
            </label>
            <input
              type="text"
              id="displayName"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setError(""); // Clear error when user types
              }}
              onKeyPress={handleKeyPress}
              placeholder="Enter your display name..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={20}
              autoFocus
            />
            {error && (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
          </div>

          <div className="text-center pt-4">
            <Button handleClick={handleSubmit}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </MediaPermissionGate>
  );
}