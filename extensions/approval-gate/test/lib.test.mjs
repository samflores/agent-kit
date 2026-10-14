import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  APPROVAL_WORD,
  armState,
  classify,
  commitPayload,
  consumeState,
  enforce,
  handleStop,
  handleUserPromptSubmit,
  hashDraft,
  isApprovalText,
  latestFence,
  normalizeDraft,
  parseFences,
  prPayload,
  readState,
  REASON_NOT_ARMED,
  recordFence,
  sanitizeSessionId,
  shellTokens,
  stateDirFor,
  sweepState,
} from "../lib.mjs";

function withStateDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "approval-gate-state-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("normalizeDraft strips trailing whitespace per line and trailing blank lines", () => {
  assert.equal(normalizeDraft("subject  \n\nbody line\t\n\n\n"), "subject\n\nbody line");
  assert.equal(normalizeDraft("a\n\nb"), "a\n\nb");
  assert.equal(normalizeDraft("a\r\nb\r\n\r\n"), "a\nb");
  assert.equal(normalizeDraft("\n\na"), "\n\na");
  assert.equal(normalizeDraft(""), "");
});

test("hashDraft is equal exactly when the normalized text is equal", () => {
  assert.equal(hashDraft("subject\n\nbody  "), hashDraft("subject\n\nbody\n\n"));
  assert.notEqual(hashDraft("subject\nbody"), hashDraft("subject\n\nbody"));
});

test("isApprovalText matches the approval word case-insensitively and whole-word", () => {
  assert.ok(isApprovalText("approved"));
  assert.ok(isApprovalText("Approved, go ahead"));
  assert.ok(isApprovalText("I APPROVED it"));
  assert.ok(isApprovalText("pre-approved"));
  assert.ok(!isApprovalText("approvedly"));
  assert.ok(!isApprovalText("unapproved"));
  assert.ok(!isApprovalText("approve"));
  assert.ok(!isApprovalText(""));
  assert.equal(APPROVAL_WORD, "approved");
});

test("parseFences finds commit-message and pr-message fences", () => {
  const text = [
    "Intro paragraph.",
    "",
    "```commit-message",
    "subject",
    "",
    "body",
    "```",
    "",
    "```pr-message",
    "pr title",
    "",
    "pr body",
    "```",
  ].join("\n");
  const fences = parseFences(text);
  assert.deepEqual(
    fences.map((fence) => fence.type),
    ["commit-message", "pr-message"],
  );
  assert.equal(fences[0].content, "subject\n\nbody");
  assert.equal(fences[1].content, "pr title\n\npr body");
  assert.equal(latestFence(text).type, "pr-message");
});

test("parseFences ignores untagged fences, other tags, and tag variants", () => {
  const text = [
    "```",
    "plain block",
    "```",
    "```js",
    "code",
    "```",
    "```commit-messages",
    "not a protocol tag",
    "```",
    "```commit-message extra",
    "also not the tag",
    "```",
    "```Commit-Message",
    "case folds to the tag",
    "```",
  ].join("\n");
  const fences = parseFences(text);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].content, "case folds to the tag");
});

test("parseFences ignores an unterminated fence and takes the last of several", () => {
  const unterminated = ["```commit-message", "dangling with no close"].join("\n");
  assert.deepEqual(parseFences(unterminated), []);
  const sequence = [
    "```commit-message",
    "first",
    "```",
    "```commit-message",
    "second",
    "```",
  ].join("\n");
  const fences = parseFences(sequence);
  assert.deepEqual(
    fences.map((fence) => fence.content),
    ["first", "second"],
  );
  assert.equal(latestFence(sequence).content, "second");
});

test("classify matches a gated invocation at any command position", () => {
  const commits = [
    "git commit -m x",
    "git   commit -m x",
    "git commit --amend -m x",
    "git commit --amend --no-edit",
    "git commit -F msg.txt",
    "git commit",
    "cd dir && git commit -m x",
    "git commit -m \"$(cat <<'EOF'\nsubject\nEOF\n)\"",
    "sh -c 'git commit -m x'",
  ];
  for (const command of commits) {
    assert.deepEqual(classify(command), { commit: true, prCreate: false }, command);
  }
  const prCreates = [
    "gh pr create --title t --body b",
    "gh pr create -t t -b b",
    "gh   pr   create --web",
  ];
  for (const command of prCreates) {
    assert.deepEqual(classify(command), { commit: false, prCreate: true }, command);
  }
  const wrapped = [
    "sh -c 'git commit -m x'",
    'bash -c "git commit -m x"',
    "/bin/sh -c 'git commit -m x'",
    "env FOO=1 bash -c 'git commit -m x'",
    "sudo -u x sh -c 'git commit -m x'",
  ];
  for (const command of wrapped) {
    assert.deepEqual(
      classify(command),
      { commit: true, prCreate: false },
      "a wrapper that executes its argument is still gated: " + command,
    );
  }
  const prose = [
    "herdr agent prompt impl 'present the message, then run git commit -F -'",
    "echo 'the gate blocks git commit until approved'",
    "cat <<'EOF'\nrun git commit when ready\nEOF",
    "grep -rn 'gh pr create' docs/",
    'rg "git commit" --files-with-matches',
    "python3 -c \"print('git commit')\"",
  ];
  for (const command of prose) {
    assert.deepEqual(
      classify(command),
      { commit: false, prCreate: false },
      "prose must not be gated: " + command,
    );
  }
  const others = [
    "git push origin main",
    "git push",
    "git status",
    "gh pr edit 5 --title t",
    "gh pr list",
    "gh pr view 5",
    "gitx commit",
    "echo commit",
    "GIT_COMMIT=1 make",
  ];
  for (const command of others) {
    assert.deepEqual(classify(command), { commit: false, prCreate: false }, command);
  }
});

function wordTokens(command) {
  return shellTokens(command)
    .filter((token) => !token.operator)
    .map((token) => token.text);
}

test("shellTokens splits words and keeps quoted values whole", () => {
  assert.deepEqual(wordTokens('git commit -m "two words"'), ["git", "commit", "-m", "two words"]);
  assert.deepEqual(wordTokens("git commit -m 'single'"), ["git", "commit", "-m", "single"]);
  assert.deepEqual(wordTokens('git commit -m"attached"'), ["git", "commit", "-mattached"]);
  assert.deepEqual(wordTokens("cd dir && git commit -m x | tee log"), [
    "cd",
    "dir",
    "git",
    "commit",
    "-m",
    "x",
    "tee",
    "log",
  ]);
});

test("shellTokens unescapes double-quoted and ansi-c content", () => {
  const escaped = shellTokens('say "quote \\" and backslash \\\\"');
  assert.equal(escaped[1].text, 'quote " and backslash \\');
  const ansi = shellTokens("git commit -m $'line1\\nline2'");
  assert.equal(ansi[3].text, "line1\nline2");
});

test("shellTokens resolves a cat heredoc substitution to its literal body", () => {
  const command = 'git commit -m "$(cat <<\'EOF\'\nsubject\n\nbody\nEOF\n)"';
  const tokens = shellTokens(command);
  const value = tokens[tokens.length - 1];
  assert.equal(value.text, "subject\n\nbody");
  assert.equal(value.dynamic, false);
});

test("shellTokens marks variables, backticks, and non-cat substitutions dynamic", () => {
  const dynamic = [
    'git commit -m "$(git log -1 --pretty=%B)"',
    'git commit -m "$MSG"',
    'git commit -m "${MSG}"',
    "git commit -m `git log -1`",
  ];
  for (const command of dynamic) {
    const value = shellTokens(command).filter((token) => !token.operator).pop();
    assert.equal(value.dynamic, true, command);
  }
});

test("shellTokens attaches a standalone heredoc body to the << operator", () => {
  const command = "git commit -F - <<'MSG'\nline1\n\nline2\nMSG";
  const heredoc = shellTokens(command).find((token) => token.text === "<<").heredoc;
  assert.equal(heredoc.body, "line1\n\nline2");
  assert.equal(heredoc.closed, true);
  assert.equal(heredoc.dynamic, false);
  const tabs = "git commit -F - <<-'MSG'\n\tline1\n\tMSG";
  const tabHeredoc = shellTokens(tabs).find((token) => token.text === "<<").heredoc;
  assert.equal(tabHeredoc.body, "\tline1");
  assert.equal(tabHeredoc.closed, true);
});

test("commitPayload extracts -m in every honest form", () => {
  assert.deepEqual(commitPayload('git commit -m "one"'), { ok: true, payload: "one" });
  assert.deepEqual(commitPayload("git commit -m one"), { ok: true, payload: "one" });
  assert.deepEqual(commitPayload('git commit --message "long form"'), { ok: true, payload: "long form" });
  assert.deepEqual(commitPayload('git commit --message="long form"'), { ok: true, payload: "long form" });
  assert.deepEqual(commitPayload('git commit -m"attached"'), { ok: true, payload: "attached" });
  assert.deepEqual(commitPayload('git commit -m "subject" -m "body"'), {
    ok: true,
    payload: "subject\n\nbody",
  });
  assert.deepEqual(commitPayload('git commit --amend -m "$(cat <<\'EOF\'\nsubject\n\nbody\nEOF\n)"'), {
    ok: true,
    payload: "subject\n\nbody",
  });
});

test("commitPayload reads -F from a file or stdin heredoc, and refuses the rest", () => {
  withStateDir((dir) => {
    writeFileSync(join(dir, "msg.txt"), "file subject\n\nfile body\n");
    assert.deepEqual(commitPayload("git commit -F msg.txt", { cwd: dir }), {
      ok: true,
      payload: "file subject\n\nfile body\n",
    });
    assert.deepEqual(commitPayload("git commit --file=msg.txt", { cwd: dir }), {
      ok: true,
      payload: "file subject\n\nfile body\n",
    });
    assert.deepEqual(commitPayload("git commit -F - <<'MSG'\nstdin subject\nMSG", { cwd: dir }), {
      ok: true,
      payload: "stdin subject",
    });
    assert.deepEqual(commitPayload("git commit -F missing.txt", { cwd: dir }), {
      ok: false,
      reason: "unverifiable",
    });
    assert.deepEqual(commitPayload('git commit -m "$(git log -1)"', { cwd: dir }), {
      ok: false,
      reason: "unverifiable",
    });
    assert.deepEqual(commitPayload("git commit", { cwd: dir }), { ok: false, reason: "no-message" });
    assert.deepEqual(commitPayload("git commit --amend --no-edit", { cwd: dir }), {
      ok: false,
      reason: "no-message",
    });
    assert.deepEqual(commitPayload("git commit -a", { cwd: dir }), { ok: false, reason: "no-message" });
  });
});

test("prPayload composes title, blank line, body from flags or a body file", () => {
  withStateDir((dir) => {
    writeFileSync(join(dir, "body.md"), "body from file\n");
    assert.deepEqual(prPayload('gh pr create --title "T" --body "B"'), { ok: true, payload: "T\n\nB" });
    assert.deepEqual(prPayload("gh pr create -t T -b B"), { ok: true, payload: "T\n\nB" });
    assert.deepEqual(prPayload('gh pr create --title="T" --body-file body.md', { cwd: dir }), {
      ok: true,
      payload: "T\n\nbody from file\n",
    });
    assert.deepEqual(prPayload('gh pr create -t "T" --body "$(cat <<\'EOF\'\nB\nEOF\n)"', { cwd: dir }), {
      ok: true,
      payload: "T\n\nB",
    });
    assert.deepEqual(prPayload("gh pr create -t T --body-file - <<'MSG'\nB\nMSG", { cwd: dir }), {
      ok: true,
      payload: "T\n\nB",
    });
    assert.deepEqual(prPayload("gh pr create", { cwd: dir }), { ok: false, reason: "missing-parts" });
    assert.deepEqual(prPayload("gh pr create --body B", { cwd: dir }), {
      ok: false,
      reason: "missing-parts",
    });
    assert.deepEqual(prPayload("gh pr create --title T", { cwd: dir }), {
      ok: false,
      reason: "missing-parts",
    });
    assert.deepEqual(prPayload('gh pr create -t "$TITLE" -b B', { cwd: dir }), {
      ok: false,
      reason: "unverifiable",
    });
  });
});

test("state files record, arm, consume, and supersede correctly", () => {
  withStateDir((dir) => {
    const session = "sess-1";
    assert.equal(readState(dir, session), null);
    recordFence(dir, session, { type: "commit-message", content: "subject\n\nbody" }, 3, 1000);
    let state = readState(dir, session);
    assert.equal(state.fence.type, "commit-message");
    assert.equal(state.fence.hash, hashDraft("subject\n\nbody"));
    assert.equal(state.armed, false);
    assert.equal(state.entries_seen, 3);
    const created = state.created;
    handleUserPromptSubmit({ stateDir: dir, sessionId: session, prompt: "approved", now: 2000 });
    state = readState(dir, session);
    assert.equal(state.armed, true);
    assert.equal(state.created, created);
    recordFence(dir, session, { type: "commit-message", content: "second" }, 5, 3000);
    state = readState(dir, session);
    assert.equal(state.armed, false, "a new fence supersedes an armed state");
    assert.equal(state.fence.hash, hashDraft("second"));
    assert.equal(state.entries_seen, 5);
    handleUserPromptSubmit({ stateDir: dir, sessionId: session, prompt: "approved", now: 4000 });
    consumeState(dir, session, 5000);
    state = readState(dir, session);
    assert.equal(state.fence, null, "consumption clears the fence");
    assert.equal(state.armed, false);
    assert.equal(state.entries_seen, 5, "consumption preserves the transcript marker");
  });
});

test("approval with nothing pending is a no-op in strict mode", () => {
  withStateDir((dir) => {
    handleUserPromptSubmit({ stateDir: dir, sessionId: "fresh", prompt: "approved" });
    assert.equal(readState(dir, "fresh"), null, "a bare approval is still discarded");
    assert.equal(armState(dir, "also-fresh"), null);
  });
});

test("a prompt without the approval word changes nothing, armed or not", () => {
  withStateDir((dir) => {
    const session = "sess-hold";
    recordFence(dir, session, { type: "commit-message", content: "x" }, 1);
    handleUserPromptSubmit({ stateDir: dir, sessionId: session, prompt: "approved" });
    handleUserPromptSubmit({ stateDir: dir, sessionId: session, prompt: "wait, not yet" });
    assert.equal(readState(dir, session).armed, true);
  });
});

test("no option arms the gate without a fence on record", () => {
  withStateDir((dir) => {
    // strict:false was the documented fallback and is now meaningless.
    // Passing it must not resurrect an arm-without-a-fence path.
    handleUserPromptSubmit({
      stateDir: dir,
      sessionId: "fallback",
      prompt: "approved",
      strict: false,
    });
    assert.equal(readState(dir, "fallback"), null, "nothing pending, nothing armed");
    assert.equal(armState(dir, "fallback", Date.now(), { strict: false }), null);
    assert.equal(readState(dir, "fallback"), null);
  });
});

test("sweepState removes state files past the 14-day TTL and keeps fresh ones", () => {
  withStateDir((dir) => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const staleAt = new Date(now - 15 * day);
    const freshAt = new Date(now - 13 * day);
    writeFileSync(join(dir, "stale"), '{"armed":false}');
    utimesSync(join(dir, "stale"), staleAt, staleAt);
    writeFileSync(join(dir, "fresh"), '{"armed":false}');
    utimesSync(join(dir, "fresh"), freshAt, freshAt);
    writeFileSync(join(dir, ".hidden"), "{}");
    const removed = sweepState(dir, now);
    assert.equal(removed, 1);
    assert.equal(readState(dir, "fresh").armed, false);
    assert.equal(readState(dir, "stale"), null);
    assert.equal(sweepState(join(dir, "missing")), 0);
  });
});

test("stateDirFor is under the agent-kit cache directory and session ids are sanitized", () => {
  assert.equal(stateDirFor("/home/user"), "/home/user/.cache/agent-kit/approval-gate");
  assert.equal(sanitizeSessionId("abc-123_XYZ"), "abc-123_XYZ");
  assert.equal(sanitizeSessionId("../escape"), null, "dot-leading ids are rejected after cleaning");
  assert.equal(sanitizeSessionId("a/b"), "a_b");
  assert.equal(sanitizeSessionId(""), null);
  assert.equal(sanitizeSessionId(null), null);
});

function stopArgs(dir, transcriptPath, sessionId = "sess-stop") {
  return { stateDir: dir, sessionId, transcriptPath };
}

const FIXTURES = new URL("./fixtures/", import.meta.url);

test("handleStop records the latest assistant fence in the unprocessed tail", () => {
  withStateDir((dir) => {
    const transcript = join(dir, "transcript.jsonl");
    copyFileSync(new URL("transcript-commit-fence.jsonl", FIXTURES), transcript);
    const fence = handleStop(stopArgs(dir, transcript));
    assert.equal(fence.type, "commit-message");
    const state = readState(dir, "sess-stop");
    assert.equal(state.armed, false);
    assert.equal(
      state.fence.hash,
      hashDraft(
        "Add the widget calibration table\n\nCalibration rows now load from the fixtures directory and the loader\nhandles the empty-table case.",
      ),
    );
    const seen = state.entries_seen;
    appendFileSync(
      transcript,
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"No fence here."}]}}\n',
    );
    handleStop(stopArgs(dir, transcript));
    const after = readState(dir, "sess-stop");
    assert.equal(after.entries_seen, seen + 1, "marker advances with no new fence");
    assert.equal(after.fence.hash, state.fence.hash, "pending fence survives a quiet stop");
  });
});

test("handleStop supersedes with a later fence and never resurrects a consumed one", () => {
  withStateDir((dir) => {
    const transcript = join(dir, "transcript.jsonl");
    copyFileSync(new URL("transcript-two-fences.jsonl", FIXTURES), transcript);
    const fence = handleStop(stopArgs(dir, transcript));
    assert.equal(fence.content, "Corrected subject\n\nCorrected body.");
    consumeState(dir, "sess-stop");
    appendFileSync(transcript, '{"type":"user","message":{"role":"user","content":"thanks"}}\n');
    const quiet = handleStop(stopArgs(dir, transcript));
    assert.equal(quiet, null);
    assert.equal(readState(dir, "sess-stop").fence, null);
  });
});

test("handleStop ignores fences that only appear in user entries", () => {
  withStateDir((dir) => {
    const transcript = new URL("transcript-user-fence-only.jsonl", FIXTURES).pathname;
    const fence = handleStop(stopArgs(dir, transcript));
    assert.equal(fence, null);
    const state = readState(dir, "sess-stop");
    assert.equal(state.fence, null, "a user-only fence is never recorded");
    assert.equal(
      state.transcript_error,
      null,
      "a readable transcript leaves no error marker",
    );
  });
});

test("a readable transcript with no fence still writes state", () => {
  withStateDir((dir) => {
    const transcript = new URL("transcript-user-fence-only.jsonl", FIXTURES).pathname;
    handleStop(stopArgs(dir, transcript));
    assert.notEqual(
      readState(dir, "sess-stop"),
      null,
      "an absent state file must mean the hook never ran, not that it found no fence",
    );
  });
});

test("an unreadable transcript records an error instead of staying silent", () => {
  withStateDir((dir) => {
    const missing = join(dir, "missing.jsonl");
    assert.equal(handleStop(stopArgs(dir, missing)), null);
    const state = readState(dir, "sess-stop");
    assert.notEqual(state, null, "the hook ran, so it must leave a trace");
    assert.equal(state.transcript_error, missing);
  });
});

test("handleStop records the session cwd so a coordinator can map session to worktree", () => {
  withStateDir((dir) => {
    const transcript = join(dir, "transcript.jsonl");
    copyFileSync(new URL("transcript-commit-fence.jsonl", FIXTURES), transcript);
    handleStop({ ...stopArgs(dir, transcript), cwd: "/work/tree-a" });
    assert.equal(readState(dir, "sess-stop").cwd, "/work/tree-a");
  });
});

test("an approval carrying the approved text arms the matching fence recorded later", () => {
  withStateDir((dir) => {
    const transcript = join(dir, "transcript.jsonl");
    copyFileSync(new URL("transcript-commit-fence.jsonl", FIXTURES), transcript);
    const presented = latestFence(
      readFileSync(transcript, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((record) => {
          const content = record.message?.content ?? record.content;
          if (typeof content === "string") return content;
          if (!Array.isArray(content)) return "";
          return content.map((block) => block.text ?? "").join("\n");
        })
        .join("\n"),
    );
    // The approval lands before the agent's Stop hook has recorded anything.
    handleUserPromptSubmit({
      stateDir: dir,
      sessionId: "sess-stop",
      prompt: "approved\n\n```commit-message\n" + presented.content + "\n```",
    });
    assert.equal(readState(dir, "sess-stop").armed, false, "nothing to arm yet");
    handleStop(stopArgs(dir, transcript));
    const state = readState(dir, "sess-stop");
    assert.equal(state.armed, true, "the matching fence picks up the deferred approval");
    assert.equal(state.approved_hash, null, "the deferred approval is spent once used");
  });
});

test("a deferred approval never arms text it did not approve", () => {
  withStateDir((dir) => {
    const transcript = join(dir, "transcript.jsonl");
    copyFileSync(new URL("transcript-commit-fence.jsonl", FIXTURES), transcript);
    handleUserPromptSubmit({
      stateDir: dir,
      sessionId: "sess-stop",
      prompt: "approved\n\n```commit-message\nsome entirely different message\n```",
    });
    handleStop(stopArgs(dir, transcript));
    const state = readState(dir, "sess-stop");
    assert.notEqual(state.fence, null, "the presented fence is still recorded");
    assert.equal(state.armed, false, "but an approval for other text must not arm it");
  });
});

test("handleStop always scans for fences and cannot be switched off", () => {
  withStateDir((dir) => {
    const transcript = new URL("transcript-commit-fence.jsonl", FIXTURES).pathname;
    const fence = handleStop({ ...stopArgs(dir, transcript), strict: false });
    assert.notEqual(fence, null, "a stale strict:false must not skip fence scanning");
    assert.equal(readState(dir, "sess-stop").fence.type, "commit-message");
  });
});

const COMMIT_MESSAGE =
  "Add the widget calibration table\n\nCalibration rows now load from the fixtures directory and the loader\nhandles the empty-table case.";
const COMMIT_COMMAND = 'git commit -m "$(cat <<\'EOF\'\n' + COMMIT_MESSAGE + "\nEOF\n)\"";

function armedSession(dir, session, fence, opts = {}) {
  recordFence(dir, session, fence, 0);
  handleUserPromptSubmit({ stateDir: dir, sessionId: session, prompt: "approved", ...opts });
}

test("enforce blocks a gated command when unarmed", () => {
  withStateDir((dir) => {
    const result = enforce({
      stateDir: dir,
      sessionId: "never-armed",
      command: COMMIT_COMMAND,
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.equal(result.allow, false);
    assert.match(result.reason, /not approved/);
  });
});

test("enforce allows a matching armed commit and consumes the arm", () => {
  withStateDir((dir) => {
    armedSession(dir, "ok", { type: "commit-message", content: COMMIT_MESSAGE });
    const result = enforce({
      stateDir: dir,
      sessionId: "ok",
      command: COMMIT_COMMAND,
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.deepEqual(result, { allow: true, reason: null });
    const state = readState(dir, "ok");
    assert.equal(state.fence, null);
    assert.equal(state.armed, false);
  });
});

test("enforce blocks a mismatched payload but keeps the arm for a corrected retry", () => {
  withStateDir((dir) => {
    armedSession(dir, "mismatch", { type: "commit-message", content: COMMIT_MESSAGE });
    const wrong = enforce({
      stateDir: dir,
      sessionId: "mismatch",
      command: 'git commit -m "Different message"',
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.equal(wrong.allow, false);
    assert.match(wrong.reason, /does not match/);
    assert.equal(readState(dir, "mismatch").armed, true);
    const retry = enforce({
      stateDir: dir,
      sessionId: "mismatch",
      command: COMMIT_COMMAND,
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.deepEqual(retry, { allow: true, reason: null });
  });
});

test("enforce blocks commits on main outright, armed or not", () => {
  withStateDir((dir) => {
    armedSession(dir, "on-main", { type: "commit-message", content: COMMIT_MESSAGE });
    const armed = enforce({
      stateDir: dir,
      sessionId: "on-main",
      command: COMMIT_COMMAND,
      cwd: "/tmp",
      branch: () => "main",
    });
    assert.equal(armed.allow, false);
    assert.match(armed.reason, /main/);
    const unarmed = enforce({
      stateDir: dir,
      sessionId: "never",
      command: "git commit -m x",
      cwd: "/tmp",
      branch: () => "main",
    });
    assert.match(unarmed.reason, /main/, "main is checked before arming");
  });
});

test("enforce refuses an editor-less commit and demands -m with the approved text", () => {
  withStateDir((dir) => {
    armedSession(dir, "no-msg", { type: "commit-message", content: COMMIT_MESSAGE });
    const result = enforce({
      stateDir: dir,
      sessionId: "no-msg",
      command: "git commit",
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.equal(result.allow, false);
    assert.match(result.reason, /-m/);
  });
});

test("enforce refuses a gh pr create that is missing title or body", () => {
  withStateDir((dir) => {
    armedSession(dir, "pr-parts", { type: "pr-message", content: "T\n\nB" });
    const result = enforce({
      stateDir: dir,
      sessionId: "pr-parts",
      command: 'gh pr create --title "T"',
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.equal(result.allow, false);
    assert.match(result.reason, /--title or --body/);
  });
});

test("enforce allows a matching armed gh pr create and rejects the wrong fence type", () => {
  withStateDir((dir) => {
    armedSession(dir, "pr-ok", { type: "pr-message", content: "T\n\nB" });
    const result = enforce({
      stateDir: dir,
      sessionId: "pr-ok",
      command: 'gh pr create -t "T" -b "B"',
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.deepEqual(result, { allow: true, reason: null });
    assert.equal(readState(dir, "pr-ok").fence, null);
    armedSession(dir, "cross-type", { type: "pr-message", content: "T\n\nB" });
    const crossed = enforce({
      stateDir: dir,
      sessionId: "cross-type",
      command: 'git commit -m "T\n\nB"',
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.equal(crossed.allow, false);
    assert.match(crossed.reason, /commit-message/);
  });
});

test("enforce leaves ungated commands alone, armed or not", () => {
  withStateDir((dir) => {
    const idle = enforce({
      stateDir: dir,
      sessionId: "any",
      command: "git push origin main",
      cwd: "/tmp",
      branch: () => "main",
    });
    assert.deepEqual(idle, { allow: true, reason: null });
    armedSession(dir, "edit", { type: "pr-message", content: "T\n\nB" });
    const edit = enforce({
      stateDir: dir,
      sessionId: "edit",
      command: 'gh pr edit 5 --title "Other"',
      cwd: "/tmp",
      branch: () => "main",
    });
    assert.deepEqual(edit, { allow: true, reason: null });
    assert.equal(readState(dir, "edit").armed, true, "no gated command ran, nothing was consumed");
  });
});

test("an armed state with no fence is refused, never allowed unchecked", () => {
  withStateDir((dir) => {
    // Hand-write the state the old fallback used to produce. Even armed,
    // a missing fence leaves nothing to check the payload against, so the
    // command must be refused rather than allowed.
    writeFileSync(
      join(dir, "forged"),
      JSON.stringify({ fence: null, armed: true, entries_seen: 0, created: 1, updated: 1 }),
    );
    const result = enforce({
      stateDir: dir,
      sessionId: "forged",
      command: 'git commit -m "anything at all"',
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.equal(result.allow, false, "an unchecked commit must never be allowed");
    assert.equal(result.reason, REASON_NOT_ARMED);
  });
});

test("normalization bridges cosmetic differences between fence and payload", () => {
  withStateDir((dir) => {
    armedSession(dir, "norm", { type: "commit-message", content: "subject \n\nbody  \n\n" });
    const result = enforce({
      stateDir: dir,
      sessionId: "norm",
      command: 'git commit -m "$(cat <<\'EOF\'\nsubject\n\nbody\nEOF\n)"',
      cwd: "/tmp",
      branch: () => "feat/x",
    });
    assert.deepEqual(result, { allow: true, reason: null });
  });
});

test("an internal failure blocks the gated command instead of failing open", () => {
  const result = enforce({
    stateDir: null,
    sessionId: "boom",
    command: "git commit -m x",
    cwd: "/tmp",
    branch: () => {
      throw new Error("boom");
    },
  });
  assert.equal(result.allow, false);
  assert.match(result.reason, /internal error/);
});

test("re-recording an identical fence keeps an existing arm", () => {
  withStateDir((dir) => {
    const session = "sess-rearm";
    const fence = { type: "commit-message", content: "subject\n\nbody" };
    recordFence(dir, session, fence, 3, 1000);
    handleUserPromptSubmit({ stateDir: dir, sessionId: session, prompt: "approved", now: 2000 });
    assert.equal(readState(dir, session).armed, true);
    // The approval turn appends transcript entries carrying the same fence,
    // so the next Stop hook rescans and re-records it. The arm must survive:
    // the commit it authorises has not run yet.
    recordFence(dir, session, fence, 7, 3000);
    const state = readState(dir, session);
    assert.equal(state.armed, true, "an identical fence must not disarm");
    assert.equal(state.fence.hash, hashDraft(fence.content));
    assert.equal(state.entries_seen, 7, "the transcript marker still advances");
  });
});
