# Commit/PR approval gate: exact mechanics on pi and Claude Code

Scope: read-only research. This document pins the APIs needed to implement the decided gate design on both platforms, flags mismatches between published documentation and the installed binaries, and defines the shared protocol core. Nothing here is installed or configured.

Gate design (decided upstream, restated for reference):

- Skills present proposed commit and PR texts in fenced blocks tagged `commit-message` and `pr-message`.
- The gate arms only when the user's reply contains the word `approved`.
- An unarmed `git commit` (including `--amend`) or `gh pr create` is blocked with a reason that restates the protocol.
- `git commit` on branch `main` is blocked outright, armed or not.
- `git push` is not gated.

Environment verified:

- pi 0.85.0 at `/usr/lib64/node_modules/@earendil-works/pi-coding-agent` (package.json reports `0.85.0`). Docs read from that install: `docs/extensions.md`, `docs/session-format.md`, `docs/json.md`, `docs/settings.md`, plus TypeScript declarations in `dist/`.
- Claude Code: see the mismatch list. The npm directory `/usr/lib64/node_modules/@anthropic-ai/claude-code` contains version 2.0.33 (a `cli.js` JavaScript bundle). The `claude` on PATH is 2.1.223, a native ELF binary at `/home/samflores/.local/share/claude/versions/2.1.223` (symlinked from `~/.local/bin/claude`). Both artifacts were grepped; evidence is quoted inline.

---

## 1. pi 0.85.0

### 1.1 Extension loading

From `docs/extensions.md` in the install:

- Auto-discovery: `~/.pi/agent/extensions/*.ts` (global) or `.pi/extensions/*.ts` (project-local, loads only after the project is trusted). Subdirectory form `*/index.ts` also works.
- Explicit paths via `settings.json`: an `"extensions"` array of local file paths or directories, and a `"packages"` array for npm (`npm:@foo/bar@1.0.0`) or git (`git:github.com/user/repo@v1`) packages. Confirmed in `docs/settings.md`: settings live at `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project); the `extensions` setting is `string[]` of local extension paths, `packages` loads distributed pi packages.
- Quick tests: `pi -e ./extension.ts`.
- Extensions are loaded via jiti, so TypeScript works without compilation. The default export is a factory receiving `ExtensionAPI`.

### 1.2 The `tool_call` event (the gate's interception point)

From `docs/extensions.md`, verified against `dist/core/extensions/types.d.ts`:

- Fires after `tool_execution_start`, before the tool executes. It can block.
- Use `isToolCallEventType("bash", event)` to narrow. Import: `import { isToolCallEventType } from "@earendil-works/pi-coding-agent"` (export confirmed in `dist/index.d.ts` and the typed overloads in `dist/core/extensions/types.d.ts`: `export declare function isToolCallEventType(toolName: "bash", event: ToolCallEvent): event is BashToolCallEvent;`).
- Narrowed input shape for the bash tool: `event.input` is `{ command: string; timeout?: number }`. Source: `docs/extensions.md` ("event.input is { command: string; timeout?: number }") and `dist/core/tools/bash.d.ts` schema `declare const bashSchema: Type.TObject<{ command: Type.TString; timeout: Type.TOptional<Type.TNumber> }>` with `export type BashToolInput = Static<typeof bashSchema>;`.
- Blocking return value: `{ block: true, reason?: string, terminate?: boolean }`. Exact declaration in `dist/core/extensions/types.d.ts`:

```
export interface ToolCallEventResult {
    /** Block tool execution. To modify arguments, mutate `event.input` in place instead. */
    block?: boolean;
    reason?: string;
    terminate?: boolean;
}
```

- `terminate` is not needed by this gate (it stops the agent early).
- Direct narrowing via `event.toolName === "bash"` does not work for typing because `CustomToolCallEvent.toolName` is `string`; the guard function is the documented approach (note in `dist/core/extensions/types.d.ts`).

Working interception examples in the install: `examples/extensions/permission-gate.ts` (blocks dangerous bash via `on("tool_call")`, uses `ctx.ui.select` and returns `{ block: true, reason: "Blocked by user" }`) and `examples/extensions/protected-paths.ts` (blocks write/edit by path, uses `ctx.ui.notify` then `{ block: true, reason: ... }`).

### 1.3 Message events: reading the approval word and the fenced proposal

From `docs/extensions.md` and `dist/core/extensions/types.d.ts`:

- `message_start` and `message_end` fire for user, assistant, and toolResult messages. Declarations:

```
export interface MessageStartEvent {
    type: "message_start";
    message: AgentMessage;
}
export interface MessageEndEvent {
    type: "message_end";
    message: AgentMessage;
}
```

- A user-sent chat message arrives with `event.message.role === "user"` and `event.message.content` either a plain string or an array of content blocks. From `docs/session-format.md`:

```
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;  // Unix ms
}
interface TextContent {
  type: "text";
  text: string;
}
```

So the approval-word check is: if `content` is a string, test it directly; otherwise concatenate the `text` of every block with `type === "text"` and test that. (Note: `docs/session-format.md` shows `TextContent` as `{ type: "text"; text: string }`; the runtime pi-ai declaration in the install's `node_modules/@earendil-works/pi-ai/dist/types.d.ts` adds an optional `textSignature?: string` field. Both agree on `type` and `text`.)

- An assistant message has `role: "assistant"` and `content: (TextContent | ThinkingContent | ToolCall)[]`, so the same text extraction works for detecting a fenced block like ` ```commit-message `.
- Alternatives for the same signals, both documented in `docs/extensions.md`: `before_agent_start` carries `event.prompt` (the user's prompt text for the turn), and the `input` event carries `event.text` (raw input before skill/template expansion) with `event.source` (`"interactive"`, `"rpc"`, `"extension"`). The gate uses `message_end` because it also sees assistant text and works uniformly for queued messages.
- Ordering guarantee relevant to the gate: "Before `tool_call` runs, pi waits for previously emitted Agent events to finish draining through `AgentSession`. This means `ctx.sessionManager` is up to date through the current assistant tool-calling message." So by the time a `git commit` tool call is intercepted, the `message_end` events for the user approval message and the assistant proposal message in that turn have already been delivered to handlers.

### 1.4 State persistence across events

Yes, within one session runtime. Extensions are modules loaded once; the documented state pattern in `docs/extensions.md` ("State Management") uses variables captured in the factory closure and mutated across event handlers. The todo example reconstructs state in `session_start` from the session branch.

Caveat, documented: on `/new`, `/resume`, `/fork`, and `/reload`, pi emits `session_shutdown` for the old extension instance, "reloads and rebinds extensions for the new session", then emits `session_start`. Module state does not survive that rebind. The docs instruct: "Do cleanup work in `session_shutdown`, then reestablish any in-memory state in `session_start`." For this gate the armed flag is intentionally session-scoped and ephemeral: losing it on session replacement is the safe direction (disarmed).

### 1.5 `ctx.ui` and `ctx.sessionManager` inside `tool_call` handlers

- `ctx.ui` is available in event handlers. `docs/extensions.md` mode table: `ctx.hasUI` is `true` in TUI and RPC modes, `false` in print (`-p`) and JSON modes. Dialog methods (`select`, `confirm`, `input`) require `ctx.hasUI`; `notify` works in TUI and RPC. The installed `permission-gate.ts` example calls `ctx.ui.select` inside a `tool_call` handler and checks `ctx.hasUI` first. This gate needs no dialogs (approval arrives as chat text), so it has no UI dependency; it can optionally `ctx.ui.notify` when `ctx.hasUI` is true.
- `ctx.sessionManager` gives read-only session state (`getEntries()`, `getBranch()`, `buildContextEntries()`, `getLeafId()`). For `tool_call`, "this state is synchronized through the current assistant message before handlers run." Not required by the minimal gate (closure state suffices), but usable to re-derive history.
- `ctx.cwd` is the working directory, useful for running `git` against the right repo.

### 1.6 Minimal working pi extension

```typescript
// File: .pi/extensions/approval-gate.ts  (project-local, loads after trust)
//   or ~/.pi/agent/extensions/approval-gate.ts  (global)
//   or any path listed in the "extensions" array of settings.json
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const APPROVAL_WORD = "approved";
const REASON = [
  "Approval gate: this command is not approved.",
  "Protocol: the assistant proposes the commit or PR text in a fenced block",
  "tagged commit-message or pr-message; the user replies with a message",
  "containing the word 'approved'; only then may git commit (including --amend)",
  "or gh pr create run. git commit on main is always blocked. git push is not gated.",
].join(" ");

const approvalRe = new RegExp(`\\b${APPROVAL_WORD}\\b`, "i");
const commitRe = /\bgit\s+commit\b/;
const prCreateRe = /\bgh\s+pr\s+create\b/;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => b?.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  let armed = false; // module state: persists across events in this session runtime

  // Recompute on every finalized user message: armed iff it contains the approval word.
  pi.on("message_end", async (event, _ctx) => {
    if (event.message.role === "user") {
      armed = approvalRe.test(messageText(event.message.content));
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    const command: string = event.input.command;

    const isCommit = commitRe.test(command);
    const isPrCreate = prCreateRe.test(command);
    if (!isCommit && !isPrCreate) return undefined; // git push and everything else pass

    if (isCommit) {
      const branch = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch.code === 0 && branch.stdout.trim() === "main") {
        armed = false;
        return { block: true, reason: "git commit on main is blocked outright. " + REASON };
      }
    }

    if (!armed) {
      return { block: true, reason: REASON };
    }

    armed = false; // one approval covers exactly one gated command
    return undefined;
  });
}
```

`pi.exec(command, args, options?)` and its result fields (`result.stdout`, `result.stderr`, `result.code`, `result.killed`) are documented in `docs/extensions.md` ("pi.exec").

### 1.7 pi mismatch and verification notes

- No mismatch found between the install's `docs/extensions.md` and the install's TypeScript declarations for any API used above: `tool_call` shape, `ToolCallEventResult` (`block`, `reason`), `MessageStartEvent`/`MessageEndEvent`, and the bash input schema all agree.
- `pi --version` equivalent: package.json reports `0.85.0`, matching the task premise.

---

## 2. Claude Code

### 2.1 Install reality versus the task premise (flagged)

- `/usr/lib64/node_modules/@anthropic-ai/claude-code/package.json` reports version `2.0.33`, and that directory ships a `cli.js` (10,147,720 bytes, minified JavaScript).
- The `claude` binary on PATH reports `2.1.223 (Claude Code)` and is a native ELF executable (290,728,968 bytes) at `/home/samflores/.local/share/claude/versions/2.1.223`, symlinked from `/home/samflores/.local/bin/claude`. There is no `cli.js` for 2.1.223; its JavaScript payload is embedded in the ELF binary.
- Consequence: grep verification was run against both artifacts. Anything attributed to "cli.js" below is from the 2.0.33 npm install; anything attributed to "2.1.223 binary" is from the ELF file.

### 2.2 Documentation fetched

- `https://code.claude.com/docs/en/hooks` (Hooks reference), fetched with `curl --max-time 20`, HTTP success, title "Hooks reference - Claude Code Docs".
- `https://code.claude.com/docs/en/hooks-guide` (Automate actions with hooks), fetched the same way, title "Automate actions with hooks - Claude Code Docs".
- No fallback to docs.anthropic.com was needed.

### 2.3 stdin JSON schema

Common input fields (docs, "Common input fields"), with the input builder verified verbatim in both installed artifacts:

- cli.js (2.0.33), the common-input builder function `XR`:

```
function XR(A,B){let Q=B??m0();return{session_id:Q,transcript_path:qB1(Q),cwd:Z0(),permission_mode:A}}
```

- 2.1.223 binary, the equivalent builder `Bm` (wider window, includes newer optional fields):

```
return{session_id:n,transcript_path:zP(n),cwd:Mt(),prompt_id:xLt()??void 0,permission_mode:e,agent_id:r?.agentId,agent_type:o,effort:a}
```

So the field names for session id, transcript path, working directory, permission mode are `session_id`, `transcript_path`, `cwd`, `permission_mode` in both versions; `prompt_id`, `agent_id`, `agent_type`, `effort` are present in 2.1.223 (docs: `prompt_id` requires v2.1.196+) and absent from the 2.0.33 builder.

PreToolUse input (event used to gate `git commit` / `gh pr create`):

- Docs: common fields plus `tool_name`, `tool_input`, `tool_use_id`. `tool_input.command` is the shell command for the Bash tool.
- cli.js (2.0.33), verbatim, the PreToolUse input assembly:

```
let J={...XR(G),hook_event_name:"PreToolUse",tool_name:A,tool_input:Q};yield*ewA({hookInput:J,toolUseID:B,matchQuery:A,...
```

- 2.1.223 binary, verbatim (now including `tool_use_id` in the input object):

```
let u={...Bm(o,void 0,n),hook_event_name:"PreToolUse",tool_name:e,tool_input:r,tool_use_id:t};yield*KO({hookInput:u,toolUseID:t,matchQuery:e,...
```

Mismatch flagged: in 2.0.33 the PreToolUse stdin object does not include `tool_use_id` (it is passed separately as `toolUseID`), while 2.1.223 includes it. The gate does not need `tool_use_id`.

UserPromptSubmit input (event used to arm the gate):

- Docs: common fields plus `prompt`, "the text the user submitted". This is the event that fires on user prompt submission, and it does receive the prompt text.
- cli.js (2.0.33), verbatim:

```
let G={...XR(B),hook_event_name:"UserPromptSubmit",prompt:A};yield*ewA({hookInput:G,toolUseID:twA(),...
```

- 2.1.223 binary, verbatim:

```
{...Bm(t),hook_event_name:"UserPromptSubmit",prompt:e,...!1,session_title:WA(Rt())};yield*KO({hookInput:s,toolUseID:FBp.randomUUID(),...
```

### 2.4 Every denial path

For PreToolUse (the gate's block):

1. Exit code 2 with the reason on stderr. Docs: "Exit 2 means a blocking error... PreToolUse blocks the tool call"; "A hook that blocks by exiting 2 routes the same way as 'deny': Claude sees the stderr message as the denial reason." Exit 2 blocks even if stdout JSON says `permissionDecision: "allow"` ("Exit 2's block is the one outcome JSON can't override"). Exit 2 support is visible in both binaries (for example, cli.js embedded text: "hook runs in background and wakes the model on exit code 2 (blocking error)").
2. Exit 0 (or any code other than 2) with JSON on stdout. Exact output schema, verbatim from cli.js (2.0.33) zod validation:

```
hookSpecificOutput:k.union([k.object({hookEventName:k.literal("PreToolUse"),permissionDecision:k.enum(["allow","deny","ask"]).optional(),permissionDecisionReason:k.string().optional(),updatedInput:k.record(k.unknown()).optional()}),...
```

So the deny object is:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "reason shown to Claude"
  }
}
```

- 2.1.223 binary, embedded schema help text, verbatim:

```
- `hookSpecificOutput` - Event-specific output (must include `hookEventName`):
  - `additionalContext` - Text injected into model context
  - `permissionDecision` - "allow", "deny", or "ask" (PreToolUse only)
  - `permissionDecisionReason` - Reason for the permission decision (PreToolUse only)
  - `updatedInput` - Modified tool i[nput...]
```

- 2.1.223 binary, runtime validation string, verbatim:

```
Unknown hook permissionDecision type: [..]. Valid types are: allow, deny, ask, defer
```

and, on `defer`:

```
returned permissionDecision=defer in interactive mode; ignoring (defer is print-mode only)
```

- 2.0.33 cli.js, denial routing into the tool result, verbatim:

```
W.permissionBehavior="deny",W.blockingError={blockingError:A.hookSpecificOutput.permissionDecisionReason||A.reason||"Blocked by hook",command:B};break;case"ask":W.permissionBehavior="ask";break}
```

Precedence when multiple PreToolUse hooks return decisions: deny > defer > ask > allow (docs). Also from docs: exit code 1 or a non-2 failure with non-JSON stdout is a non-blocking error and the tool call proceeds, so a policy hook must use exit 2 or the JSON deny, never plain exit 1.

For UserPromptSubmit (not used to block by this gate, listed for completeness): denial is a top-level `decision: "block"` with `reason` in JSON output, or exit 2 with stderr (blocks prompt processing and erases the prompt). The 2.1.223 embedded help text confirms: "`decision` - 'block' for PostToolUse/Stop/UserPromptSubmit hooks (deprecated for PreToolUse, use hookSpecificOutput.permissionDecision instead)". Top-level `decision`/`reason` for PreToolUse is deprecated; values `"approve"`/`"block"` map to `"allow"`/`"deny"`.

### 2.5 Hook configuration and matcher syntax

Configuration locations (docs, "Hook locations"):

- `~/.claude/settings.json`: user scope, all projects.
- `.claude/settings.json`: project scope, shareable, committable.
- `.claude/settings.local.json`: project scope, not shareable.
- Managed policy settings (organization-wide), plugin `hooks/hooks.json`, skill frontmatter, and subagent frontmatter also define hooks. Not needed here.

Structure: a top-level `"hooks"` object keyed by event name; each event maps to an array of matcher groups `{ "matcher": ..., "hooks": [ { "type": "command", "command": "...", "args": [...] } ] }`. Verified in cli.js (2.0.33), verbatim: `{matcher:Y.matcher,hooks:[...]}` appears in the hook-config normalization code.

Matcher syntax (docs, "Matcher patterns"):

- `"*"`, `""`, or omitted: match all.
- Only letters, digits, `_`, `-`, spaces, `,`, `|`: exact string or `|`/`,`-separated exact list. `Bash` matches only the Bash tool; `Bash|PowerShell` covers both shell tools (relevant on Windows).
- Any other character: unanchored JavaScript regular expression (`mcp__memory__.*`).
- PreToolUse matchers filter on the tool name (`tool_name`). UserPromptSubmit has no matcher support: it always fires on every occurrence, and a `matcher` field on it is silently ignored.
- Optional per-handler `if` field using permission-rule syntax (for example `"Bash(git *)"`) to avoid spawning the script for unrelated commands. UNVERIFIED in both installed binaries; the gate does not depend on it (the script itself filters).

### 2.6 State between hook invocations

Command hooks are separate processes spawned per event (they run "in their own session without a controlling terminal" per docs), so there is no in-process state. Every invocation's stdin carries `session_id`, stable for the session (both builders above derive it once per session: `m0()` in 2.0.33, `n` in 2.1.223). A state file keyed by `session_id` therefore carries state across invocations within one session:

```
~/.cache/approval-gate/<session_id>.json   containing   {"armed": true}
```

Notes and risks:

- Keying by `session_id` alone is sufficient (UUID per session); including `cwd` in the key would also isolate concurrent sessions in the same repo, at the cost of a new key when Claude `cd`s mid-session (the docs note the `cwd` field follows Claude, including into worktrees). Either is defensible; the snippet below keys on `session_id` only.
- Stale files accumulate; Claude Code's own 30-day session cleanup (`cleanupPeriodDays`, per docs) does not touch this directory. A `SessionEnd` hook could delete the file; UNVERIFIED whether `SessionEnd` fires in all termination paths (kill, crash) in 2.1.223. Treat stale files as harmless (they only contain an armed flag that a new session id will not read).
- Hooks from settings files also run inside subagents (docs), and subagent input carries `agent_id`/`agent_type`. The gate does not need to distinguish; subagent `git commit` calls are gated identically.

### 2.7 Minimal working hook script and settings.json

Config (would live in the project's `.claude/settings.json`; NOT created by this research task):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
 "hooks": [
   { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/approval-gate.js" }
 ]
      }
    ],
    "PreToolUse": [
      {
 "matcher": "Bash",
 "hooks": [
   { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/approval-gate.js" }
 ]
      }
    ]
  }
}
```

`${CLAUDE_PROJECT_DIR}` is a documented placeholder for the project root. `UserPromptSubmit` needs no matcher (it has no matcher support). On Windows, use `"matcher": "Bash|PowerShell"` and expect the command in the same `tool_input.command` field.

Script:

```js
#!/usr/bin/env node
// File: .claude/hooks/approval-gate.js  (chmod +x)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const APPROVAL_WORD = "approved";
const REASON = [
  "Approval gate: this command is not approved.",
  "Protocol: the assistant proposes the commit or PR text in a fenced block",
  "tagged commit-message or pr-message; the user replies with a message",
  "containing the word 'approved'; only then may git commit (including --amend)",
  "or gh pr create run. git commit on main is always blocked. git push is not gated.",
].join(" ");

const approvalRe = new RegExp("\\b" + APPROVAL_WORD + "\\b", "i");
const commitRe = /\bgit\s+commit\b/;
const prCreateRe = /\bgh\s+pr\s+create\b/;

const input = JSON.parse(fs.readFileSync(0, "utf8")); // stdin: hook input JSON

function stateFile(sessionId) {
  return path.join(process.env.HOME, ".cache", "approval-gate", sessionId + ".json");
}
function writeArmed(sessionId, armed) {
  const file = stateFile(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ armed }));
}
function readArmed(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8")).armed === true;
  } catch {
    return false;
  }
}
function deny(reason) {
  // Exit 0 + JSON decision (equivalent alternative: print reason to stderr and exit 2)
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

if (input.hook_event_name === "UserPromptSubmit") {
  // Armed iff this prompt contains the approval word; any other prompt disarms.
  writeArmed(input.session_id, approvalRe.test(String(input.prompt ?? "")));
  process.exit(0);
}

if (input.hook_event_name === "PreToolUse" && input.tool_name === "Bash") {
  const command = String(input.tool_input?.command ?? "");
  const isCommit = commitRe.test(command);
  const isPrCreate = prCreateRe.test(command);
  if (!isCommit && !isPrCreate) process.exit(0); // git push and everything else pass

  if (isCommit) {
    let branch = "";
    try {
      branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: input.cwd,
        encoding: "utf8",
      }).trim();
    } catch {}
    if (branch === "main") {
      writeArmed(input.session_id, false);
      deny("git commit on main is blocked outright. " + REASON);
    }
  }

  if (!readArmed(input.session_id)) {
    deny(REASON);
  }
  writeArmed(input.session_id, false); // one approval covers exactly one gated command
  process.exit(0);
}

process.exit(0);
```

### 2.8 Claude Code mismatch flags (docs versus installed binaries)

1. Install premise: the task stated Claude Code 2.1.223 is installed at `/usr/lib64/node_modules/@anthropic-ai/claude-code`. That directory is 2.0.33 with a `cli.js`; 2.1.223 is a native ELF binary at `~/.local/share/claude/versions/2.1.223`. Both were verified; all evidence above names which artifact it came from.
2. `permissionDecision` values: current docs describe four values (allow, deny, ask, defer). The 2.0.33 cli.js zod enum is only `["allow","deny","ask"]`. The 2.1.223 runtime accepts defer ("Valid types are: allow, deny, ask, defer") but its own embedded help text still says `"allow", "deny", or "ask"`, an internal doc/binary inconsistency in 2.1.223. The gate uses only `"deny"`, safe on both.
3. Event coverage: the current docs list many events (UserPromptExpansion, PostToolBatch, PermissionRequest, WorktreeCreate, ConfigChange, and others). The 2.0.33 cli.js embedded event list is only `["PreToolUse","PostToolUse","Notification","UserPromptSubmit","SessionStart","SessionEnd","Stop","SubagentStop","PreCompact"]`, and grep finds no `UserPromptExpansion`, `PostToolBatch`, `WorktreeCreate`, or `ConfigChange` strings in it. The two events this gate uses, PreToolUse and UserPromptSubmit, exist in both.
4. `prompt_id`: documented as requiring v2.1.196+. Present in the 2.1.223 builder (`prompt_id:xLt()??void 0`); absent from the 2.0.33 builder. Consistent with the version note, listed because it means stdin payloads differ between the two installed versions.
5. `scratchpad_dir`: documented as requiring v2.1.257+. Grep finds no `scratchpad_dir` string in the 2.1.223 binary either (consistent: 2.1.223 predates 2.1.257). Do not rely on this field on these installs.
6. UNVERIFIED (docs-only, not grepped in the binaries): the `if` permission-rule filter syntax on handlers, `async`/`asyncRewake` handler fields, HTTP hook fields, and the exact matcher evaluation precedence details. None are used by the gate.
7. UNVERIFIED: whether the docs' claim that exit code 2 with invalid JSON still blocks ("Before v2.1.214, Claude Code treated that combination as a non-blocking error") applies to 2.0.33; on 2.0.33 that edge case may fail open. The gate never emits invalid JSON on a blocking path, so it is unaffected.

---

## 3. Shared core: protocol logic and factoring

### 3.1 The protocol state machine (identical on both platforms)

State: a single boolean `armed`, scoped to one session (pi: module variable; Claude Code: JSON file keyed by `session_id`).

1. On every user message (pi: `message_end` with `event.message.role === "user"`; Claude Code: `UserPromptSubmit` with `input.prompt`): `armed = /\bapproved\b/i.test(userText)`. Any user message without the word disarms; the approval must be the user's latest message when the gated command runs.
2. On a candidate Bash command (pi: `tool_call` narrowed with `isToolCallEventType("bash", event)`, read `event.input.command`; Claude Code: PreToolUse with `tool_name === "Bash"`, read `input.tool_input.command`):
   - Classify: `isCommit = /\bgit\s+commit\b/` (covers `--amend` and any other flags), `isPrCreate = /\bgh\s+pr\s+create\b/`. If neither, allow. `git push` matches neither and is never gated.
   - If `isCommit` and current branch is `main` (checked by running `git rev-parse --abbrev-ref HEAD` in the repo cwd: pi `ctx.cwd` via `pi.exec`; Claude Code `input.cwd` via `execFileSync`): block outright with the main-branch reason, set `armed = false`.
   - Else if `armed` is false: block, restating the protocol (the canonical reason text appears in both snippets above).
   - Else: set `armed = false` (one approval authorizes exactly one gated command) and allow.
3. Blocking: pi returns `{ block: true, reason }` from the `tool_call` handler; Claude Code prints the JSON deny object (`hookSpecificOutput` with `hookEventName`, `permissionDecision: "deny"`, `permissionDecisionReason`) and exits 0, or equivalently writes the reason to stderr and exits 2.

Known limits of the classifier (identical on both platforms, accepted): it is a string heuristic on the command text. It does not catch indirection such as git aliases, `sh -c 'git '"'"'commit'`, scripts that commit, or an amended commit smuggled through `GIT_EDITOR`. It does catch plain `git commit ...`, `git commit --amend ...`, and `gh pr create ...` wherever they appear in the command string, including after `&&` or `;`.

### 3.2 What factors into one script

Everything except the two adapter surfaces:

- The canonical reason string.
- The approval regex (`\bapproved\b`, case-insensitive).
- The classifier regexes (`git commit`, `gh pr create`).
- The branch check (`git rev-parse --abbrev-ref HEAD` against `main`).
- The arm/disarm/consume transitions.

Concrete factoring: put the four items above in one plain JavaScript module, say `approval-gate-core.js`, exporting `isApprovalText(text)`, `classify(command)` returning `{ commit, prCreate }`, `blockReason(kind)`, and `onMain(cwd)`. The Claude Code hook script (section 2.7) is then a thin stdin/stdout wrapper around it, and the pi extension imports the same module (Node built-ins and local imports resolve in pi extensions; `require`/`import` of a sibling file works since extensions are jiti-loaded modules) and wires it to `message_end` and `tool_call`. The only per-platform code left is:

- pi: event subscription, closure state, `{ block: true, reason }` return.
- Claude Code: stdin JSON parsing, `session_id`-keyed state file, JSON deny output or exit 2.

Parity differences to keep in mind when factoring:

- pi re-derives `armed` from finalized user messages (`message_end`), which also fires for messages injected via `sendUserMessage` with `source: "extension"`; the Claude Code `UserPromptSubmit` event fires on submitted prompts. If extension-injected user messages should not arm the gate, filter with the `input` event's `event.source` on pi instead; document the choice.
- Claude Code hooks also fire inside subagents (input gains `agent_id`/`agent_type`), gating subagent commits with the same session-scoped armed flag. pi's gate applies to the main session's tool calls (pi subagents spawned via `pi.exec` or the subagent example run tools through their own runtime; whether a nested pi agent's tool calls traverse the parent's `tool_call` handlers is UNVERIFIED from the docs read).
- Claude Code's state file survives a session restart with `--resume` if the session id is reused; pi's closure state does not survive `/resume` (extensions are rebound and `session_start` fires). Both are safe-direction differences: at worst the gate is stricter.
