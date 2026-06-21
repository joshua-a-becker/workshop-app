import React, { useState, useEffect, useRef } from "react";
import { usePlayer, useGame } from "@empirica/core/player/classic/react";
import { saveExerciseNote } from "../clubApi";

// Turn a Cloudflare Stream HLS manifest URL into the minimal iframe player URL.
//   https://customer-xxx.cloudflarestream.com/<id>/manifest/video.m3u8
//     -> https://customer-xxx.cloudflarestream.com/<id>/iframe
// The iframe player is just a play button + standard controls (no logos), and
// works across browsers without pulling in an HLS library. Any non-Stream URL is
// returned unchanged so a plain embeddable URL can also be used.
function toEmbedUrl(url) {
  if (!url) return "";
  const m = url.match(/^(https?:\/\/[^/]*cloudflarestream\.com\/[^/]+)\//i);
  return m ? `${m[1]}/iframe` : url;
}

const TABS = [
  { id: "outcome", label: "Outcome" },
  { id: "discussion", label: "Discussion Questions" },
  { id: "video", label: "Debrief Video" },
  { id: "notes", label: "Your Notes" },
];

export function DebriefPanel() {
  const player = usePlayer();
  const game = useGame();

  const [activeTab, setActiveTab] = useState("outcome");

  const debrief = game.get("debrief") || {};
  const questions = debrief.discussion_questions || [];
  const embedUrl = toEmbedUrl(debrief.video_url || "");

  const scenario = player.get("scenario") || "";

  const bonus = player.get("bonus") || 0;
  // Set per-player in onRoundEnded; fall back to the score for older games.
  const reachedAgreement = player.get("reachedAgreement") ?? bonus > 0;

  return (
    <div className="w-full bg-gray-300 p-6 flex flex-col relative min-h-screen">
      {/* Bottom fade overlay (matches the negotiation materials panel) */}
      <div className="fixed left-0 bottom-0 w-[70%] h-12 bg-gradient-to-t from-gray-300 to-transparent pointer-events-none z-10"></div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded font-medium transition-all border ${
              activeTab === tab.id
                ? "bg-white text-blue-600 border-blue-400 shadow"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1">
        {activeTab === "outcome" && (
          <OutcomeTab
            reachedAgreement={reachedAgreement}
            bonus={bonus}
            note={debrief.outcome_note}
            onProceed={() => setActiveTab("discussion")}
          />
        )}

        {activeTab === "discussion" && (
          <DiscussionTab
            questions={questions}
            onProceed={() => setActiveTab("video")}
          />
        )}

        {activeTab === "video" && (
          <VideoTab
            embedUrl={embedUrl}
            title={debrief.video_title}
            onProceed={() => setActiveTab("notes")}
          />
        )}

        {activeTab === "notes" && <NotesTab scenario={scenario} />}
      </div>
    </div>
  );
}

function OutcomeTab({ reachedAgreement, bonus, note, onProceed }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-4">
          Negotiation Outcome
        </h3>

        {reachedAgreement ? (
          <div className="space-y-6">
            <div className="bg-green-50 border-l-4 border-green-500 p-6 rounded-r-lg">
              <div className="flex items-center mb-2">
                <div className="text-4xl mr-4">🎉</div>
                <h4 className="text-xl font-bold text-green-900">
                  Congratulations — your group reached an agreement!
                </h4>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
              <p className="text-lg text-gray-700 mb-2">Your score is:</p>
              <p className="text-5xl font-bold text-blue-600">
                {bonus.toFixed(2)} points
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-lg">
              <h4 className="text-xl font-bold text-amber-900 mb-1">
                No Agreement Reached
              </h4>
              <p className="text-gray-700">
                Your group did not reach an agreement, so each of you falls back
                to your BATNA.
              </p>
            </div>
          </div>
        )}

        {note && (
          <p className="text-gray-700 leading-relaxed mt-6">{note}</p>
        )}
      </div>

      <ProceedButton onClick={onProceed}>
        Proceed to Discussion Questions
      </ProceedButton>
    </div>
  );
}

function DiscussionTab({ questions, onProceed }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          Discussion Questions
        </h3>
        <p className="text-gray-600 mb-6">
          Talk through these prompts together as a group before watching the
          debrief video.
        </p>

        {questions.length === 0 ? (
          <p className="text-gray-500 italic">
            No discussion questions were configured for this scenario.
          </p>
        ) : (
          <ol className="space-y-4">
            {questions.map((q, i) => {
              const question = typeof q === "string" ? q : q.question;
              const guidance = typeof q === "string" ? null : q.guidance;
              return (
                <li
                  key={i}
                  className="flex gap-4 bg-gray-50 border border-gray-200 rounded-lg p-4"
                >
                  <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-gray-900 font-medium">{question}</p>
                    {guidance && (
                      <p className="text-gray-600 text-sm mt-1">{guidance}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <ProceedButton onClick={onProceed}>
        Proceed to Debrief Video
      </ProceedButton>
    </div>
  );
}

function VideoTab({ embedUrl, title, onProceed }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-4">
          {title || "Debrief Video"}
        </h3>

        {embedUrl ? (
          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ paddingTop: "56.25%" /* 16:9 */ }}
          >
            <iframe
              src={embedUrl}
              title={title || "Debrief Video"}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="text-gray-500 italic">
            No debrief video was configured for this scenario.
          </p>
        )}
      </div>

      <ProceedButton onClick={onProceed}>Proceed to Your Notes</ProceedButton>
    </div>
  );
}

// Save at most once per this interval while typing (plus once on unmount), so we
// never hit the server on every keystroke.
const SAVE_DEBOUNCE_MS = 3000;

function NotesTab({ scenario }) {
  const player = usePlayer();
  // Seed from the player attribute so the note survives a page reload (Empirica
  // rehydrates player state on reconnect). The remote club save is the durable
  // copy; this is the local/offline-resilient draft.
  const initial = player.get("exerciseNote") || "";
  const [note, setNote] = useState(initial);
  // "idle" | "editing" | "saving" | "saved" | "error"
  const [status, setStatus] = useState("idle");
  const timerRef = useRef(null);
  // Latest text + last-saved text live in refs so the debounce timer always
  // reads current values without restarting on every keystroke.
  const noteRef = useRef(initial);
  const savedRef = useRef(initial);

  // Persist the current draft: write the player attribute (survives reload/tab
  // change) and the remote club save. Called at most once per SAVE_DEBOUNCE_MS,
  // plus once on unmount — never on every keystroke.
  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const current = noteRef.current;
    if (current === savedRef.current) return; // nothing new to persist
    savedRef.current = current;
    player.set("exerciseNote", current);
    setStatus("saving");
    saveExerciseNote(scenario, current)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Don't flip to "saved" if the user kept typing while we were saving.
        setStatus(noteRef.current === current ? "saved" : "editing");
      })
      .catch(() => setStatus("error"));
  };

  const handleChange = (e) => {
    const value = e.target.value;
    setNote(value);
    noteRef.current = value;
    setStatus("editing");
    // Throttle: schedule a save only if one isn't already pending, so a burst of
    // typing produces at most one save per SAVE_DEBOUNCE_MS.
    if (!timerRef.current) {
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }
  };

  // Flush any pending edits when the component unmounts (e.g. tab switch).
  useEffect(() => {
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Your Notes</h3>
        <p className="text-gray-700 mb-4">
          Please enter any notes you'd like to save about this exercise. Enter at
          least 1 thing you did well, and 1 thing you'd do differently next time.
        </p>

        <textarea
          value={note}
          onChange={handleChange}
          rows={10}
          placeholder="Type your notes here…"
          className="w-full rounded-lg border border-gray-300 p-4 text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-y"
        />

        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-gray-500 italic">
            This note will be saved to your profile.
          </p>
          <SaveIndicator status={status} />
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ status }) {
  switch (status) {
    case "editing":
      return <span className="text-sm text-gray-400">Editing…</span>;
    case "saving":
      return <span className="text-sm text-gray-400">Saving…</span>;
    case "saved":
      return <span className="text-sm text-green-600">✓ Saved</span>;
    case "error":
      return (
        <span className="text-sm text-red-600">
          Couldn't save — check your connection
        </span>
      );
    default:
      return null;
  }
}

function ProceedButton({ onClick, children }) {
  return (
    <div className="flex justify-center pt-2 pb-8">
      <button
        onClick={onClick}
        className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors"
      >
        {children} →
      </button>
    </div>
  );
}
