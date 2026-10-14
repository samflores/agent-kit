import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const APPROVAL_WORD = "approved";
export const FENCE_TYPES = ["commit-message", "pr-message"];
export const STATE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const PROTOCOL_REMINDER =
  "Protocol: the assistant presents the complete message in a fenced code " +
  "block tagged commit-message or pr-message, one at a time; the gated " +
  "command runs only after a later user reply containing the word " +
  "'approved', and only when its payload matches the fence exactly. git " +
  "commit on main is always blocked outright. git push is not gated.";

export const REASON_MAIN =
  "Approval gate: git commit on main is blocked outright, armed or not. " +
  "Move the work to a topic branch first.";

export const REASON_NOT_ARMED =
  "Approval gate: this command is not approved. " + PROTOCOL_REMINDER;

export const REASON_NO_MESSAGE =
  "Approval gate: git commit without an inline message is refused. Pass " +
  "the exact approved text with -m (heredoc form for a multi-line " +
  "message) or a readable -F/--file.";

export const REASON_PR_INCOMPLETE =
  "Approval gate: gh pr create is missing --title or --body/--body-file. " +
  "Give both, carrying the approved pr-message fence exactly: title, " +
  "blank line, body.";

export const REASON_UNVERIFIABLE =
  "Approval gate: the command's message could not be read for " +
  "verification (dynamic substitution, stdin without a heredoc, or an " +
  "unreadable file). Use the literal approved text via -m or --body, or " +
  "a readable --file/--body-file.";

export const REASON_INTERNAL =
  "Approval gate: internal error while checking this command; it is " +
  "treated as blocked. Re-present the fence, get approval, and retry.";

/** True when the text contains the approval word as a whole word, case-insensitive. */
export function isApprovalText(text) {
  return /\bapproved\b/i.test(String(text ?? ""));
}

/**
 * Draft normalization used for both sides of the strict match: trailing
 * whitespace stripped per line, then trailing blank lines removed. Interior
 * blank lines and leading content are preserved.
 */
export function normalizeDraft(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** SHA-256 hex digest of the normalized draft text. */
export function hashDraft(text) {
  return createHash("sha256").update(normalizeDraft(text), "utf8").digest("hex");
}

const fenceOpenRe = /^\s{0,3}(`{3,})[ \t]*(commit-message|pr-message)[ \t]*$/i;
const fenceCloseRe = /^\s{0,3}(`{3,})[ \t]*$/;

/**
 * Every protocol fence in the text, in order of appearance. A fence is a
 * code block whose info string is exactly commit-message or pr-message
 * (case-insensitive); it must be closed, otherwise it is ignored.
 */
export function parseFences(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const fences = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(fenceOpenRe);
    if (!open) {
      i += 1;
      continue;
    }
    const type = open[2].toLowerCase();
    const body = [];
    let j = i + 1;
    while (j < lines.length && !fenceCloseRe.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    if (j < lines.length) {
      fences.push({ type, content: body.join("\n") });
      i = j + 1;
    } else {
      i = j;
    }
  }
  return fences;
}

/** The last protocol fence in the text, or null. Later fences supersede earlier ones. */
export function latestFence(text) {
  const fences = parseFences(text);
  return fences.length > 0 ? fences[fences.length - 1] : null;
}

/**
 * A gated invocation counts only where a command can actually start: at
 * the beginning of the string, or just after a shell separator
 * (newline ; && || | &) or an opening subshell paren.
 *
 * A quoted string is a command start only when it is the argument of a
 * wrapper that executes it, so `sh -c '...'` stays gated while a quoted
 * mention inside some other command does not. Prose relayed to an agent,
 * or a grep for the phrase, is not a command the caller is running.
 */
const SEPARATOR_START = String.raw`(?:^|[\n;&|(])\s*`;
const WRAPPER = String.raw`(?:[a-z/]*sh|env|xargs|time|nohup|sudo|doas)`;
const WRAPPER_ARG = String.raw`(?:-[^\s]+(?:\s+[^-\s][^\s]*)?|[A-Za-z_][A-Za-z0-9_]*=[^\s]*)`;
const WRAPPER_START =
  String.raw`(?:^|[\n;&|(])\s*` +
  "(?:" + WRAPPER + String.raw`\s+` + "(?:" + WRAPPER_ARG + String.raw`\s+` + ")*)+" +
  String.raw`['"]`;

function gatedRe(invocation) {
  return new RegExp(
    "(?:" + SEPARATOR_START + "|" + WRAPPER_START + ")" + invocation,
  );
}

const gitCommitRe = gatedRe(String.raw`git\s+commit\b`);
const ghPrCreateRe = gatedRe(String.raw`gh\s+pr\s+create\b`);

/**
 * Best-effort classification of a shell command string. Only git commit
 * and gh pr create are gated; git push, gh pr edit, and everything else
 * pass. The threat model is forgetting the protocol, not evading the gate.
 */
export function classify(command) {
  const cmd = String(command ?? "");
  return { commit: gitCommitRe.test(cmd), prCreate: ghPrCreateRe.test(cmd) };
}

/** The current git branch name in a directory, or null when git cannot answer. */
export function currentBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function readTextFile(target, cwd) {
  try {
    const resolved = isAbsolute(target) ? target : resolve(cwd, target);
    return readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

function scanSingleQuoted(src, start) {
  const end = src.indexOf("'", start + 1);
  if (end === -1) return { text: src.slice(start + 1), closed: false, next: src.length };
  return { text: src.slice(start + 1, end), closed: true, next: end + 1 };
}

const ansiEscapes = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };

function scanAnsiQuoted(src, start) {
  let text = "";
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'") return { text, closed: true, next: i + 1 };
    if (ch === "\\" && i + 1 < src.length) {
      const escaped = src[i + 1];
      text += ansiEscapes[escaped] ?? escaped;
      i += 2;
      continue;
    }
    text += ch;
    i += 1;
  }
  return { text, closed: false, next: src.length };
}

/**
 * Captures the source between $( and its matching close paren, honoring
 * nested parens and quoted spans. Newlines are allowed so heredoc bodies
 * inside the substitution are captured whole.
 */
function captureSubstitution(src, start) {
  let depth = 1;
  let i = start + 2;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === "`") {
      const quote = ch === "'" ? "'" : "`";
      const end = src.indexOf(quote, i + 1);
      if (end === -1) return { inner: src.slice(start + 2), next: src.length };
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end === -1) return { inner: src.slice(start + 2), next: src.length };
      i = end + 1;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { inner: src.slice(start + 2, i), next: i + 1 };
    }
    i += 1;
  }
  return { inner: src.slice(start + 2), next: src.length };
}

/**
 * The literal value of a command substitution, when it is statically
 * known: only cat with a heredoc qualifies. Anything else (or an
 * unterminated heredoc, or an unquoted heredoc containing expansions)
 * is dynamic and cannot be verified.
 */
function substitutionValue(inner) {
  const match = inner.match(
    /^[ \t]*cat[ \t]+(?:-[ \t]+)?<<(-?)[ \t]*('([^']*)'|"([^"]*)"|([^\s;&|<>)]+))[ \t]*\n?/,
  );
  if (!match) return { dynamic: true };
  const stripTabs = match[1] === "-";
  const tag = match[3] ?? match[4] ?? match[5];
  const quoted = match[3] !== undefined || match[4] !== undefined;
  let rest = inner.slice(match[0].length);
  const lines = [];
  let closed = false;
  while (rest.length > 0) {
    const nl = rest.indexOf("\n");
    const line = nl === -1 ? rest : rest.slice(0, nl);
    rest = nl === -1 ? "" : rest.slice(nl + 1);
    const compare = stripTabs ? line.replace(/^\t+/, "") : line;
    if (compare === tag) {
      closed = true;
      break;
    }
    lines.push(line);
    if (nl === -1) break;
  }
  const body = lines.join("\n");
  if (!closed) return { dynamic: true };
  if (!quoted && /[$`]/.test(body)) return { dynamic: true };
  return { value: body };
}

function scanDoubleQuoted(src, start) {
  const parts = [];
  let dynamic = false;
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') return { parts, dynamic, closed: true, next: i + 1 };
    if (ch === "\\") {
      if (i + 1 >= src.length) break;
      const escaped = src[i + 1];
      if (escaped === "\n") {
        i += 2;
        continue;
      }
      if ('"\\$`'.includes(escaped)) {
        parts.push(escaped);
        i += 2;
        continue;
      }
      parts.push("\\");
      i += 1;
      continue;
    }
    if (ch === "$" && src[i + 1] === "(") {
      const sub = captureSubstitution(src, i);
      const value = substitutionValue(sub.inner);
      if (value.dynamic) dynamic = true;
      else parts.push(value.value);
      i = sub.next;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      dynamic = true;
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === "$" && /[A-Za-z_{(]/.test(src[i + 1] ?? "")) {
      dynamic = true;
      if (src[i + 1] === "{") {
        const end = src.indexOf("}", i + 2);
        i = end === -1 ? src.length : end + 1;
        continue;
      }
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      i = j;
      continue;
    }
    parts.push(ch);
    i += 1;
  }
  return { parts, dynamic, closed: false, next: src.length };
}

const heredocTagStop = /[^\s;&|<>)]/;

/**
 * Splits a shell command into words and operators, best effort, so flag
 * payloads can be extracted. Each token carries the literal text it
 * expands to and a dynamic flag set whenever the expansion cannot be
 * computed statically (variables, non-cat substitutions, backticks).
 * Heredoc redirections attach their body to the << operator token.
 */
export function shellTokens(command) {
  const src = String(command ?? "");
  const tokens = [];
  const pendingHeredocs = [];
  let word = null;

  const startWord = () => {
    if (!word) word = { parts: [], dynamic: false };
  };
  const flushWord = () => {
    if (!word) return;
    tokens.push({ text: word.parts.join(""), dynamic: word.dynamic, operator: false, heredoc: null });
    word = null;
  };
  const pushOperator = (text) => {
    flushWord();
    tokens.push({ text, dynamic: false, operator: true, heredoc: null });
  };

  function readHeredocBodies(start) {
    let pos = start;
    for (const heredoc of pendingHeredocs) {
      const lines = [];
      let closed = false;
      while (pos <= src.length) {
        const nl = src.indexOf("\n", pos);
        const line = nl === -1 ? src.slice(pos) : src.slice(pos, nl);
        const next = nl === -1 ? src.length + 1 : nl + 1;
        const compare = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
        if (compare === heredoc.tag) {
          closed = true;
          pos = next;
          break;
        }
        lines.push(line);
        pos = next;
        if (nl === -1) break;
      }
      heredoc.body = lines.join("\n");
      heredoc.closed = closed;
      heredoc.dynamic = !heredoc.quoted && /[$`]/.test(heredoc.body);
    }
    pendingHeredocs.length = 0;
    return Math.min(pos, src.length);
  }

  function pushHeredocOperator(i) {
    let j = i + 2;
    let stripTabs = false;
    if (src[j] === "-") {
      stripTabs = true;
      j += 1;
    }
    while (src[j] === " " || src[j] === "\t") j += 1;
    let tag = null;
    let quoted = false;
    if (src[j] === "'" || src[j] === '"') {
      const quote = src[j];
      const end = src.indexOf(quote, j + 1);
      if (end !== -1) {
        tag = src.slice(j + 1, end);
        quoted = true;
        j = end + 1;
      }
    }
    if (tag === null) {
      let k = j;
      while (k < src.length && heredocTagStop.test(src[k])) k += 1;
      if (k > j) {
        tag = src.slice(j, k);
        j = k;
      }
    }
    if (tag === null || tag === "") {
      pushOperator("<");
      return i + 2;
    }
    flushWord();
    const heredoc = { tag, quoted, stripTabs, body: null, closed: false, dynamic: false };
    tokens.push({ text: "<<", dynamic: false, operator: true, heredoc });
    pendingHeredocs.push(heredoc);
    return j;
  }

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      flushWord();
      i = readHeredocBodies(i + 1);
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      i += 1;
      continue;
    }
    if (ch === "\\") {
      if (src[i + 1] === "\n") {
        flushWord();
        i += 2;
        continue;
      }
      if (i + 1 < src.length) {
        startWord();
        word.parts.push(src[i + 1]);
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      startWord();
      const r = scanSingleQuoted(src, i);
      word.parts.push(r.text);
      if (!r.closed) word.dynamic = true;
      i = r.next;
      continue;
    }
    if (ch === '"') {
      startWord();
      const r = scanDoubleQuoted(src, i);
      word.parts.push(...r.parts);
      if (!r.closed || r.dynamic) word.dynamic = true;
      i = r.next;
      continue;
    }
    if (ch === "`") {
      startWord();
      word.dynamic = true;
      const end = src.indexOf("`", i + 1);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === "$") {
      const next = src[i + 1];
      if (next === "(") {
        startWord();
        const sub = captureSubstitution(src, i);
        const value = substitutionValue(sub.inner);
        if (value.dynamic) word.dynamic = true;
        else word.parts.push(value.value);
        i = sub.next;
        continue;
      }
      if (next === "'") {
        startWord();
        const r = scanAnsiQuoted(src, i + 1);
        word.parts.push(r.text);
        if (!r.closed) word.dynamic = true;
        i = r.next;
        continue;
      }
      if (next === "{") {
        startWord();
        word.dynamic = true;
        const end = src.indexOf("}", i + 2);
        i = end === -1 ? src.length : end + 1;
        continue;
      }
      if (/[A-Za-z_]/.test(next ?? "")) {
        startWord();
        word.dynamic = true;
        let j = i + 1;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
        i = j;
        continue;
      }
      startWord();
      word.parts.push("$");
      i += 1;
      continue;
    }
    if (ch === "<" && src[i + 1] === "<") {
      i = pushHeredocOperator(i);
      continue;
    }
    if (";&|()<>".includes(ch)) {
      let op = ch;
      if (";&|".includes(ch) && src[i + 1] === ch) op += ch;
      pushOperator(op);
      i += op.length;
      continue;
    }
    startWord();
    word.parts.push(ch);
    i += 1;
  }
  flushWord();
  if (pendingHeredocs.length > 0) readHeredocBodies(src.length);
  return tokens;
}

/**
 * Collects the values of one flag across a token list. Supports the short
 * form with attached or separated value, and each long form with = or a
 * separated value. Tokens that expand dynamically are returned as-is so
 * callers can refuse them.
 */
function extractFlagValues(tokens, short, longs) {
  const values = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.operator) continue;
    const text = token.text;
    let attached = null;
    let wantsNext = false;
    if (short !== null && text === "-" + short) {
      wantsNext = true;
    } else if (
      short !== null &&
      text.startsWith("-" + short) &&
      !text.startsWith("--") &&
      text.length > short.length + 1
    ) {
      attached = text.slice(short.length + 1);
    } else {
      for (const long of longs) {
        if (text === "--" + long) {
          wantsNext = true;
          break;
        }
        if (text.startsWith("--" + long + "=")) {
          attached = text.slice(long.length + 3);
          break;
        }
      }
    }
    if (!wantsNext && attached === null) continue;
    if (wantsNext) {
      const next = tokens[i + 1];
      if (
        !next ||
        next.operator ||
        (next.text.startsWith("-") && next.text !== "-")
      ) {
        return { values, missing: true };
      }
      values.push(next);
      i += 1;
      continue;
    }
    values.push({ text: attached, dynamic: token.dynamic, heredoc: token.heredoc });
  }
  return { values, missing: false };
}

function stdinHeredoc(tokens) {
  for (const token of tokens) {
    if (token.operator && token.heredoc && token.heredoc.body !== null) return token.heredoc;
  }
  return null;
}

/**
 * The commit payload of a git commit command: every -m/--message value
 * with paragraphs joined by a blank line, or the contents of -F/--file.
 * Reasons: no-message (nothing inline, the editor path), unverifiable
 * (dynamic substitution, stdin without a heredoc, unreadable file).
 */
export function commitPayload(command, { cwd = process.cwd() } = {}) {
  const tokens = shellTokens(command);
  const messages = extractFlagValues(tokens, "m", ["message"]);
  if (messages.values.length > 0) {
    if (messages.values.some((value) => value.dynamic)) {
      return { ok: false, reason: "unverifiable" };
    }
    return { ok: true, payload: messages.values.map((value) => value.text).join("\n\n") };
  }
  const files = extractFlagValues(tokens, "F", ["file"]);
  const file = files.values[files.values.length - 1];
  if (!file) return { ok: false, reason: "no-message" };
  if (file.dynamic) return { ok: false, reason: "unverifiable" };
  if (file.text === "-") {
    const heredoc = stdinHeredoc(tokens);
    if (heredoc && heredoc.closed && !heredoc.dynamic) {
      return { ok: true, payload: heredoc.body };
    }
    return { ok: false, reason: "unverifiable" };
  }
  const content = readTextFile(file.text, cwd);
  if (content === null) return { ok: false, reason: "unverifiable" };
  return { ok: true, payload: content };
}

/**
 * The PR payload of a gh pr create command: title, blank line, body. The
 * body comes from --body/-b or from --body-file/-F (a readable path or -
 * with a heredoc on stdin). Reasons: missing-parts, unverifiable.
 */
export function prPayload(command, { cwd = process.cwd() } = {}) {
  const tokens = shellTokens(command);
  const titles = extractFlagValues(tokens, "t", ["title"]);
  const bodies = extractFlagValues(tokens, "b", ["body"]);
  const bodyFiles = extractFlagValues(tokens, "F", ["body-file"]);
  const title = titles.values[titles.values.length - 1];
  if (!title) return { ok: false, reason: "missing-parts" };
  if (title.dynamic) return { ok: false, reason: "unverifiable" };
  if (bodies.values.length > 0) {
    const body = bodies.values[bodies.values.length - 1];
    if (body.dynamic) return { ok: false, reason: "unverifiable" };
    return { ok: true, payload: title.text + "\n\n" + body.text };
  }
  const file = bodyFiles.values[bodyFiles.values.length - 1];
  if (!file) return { ok: false, reason: "missing-parts" };
  if (file.dynamic) return { ok: false, reason: "unverifiable" };
  if (file.text === "-") {
    const heredoc = stdinHeredoc(tokens);
    if (heredoc && heredoc.closed && !heredoc.dynamic) {
      return { ok: true, payload: title.text + "\n\n" + heredoc.body };
    }
    return { ok: false, reason: "unverifiable" };
  }
  const content = readTextFile(file.text, cwd);
  if (content === null) return { ok: false, reason: "unverifiable" };
  return { ok: true, payload: title.text + "\n\n" + content };
}

function payloadFailureReason(reason) {
  if (reason === "no-message") return REASON_NO_MESSAGE;
  if (reason === "missing-parts") return REASON_PR_INCOMPLETE;
  return REASON_UNVERIFIABLE;
}

function mismatchReason(expectedType) {
  return (
    "Approval gate: the command's message does not match the presented " +
    expectedType +
    " fence. Run the command with exactly the fenced text."
  );
}

/** The state directory under a home directory. */
export function stateDirFor(home = homedir()) {
  return join(home, ".cache", "agent-kit", "approval-gate");
}

/**
 * A filesystem-safe session id, or null when the id cannot be used as a
 * state file name.
 */
export function sanitizeSessionId(sessionId) {
  const cleaned = String(sessionId ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.startsWith(".")) return null;
  return cleaned;
}

function normalizedFence(fence) {
  if (typeof fence !== "object" || fence === null) return null;
  if (!FENCE_TYPES.includes(fence.type) || typeof fence.hash !== "string") return null;
  return { type: fence.type, hash: fence.hash };
}

/** The session state, or null when absent or corrupt. */
export function readState(stateDir, sessionId) {
  const id = sanitizeSessionId(sessionId);
  if (!id) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir, id), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      fence: normalizedFence(parsed.fence),
      armed: parsed.armed === true,
      approved_hash: typeof parsed.approved_hash === "string" ? parsed.approved_hash : null,
      entries_seen: Number.isFinite(parsed.entries_seen) ? parsed.entries_seen : 0,
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : null,
      transcript_error: typeof parsed.transcript_error === "string" ? parsed.transcript_error : null,
      created: Number(parsed.created) || 0,
      updated: Number(parsed.updated) || 0,
    };
  } catch {
    return null;
  }
}

function writeState(stateDir, sessionId, state) {
  const id = sanitizeSessionId(sessionId);
  if (!id) return;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, id), JSON.stringify(state));
}

/**
 * Records a presented fence as pending. A new fence replaces any pending
 * or armed state (supersession); the arm resets to false.
 *
 * Re-recording the fence already on file keeps the arm. The approval turn
 * appends transcript entries that still carry the fence, so the next Stop
 * hook rescans them and records the same fence again. Disarming there would
 * destroy the arm before the commit it authorises ever runs.
 */
export function recordFence(stateDir, sessionId, fence, entriesSeen, now = Date.now()) {
  const previous = readState(stateDir, sessionId);
  const hash = hashDraft(fence.content);
  const unchanged = previous?.fence?.type === fence.type && previous?.fence?.hash === hash;
  // A deferred approval (the word arrived before this fence was recorded)
  // arms only the exact text it approved. Any other fence supersedes it
  // unarmed, so an early approval can never authorize unseen text.
  const deferred = previous?.approved_hash != null && previous.approved_hash === hash;
  writeState(stateDir, sessionId, {
    ...previous,
    fence: { type: fence.type, hash },
    armed: unchanged ? previous.armed === true : deferred,
    approved_hash: null,
    entries_seen: entriesSeen,
    created: previous?.created ?? now,
    updated: now,
  });
}

/**
 * Arms the pending fence when the text carries the approval word. A bare
 * approval with nothing pending is a no-op: there is no way to arm the
 * gate without a fence to check a payload against. Text without the
 * approval word changes nothing.
 */
export function armState(stateDir, sessionId, now = Date.now(), { approvedHash = null } = {}) {
  const state = readState(stateDir, sessionId);
  if (state?.fence) {
    if (state.armed) return state;
    const next = { ...state, armed: true, updated: now };
    writeState(stateDir, sessionId, next);
    return next;
  }
  // Nothing pending yet. When the approval carries the approved text, hold
  // its hash so the matching fence arms itself the moment it is recorded.
  // A bare approval with nothing pending stays a no-op.
  if (approvedHash) {
    const next = {
      ...state,
      fence: null,
      armed: false,
      approved_hash: approvedHash,
      entries_seen: state?.entries_seen ?? 0,
      created: state?.created ?? now,
      updated: now,
    };
    writeState(stateDir, sessionId, next);
    return next;
  }
  return state;
}

/**
 * Ends the fence's life after an allowed gated command: fence cleared,
 * armed cleared, transcript marker preserved so the fence cannot be
 * resurrected by a later transcript scan.
 */
export function consumeState(stateDir, sessionId, now = Date.now()) {
  const state = readState(stateDir, sessionId);
  if (!state) return;
  writeState(stateDir, sessionId, { ...state, fence: null, armed: false, updated: now });
}

function markEntriesSeen(stateDir, sessionId, entriesSeen, now) {
  const state = readState(stateDir, sessionId);
  if (!state) {
    writeState(stateDir, sessionId, {
      fence: null,
      armed: false,
      approved_hash: null,
      entries_seen: entriesSeen,
      cwd: null,
      transcript_error: null,
      created: now,
      updated: now,
    });
    return;
  }
  writeState(stateDir, sessionId, {
    ...state,
    entries_seen: entriesSeen,
    transcript_error: null,
    updated: now,
  });
}

/**
 * Records the session's working directory so a coordinator can map a
 * session id to the worktree it owns instead of guessing between sessions.
 */
function noteCwd(stateDir, sessionId, cwd, now) {
  if (!cwd) return;
  const state = readState(stateDir, sessionId);
  if (!state || state.cwd === cwd) return;
  writeState(stateDir, sessionId, { ...state, cwd, updated: now });
}

/**
 * Records that a Stop hook ran but could not read its transcript. Without
 * this an unreadable transcript is indistinguishable from a session whose
 * hooks never loaded at all.
 */
function noteTranscriptError(stateDir, sessionId, transcriptPath, cwd, now) {
  const state = readState(stateDir, sessionId);
  writeState(stateDir, sessionId, {
    fence: state?.fence ?? null,
    armed: state?.armed === true,
    approved_hash: state?.approved_hash ?? null,
    entries_seen: state?.entries_seen ?? 0,
    cwd: cwd ?? state?.cwd ?? null,
    transcript_error: transcriptPath || "unreadable",
    created: state?.created ?? now,
    updated: now,
  });
}

/**
 * Deletes state files whose mtime is older than the 14-day TTL. Runs on
 * every core invocation. Returns the number of files removed.
 */
export function sweepState(stateDir, now = Date.now()) {
  let names = [];
  try {
    names = readdirSync(stateDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const file = join(stateDir, name);
    try {
      const stats = statSync(file);
      if (!stats.isFile()) continue;
      if (stats.mtimeMs < now - STATE_TTL_MS) {
        unlinkSync(file);
        removed += 1;
      }
    } catch {
      continue;
    }
  }
  return removed;
}

function assistantText(record) {
  if (typeof record !== "object" || record === null) return null;
  const message = record.message;
  const isAssistant = record.type === "assistant" || message?.role === "assistant";
  if (!isAssistant) return null;
  const content = message?.content ?? record.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        block.type === "text" &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * The Stop transition: scans transcript entries beyond the previously
 * processed marker and records the latest assistant fence in that tail as
 * pending. Entries already processed are never rescanned, so a consumed
 * fence cannot come back. Returns the recorded fence, or null.
 */
export function handleStop({ stateDir, sessionId, transcriptPath, now = Date.now(), cwd = null }) {
  const content = readTextFile(transcriptPath, process.cwd());
  // An unreadable transcript is not "no fence presented". Record the
  // failure so an absent state file means the hook never ran, rather than
  // silently meaning the hook ran and could not see the transcript.
  if (content === null) {
    noteTranscriptError(stateDir, sessionId, String(transcriptPath ?? ""), cwd, now);
    return null;
  }
  const lines = content.split("\n");
  const total = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const previous = readState(stateDir, sessionId);
  const seen = previous?.entries_seen ?? 0;
  let fence = null;
  for (let index = seen; index < total; index += 1) {
    let record = null;
    try {
      record = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const text = assistantText(record);
    if (text === null) continue;
    const latest = latestFence(text);
    if (latest) fence = latest;
  }
  if (fence) {
    recordFence(stateDir, sessionId, fence, total, now);
    noteCwd(stateDir, sessionId, cwd, now);
    return fence;
  }
  markEntriesSeen(stateDir, sessionId, total, now);
  noteCwd(stateDir, sessionId, cwd, now);
  return null;
}

/**
 * The UserPromptSubmit transition: arms the pending fence when the prompt
 * carries the approval word. Any other prompt changes nothing.
 */
export function handleUserPromptSubmit({ stateDir, sessionId, prompt, now = Date.now() }) {
  if (!isApprovalText(prompt)) return null;
  // An approval may carry the approved text in a protocol fence. That text
  // is what makes an early approval safe to defer: it binds the approval to
  // one exact message instead of to whatever is recorded next.
  const carried = latestFence(prompt);
  const approvedHash = carried ? hashDraft(carried.content) : null;
  return armState(stateDir, sessionId, now, { approvedHash });
}

function enforceInner({ stateDir, sessionId, command, cwd, branch, now }) {
  const { commit, prCreate } = classify(command);
  if (!commit && !prCreate) return { allow: true, reason: null };
  if (commit && branch(cwd) === "main") {
    return { allow: false, reason: REASON_MAIN };
  }
  const state = readState(stateDir, sessionId);
  if (!state || state.armed !== true) {
    return { allow: false, reason: REASON_NOT_ARMED };
  }
  // There is no armed-without-a-fence path. An approval always refers to
  // text the user read, so a missing fence means there is nothing to check
  // the payload against and the command is refused.
  if (!state.fence) {
    return { allow: false, reason: REASON_NOT_ARMED };
  }
  if (commit) {
    const payload = commitPayload(command, { cwd });
    if (!payload.ok) return { allow: false, reason: payloadFailureReason(payload.reason) };
    if (state.fence.type !== "commit-message" || hashDraft(payload.payload) !== state.fence.hash) {
      return { allow: false, reason: mismatchReason("commit-message") };
    }
  } else {
    const payload = prPayload(command, { cwd });
    if (!payload.ok) return { allow: false, reason: payloadFailureReason(payload.reason) };
    if (state.fence.type !== "pr-message" || hashDraft(payload.payload) !== state.fence.hash) {
      return { allow: false, reason: mismatchReason("pr-message") };
    }
  }
  consumeState(stateDir, sessionId, now);
  return { allow: true, reason: null };
}

/**
 * The PreToolUse transition for a Bash command. Main is checked before
 * arming and blocks outright. The arm is consumed only on success, so a
 * blocked attempt (wrong payload, unreadable file) can be retried with
 * the fence text without a fresh approval. Every allowed command has its
 * payload checked against a recorded fence; there is no path that skips
 * that check. Internal failures block the gated command.
 */
export function enforce({ stateDir, sessionId, command, cwd, branch = currentBranch, now = Date.now() }) {
  try {
    return enforceInner({ stateDir, sessionId, command, cwd, branch, now });
  } catch {
    return { allow: false, reason: REASON_INTERNAL };
  }
}
