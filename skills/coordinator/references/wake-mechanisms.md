# Wake mechanisms

How a coordinator gets woken when a tab agent reaches a sentinel. The wake
mechanism belongs to the **coordinator's own runtime**, not the tab agents',
so it is chosen by what the coordinator is running under. Arm exactly one.

Both branches replace the same thing: a foreground polling loop, which must
never block the coordinator chat.

## A Pi coordinator

Two mechanisms, both already present on the owner's machine. Before building
any monitoring, inventory the owner's global extensions; the right tool is
usually already installed.

### The herdr-wave-watcher extension

Global, at `~/.config/pi/agent/extensions/herdr-wave-watcher.ts`. It wakes
the coordinator session on events via `pi.sendMessage` with `triggerTurn`.

It arms via a marker named after the coordinator's own Pi session, whose
content is the wave's agent names, one per line:

```bash
printf 'impl-<slug>\nrev-<slug>\n' > /tmp/agent-kit-wave.active.s$PI_SESSION_ID
```

Write it at spawn, remove it at teardown. The watcher watches only the names
in its own marker, so coordinators never pick up each other's waves even
when they share a workspace or lose their herdr environment.

### A status-only daemon

Rewrites `/tmp/wave-telemetry/status.$HERDR_WORKSPACE_ID` every ~10s with the
wave's agent states and sentinels.

Start it with `setsid`, never as a foreground sleep in a tool call: the tool
kills its process group on exit. For the same reason, never use `pkill -f`
inside such a call, which can match the wrapper's own command line. Kill the
daemon at teardown by the pid recorded in the wave state.

The footer extension `wave-status.ts` (project-local `.pi/extensions/`, or
the global copy in `~/.config/pi/agent/extensions/`, activated with
`/reload`) reads that file and renders it via `ctx.ui.setStatus`, mirroring
how the subagent example streams `onUpdate` into its collapsed widget.

## A Claude Code coordinator

Neither Pi mechanism is available: the watcher wakes a session through
`pi.sendMessage`, and `PI_SESSION_ID` (which names its marker) is unset
outside Pi.

The equivalent is the `Monitor` tool, whose every stdout line becomes a chat
notification: the same push-wake as `triggerTurn` under a different name. Arm
one persistent Monitor per wave, running the watcher's own `pass()` logic
transcribed into shell:

- Poll `herdr agent list` every ~10s, filtered to the wave's agent names.
- For each implementer that is idle or done, run `herdr agent read <name>
  --source recent-unwrapped --lines 60` and match the implementer sentinel
  pattern. For each reviewer, stat its report file under
  `/tmp/agent-kit-reviews/feat/`.
- Dedupe against a state file keyed by agent name plus the agent's
  `state_change_seq` (or the report's mtime), so one event wakes once.
- Print one line per new event, and nothing otherwise: every line is a
  notification.

Emit failure signals too, not just the happy path. A monitor matching only
sentinels stays silent through a crashed agent, and silence reads exactly
like work in progress.

The status-only daemon and its footer extension have no Claude Code
equivalent and are dropped. The wave state file carries what the footer would
have rendered.

## Reading sentinels

Sentinel classification reads the settled turn via `agent read`, with
status-bar and separator lines filtered. The pane's literal last line is
always the status bar, so `pane wait-output --lines 1` never sees the
sentinel.

The sentinel is a packet contract: it exists only if the packet
instructs the agent to end its final message with the sentinel line.
The coordinator templates carry that instruction; any hand-rolled
prompt, a prototype packet or a one-off research prompt, must repeat
it verbatim: end the final message with IMPLEMENTATION COMPLETE, or
with BLOCKED: <reason> when unable to proceed, and send nothing after
it. An agent that ends in prose never wakes the coordinator, and
silence reads exactly like work in progress.
