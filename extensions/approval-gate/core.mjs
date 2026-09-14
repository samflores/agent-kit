#!/usr/bin/env node
/**
 * The Claude Code hook entry point for the approval gate. Invoked once per
 * hook event as: node core.mjs <stop|userpromptsubmit|pretooluse>, with the
 * event's stdin JSON as documented in the Claude Code hooks reference.
 */
import { readFileSync } from "node:fs";
import { enforce, handleStop, handleUserPromptSubmit, stateDirFor, sweepState } from "./lib.mjs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function strictFences() {
  return process.env.AG_GATE_STRICT_FENCES !== "0";
}

const payload = (() => {
  try {
    return JSON.parse(readStdin() || "{}");
  } catch {
    return {};
  }
})();

const event = (process.argv[2] ?? payload.hook_event_name ?? "").toLowerCase();
const stateDir = stateDirFor();
sweepState(stateDir);
const strict = strictFences();

if (event === "stop") {
  handleStop({
    stateDir,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    strict,
  });
  process.exit(0);
}

if (event === "userpromptsubmit") {
  handleUserPromptSubmit({
    stateDir,
    sessionId: payload.session_id,
    prompt: payload.prompt,
    strict,
  });
  process.exit(0);
}

if (event === "pretooluse") {
  if (payload.tool_name !== "Bash") process.exit(0);
  const decision = enforce({
    stateDir,
    sessionId: payload.session_id,
    command: payload.tool_input?.command,
    cwd: payload.cwd || process.cwd(),
  });
  if (!decision.allow) {
    process.stderr.write((decision.reason ?? "Approval gate: blocked.") + "\n");
    process.exit(2);
  }
  process.exit(0);
}

process.exit(0);
