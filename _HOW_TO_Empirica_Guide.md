# Developing Empirica Apps — A Practical Guide

*A developer's guide to building multiplayer behavioural-experiment apps on the Empirica (empirica.ly) framework. Grounded in the official source and in a real production study, the ZOPA-vs-Complexity video-negotiation platform.*

---

## 0\. What this guide is, in plain terms

[Empirica](https://empirica.ly) is an open-source framework for running **real-time, multi-participant experiments online** — the kind where several people are matched together, move through stages in lockstep, and have every action recorded for later analysis. It removes most of the plumbing (matching people, synchronising their screens, saving data) so the researcher only writes the parts that are specific to their study.

This document explains how an Empirica app is put together and how to build one well. It assumes the reader will be editing code, but it defines jargon as it goes. Two repositories sit alongside this guide for reference:

| Folder | What it is |
| :---- | :---- |
| `empirica/` | The official framework source — `github.com/empiricaly/empirica` |
| `zopa-vs-complexity/` | A real study built on Empirica (UCL; PI Joshua Becker) — `github.com/joshua-a-becker/zopa-vs-complexity`. Used throughout as the worked example. |

**A note on the example app.** ZOPA-vs-Complexity is a mature, customised study (video negotiation via Daily.co, Prolific recruitment, custom lobbies). It is excellent for seeing real patterns, but it is *not* a vanilla Empirica project — several conventions in it (the `devKey` value, the Daily.co integration) are the author's own choices, not framework requirements. Where that matters, this guide says so.

---

## 1\. Getting and running Empirica

**Install the command-line tool (one time):**

curl https://get.empirica.dev | sh

**Create and run a new project:**

empirica create my-project   \# scaffolds client/ \+ server/ and installs deps

cd my-project

empirica                     \# runs server \+ client together

- Participant interface: [**http://localhost:3000**](http://localhost:3000) (the example app uses a separate Vite dev server on [**http://localhost:8844**](http://localhost:8844) in development).  
- Admin dashboard: [**http://localhost:3000/admin**](http://localhost:3000/admin) — log in with the credentials in `.empirica/empirica.toml`, then create and start a *batch* to let participants in.

Full docs live at [**https://docs.empirica.ly**](https://docs.empirica.ly).

---

## 2\. Anatomy of an Empirica project

my-project/

├── client/                  \# React front-end (what participants see)

│   └── src/

│       ├── index.jsx        \# Mounts \<App/\>

│       ├── App.jsx          \# Root: wires up Empirica, intro/exit steps, lobby

│       ├── Game.jsx         \# The game shell — renders the current stage

│       ├── Stage.jsx        \# "Router": picks a component based on stage name

│       ├── intro-exit/      \# Consent, instructions, surveys, end screens

│       └── components/       \# Your study-specific UI (timers, chat, etc.)

├── server/

│   └── src/

│       └── callbacks.js     \# Server-side game logic (the experiment's "brain")

└── .empirica/

    ├── empirica.toml        \# Admin login \+ app settings

    ├── treatments.yaml      \# Experimental conditions (factors \+ treatments)

    └── lobbies.yaml         \# How participants are matched and what happens on timeout

Two halves, one rule of thumb:

- **`client/`** decides *what each participant sees and does*. It is React, and reads/writes shared state through Empirica hooks.  
- **`server/callbacks.js`** decides *what happens to the game* — setting up rounds and stages, assigning roles, scoring, paying bonuses. It is the single source of truth and the safe place for anything participants must not tamper with.

---

## 3\. The core data model

Everything in Empirica hangs off one hierarchy:

Batch  →  Game  →  Round  →  Stage

                              ▲

                           Player(s)

| Object | What it represents |
| :---- | :---- |
| **Batch** | A run of the study. You create and launch batches from the admin dashboard. A batch holds many games running in parallel. |
| **Game** | One self-contained experiment session with its matched group of players. |
| **Round** | An ordered phase within a game. A game can have several rounds. |
| **Stage** | A timed step within a round (minimum duration 5 s). Stages are **synchronous** — every player must finish (or the timer must expire) before the group advances together. |
| **Player** | One participant. Stores their identity, progress, and any custom data you attach. |
| **Treatment** | A named bundle of **factors** assigned to a game — i.e. one experimental condition. |
| **Factor** | A single variable that shapes a game (e.g. `playerCount`, `negotiateTime`). `playerCount` is mandatory. |
| **Lobby** | The waiting room where players are held until a group is ready. |

**Reading and writing state.** Every object above is a key–value store you read with `.get()` and write with `.set()`:

player.set("score", 150);

const score \= player.get("score") || 0;

game.set("agreementReached", true);

round.set("proposalHistory", history);

Anything you `.set()` is automatically synchronised to the right clients and saved to the database for export. This is the heart of how the framework works.

**Intro and exit steps are different.** Unlike rounds/stages, the intro steps (consent, instructions) and exit steps (surveys, payment screens) are **asynchronous** — each participant moves through them at their own pace.

---

## 4\. The client: how an experiment flows

The whole front-end is wrapped in two Empirica providers. From the example (`client/src/App.jsx:963`):

\<EmpiricaParticipant url={url} ns={playerKey} modeFunc={EmpiricaClassic}\>

  \<EmpiricaContext

     playerCreate={AutoPlayerIdForm}   // how a participant gets an identity

     introSteps={introSteps}           // consent, instructions, etc. (async)

     lobby={CustomLobby}               // waiting-room screen

     exitSteps={exitSteps}             // surveys / payment screens (async)

     finished={Finished}\>

    \<Game /\>                           // the actual game (synchronous rounds/stages)

  \</EmpiricaContext\>

\</EmpiricaParticipant\>

- **`ns`** is the participant's namespace — effectively their identity. In the example it comes from the URL (see §6).  
- **`introSteps` / `exitSteps`** are functions returning an array of React components shown in order. Crucially, they receive `{ game, player }`, so you can **decide the flow dynamically** — skipping steps, branching on a treatment, or showing a different ending depending on what happened (the example shows a different exit screen for "game terminated", "no more games", "lobby timed out", etc. — `App.jsx:161`).

**The stage router.** Inside a game, `Stage.jsx` looks at the current stage's name and renders the matching component:

const stageName \= stage.get("name");

if (stageName \=== "Read Negotiation Role") return \<ReadRole .../\>;

if (stageName \=== "Time To Negotiate")     return \<VideoNegotiate .../\>;

The stage *names* themselves are defined on the server (§5). Keeping the names in sync between server and client is a common source of "blank screen" bugs.

**Hooks you will use constantly** (from `@empirica/core/player/classic/react`): `usePlayer()`, `usePlayers()`, `useGame()`, `useRound()`, `useStage()`. They give you live objects whose `.get()`/`.set()` stay synchronised across all participants.

**Advancing a stage from the client:** `player.stage.set("submit", true)` marks *this* player done; the group advances when everyone has submitted or the timer runs out.

---

## 5\. The server: `callbacks.js`

This is where the game is built and scored. The framework fires callbacks at each life-cycle moment; you fill in what should happen:

import { ClassicListenersCollector } from "@empirica/core/admin/classic";

export const Empirica \= new ClassicListenersCollector();

Empirica.onGameStart(({ game }) \=\> {

  // Build the structure: add rounds and stages, assign roles, set up resources.

  const round \= game.addRound({ name: "Negotiation Game" });

  round.addStage({ name: "Read Negotiation Role", duration: 300 });

  round.addStage({ name: "Time To Negotiate",     duration: 1800 });

});

Empirica.onRoundStart(({ round }) \=\> { /\* per-round setup \*/ });

Empirica.onStageStart(({ stage }) \=\> { /\* per-stage setup \*/ });

Empirica.onStageEnded(({ stage }) \=\> { /\* clean up / record \*/ });

Empirica.onRoundEnded(({ round }) \=\> { /\* scoring, bonuses \*/ });

In the example, `onGameStart` fetches role data from a URL named in the treatment, assigns each player a role and scoresheet, and provisions a video room; `onRoundEnded` reads the negotiated proposal, computes each player's score, and writes `player.set("bonus", …)` (`server/src/callbacks.js:10`).

**Why this matters:** the server is trusted, the client is not. Put scoring, payment, role assignment, and anything a participant could otherwise cheat **on the server**. Read it back on the client with `.get()`.

---

## 6\. Custom URL parameters — patterns and best practices

This is one of the most useful and most misunderstood parts of building a real study. Empirica doesn't dictate a URL scheme; **you read `window.location.search` yourself** and decide what each parameter does. The example app establishes several conventions worth adopting.

### 6.1 The basic technique

const urlParams \= new URLSearchParams(window.location.search);

const devKey   \= urlParams.get("devKey")   || "";

const skipIntro \= urlParams.get("skipIntro");

A clean pattern from the example: on the name-entry screen, **every** URL parameter is copied onto the player so it lands in the exported data (`intro-exit/DisplayNameEntry.jsx:18`):

for (const \[key, value\] of urlParams.entries()) {

  if (key \!== "participantKey") player.set(key, value);

}

**Best practice — read once, persist to the player.** URL params are easy to lose (a refresh, a new tab, an OAuth bounce). Copy anything you care about onto the `player` object early so it survives in the data and across reloads.

### 6.2 `participantKey` — identity

`participantKey` is the identity the app feeds to `EmpiricaParticipant ns={…}`. Recruitment platforms (Prolific, MTurk) append it to the study link so each participant maps to a known ID. If it's missing, the example shows an "Invalid URL" page rather than letting an unidentified person in (`App.jsx:81`).

**Best practice — never let an anonymous participant start.** Gate entry on a valid identity (or generate one deliberately, as the dev/student paths below do).

### 6.3 `devKey` — developer mode and the per-stage SKIP button

`devKey` turns on developer affordances. In the example the magic value is `"oandi"`, and it does two things:

1. **Auto-generates a `participantKey`** so a developer can open the app directly without a recruitment link (`App.jsx:68`).  
2. **Shows a red SKIP button** on every stage, letting you jump past a stage's timer instead of waiting it out (`Profile.jsx:17`):

const isDevMode \= process.env.NODE\_ENV \=== 'development' ||

  new URLSearchParams(window.location.search).get('devKey') \=== 'oandi';

// ...

{isDevMode && (

  \<button onClick={() \=\> player.stage.set("submit", true)}\>SKIP\</button\>

)}

So `?devKey=oandi` is "let me in and let me move fast." The SKIP button simply submits the current stage for this player — the same call a real participant makes when they finish.

**Best practice — gate dev tools, and treat the key as a secret-ish.** Anyone with the URL and the key can skip stages, so:

- Don't reuse a guessable value, and don't print it in public docs.  
- Prefer gating on `process.env.NODE_ENV === 'development'` for things that should *never* reach participants, and reserve the `devKey` route for testing against a production-like deployment.  
- Pick **one** dev-key value and centralise it (a shared constant), rather than hard-coding the same string in several files as the example does.

### 6.4 `skipIntro` — jump straight into the game

`?skipIntro=T` makes the intro-step function return an empty list, so consent and instructions are skipped and a random display name is assigned (`App.jsx:135`):

const skipIntro \= urlParams.get("skipIntro");

if (skipIntro \== "T") {

  const animal \= \["lion","tiger","bear", /\* … \*/\]\[Math.floor(Math.random()\*10)\];

  player.set("displayName", player.get("displayName") ?? animal);

  return \[\];                 // no intro steps

}

This is purely for testing the game itself without clicking through consent every time.

**Best practice — skips are client-side only and must never gate real data.** `skipIntro` bypasses *display*, not server logic. Consent that has legal/ethical weight should be enforced where it counts (recorded on the player, checked on the server), so a stray `?skipIntro=T` can't quietly produce an unconsented record.

### 6.5 `studentId` — deterministic identity for classroom use

For in-class use the example accepts `?studentId=12345` and builds a stable `participantKey` of `studentId_YYYYMMDD` (`App.jsx:27`), so the same student on the same day maps to the same record.

### 6.6 Recommended conventions for your own apps

| Parameter | Purpose | Recommendation |
| :---- | :---- | :---- |
| `participantKey` | Real participant identity | Always required in production; supplied by the recruitment link. |
| `devKey` | Dev mode \+ SKIP button \+ auto-identity | One central secret value; gate all dev UI behind it. |
| `skipIntro` | Skip consent/instructions in testing | Use `=T`/absent. Never let it bypass server-side gating. |
| `studentId` | Deterministic classroom identity | Document the ID→key formula so data can be re-linked. |

When adding a new parameter: (1) read it once near the app root, (2) `player.set()` it so it reaches the data, (3) document it in your project README's "URL Parameters" section, and (4) decide explicitly whether it is **safe for participants to set** — assume they will.

---

## 7\. Treatments, factors, and lobbies (`.empirica/`)

**`treatments.yaml`** defines your conditions in two parts — the menu of `factors` and the named `treatments` that combine them:

factors:

  \- name: playerCount

    values: \[{ value: 2 }, { value: 3 }\]

  \- name: negotiateTime

    values: \[{ value: 300 }, { value: 900 }\]

treatments:

  \- name: 3-party-hard

    factors:

      playerCount: 3

      negotiateTime: 900

      roleDataURL: https://…/shared\_office\_3p\_hard.json

You then pick a treatment when creating a batch in the admin dashboard. On the server, read factors with `game.get("treatment").negotiateTime`; on the client, `useGame().get("treatment")`.

**Best practice — drive everything experimental through factors.** Timings, group sizes, condition text, even a URL pointing at the round's content (as the example does with `roleDataURL`) belong in treatments, not hard-coded. It lets you re-run variations without touching code, and the condition is recorded automatically.

**`lobbies.yaml`** controls matching: shared vs. individual lobbies, the timeout, and what happens to people who don't get matched (fail them, or let them through). The example ships three lobby configs and routes unmatched players to tailored exit screens — a pattern worth copying so nobody hits a dead end.

---

## 8\. Local development & testing workflow

1. Start the app (`empirica`, or the example's separate server \+ Vite dev server).  
2. Open the **admin dashboard**, create a batch with a treatment, and **start** it.  
3. Open the participant link in **two or more separate browser sessions** (different browsers or incognito windows — same browser shares identity and will look like one participant).  
4. Use `?devKey=…` to skip the queue/timers and `?skipIntro=T` to bypass consent while iterating.  
5. Inspect saved data via the dashboard / data export to confirm your `.set()` calls are landing.

**Best practice — always test with the real player count.** Single-player testing hides synchronisation bugs. Because stages are synchronous, behaviour with 1 player differs from 2+ (the example even special-cases `players.length === 1`).

---

## 9\. Best-practice checklist

- **Server owns the truth.** Scoring, payment, role assignment, eligibility → in `callbacks.js`. The client only displays and submits.  
- **Keep stage names in one place.** A typo between `callbacks.js` and `Stage.jsx` gives a blank screen, not an error.  
- **Persist URL params and key state onto the `player`** so they survive refreshes and land in the export.  
- **Make conditions data, not code** — push them into `treatments.yaml`.  
- **Plan every exit path.** Matched, unmatched, timed-out, terminated, batch-full — each needs a screen, or participants get stuck (and, on paid platforms, can't collect payment).  
- **Gate developer tooling** behind `NODE_ENV` and/or a `devKey`; never ship a participant a way to skip consent or scoring.  
- **Don't hard-code secrets.** API keys (the example hard-codes a Daily.co key in `callbacks.js`) and admin passwords belong in environment variables / untracked config, not in the repo.  
- **Test multiplayer, with the real player count.**

---

## 10\. ⚠️ Warnings & known pitfalls

**How to use this section.** Append project- or version-specific warnings here as they are discovered. Keep each one short and in the template below so the list stays scannable. Use the ⚠️ marker inline elsewhere in the guide when a warning belongs next to the thing it concerns.

**Template for a new warning:**

\#\#\# ⚠️ \<Short title\>

\- \*\*Applies to:\*\* \<Empirica version / this app / all apps\>

\- \*\*Symptom:\*\* \<what you see go wrong\>

\- \*\*Cause:\*\* \<why\>

\- \*\*Fix / avoid:\*\* \<what to do instead\>

\- \*\*Added:\*\* \<YYYY-MM-DD\> by \<name\>

---

*Seed warnings (derived from reviewing the example app — verify against your own version before relying on them):*

### ⚠️ `devKey` value is app-specific and hard-coded in multiple files

- **Applies to:** the example app (and any fork of it)  
- **Symptom:** The SKIP button / dev auto-login doesn't appear, or appears unexpectedly in production.  
- **Cause:** The magic value `"oandi"` is hard-coded separately in `App.jsx` and `Profile.jsx`; there is no shared constant and no production guard beyond the string itself.  
- **Fix / avoid:** Centralise the value, and consider disabling the `devKey` path entirely in production builds.  
- **Added:** 2026-06-13 by Claude (initial review)

### ⚠️ `skipIntro` bypasses consent display only

- **Applies to:** all apps using a client-side intro-skip  
- **Symptom:** A record exists for a participant who never saw the consent form.  
- **Cause:** `skipIntro=T` returns empty intro steps on the client; it does not touch any server-side consent record.  
- **Fix / avoid:** Enforce consent where it has weight (record it on the player and check server-side); keep `skipIntro` strictly for development.  
- **Added:** 2026-06-13 by Claude (initial review)

### ⚠️ Hard-coded API keys / admin credentials

- **Applies to:** the example app  
- **Symptom:** Secrets committed to git; risk of leak.  
- **Cause:** Daily.co API key in `server/src/callbacks.js`; admin password in `.empirica/empirica.toml`.  
- **Fix / avoid:** Move to environment variables; never commit live keys.  
- **Added:** 2026-06-13 by Claude (initial review)

### ⚠️ Single-player testing hides synchronisation bugs

- **Applies to:** all apps  
- **Symptom:** Works solo, breaks with real participants.  
- **Cause:** Rounds/stages are synchronous; the 1-player case is special-cased.  
- **Fix / avoid:** Always test with the treatment's real `playerCount`.  
- **Added:** 2026-06-13 by Claude (initial review)

---

## 11\. References

- Official framework & source: [https://github.com/empiricaly/empirica](https://github.com/empiricaly/empirica)  
- Documentation: [https://docs.empirica.ly](https://docs.empirica.ly)  
- Example study (worked example throughout): [https://github.com/joshua-a-becker/zopa-vs-complexity](https://github.com/joshua-a-becker/zopa-vs-complexity)  
- Local copies for reference: `./empirica/` and `./zopa-vs-complexity/`
