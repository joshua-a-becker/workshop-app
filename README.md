# Group Negotiation Experiment Platform

A real-time, multi-party video negotiation experiment platform built with [Empirica](https://empirica.ly/) v1.12.5 and [Daily.co](https://www.daily.co/). Participants are assigned fictional roles and negotiate via live video chat, using a structured proposal submission and voting system. The negotiation scenario is fully configurable via a `roleDataURL` treatment factor that points to a JSON file defining roles, scoresheets, and tips.

**Principal Investigator:** Joshua Becker, University College London (UCL)
**Contact:** joshua.becker@ucl.ac.uk
**Production URL:** https://platform.negotiation.education

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Detailed Component Reference](#detailed-component-reference)
- [User Registration & Entry Flow](#user-registration--entry-flow)
- [Waiting Room & Group Assignment](#waiting-room--group-assignment)
- [Game Flow & Stages](#game-flow--stages)
- [Negotiation Mechanics](#negotiation-mechanics)
- [Server Logic](#server-logic)
- [Negotiation Types](#negotiation-types)
- [Role Data Format](#role-data-format)
- [Treatment Configuration](#treatment-configuration)
- [URL Parameters](#url-parameters)
- [Setup & Installation](#setup--installation)
- [Development & Testing](#development--testing)
- [Data Collection](#data-collection)
- [Deployment](#deployment)

---

## Overview

### Negotiation Scenario

The platform is **scenario-agnostic**. The negotiation scenario is defined entirely by external role data loaded at game start from the `roleDataURL` treatment factor, which may be either a **remote URL** or a **local file path** in the repo. This means the same platform can run any negotiation by simply pointing to a different JSON file.

The platform supports **three negotiation types**, identified by a `type` field in the role data (see [Negotiation Types](#negotiation-types) and [Role Data Format](#role-data-format)):

- **`features`** (default) — a list of include/exclude issues, shown as checkboxes.
- **`multiple_choice`** — one ordered dropdown per issue (multi-issue, more than two options each).
- **`price`** — a single number entered in a box (single-issue price bargaining).

Each player receives a private role with:

- A **narrative** describing their character's background and preferences
- For `features`/`multiple_choice`: a **scoresheet** giving the **value** of each option of each issue
- For `price`: a **reservation price** (`rp`) and a **multiplier** (buyer +1 / seller −1)
- A **BATNA** (Best Alternative to Negotiated Agreement) — their fallback if no deal is reached

All three types share one unifying concept — **value** (the term shown throughout the UI). The same rule applies everywhere: **never accept a deal worth less than 0**. Players negotiate via live video call while using an interactive scoring calculator and formal proposal system. Issues typically have asymmetric values across roles, creating opportunities for integrative bargaining where parties trade low-value items for high-value ones.

**Included example scenarios** (in the repo root) — one per type:
- `roles_features_example.json` — Two-party apartment lease, 6 include/exclude terms (`features`)
- `roles_multiplechoice_example.json` — Two-party job offer, 4 issues × 3 ordered options (`multiple_choice`)
- `roles_price_example.json` — Two-party used-car sale, ZOPA $12k–$20k (`price`)

Plus `roles_v1.json` / `roles_v2.json` — the original three-party vacation-planning `features` scenarios. These are all examples; any scenario following the role data schema can be used.

### Experiment Flow

1. **Entry** - Player arrives via URL with participant key and group assignment
2. **Intro** - Welcome page, consent form, display name entry, camera/mic permissions
3. **Waiting Room** - Video chat with group members while waiting for admin to start
4. **Read Role** (5 min) - Review private role narrative, scoresheet, and BATNA
5. **Transition** (15 sec) - Countdown before negotiation begins
6. **Negotiate** (30 min) - Live video negotiation with proposal submission and voting
7. **Debrief & Discussion** - Same split-screen layout (video call on the right), with a tabbed panel on the left: the **Outcome** (score), a set of **Discussion Questions** to talk through as a group, and a **Debrief Video**. Content is driven by the `debrief` block in the role data.
8. **Outcome (exit)** - Final score display based on agreement or BATNA

### Outcome Rules

- **Agreement reached**: All players unanimously accept AND ratify a proposal. Each player's value is computed per the negotiation type — sum of the chosen options' scores (`features`/`multiple_choice`) or `multiplier · (rp − price)` (`price`).
- **No agreement**: Time runs out or no proposal is unanimously ratified. Each player receives their BATNA value — `RP` for `features`/`multiple_choice`, and `0` for `price` (the no-deal surplus).
- Players **cannot accept proposals worth negative value** to them (enforced by the UI).

---

## Technology Stack

### Frontend (`/client`)

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 18.2.0 | UI framework |
| `react-dom` | 18.2.0 | React DOM rendering |
| `@empirica/core` | 1.12.5 | Experiment framework (player/game state hooks) |
| `@daily-co/daily-js` | ^0.85.0 | Video conferencing SDK |
| `react-markdown` | ^10.1.0 | Markdown rendering for role narratives |
| `lucide-react` | ^0.263.1 | Icon library (Users, Video, Clock, Play, etc.) |
| `vite` | 5.1.4 | Build tool and dev server |
| `unocss` | ^0.58.5 | Utility-first CSS (Tailwind-compatible) |

### Backend (`/server`)

| Package | Version | Purpose |
|---------|---------|---------|
| `@empirica/core` | 1.12.5 | Experiment server framework |
| `node-fetch` | — | HTTP client for Daily.co API calls |
| `js-yaml` | ^4.1.1 | YAML configuration parsing |
| `esbuild` | 0.14.47 | JavaScript bundling |
| `nodemon` | ^3.1.11 | Development hot reload |

### Infrastructure

- **Empirica.ly** - Multiplayer experiment framework (game state, player matching, admin panel)
- **Daily.co** - Video conferencing with raw-track recording and transcription
- **Node.js** 20.11.1 - Server runtime
- **Caddy** - Reverse proxy with automatic HTTPS (production)

---

## Project Structure

```
group-negotiation/
├── client/                              # Frontend React application
│   ├── src/
│   │   ├── index.jsx                    # App entry point
│   │   ├── index.css                    # Global styles
│   │   ├── App.jsx                      # Root component: URL routing, Daily.co call lifecycle
│   │   ├── Game.jsx                     # Empirica game wrapper
│   │   ├── Stage.jsx                    # Stage router (dispatches to stage components)
│   │   ├── Profile.jsx                  # Top bar: stage name, timer, dev skip button
│   │   │
│   │   ├── components/
│   │   │   ├── VideoChat.jsx            # Daily.co video grid with mic/camera toggle controls
│   │   │   ├── VideoNegotiate.jsx       # Negotiation layout: MaterialsPanel (70%) + InteractionPanel (30%)
│   │   │   ├── VideoDebrief.jsx         # Debrief layout: DebriefPanel (70%) + InteractionPanel (30%)
│   │   │   ├── DebriefPanel.jsx         # Tabbed panel: Outcome, Discussion Questions, Debrief Video
│   │   │   ├── MaterialsPanel.jsx       # Tabbed panel: Narrative, Scoring calculator, Proposals, Tips
│   │   │   ├── negotiationDisplay.jsx   # Shared value logic + per-type calculator/proposal display (features/multiple_choice/price)
│   │   │   ├── InteractionPanel.jsx     # Right panel wrapper: Profile bar + VideoChat
│   │   │   ├── ReadRole.jsx             # "Read Negotiation Role" stage: welcome modal + ReadRoleContent
│   │   │   ├── ReadRoleContent.jsx      # Role narrative display + scoresheet preview (read-only)
│   │   │   ├── ReadRoleContentProlific.jsx  # Prolific-specific variant of ReadRoleContent
│   │   │   ├── ReadyToNegotiate.jsx     # 15-second countdown transition screen
│   │   │   ├── MediaPermissionGate.jsx  # Camera/mic permission request + device selector
│   │   │   ├── CustomChat.jsx           # Text chat component
│   │   │   ├── Heartbeat.jsx            # Writes player.lastSeen every 1s (presence tracking)
│   │   │   ├── Timer.jsx                # Stage countdown timer display
│   │   │   ├── Avatar.jsx               # Player avatar component
│   │   │   ├── Button.jsx               # Reusable styled button
│   │   │   └── Alert.jsx                # Alert/notification component
│   │   │
│   │   ├── intro-exit/
│   │   │   ├── AutoPlayerIdForm.jsx     # Auto-creates Empirica player from URL participantKey
│   │   │   ├── Introduction.jsx         # Welcome page explaining the negotiation task
│   │   │   ├── IntroductionProlific.jsx # Prolific-specific introduction variant
│   │   │   ├── CustomConsent.jsx        # UCL research consent form
│   │   │   ├── CustomConsentProlific.jsx # Prolific-specific consent variant
│   │   │   ├── DisplayNameEntry.jsx     # Display name input + media permission gate
│   │   │   ├── CustomLobby.jsx          # Group waiting room with video chat + admin controls
│   │   │   ├── NegotiationOutcome.jsx   # Post-game score display (agreement or no-agreement)
│   │   │   ├── NoGameExitStep.jsx       # Fallback exit for players who couldn't join a game
│   │   │   ├── Finished.jsx             # Thank you page with completion code
│   │   │   └── ExitSurvey.jsx           # Post-experiment survey (placeholder)
│   │   │
│   │   ├── examples/
│   │   │   ├── JellyBeans.jsx           # Example game (unused)
│   │   │   └── MineSweeper.jsx          # Example game (unused)
│   │   │
│   │   └── workers/
│   │       └── heartbeat.worker.js      # Web Worker ticking the heartbeat (runs even when tab is backgrounded)
│   │
│   ├── package.json
│   ├── vite.config.js                   # Vite dev server + build configuration
│   └── jsconfig.json
│
├── server/                              # Backend Empirica server
│   ├── src/
│   │   ├── index.js                     # Server entry point (registers callbacks)
│   │   └── callbacks.js                 # All server logic: game setup, group assignment, Daily.co
│   ├── dist/                            # Compiled server output
│   ├── package.json
│   └── jsconfig.json
│
├── roles_v1.json                        # Role data version 1 (detailed narratives with backstory)
├── roles_v2.json                        # Role data version 2 (simplified narratives)
└── .empirica/                           # Empirica configuration directory
    ├── empirica.toml                    # App name + admin dashboard credentials
    ├── treatments.yaml                  # Factors + named treatments (conditions)
    ├── lobbies.yaml                     # Built-in lobby config (mostly unused; see below)
    └── local/
        └── tajriba.json                 # Local Empirica database (gitignored)
```

---

## Detailed Component Reference

### Root & Routing

#### `App.jsx` — Root Component (~1000 lines)

The main application component. Handles:

1. **URL parameter parsing**: Reads `participantKey`, `groupName`, `studentId`, `devKey`, `skipIntro` from the URL query string.
2. **Participant key generation**: If `studentId` is present, generates key as `{studentId}_{YYYYMMDD}`. If `devKey=oandi`, generates a random 15-character key.
3. **Group name routing**: If `groupName` is missing from the URL, renders a `GroupNameEntry` form prompting the user. Otherwise proceeds to the Empirica context.
4. **Daily.co call lifecycle management**: Creates and manages a single `DailyCallContext` that persists across all stages. This includes:
   - Creating the Daily.co call object (`DailyIframe.createCallObject()`)
   - Joining the call with the player's media stream, meeting token, and display name
   - Handling all participant events (`participant-joined`, `participant-updated`, `track-started`, `participant-left`)
   - Managing remote media streams in React state (`remoteStreams`, `participantNames`, `participantVideoStates`, `participantAudioStates`)
   - Auto-starting raw-track recording and transcription on join
   - Polling for remote participants (fast: 500ms for 10s, then slow: 2s indefinitely) to catch late joiners and rejoiners
   - Cleaning up dead/stale streams (tracks with `readyState === "ended"`)
   - Providing `refreshRemoteParticipant()` for manual stream recovery
5. **Audio/video track control**: Tracks whether VideoChat is mounted and whether audio/video are individually enabled. Only sends tracks to Daily.co when both conditions are true.
6. **Empirica integration**: Wraps the app in `<EmpiricaParticipant>` with `EmpiricaClassic` mode, wiring up intro steps, exit steps, lobby, and player creation.

**Context provided** (`DailyCallContext`):
- `mediaStream` / `setMediaStream` — Local camera/mic stream
- `callState` / `setCallState` — All remote streams, participant names, video/audio states, recording/transcription status
- `registerCallData` — Callback to provide room URL, meeting token, display name for joining
- `refreshRemoteParticipant(sessionId)` — Force-refresh a remote participant's stream
- `isAudioEnabled` / `setIsAudioEnabled` — Mic toggle state
- `isVideoEnabled` / `setIsVideoEnabled` — Camera toggle state
- `setIsVideoChatMounted` — Tracks whether VideoChat component is currently rendered
- `groupName` — Player's group assignment

**Intro steps** (configurable, skipped with `skipIntro=T`):
1. `Introduction` — Welcome page
2. `CustomConsent` — Research consent form
3. `DisplayNameEntry` — Name entry + camera/mic permissions

**Exit steps** (conditional):
- Normal completion → `NegotiationOutcome` (shows score)
- Lobby timeout / no game → `NoGameExitStep` (shows reduced payment code)

#### `Game.jsx` — Game Wrapper

Minimal wrapper that renders the `Stage` component (with a `Profile` bar) and mounts the `<Heartbeat />` component for presence tracking.

#### `Heartbeat.jsx` — Presence Heartbeat

Renders nothing. While a player is in a game, it spawns a Web Worker (`workers/heartbeat.worker.js`) that fires every second so the heartbeat keeps ticking even when the browser tab is backgrounded. On each tick it writes `player.lastSeen = { ts, meetingState, videoState, audioState }`. The server reads `lastSeen` to detect players who have left the lobby or abandoned a stage (see [Presence Tracking](#presence-tracking)).

#### `Stage.jsx` — Stage Router

Dispatches to the appropriate component based on the current stage name:

| Stage Name | Component |
|------------|-----------|
| `"Read Negotiation Role"` | `<ReadRole />` |
| `"Ready To Negotiate"` | `<ReadyToNegotiate />` |
| `"Time To Negotiate"` | `<VideoNegotiate />` |
| `"Debrief & Discussion"` | `<VideoDebrief />` |

Also handles the "waiting for other players" state when a player has submitted their stage.

#### `Profile.jsx` — Top Bar

Displays:
- Current stage name (left)
- Countdown timer via `<Timer />` (center)
- Dev-mode "SKIP" button (right, only in development or when `devKey=oandi`)

### Intro & Exit Components

#### `AutoPlayerIdForm.jsx` — Player Creation

Invisible component that auto-creates the Empirica player. Extracts `participantKey` from the URL and calls `onPlayerID()` to register with Empirica. Also sets the player's `groupName` from URL params.

#### `Introduction.jsx` — Welcome Page

Displays experiment overview:
- Explains participants will be assigned a vacation-planning role
- 5 minutes to read and prepare
- Placed into video chat for 20 minutes of negotiation
- Warns that video is required
- Button: "Continue to Consent Form"

#### `CustomConsent.jsx` — Research Consent Form

UCL-branded consent form with sections:
- Purpose of the Research
- Procedures
- Safety Statement (warns about potential rude/argumentative behavior)
- Benefits (negotiation practice, free resources)
- Anonymity guarantees
- Button: "I Consent"

#### `DisplayNameEntry.jsx` — Name & Media Setup

Two-phase component:

1. **Media permissions** (via `MediaPermissionGate`): Requests camera/mic access, shows device selector, stores device IDs in player state.
2. **Name entry**: Text input (2-20 characters) for display name visible during video calls.

Also sets all URL parameters as player attributes (e.g., `groupName`, `studentId`, etc.) for server-side access.

#### `MediaPermissionGate.jsx` — Camera/Mic Permissions

Wraps child content and blocks rendering until camera and microphone permissions are granted:

1. Shows a pre-permission modal explaining why access is needed
2. Requests `getUserMedia` with video and audio
3. Enumerates available devices and shows a device selector
4. Provides video preview of selected camera
5. Stores selected device IDs for persistence across page refreshes
6. Passes the resulting `MediaStream` to the parent via callback

#### `CustomLobby.jsx` — Group Waiting Room

Full-screen waiting room with two panels:

**Left sidebar (320px)**:
- Group name header with clock icon
- **Start Game button** (only for group admin, requires 2+ players). Clicking it opens the **Assignment Mode modal** (see below) rather than starting immediately.
- Member list with green online indicators
- Info text (admin: "Click Start when ready" / non-admin: "Waiting for admin to start")
- Negotiation tips (fetched from role data URL)

**Assignment Mode modal** (admin only): Before starting, the admin chooses how to split the group into games when the headcount isn't an exact multiple of the configured `playerCount`. The modal previews the resulting split live. Two modes are offered:

| Mode | id | Behavior |
|------|----|----------|
| **Exact Groups Only** | `exact` | Creates as many full groups of `playerCount` as possible. Extras stay in the lobby. |
| **Inclusive** | `overfill` | Assigns everyone — uses a partial group, or overfills the last group by one, to avoid leaving anyone behind. |

The selected mode is sent to the server inside `player.requestStart = { groupName, timestamp, mode }`.

**Main area (remaining width)**:
- Live video chat (via `<VideoChat>`) filtered to show only members of the same group
- Placeholder shown if video room isn't ready or intro not completed

**Group admin logic**: The first player to join a group in the waiting game becomes admin. Admin status is tracked in `game.groupAdmins` (a map of `groupName → playerId`). If the admin changes groups, admin is reassigned to the next player in the old group.

#### `NegotiationOutcome.jsx` — Post-Game Results

Displays after the negotiation round ends:
- **Agreement reached**: Shows congratulations message and final point score
- **No agreement**: Shows "No Agreement Reached" message with base payment info
- Instructs players to return to the classroom

#### `NoGameExitStep.jsx` — No Game Fallback

Shown when a player couldn't be assigned to a game (lobby timeout, no games available). Displays a reduced payment code (`NOGAME25`).

#### `Finished.jsx` — Completion Page

Thank you page displayed after all exit steps. Shows completion code `VACATION25`.

### Game Stage Components

#### `ReadRole.jsx` — Role Reading Stage

Shows a welcome modal overlay on top of the `CustomLobby`:
- "Your Group is Ready — Prepare for Your Negotiation!"
- Shows remaining time
- Reassures that materials remain available during negotiation
- "Got It!" button dismisses modal and shows `ReadRoleContent`

The modal is tracked in player state (`hasSeenReadRoleModal`) so it only shows once.

#### `ReadRoleContent.jsx` — Role Materials (Read-Only)

Displays the player's role materials during the reading stage:
- **Profile bar** (sticky at top) with stage name and timer
- **Role narrative** rendered as markdown
- **Scoring calculator** for exploring value (practice only, not submitted) — rendered via the shared `<ScoringCalculator>` from `negotiationDisplay.jsx`, so it adapts to the negotiation type (checkboxes / dropdowns / price box)
- **BATNA information**
- **Negotiation tips** from game state

#### `ReadyToNegotiate.jsx` — Transition Countdown

Simple centered screen with large countdown number (15 seconds). Text: "Now that you have reviewed your role, it's time to negotiate! You will be automatically redirected to the video call in X seconds."

#### `VideoNegotiate.jsx` — Main Negotiation View

Split-screen layout:
- **Left (70%)**: `<MaterialsPanel>` with all role data
- **Right (30%, fixed)**: `<InteractionPanel>` with profile bar + video chat

#### `VideoDebrief.jsx` — Post-Negotiation Debrief View

Shown during the **"Debrief & Discussion"** stage (a separate round that runs after the negotiation round ends). Reuses the same split-screen layout as `VideoNegotiate`:
- **Left (70%)**: `<DebriefPanel>`
- **Right (30%, fixed)**: `<InteractionPanel>` with profile bar + video chat

The live video call continues so the group can talk through the debrief together.

#### `DebriefPanel.jsx` — Tabbed Debrief Interface

Three self-paced tabs, each ending in a large button that advances to the next:

1. **Outcome** — Shows whether the group reached agreement and the player's final score (read from `player.bonus` / `player.reachedAgreement`, set in `onRoundEnded`). Button: "Proceed to Discussion Questions".
2. **Discussion Questions** — Numbered list of prompts (with optional guidance) for the group to talk through, from `debrief.discussion_questions` in the role data. Button: "Proceed to Debrief Video".
3. **Debrief Video** — Plays the debrief video from `debrief.video_url`. Cloudflare Stream HLS manifest URLs are converted to the minimal Stream iframe player (just a play button + standard controls, no logos) via `toEmbedUrl()`; any other URL is embedded as-is.

#### `MaterialsPanel.jsx` — Tabbed Negotiation Interface (~790 lines)

The core negotiation UI with four tabs:

**1. Narrative Tab**
- Role narrative rendered as markdown in a white card

**2. Scoring Tab (Calculator)** — rendered by the shared `<ScoringCalculator>` (`negotiationDisplay.jsx`), so the inputs adapt to the negotiation type:
- `features`: a checkbox per feature, rows sorted by score (highest first)
- `multiple_choice`: an ordered dropdown per issue (JSON order preserved, `— Select —` placeholder)
- `price`: a single number box driven by `price_config`
- Each choice row shows the option's **value** (color-coded: blue for positive, red for negative) and reason
- Right side panel shows:
  - Running total **value** (updates live as inputs change)
  - "Beats your BATNA" / "Below your BATNA" indicator
  - **Submit Proposal** button (disabled while a proposal is pending)
  - Reset All button

**3. Proposal Tab**
- **Current Proposal** (if one is pending): Shows the proposal contents (via `<ProposalDetails>`, type-aware), value to the player, "Beats BATNA" indicator, Accept/Reject vote buttons, vote count
- **Proposal History**: All past proposals with their contents, acceptance ratio (color-coded from red to green), value, and "Modify" button to load into calculator
- Tab flashes red when a new proposal arrives and player is on a different tab

**4. Tips Tab**
- Negotiation tips HTML content (BATNA, integrative negotiation concepts)

**Proposal Workflow** (managed entirely through `round.proposalHistory`):
1. Player checks items on Scoring tab → clicks "Submit Proposal"
2. Proposal added to `round.proposalHistory` with empty `initialVotes` and `finalVotes`
3. All players see the proposal on the Proposal tab and vote Accept/Reject
4. If ANY player rejects → proposal is "complete" and moves to history
5. If ALL players accept → **Finalize Modal** appears:
   - Shows "Congratulations! Everyone has accepted this proposal"
   - Displays the player's value with this proposal
   - Two buttons: "Finalize Deal" / "Keep Discussing"
6. If ALL players vote "Finalize" → `player.stage.set("submit", true)` ends the stage
7. If any player votes "Continue" → modal can be dismissed, negotiation continues

**Safety guards**:
- Cannot accept a proposal worth negative value (warning modal)
- Cannot submit an incomplete proposal — type-specific (features: at least one feature; multiple_choice: every issue chosen; price: a number entered)
- Only one pending proposal at a time

#### `InteractionPanel.jsx` — Video Panel

Simple wrapper: white panel with profile bar at top, `<VideoChat>` filling the remaining space.

#### `VideoChat.jsx` — Daily.co Video Grid

Renders the video chat interface:
- **Local video**: Camera preview with mic/camera toggle buttons (red when off, gray when on). Video element is always rendered (even when hidden) to maintain Daily.co stream continuity.
- **Remote videos**: Grid of remote participant video elements, each with name label and audio/video state indicators (muted icon, camera off overlay)
- Uses `DailyCallContext` to access streams, toggle audio/video, and register mount/unmount state
- Optional `filterPlayerIds` prop to show only specific participants (used in lobby to filter by group)
- Optional `defaultHideSelf` prop to hide local video preview

---

## User Registration & Entry Flow

### Step-by-Step Registration Process

```
URL with params → App.jsx URL parsing → GroupNameEntry? → EmpiricaParticipant
    → AutoPlayerIdForm (creates Empirica player)
    → Introduction → CustomConsent → DisplayNameEntry (+ MediaPermissionGate)
    → [introDone=true] → Server assigns to waiting game → CustomLobby
```

#### 1. URL Arrival

Players arrive via a URL like:
```
https://platform.negotiation.education/?participantKey=abc123&groupName=TeamAlpha
```

`App.jsx` parses the URL:
- **`participantKey`** is required. Without it (and no `studentId` or `devKey`), an "Invalid URL" error page is shown.
- **`studentId`** auto-generates a participantKey as `{studentId}_{YYYYMMDD}` (e.g., `john_20260304`).
- **`devKey=oandi`** auto-generates a random 15-character participantKey (for testing).
- **`groupName`** determines which group the player joins in the waiting room. If missing, a form (`GroupNameEntry`) prompts the user to type one.

#### 2. Empirica Player Creation

`App.jsx` renders `<EmpiricaParticipant url={url} ns={playerKey}>` which connects to the Empirica server. The `playerCreate` prop points to `AutoPlayerIdForm`, which:
- Calls `onPlayerID(participantKey)` to register the player with Empirica
- Sets `groupName` on the player object from URL params

#### 3. Intro Steps

Three sequential steps (skipped entirely if `skipIntro=T`):

1. **Introduction** (`Introduction.jsx`): Welcome page with task overview. Button: "Continue to Consent Form".
2. **Consent** (`CustomConsent.jsx`): UCL research consent form. Button: "I Consent".
3. **Display Name + Media** (`DisplayNameEntry.jsx`):
   - Wrapped in `MediaPermissionGate` — blocks until camera/mic permissions granted and device selected
   - Text input for display name (2-20 chars)
   - All URL params saved to player state
   - `groupName` explicitly set on player for server-side group filtering
   - On submit: sets `player.displayName` and calls `next()`

After the final intro step, Empirica marks `player.introDone = true`, which triggers the server to finalize the player's waiting game assignment and create their Daily.co meeting token.

#### 4. Waiting Room

After intro, the player enters the `CustomLobby` (see [Waiting Room & Group Assignment](#waiting-room--group-assignment)).

---

## Waiting Room & Group Assignment

### Architecture

The server uses a **waiting game** pattern rather than Empirica's built-in lobby:

1. When a batch starts, the server creates a **waiting game** — a special game with `isWaiting=true` and `playerCount=1000` (effectively unlimited).
2. A Daily.co video room is created for the waiting game.
3. As players complete intro, the server assigns them to the waiting game and generates a per-player Daily.co meeting token.
4. Players see the `CustomLobby` component, which shows their group members and a video chat.
5. The **group admin** (first player in each group) can click "Start Game" to trigger game creation for their group.

### Group Admin System

- The first player to join a group becomes that group's **admin** (stored in `game.groupAdmins`).
- If an admin changes their group name, admin is reassigned to the next player in the old group.
- If the old group becomes empty, the admin entry is removed.
- The new group gets the player as admin if it didn't have one.

### Game Start Process

When the admin confirms the Assignment Mode modal:

1. Client sets `player.requestStart = { groupName, timestamp, mode }` on the player object (`mode` is `"exact"` or `"overfill"`).
2. Server listens for `requestStart` changes via `Empirica.on("player", "requestStart", ...)`.
3. Server verifies the requester is indeed the admin of the specified group.
4. Server gathers all players in that group from `game.waitingPlayers` (admin placed first so the split matches the modal preview).
5. Requires minimum 2 players to start.
6. Splits the group into one or more games via `chunkByMode(players, playerCount, mode)`:
   - `exact` → as many full groups of `playerCount` as possible; remainder are leftovers.
   - `overfill` → everyone is placed (partial or overfilled final group); no leftovers (except an unavoidable singleton when `playerCount === 2` and the count is odd).
7. For each chunk, calls `createAndAssignGame()`:
   - Creates a new game via `batch.addGame()` with treatment factors (`treatment.playerCount` is overwritten with the actual chunk size)
   - Polls until the real Game object appears in context (up to 5 seconds)
   - Assigns each player via `game.assignPlayer(player)`
   - Sets `game.start = true`
8. Removes assigned players from `waitingPlayers`. Any leftovers stay in the lobby, and admin of the group is reassigned to a leftover (preferring the original requester).

### Auto-Assignment Path (`assignPlayersToGames`)

A separate, server-driven assignment path exists for assigning *all* waiting groups at once — triggered manually via `batch.triggerAssignment`, or on a schedule when `ENABLE_AUTO_ASSIGNMENT = true` (see below). This path does **not** use the exact/overfill modes; instead it reads `batch.smallGroupMode`:

| Mode | Behavior |
|------|----------|
| `skip` (default) | Groups with fewer than `playerCount` players are skipped |
| `undersize` | Create game with fewer players than configured |
| `oversize` | Borrow extra players from other groups to fill |

### Auto-Assignment (Optional)

When `ENABLE_AUTO_ASSIGNMENT = true` in `callbacks.js`:
- Server polls every 60 seconds
- At the configured time (default: 6:00 PM EST), automatically runs `assignPlayersToGames()`
- Groups players by `groupName` and creates games for groups with enough players

---

## Game Flow & Stages

### Game Initialization (`onGameStart`)

When a game starts, the server:

1. **Loads role data** from `treatment.roleDataURL` via `loadRoleData()` — a remote URL is fetched with `curl`, otherwise the value is treated as a local file path resolved relative to the project root
2. **Reads the negotiation type** (`rolesData.type`, default `"features"`) and stores it as `game.negotiationType`; for `price` it also stores `game.priceConfig`
3. **Creates a Daily.co video room** for the game (4-hour expiry, raw-track recording, transcription storage enabled)
4. **Generates meeting tokens** for each player with transcription permissions
5. **Randomly assigns roles**: Shuffles players array and assigns roles by cycling through the roles array
6. **Stores role data on players**: always `roleName`, `roleNarrative`, `roleBATNA`; for choice types `roleScoresheet` + `roleRP`; for `price` `roleMultiplier` + `rolePriceRP` (with `roleRP = 0`)
7. **Stores tips** on game state for client access
8. **Initializes participant timestamps** for presence tracking
9. **Creates stages**:

The game has **two rounds**: the **"Negotiation Game"** round (stages 1–3 below) and a **"Debrief"** round (stage 4). Splitting the debrief into its own round lets the negotiation round end first — so `onRoundEnded` computes each player's bonus before the Debrief stage displays the outcome.

| Round | Stage | Name | Default Duration |
|-------|-------|------|---------|
| Negotiation Game | 1 | "Read Negotiation Role" | `readRoleTime` (300s / 5 min) |
| Negotiation Game | 2 | "Ready To Negotiate" | 15 seconds |
| Negotiation Game | 3 | "Time To Negotiate" | `negotiateTime` (1800s / 30 min) |
| Debrief | 4 | "Debrief & Discussion" | `debriefTime` (1800s / 30 min) |

### Stage Monitoring (`onStageStart`)

At the start of each stage:
- Initializes `game.participantTimestamps` for all players
- Starts a 5-second polling interval that:
  - Fetches current Daily.co room participants via the presence API and refreshes `game.participantTimestamps` / `game.activeDailyCalls` (a parallel, Daily-side cross-check)
  - Checks each player's `lastSeen.ts` heartbeat (written by `Heartbeat.jsx`) and, if it is older than `PRESENCE_STALE_MS` (5s), sets `player.leftAt = now` so abandonment can be detected. `leftAt` is set once and not re-fired.

See [Presence Tracking](#presence-tracking) for the full mechanism.

### Round End (`onRoundEnded`)

Fires when **any** round ends, but **returns immediately for the "Debrief" round** — only the "Negotiation Game" round produces a score, and the guard prevents the debrief round end from overwriting the computed bonus.

When the negotiation round ends (either by time expiring or all players submitting):

1. Checks if agreement was reached: last proposal must have unanimous "finalize" votes from all players
2. **Agreement**: Calculates each player's bonus (their **value**) from the finalized proposal per the negotiation type — Σ chosen option scores for `features`/`multiple_choice`, or `multiplier · (rp − price)` for `price`
3. **No agreement**: Each player receives their BATNA value (`roleRP` for choice types, `0` for `price`)
4. Saves `bonus` and `reachedAgreement` on each player and `agreementReached` on the round

---

## Negotiation Mechanics

### Proposal Lifecycle

All proposal state is stored in `round.proposalHistory` — a shared array visible to all players.

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│  Player      │     │  All players    │     │  All players         │
│  submits     │────▶│  vote Accept    │────▶│  vote Finalize       │
│  proposal    │     │  or Reject      │     │  or Keep Discussing  │
└──────────────┘     └─────────────────┘     └──────────────────────┘
                            │                          │
                     ┌──────┴──────┐            ┌──────┴──────┐
                     │ Any reject  │            │ All finalize│
                     │ → History   │            │ → GAME ENDS │
                     └─────────────┘            └─────────────┘
                                                       │
                                                ┌──────┴──────┐
                                                │ Any continue│
                                                │ → Continues │
                                                └─────────────┘
```

### Proposal Data Structure

```javascript
{
  id: "1709568000000-playerXYZ",      // timestamp-playerID
  submittedBy: "playerXYZ",            // player ID
  submittedByName: "Alice",            // display name
  timestamp: 1709568000000,            // submission time
  options: {                           // shape depends on negotiation type:
    "Budget_Hotel": 0,                 //   features:        0 = Include, 1 = Exclude (defaults to 1)
    "Hiking": 0,                       //   multiple_choice: issue -> chosen option index
    "Premium_Flight": 1,               //   price:           { value: <number> }
    // ...
  },
  initialVotes: {                      // Accept/Reject votes
    "player1": "accept",
    "player2": "reject",
  },
  finalVotes: {                        // Finalize/Continue votes
    "player1": "finalize",
  },
  modalDismissed: {                    // Track who dismissed the modal
    "player2": true,
  }
}
```

### Scoring Calculation

Value is computed per negotiation type. The display logic lives in the shared
`client/src/components/negotiationDisplay.jsx` module, and the server mirrors the
same formulas in `server/src/callbacks.js` (`onRoundEnded`):

```
features:         value = SUM over issues of roleScoresheet[issue][selectedIndex].score
                  (unchecked feature defaults to index 1 / Exclude)

multiple_choice:  value = SUM over issues of roleScoresheet[issue][selectedIndex].score
                  (every issue must be chosen before a proposal can be submitted)

price:            value = roleMultiplier · (rolePriceRP − price)
                  (buyer multiplier +1 → rp − price; seller −1 → price − rp)
```

`features` and `multiple_choice` are the **same logic** with different display
(`features` is the two-option Include/Exclude special case). The calculator updates
in real-time as players change their selections or the entered price.

> **Note:** The proposal `options` payload differs by type — `{ issue: optionIndex }`
> for the choice types and `{ value: number }` for `price` (see below).

---

## Server Logic

### `callbacks.js` — Complete Reference

#### Event Listeners

| Event | Trigger | Action |
|-------|---------|--------|
| `Empirica.on("batch")` | Batch created | Creates waiting game with Daily.co room |
| `Empirica.on("batch", "status")` | Batch status changes | Creates waiting game when status = "running" |
| `Empirica.on("batch", "triggerAssignment")` | Manual assignment trigger | Runs `assignPlayersToGames()` for all groups |
| `Empirica.on("player")` | New player connects | Assigns to waiting game, creates meeting token; on first player also starts the lobby presence sweep (and the auto-assignment poll if enabled) |
| `Empirica.on("player", "groupName")` | Player changes group | Updates `waitingPlayers` and `groupAdmins` on the game |
| `Empirica.on("player", "displayName")` | Player changes name | Updates `waitingPlayers` on the game |
| `Empirica.on("player", "introDone")` | Player completes intro | Creates meeting token if not already created |
| `Empirica.on("player", "requestStart")` | Admin confirms Start modal | Splits the group via `chunkByMode` (exact/overfill) and creates + assigns one or more games; leftovers stay in the lobby |
| `Empirica.onGameStart` | Game starts | Fetches roles, creates Daily.co room, assigns roles, creates stages |
| `Empirica.onStageStart` | Stage starts | Initializes presence tracking, polls Daily.co, marks `player.leftAt` on stale heartbeats |
| `Empirica.onRoundEnded` | Round ends | Calculates scores, saves bonuses (no-ops for the "Debrief" round) |

#### Key Functions

| Function | Purpose |
|----------|---------|
| `createDailyRoom(roomName)` | Creates a Daily.co room with 8-hour expiry, recording, and transcription |
| `createMeetingToken(roomName, player, expiry)` | Creates a per-player Daily.co token with transcription permissions |
| `createWaitingGame(ctx, batch)` | Creates the shared waiting game for a batch |
| `getTargetPlayerCount(ctx, batch)` | Reads the configured per-game size from an unused template game (or `batch.config`), since created games overwrite `treatment.playerCount` |
| `assignPlayersToGames(ctx)` | Bulk path: groups waiting players by `groupName` and creates games using `smallGroupMode` |
| `createAndAssignGame(ctx, batch, players, groupName)` | Creates a new game, assigns players, and starts it |
| `chunkByMode(players, P, mode)` | Splits a group into game-sized chunks for the Start-button path (`exact` → `chunkExact`, otherwise `chunkOverfill`) |
| `chunkExact` / `chunkPartial` / `chunkOverfill` | The three splitting strategies (`chunkPartial` is an internal helper for `chunkOverfill`) |
| `sweepLobbyPresence(ctx)` | Prunes stale players from waiting-game rosters based on `lastSeen` |
| `reassignAdmin(waitingPlayers, groupAdmins, groupName, removedPlayerId)` | Reassigns or clears a group's admin after a player is removed |
| `groupByGroupName(players)` | Utility: groups player array by their `groupName` attribute |
| `findExtraPlayers(groups, needed, excludeGroup, processedPlayers)` | Finds players from other groups to fill undersized games |
| `isAssignmentTime()` | Checks if current time matches auto-assignment schedule |

#### Daily.co Integration Details

**Room creation**:
- Rooms are created for both waiting games (8-hour expiry) and negotiation games (4-hour expiry)
- Room names follow the pattern: `waiting_room_{batchId}_{YYYY_MM_DD}` or `{gameId}_video_room_{YYYY_MM_DD}`
- Properties: `enable_recording: "raw-tracks"`, `enable_transcription_storage: true`

**Meeting tokens**:
- Per-player tokens with `user_name` set to `"{displayName} - Player {playerId}"`
- `is_owner: false`, but with `canAdmin: ["transcription"]` permission
- Token expiry matches room expiry

**Presence monitoring**:
- Server polls `GET /v1/rooms/{roomName}/presence` every 5 seconds during each stage
- Updates `game.participantTimestamps` with current time for active participants
- Stores active participant data in `game.activeDailyCalls`
- This Daily-side data is a cross-check; the authoritative abandonment signal is the client heartbeat (see below)

### Presence Tracking

The app tracks whether players are still present using a **client heartbeat** rather than relying on Daily.co alone.

**Client side** (`client/src/components/Heartbeat.jsx` + `workers/heartbeat.worker.js`):
- Mounted by `Game.jsx` for the duration of a game.
- A Web Worker fires every `HEARTBEAT_PERIOD_MS` (1s) — using a worker means the timer keeps ticking even when the tab is backgrounded.
- Each tick writes `player.lastSeen = { ts, meetingState, videoState, audioState }`.

**Server side** (`server/src/callbacks.js`):
- Tuning constants (must stay paired with the 1s client period):
  - `PRESENCE_STALE_MS = 5000` — a player is "gone" when `Date.now() - lastSeen.ts > 5s`.
  - `PRESENCE_SWEEP_MS = 1000` — how often the lobby sweep runs.
- **Lobby sweep** (`sweepLobbyPresence`): runs every 1s. Prunes stale players from each waiting game's `waitingPlayers`, and reassigns/removes the group admin via `reassignAdmin` when an admin disappears. This keeps the lobby roster and the "Start" headcount honest.
- **In-stage check** (`onStageStart` interval): every 5s, marks `player.leftAt = now` for any player whose `lastSeen` has gone stale during a live stage.

---

## Negotiation Types

The role data declares its negotiation type via a top-level `type` field. An absent
`type` is treated as `"features"` (backward compatible with the original schema). All
three types share the single concept of **value** and the rule "never accept a deal
worth < 0"; they differ only in how options are presented and how value is computed.

| Type | UI | Value formula | Per-role data |
|------|----|--------------|---------------|
| `features` | Checkbox per issue (Include/Exclude) | Σ chosen option scores (unchecked → Exclude) | `scoresheet`, `RP` |
| `multiple_choice` | One ordered dropdown per issue | Σ chosen option scores (all issues required) | `scoresheet`, `RP` |
| `price` | Single number box | `multiplier · (rp − price)` | `multiplier`, `rp` |

`features` is the two-option special case of `multiple_choice`. For `price`, the
no-agreement value is `0` (the surplus relative to your reservation price); for the
choice types it is the role's `RP`.

---

## Role Data Format

Role data is loaded at game start from the `roleDataURL` treatment factor, which may
be **either a remote URL** (fetched via `curl`) **or a local file path** relative to
the project root (e.g. `roles_price_example.json`). This is the key configuration
point for defining different negotiation scenarios — the platform itself is
scenario-agnostic.

### Schema — `features` (default)

```json
{
  "type": "features",
  "roles": [
    {
      "role_name": "Party A",
      "narrative": "Markdown-compatible narrative text describing the role...",
      "BATNA": "Human-readable description of the fallback option",
      "RP": 0,
      "scoresheet": {
        "Issue_Name": [
          { "option": "Include", "score": 1.5, "reason": "Why including this helps you" },
          { "option": "Exclude", "score": 0, "reason": "" }
        ],
        "Another_Issue": [
          { "option": "Include", "score": -0.75, "reason": "Why including this hurts you" },
          { "option": "Exclude", "score": 0, "reason": "" }
        ]
      }
    }
  ],
  "tips": "<html>Negotiation tips HTML content shown in the Tips tab</html>"
}
```

### Schema — `multiple_choice`

Identical to `features` but with `"type": "multiple_choice"` and **more than two
options per issue**. Options are displayed as a dropdown in the **exact order given in
the JSON** (no reordering, no biasing default — the dropdown starts on a `— Select —`
placeholder and every issue must be chosen before a proposal can be submitted).

```json
{
  "type": "multiple_choice",
  "roles": [
    {
      "role_name": "Candidate",
      "narrative": "...",
      "BATNA": "...",
      "RP": 0,
      "scoresheet": {
        "Salary": [
          { "option": "$90,000",  "score": 0, "reason": "Below market" },
          { "option": "$110,000", "score": 4, "reason": "A fair salary" },
          { "option": "$130,000", "score": 8, "reason": "Excellent" }
        ]
      }
    }
  ],
  "tips": "..."
}
```

### Schema — `price`

Single-issue price bargaining. Each role carries a `multiplier` (buyer `+1`, seller
`-1`) and a reservation price `rp`; value is `multiplier · (rp − price)`. A top-level
`price_config` object controls the input box. Roles have **no `scoresheet`**.

```json
{
  "type": "price",
  "price_config": {
    "label": "Sale Price",
    "prefix": "$",
    "suffix": "",
    "min": 0,
    "max": 100000,
    "step": 250,
    "description": "Agree on a single sale price for the car."
  },
  "roles": [
    { "role_name": "Buyer",  "narrative": "...", "BATNA": "...", "multiplier": 1,  "rp": 20000 },
    { "role_name": "Seller", "narrative": "...", "BATNA": "...", "multiplier": -1, "rp": 12000 }
  ],
  "tips": "..."
}
```

### Field Reference

| Field | Type | Applies to | Description |
|-------|------|-----------|-------------|
| `type` | String | all | `"features"` (default if absent), `"multiple_choice"`, or `"price"`. |
| `roles` | Array | all | One entry per role. Players are assigned roles by cycling through this array. |
| `role_name` | String | all | Display name for the role (e.g., "Buyer", "Candidate"). |
| `narrative` | String | all | Markdown-compatible backstory and instructions shown to the player. |
| `BATNA` | String | all | Human-readable description of the player's best alternative to agreement. |
| `RP` | Number | features, multiple_choice | Reservation price — the player's value if no deal is reached. |
| `scoresheet` | Object | features, multiple_choice | Map of issue names to **ordered** option arrays. `features` has exactly 2 options (Include = index 0, Exclude = index 1); `multiple_choice` has any number. Underscores in issue names render as spaces. |
| `multiplier` | Number | price | `+1` for a buyer (value rises as price falls), `−1` for a seller. |
| `rp` | Number | price | Reservation price — the worst price still acceptable; value is `0` at this price. |
| `price_config` | Object | price | Controls the number box: `label`, `prefix`, `suffix`, `min`, `max`, `step`, `description` (all optional). |
| `tips` | String | all | HTML content displayed in the "Tips" tab. Shared across all roles. |
| `debrief` | Object | all | Optional. Content for the post-negotiation Debrief stage (shared across all roles). See below. |

### Debrief Block

A top-level `debrief` object (shared across all roles, like `tips`) supplies the content for the **Debrief & Discussion** stage. All fields are optional — an absent `debrief` simply shows placeholder messages.

```json
{
  "debrief": {
    "video_title": "Debrief: Creating Value Through Logrolling",
    "video_url": "https://customer-xxxx.cloudflarestream.com/<id>/manifest/video.m3u8",
    "outcome_note": "Optional line shown under the score on the Outcome tab.",
    "discussion_questions": [
      { "question": "Which terms did you include vs. exclude?", "guidance": "Optional supporting hint shown under the question." },
      "A plain string also works as a question with no guidance."
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `video_title` | String | Heading shown above the debrief video (defaults to "Debrief Video"). |
| `video_url` | String | Debrief video URL. A Cloudflare Stream **HLS manifest** URL (`.../<id>/manifest/video.m3u8`) is auto-converted to the minimal Stream **iframe** player; any other embeddable URL is used as-is. |
| `outcome_note` | String | Optional extra text on the Outcome tab. |
| `discussion_questions` | Array | List of prompts. Each item is either a string, or an object `{ question, guidance }`. |

### Designing a Scenario

To create a new negotiation scenario:

1. Choose a `type` (`features`, `multiple_choice`, or `price`).
2. Define the roles (typically 2-4 parties).
3. For choice types: define the negotiable issues and assign **asymmetric** scores so
   trading low-value issues for high-value ones (integrative bargaining) pays off. For
   `price`: set each role's `multiplier` and `rp` so a non-empty ZOPA exists (buyer
   `rp` above seller `rp`).
4. Set BATNA values (`RP` for choice types; for `price` the no-deal value is `0`).
5. Write narrative text and tips.
6. Either host the JSON at a public URL **or** drop it in the repo root.
7. Set `roleDataURL` to that URL or file path in the Empirica treatment configuration.

### Included Example Scenarios

One canonical example per type:

- **`roles_features_example.json`** (`features`) — Two-party apartment lease; 6 include/exclude terms (pet allowance, parking, gym, repaint, early move-in, two-year term) with asymmetric scores that reward logrolling.
- **`roles_multiplechoice_example.json`** (`multiple_choice`) — Two-party job offer; 4 issues (salary, start date, leave, remote days) × 3 ordered options each, with asymmetric scores that reward logrolling.
- **`roles_price_example.json`** (`price`) — Two-party used-car sale; buyer `rp` $20,000, seller `rp` $12,000 → ZOPA $12,000–$20,000.

Plus the original three-party `features` scenarios:

- **`roles_v1.json`** — Three-party vacation planning with detailed backstory narratives. 8 negotiable features.
- **`roles_v2.json`** — Three-party vacation planning with simplified narratives. Same 8 features, different scores.

---

## Treatment Configuration

Treatments are configured via the Empirica admin panel when creating batches.

| Factor | Type | Default | Description |
|--------|------|---------|-------------|
| `playerCount` | Number | varies | Players per negotiation game |
| `readRoleTime` | Number | 300 | Seconds for role reading stage (5 min) |
| `negotiateTime` | Number | 1800 | Seconds for negotiation stage (30 min). Values **over 18000 (5 hours)** hide the countdown timer during the negotiate stage, giving "unlimited" time without changing the layout. |
| `debriefTime` | Number | 1800 | Seconds for the Debrief & Discussion stage (30 min). Like `negotiateTime`, values **over 18000 (5 hours)** hide the countdown timer during the debrief stage. |
| `roleDataURL` | String | — | URL **or local file path** for the role JSON data (e.g., a hosted `roles_v1.json`, or `roles_price_example.json` in the repo root) |

---

## URL Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `participantKey` | Yes* | Unique player identifier for Empirica |
| `studentId` | No | Auto-generates `participantKey` as `{studentId}_{YYYYMMDD}` |
| `groupName` | Yes* | Group assignment for waiting room (prompted via form if missing) |
| `displayName` | No | Pre-fills and auto-submits the display name step (after camera/mic permission). Use `+` or `%20` for spaces, e.g. `john+smith`. Must be 2–20 chars to auto-submit. |
| `devKey` | No | Set to `oandi` for developer mode (auto-generates key, shows skip button) |
| `skipIntro` | No | Set to `T` to skip all intro steps (auto-assigns random animal name) |

*`participantKey` is required unless `studentId` or `devKey=oandi` is provided. `groupName` is required but can be entered via form if not in URL.

**Example URLs**:
```
# Standard participant
https://host/?participantKey=abc123&groupName=TeamAlpha

# Pre-filled, auto-submitted display name (+ = space)
https://host/?participantKey=abc123&groupName=TeamAlpha&displayName=john+smith

# Student with auto-generated key
https://host/?studentId=john&groupName=Section1

# Developer testing
https://host/?devKey=oandi&groupName=TestGroup&skipIntro=T
```

---

## Setup & Installation

### Prerequisites

- **Node.js** 20.11.1+ (managed via Volta)
- **npm** 10.2.4+
- **Empirica CLI**: `npm install -g @empirica/empirica`
- **Daily.co account** with API key

### Installation

```bash
# Clone repository
git clone <repository-url>
cd group-negotiation

# Install client dependencies
cd client && npm install

# Install server dependencies
cd ../server && npm install
```

### Configuration

1. **Daily.co API key**: Hard-coded in `server/src/callbacks.js`. ⚠️ The key is currently duplicated in **three** places — the top-level `DAILY_API_KEY` constant (~line 11), a redeclaration inside `onGameStart` (~line 1037), and the presence-polling block in `onStageStart` (~line 1215). Note the value used in the presence-polling block currently **differs** from the other two; consolidate to a single constant (ideally an environment variable) to avoid one of them being stale/wrong.
2. **Empirica auth**: Configure in `.empirica/empirica.toml` (admin username/password). ⚠️ Credentials are currently committed to the repo; move them out of version control for production.
3. **Custom assignment**: `server/src/index.js` registers `Classic({ disableAssignment: true })`, which turns off Empirica's built-in matchmaking so the custom waiting-game / group-admin flow in `callbacks.js` controls game creation.

---

## Development & Testing

### Running Locally

```bash
# Option 1: Empirica CLI (recommended)
empirica

# Option 2: Run separately
cd server && npm run dev     # Terminal 1
cd client && npm run dev     # Terminal 2
```

**Access points**:
- Participant interface: `http://localhost:8844`
- Admin dashboard: `http://localhost:3000/admin`

### Testing Flow

1. Open admin dashboard → Create batch with treatment → Start batch
2. Open participant interface in 3 browser windows (use incognito/different profiles)
3. Use `?devKey=oandi&groupName=TestGroup` for quick testing
4. Add `&skipIntro=T` to skip intro steps entirely

### Server Auto-Reload

```bash
cd server && npm run watch    # Watches src/ for changes and rebuilds
```

### Dev Mode Features

When `NODE_ENV=development` or `devKey=oandi` in URL:
- Red "SKIP" button appears in the profile bar to advance stages immediately
- Auto-generated participant keys for easy multi-window testing

---

## Data Collection

### Empirica Game State

All game state is automatically persisted by Empirica and exportable from the admin dashboard:

- Player attributes: `roleName`, `roleNarrative`, `roleScoresheet`, `roleBATNA`, `roleRP`, `displayName`, `groupName`, `bonus`, `reachedAgreement`, `studentId`, `lastSeen`, `leftAt`, `dailyMeetingToken`
- Round data: `proposalHistory` (complete record of all proposals and votes), `agreementReached`
- Game data: `treatment`, `groupName`, `roomUrl`, `participantTimestamps`, `activeDailyCalls`, `tips`, `debrief`, and (on the waiting game) `waitingPlayers`, `groupAdmins`, `gamePlayerCount`

### Daily.co Recordings & Transcripts

- **Raw-track recordings**: Individual audio/video tracks per participant, stored in Daily.co cloud
- **Transcripts**: Automatic speech-to-text with speaker identification
- Accessible via Daily.co dashboard or API (`GET /v1/recordings`, `GET /v1/transcription/:id`)

### Data Points Collected Per Session

| Data | Source | Format |
|------|--------|--------|
| Role assignments | Empirica | Player attributes |
| All proposals submitted | Empirica | `round.proposalHistory` array |
| All votes (accept/reject/finalize) | Empirica | Within proposal objects |
| Final scores | Empirica | `player.bonus` |
| Agreement status | Empirica | `round.agreementReached` |
| Video recordings | Daily.co | Raw tracks (per participant) |
| Transcripts | Daily.co | JSON with timestamps + speakers |
| Player presence/absence | Empirica | `player.lastSeen` (heartbeat), `player.leftAt`, `game.participantTimestamps` |
| Stage timing | Empirica | Built-in stage duration tracking |

---

## Deployment

### Production Setup

**Server**: DigitalOcean (or similar)
**Domain**: platform.negotiation.education
**SSL**: Automatic via Caddy + Let's Encrypt

### Deploy Steps

```bash
# 1. Bundle the application
empirica bundle

# 2. Transfer to server
scp bundle.tar.zst root@server:/root/

# 3. Start on server
ssh root@server "empirica serve bundle.tar.zst"
```

### Caddy Configuration

```caddy
platform.negotiation.education {
    reverse_proxy localhost:3000
}
```

---

## Additional Resources

- **Empirica Documentation**: https://empirica.ly/docs
- **Daily.co Documentation**: https://docs.daily.co
- **Empirica Discord**: https://discord.gg/empirica
