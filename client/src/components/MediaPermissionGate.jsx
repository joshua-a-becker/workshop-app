import React, { useEffect, useState, useRef } from "react";

export function MediaPermissionGate({ children, onPermissionsGranted, storedVideoDeviceId, storedAudioDeviceId }) {
  const [hasMediaPermissions, setHasMediaPermissions] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showQuitConfirmation, setShowQuitConfirmation] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [mediaStream, setMediaStream] = useState(null);
  const [showPrePermissionModal, setShowPrePermissionModal] = useState(false);
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState(storedVideoDeviceId || "");
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(storedAudioDeviceId || "");
  const previewVideoRef = useRef(null);

  // Check if permissions are already granted AND stream exists in state
  const checkExistingPermissions = async () => {
    // Always request if we don't have a stream stored
    if (!mediaStream) {
      console.log("No media stream in state, requesting permissions");
      return false;
    }

    if (!navigator.mediaDevices?.enumerateDevices) {
      // Fallback for browsers without enumerateDevices
      console.log("enumerateDevices not supported, checking via getUserMedia");
      return false;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideoDevice = devices.some(device =>
        device.kind === 'videoinput' && device.label !== ''
      );
      const hasAudioDevice = devices.some(device =>
        device.kind === 'audioinput' && device.label !== ''
      );

      // If both have labels, permissions are already granted
      return hasVideoDevice && hasAudioDevice;
    } catch (err) {
      console.error("Error checking existing permissions:", err);
      return false;
    }
  };

  // Enumerate available devices
  const enumerateDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      setVideoDevices(videoInputs);
      setAudioDevices(audioInputs);

      // Set default selections if not already set
      if (!selectedVideoDevice && videoInputs.length > 0) {
        setSelectedVideoDevice(videoInputs[0].deviceId);
      }
      if (!selectedAudioDevice && audioInputs.length > 0) {
        setSelectedAudioDevice(audioInputs[0].deviceId);
      }

      return { videoInputs, audioInputs };
    } catch (err) {
      console.error("Error enumerating devices:", err);
      return { videoInputs: [], audioInputs: [] };
    }
  };

  // Request initial permission (to get device list)
  const requestInitialPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      // Store temporary stream
      setMediaStream(stream);
      console.log("Initial permission granted, enumerating devices");

      // Now enumerate devices (labels will be available after permission)
      await enumerateDevices();

      // Show device selector
      setShowPrePermissionModal(false);
      setShowDeviceSelector(true);
      setIsChecking(false);

    } catch (err) {
      console.error("Media permissions denied:", err);
      setPermissionDenied(true);
      setShowPrePermissionModal(false);
      setIsChecking(false);
    }
  };

  // Create stream with selected devices
  const createStreamWithSelectedDevices = async () => {
    try {
      // Stop existing stream tracks
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : true,
        audio: selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setMediaStream(stream);
      console.log("Media stream created with selected devices");

      setHasMediaPermissions(true);
      setShowDeviceSelector(false);

      if (onPermissionsGranted) {
        onPermissionsGranted(stream, selectedVideoDevice, selectedAudioDevice);
      }
    } catch (err) {
      console.error("Failed to create stream with selected devices:", err);
      alert("Failed to access selected devices. Please try again.");
    }
  };

  // Initial check on mount
  const checkPermissionsOnMount = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      console.log("getUserMedia not supported, assuming permissions");
      setHasMediaPermissions(true);
      setIsChecking(false);
      if (onPermissionsGranted) onPermissionsGranted();
      return;
    }

    // Check if we have stored device IDs (page refresh scenario)
    if (storedVideoDeviceId && storedAudioDeviceId) {
      console.log("Found stored device IDs, attempting to use them");
      try {
        const constraints = {
          video: { deviceId: { exact: storedVideoDeviceId } },
          audio: { deviceId: { exact: storedAudioDeviceId } }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setMediaStream(stream);
        console.log("Media stream re-acquired with stored devices");
        setHasMediaPermissions(true);
        setIsChecking(false);
        if (onPermissionsGranted) onPermissionsGranted(stream, storedVideoDeviceId, storedAudioDeviceId);
        return;
      } catch (err) {
        console.error("Failed to use stored devices, will show modal:", err);
        // Fall through to show modal
      }
    }

    // First check if permissions are already granted
    const alreadyGranted = await checkExistingPermissions();
    if (alreadyGranted && mediaStream) {
      console.log("Permissions already granted and stream exists");
      setHasMediaPermissions(true);
      setIsChecking(false);
      if (onPermissionsGranted) onPermissionsGranted(mediaStream);
      return;
    }

    // Show pre-permission modal
    setShowPrePermissionModal(true);
    setIsChecking(false);
  };

  useEffect(() => {
    checkPermissionsOnMount();
  }, []);

  // Update preview when video device changes
  useEffect(() => {
    if (showDeviceSelector && selectedVideoDevice && previewVideoRef.current) {
      const updatePreview = async () => {
        try {
          // Stop existing preview tracks
          if (previewVideoRef.current.srcObject) {
            const tracks = previewVideoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
          }

          const previewStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedVideoDevice } },
            audio: false
          });

          previewVideoRef.current.srcObject = previewStream;
        } catch (err) {
          console.error("Failed to update preview:", err);
        }
      };
      updatePreview();
    }
  }, [selectedVideoDevice, showDeviceSelector]);

  // Show loading state while checking
  if (isChecking) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
          <p className="text-gray-600">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Show children if permissions granted
  if (hasMediaPermissions) {
    return <>{children}</>;
  }

  // Show modals
  return (
    <>
      {/* Pre-Permission Informational Modal */}
      {showPrePermissionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md">
            <h2 className="text-xl font-bold mb-4">Camera and Microphone Access Required</h2>
            <p className="mb-4">
              This activity requires access to your camera and microphone for video collaboration with your team.
            </p>
            <p className="mb-4">
              When you click "Continue", your browser will ask for permission to access your camera and microphone.
              Please click "Allow" to proceed.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
              <p className="text-sm font-semibold mb-2">What happens next:</p>
              <ol className="text-sm list-decimal list-inside space-y-1">
                <li>You'll be asked to grant camera/microphone permission</li>
                <li>You'll be able to select which camera and microphone to use</li>
                <li>You'll see a preview of your camera</li>
              </ol>
            </div>
            <div className="flex gap-4 justify-end">
              <button
                onClick={() => setShowQuitConfirmation(true)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={requestInitialPermission}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Selector Modal */}
      {showDeviceSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-2xl w-full">
            <h2 className="text-xl font-bold mb-4">Select Your Camera and Microphone</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Camera
              </label>
              <select
                value={selectedVideoDevice}
                onChange={(e) => setSelectedVideoDevice(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {videoDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Microphone
              </label>
              <select
                value={selectedAudioDevice}
                onChange={(e) => setSelectedAudioDevice(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {audioDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Camera Preview
              </label>
              <div className="bg-gray-100 rounded-lg overflow-hidden">
                <video
                  ref={previewVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-64 object-contain"
                />
              </div>
            </div>

            <div className="flex gap-4 justify-end">
              <button
                onClick={createStreamWithSelectedDevices}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Confirm Selection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Denied Modal */}
      {permissionDenied && !showQuitConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md">
            <h2 className="text-xl font-bold mb-4">Camera/Microphone Permission Required</h2>
            <p className="mb-4">
              You must allow camera and microphone access to proceed. Would you like to quit this activity?
              Please note that participation is voluntary, but we cannot pay you if you don't complete the task.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
              <p className="text-sm font-semibold mb-2">To grant permissions:</p>
              <ol className="text-sm list-decimal list-inside space-y-1">
                <li>Refresh your browser tab/page</li>
                <li>Click "Allow" when prompted for camera/microphone access</li>
              </ol>
            </div>
            <div className="flex gap-4 justify-end">
              <button
                onClick={() => setShowQuitConfirmation(true)}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quit Confirmation Modal */}
      {showQuitConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md">
            <h2 className="text-xl font-bold mb-4">Are you sure you want to quit?</h2>
            <div className="flex gap-4 justify-end mt-6">
              <button
                onClick={() => setShowQuitConfirmation(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  window.location.href = "https://mgmt.ucl.ac.uk";
                }}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Yes, Quit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
