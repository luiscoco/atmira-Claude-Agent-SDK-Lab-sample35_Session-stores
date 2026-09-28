# Session stores

This file describes the **steps followed** to add Concept 35 (**session stores**) to the Claude Agent SDK Lab: what was
read, what was probed, what was decided, how it was tested, and what the tests changed. To learn the concept itself,
read [Tab35-Session-stores.md](Tab35-Session-stores.md) (the same text is in `readme.md`).

| Concept | Topic | Routes | Explanation |
|---|---|---|---|
| 35 | Session stores: a `SessionStore` adapter, mirroring (`batched` / `eager`), resume on another machine, `continue`, subagent keys, a tenant key, the session functions with `{ sessionStore }`, `foldSessionSummary`, `importSessionToStore`, failures (`mirror_error`, `loadTimeoutMs`, refused options), a host-side check | `/api/c35/db`, `/entries`, `/reset`, `/run`, `/manage`, `/failures`, `/code` | [Tab35-Session-stores.md](Tab35-Session-stores.md) |

## How to run it

```powershell
npm run dev        # server on http://localhost:3001, web on the Vite port
```

`node_modules` was copied from sample34, so `npm install` is not needed. Open the **35. Session stores** tab.
`ANTHROPIC_API_KEY` must be in `.env`. Start it from a normal terminal, not from inside Claude Code (see Tab16). A
scenario costs about $0.001 (scenario 3 about $0.02).

> **Only one sample can run at a time.** Every sample's server uses port **3001**. Stop the other samples'
> `npm run dev` first.

## Step 1: Choose the feature

The request said "implement the following feature sample" with no feature text, as in sample28 to sample34. Every
field of `Options` in `sdk.d.ts` (`0.3.281`) was counted in `server/` and `src/`. Sixteen were used nowhere, among
them `sessionStore`, `sessionStoreFlush`, `loadTimeoutMs`, `promptSuggestions`, `toolAliases`,
`permissionPromptToolName` and `spawnClaudeCodeProcess`. **Session stores** were chosen: they are the largest of these
(an adapter type, seven functions that take a store, a system message), and they follow Concepts 6 and 19.

## Step 2: Read what the course already said

| Read | To learn |
|---|---|
| `Build-steps.md`, `34-output-styles.ts`, `Concept34OutputStyles.tsx` | The latest style: strict zod bodies, SSE events, a table of cases run in parallel, `#region` + `/code`, a host check |
| `19-session-management.ts`, `Tab19-Session-management.md`, `Tab6-Sessions.md` | What was already taught about sessions (so this concept only adds the store) |
| `server/index.ts`, `src/App.tsx`, `src/lib/sse.ts`, `src/styles.css` | Mounting, the tab list, SSE, the CSS classes to reuse |

## Step 3: Read the types and the SDK's code

| Found | Used for |
|---|---|
| `SessionStore` (`append`, `load`, optional `listSessions`, `listSessionSummaries`, `delete`, `listSubkeys`), `SessionKey`, `SessionStoreEntry`, `SessionSummaryEntry` | The adapter |
| `Options.sessionStore`, `sessionStoreFlush`, `loadTimeoutMs`; `{ sessionStore }` on `listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents` and the mutation functions | Parts A to C |
| `foldSessionSummary`, `importSessionToStore`, `InMemorySessionStore`, `SDKMirrorErrorMessage` | Summaries, migration, failures |
| In `sdk.mjs`: the mirror batcher (500 lines or 1 MiB, flush at each `result` before passing it on, retries with 200 / 800 ms backoff, 60 s timeout not retried); resume = `load()` in the parent + a `claude-resume-*` temp config dir; the checks that refuse `persistSession: false`, `enableFileCheckpointing` and `continue` without `listSessions`; the key from `CLAUDE_CODE_PROJECT_DIR_NAME` | What to probe, and the doc's numbers |

## Step 4: Probe before designing

A scratchpad script (in a temporary `.probe/` folder) ran real sessions with Haiku 4.5 and an `InMemorySessionStore`
wrapped in a logger, with two `CLAUDE_CONFIG_DIR`s:

| Probe | Result | Decision |
|---|---|---|
| One turn, batched | 2 appends: 12 lines at the `result`, 3 more (last-prompt, cost-state, ai-title) at close | Scenario 1, the timeline of store calls |
| Eager | 5 appends; the first one before the assistant message | Scenario 2 |
| Resume on machine B with the store | `load` (15 lines) + `listSubkeys`, the answer remembers; new lines go to the same key; B's dir stays empty; a `claude-resume-*` dir exists during the run, deleted after | Scenario 5, the "temporary CLAUDE_CONFIG_DIR" row |
| The same without the store | `No conversation found` | Scenario 6 |
| `listSessions`, `getSessionInfo`, `getSessionMessages`, `renameSession`, `tagSession`, `forkSession`, `deleteSession` with the store | All work through the store (the calls in Part C) | Part C |
| `append` that throws | 3 attempts per batch, `system/mirror_error`, result success | Part D, the host check |
| `persistSession: false`, `enableFileCheckpointing`, `continue` without `listSessions` | Refused before start | Part D |
| Slow `load` + `loadTimeoutMs: 1000`; unknown id | Throws "timed out"; `null` → `No conversation found` | Part D |
| `continue: true` on B | `listSessions` → newest → `load` | Scenario 7 |
| `importSessionToStore` | Reads the process's `CLAUDE_CONFIG_DIR`; then resume works on B | Scenario 8, `withConfigDir()` |
| `CLAUDE_CODE_PROJECT_DIR_NAME=tenant-acme` | projectKey `tenant-acme`; `listSessions({ dir })` returns nothing; resume with the same env works | Scenario 4 |
| A subagent | Its own key `subagents/agent-<id>`; `listSubagents` finds it; resume loads it | Scenario 3 |

## Step 5: Design the concept

- **A real adapter**, `FileSessionStore`: files under `store-lab/db/`, dedup by `uuid`, a summary sidecar kept with
  `foldSessionSummary`, and a check that no key leaves the folder. It is written the way a database adapter would be.
- **A spy** around it that reports every call (key, lines, types, time, result or error) and can break the store.
- **Two machines**: `store-lab/machine-a` and `machine-b` (two `CLAUDE_CONFIG_DIR`s), the same `cwd`.
- **A host check** (`mirrorCheck()`): at each `result`, the uuids of the local (or temporary) file against the store.
- **Routes**: `GET /db` (the store and both machines), `GET /entries` (one key's lines), `POST /reset`, `POST /run`
  (one query on A or B, with or without the store, resume / continue / subagent / tenant), `POST /manage` (the session
  functions), `POST /failures` (6 cases in parallel), `GET /code`.
- **The tab**: machine A, the store, machine B side by side (the store lets you pick the session); Parts A (mirror), B
  (resume elsewhere), C (session functions), D (failures), E (code), F (summary table).

## Step 6: Implement it

| File | What was done |
|---|---|
| `server/concepts/35-session-stores.ts` | New: `FileSessionStore`, `spy()`, `baseOptions()`, `collect()`, `mirrorCheck()`, `withConfigDir()`, `manage()`, the failure rows, the routes |
| `server/index.ts` | Mounted on `/api/c35` |
| `src/concepts/Concept35SessionStores.tsx` | New: `MachineFiles`, `StorePanel`, `Timeline`, `FailTable`, Parts A to F |
| `src/App.tsx`, `src/styles.css` | Tab; `.store-panel`, `.store-row`, `.tag-store`, `.store-call` |
| `.gitignore`, `Tab1-query().md` | `store-lab/`, table row |

`npx tsc --noEmit -p .` passed.

## Step 7: Test the routes

Port 3001 was left free for the other samples. A scratchpad script (`serve.ts`) mounted **only** the Concept 35 router
on port **3135**, with `.env` loaded and the `CLAUDE*` variables removed. `drive.mjs` posted each body the way the tab
does and printed each SSE event on one line; `m.mjs` did the same for `/manage`.

| Test | Result |
|---|---|
| `/run`: `{}`, machine `c`, `flush` without the store, `resume` + `continue`, tenant `../etc`, resume `../../x`, an unknown key; `/manage` with a bad id or action; `/entries` with `..` | Refused with a clear message, nothing started |
| Scenarios 1 to 4 | 2 appends (batched), 5 (eager), a `subagents/agent-…` key, a `tenant-acme` key missed by `listSessions({ dir })` |
| Scenarios 5 to 7, and a tenant resume | Remembers "Ada / tangerine"; `No conversation found` without the store; `continue` picks the newest; tenant resume answers "Mango" |
| `/manage`, all nine actions | The expected store calls (Part C); `getSessionInfo` of a deleted session → `undefined` |
| Scenario 8 | Imported 15 lines; resume on B answered "Teal" |
| `/failures` | The six rows of the doc's Step 7 |
| `/code` | 7 regions |

What the tests changed:

- **The slow-load row did not show the `load` call.** The SDK gave up after 1 s, but the spy only reports a call when
  it ends, 3 s later, after the row was sent. The row now waits for it and says so ("load() itself finished later: the
  SDK cannot cancel it"). The call summary also shows how long a call took.
- **The tenant listing came after resumes too**: now only for a new session.
- **Importing twice added 6 lines** (15 → 21): the lines without a `uuid`. The adapter was kept as the contract says,
  and the doc and the hint of scenario 8 explain it.
- **The cost estimates were 10 times too high** ($0.003 written, $0.0003 to $0.001 measured). The hints were fixed.

## Step 8: Run it in the real app

Vite ran on port **5199** with a scratchpad config whose proxy pointed to the 3135 server. Headless Edge was driven
through the DevTools protocol (`shot.mjs`), with real runs: empty the store, 1, 5, 6, 3, `listSessions()`, 9,
`code: adapter`.

| Check | Page |
|---|---|
| Open tab 35 | Machine A, the store, machine B; 7 code buttons |
| Scenario 1 | `store.append` rows, "every message is in the store" |
| Scenario 5 | `store.load`, the temporary `CLAUDE_CONFIG_DIR` row, "tangerine"; machine B still empty |
| Scenario 6 | `No conversation found` |
| Scenario 3 | The subagent key under the session in the store |
| Button 9 | The six rows; "after importSessionToStore(): all there" |
| Console | No error |

What the browser run changed:

- **The driver found nothing at first**: the Edge profile in the scratchpad had a path too long for Windows, and the
  script could miss the WebSocket `open` event. The profile moved to `%TEMP%\c35-edge`, and the script waits correctly.
  No code in the lab changed.
- **The host-check row printed the full project key** (about 100 characters). It now shows `projects/<key>/…` like
  the other rows.

All test processes were stopped, and `store-lab/`, `.probe/`, the Edge profile and leftover `claude-resume-*` folders
were deleted.

Costs: under $0.10 for all the probes, route tests and the browser test.

## Files added or changed

| File | Change |
|---|---|
| `server/concepts/35-session-stores.ts` | New: the Concept 35 routes, the adapter, the spy, the host check |
| `server/index.ts` | Mounts `/api/c35` |
| `src/concepts/Concept35SessionStores.tsx` | New: the Session stores tab |
| `src/App.tsx` | Tab |
| `src/styles.css` | Store panel and store-call styles |
| `.gitignore` | `store-lab/` |
| `Tab1-query().md` | Adds Concept 35 to the table |
| `Tab35-Session-stores.md` | Explanation of the concept |
| `readme.md` | Same content as `Tab35-Session-stores.md` |
| `Build-steps.md` | This file |
