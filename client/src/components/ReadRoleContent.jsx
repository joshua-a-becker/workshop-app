import React, { useState, useRef } from "react";
import { usePlayer, useGame } from "@empirica/core/player/classic/react";
import Markdown from "react-markdown";
import { ScoringCalculator, batnaThreshold } from "./negotiationDisplay";

export function ReadRoleContent({ profileComponent }) {
  const player = usePlayer();
  const game = useGame();
  const tips = game.get("tips") || "";
  const type = game.get("negotiationType") || "features";
  const priceConfig = game.get("priceConfig") || {};
  const roleName = player.get("roleName");
  const roleNarrative = player.get("roleNarrative");
  const roleScoresheet = player.get("roleScoresheet");
  const roleBATNA = player.get("roleBATNA");
  const roleRP = player.get("roleRP");
  const roleMultiplier = player.get("roleMultiplier");
  const rolePriceRP = player.get("rolePriceRP");
  const [showFade, setShowFade] = useState(false);
  const scrollContainerRef = useRef(null);

  // Calculator practice state (not submitted anywhere — exploration only).
  const [selectedOptions, setSelectedOptions] = useState({});
  const [priceValue, setPriceValue] = useState("");

  const threshold = batnaThreshold(type, roleRP);

  // Handle scroll to show/hide fade
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const scrollTop = scrollContainerRef.current.scrollTop;
      setShowFade(scrollTop > 10);
    }
  };

  // Price roles have no scoresheet; they carry a multiplier + reservation price.
  const hasRoleData = roleScoresheet || roleMultiplier !== undefined;

  if (!roleName || !roleNarrative || !hasRoleData) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-gray-500">Loading your role...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-50">
      {/* Profile bar at top - sticky */}
      <div className="sticky top-0 z-20 bg-gray-50">
        {profileComponent}
      </div>

      {/* Fade overlay at top - only show when scrolled, positioned below profile border */}
      {showFade && (
        <div className="absolute top-[3.6rem] left-0 right-0 h-8 bg-gradient-to-b from-gray-50 to-transparent pointer-events-none z-10"></div>
      )}

      {/* Main content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto relative"
      >
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">

        {/* Prominent header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg shadow-lg p-8 text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            It's Time to Prepare for Your Negotiation
          </h1>
        </div>

        {/* Instructions at top */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-blue-900 mb-3">How Negotiations Activities Work</h2>
          <p className="text-gray-700 leading-relaxed">
            This activity is based off a standard MBA classroom exercise.
          </p><br/>
          <p>
            You have been assigned a specific role with unique objectives and priorities.
          </p><br/>
          <p>
            Review your narrative carefully to understand your interests and goals. Then examine the scoresheet to see how
            different outcomes affect your final score. During negotiation, work with other participants to find
            mutually beneficial solutions.
          </p><br/>
          <p>
            Your goal is to reach an agreement that maximizes your score based on your role's scoresheet, which is shown below.
          </p><br/>
          {/* <p>
            Your bonus will be equal to the points you get!  1 point = $1 dollar.
          </p> */}
        </div>

          {/* 1. Narrative Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Your Role
            </h3>
            <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed">
              <Markdown>{roleNarrative}</Markdown>
            </div>
          </div>

          {/* 2. What if I don't reach agreement? (BATNA) */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h4 className="text-base font-bold text-gray-900 mb-2">
              What if I don't reach agreement?
            </h4>
            {roleBATNA && (
              <p className="text-sm text-gray-700 mb-1">{roleBATNA}</p>
            )}
            <p className="text-sm text-gray-700">
              <br/>If you don't reach agreement, you will earn <span className="font-bold">{threshold} value</span>.
            </p>
          </div>

          {/* 3. Scoring Section (type-aware; practice only) */}
          <ScoringCalculator
            type={type}
            roleScoresheet={roleScoresheet}
            priceConfig={priceConfig}
            roleMultiplier={roleMultiplier}
            rolePriceRP={rolePriceRP}
            roleRP={roleRP}
            selection={selectedOptions}
            onSelectionChange={setSelectedOptions}
            priceStr={priceValue}
            onPriceChange={setPriceValue}
            title="Scoring"
            footer={
              <button
                onClick={() => { setSelectedOptions({}); setPriceValue(""); }}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Reset All
              </button>
            }
          />

          {/* 4. Tips on Negotiation Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Tips on Negotiation
            </h3>
            <div className="prose prose-gray max-w-none" dangerouslySetInnerHTML={{ __html: tips }} />
          </div>
        </div>
      </div>
    </div>
  );
}
