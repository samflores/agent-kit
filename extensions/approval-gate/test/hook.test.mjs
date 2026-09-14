import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "core.mjs");
const FIXTURES = join(HERE, "fixtures");

const COMMIT_MESSAGE =
  "Add the widget calibration table\n\nCalibration rows now load from the fixtures directory and the loader\nhandles the empty-table case.";
const COMMIT_COMMAND = 'git commit -m "$(cat <<\'EOF\'\n' + COMMIT_MESSAGE + "\nEOF\n)\"";
const PR_TITLE = "Add the calibration table";
const PR_BODY =
  "The loader reads calibration rows from the fixtures directory and\nhandles the empty-table case, so the table renders without a manual\nseed row.";
const PR_COMMAND =
  'gh pr create --title "' + PR_TITLE + '" --body "$(cat <<\'EOF\'\n' + PR_BODY + "\nEOF\n)\"";

function makeHome() {
  return mkdtempSync(join(tmpdir(), "approval-gate-home-"));
}

function makeRepo(onMain) {
  const dir = mkdtempSync(join(tmpdir(), "approval-gate-repo-"));
  const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "gate@example.test"]);
  git(["config", "user.name", "Gate Test"]);
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-m", "seed"]);
  if (!onMain) git(["checkout", "-b", "feat/widget"]);
  return dir;
}

function runCore(event, payload, home, extraEnv = {}) {
  return spawnSync(process.execPath, [CORE, event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...extraEnv },
  });
}

function stateFile(home, sessionId) {
  return join(home, ".cache", "agent-kit", "approval-gate", sessionId);
}

function stopPayload(sessionId, transcriptName) {
  return {
    hook_event_name: "Stop",
    session_id: sessionId,
    transcript_path: join(FIXTURES, transcriptName),
    cwd: "/tmp",
  };
}

function promptPayload(sessionId, prompt) {
  return { hook_event_name: "UserPromptSubmit", session_id: sessionId, prompt };
}

function toolPayload(sessionId, command, cwd) {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_name: "Bash",
    tool_input: { command },
    cwd,
  };
}

function withSession(home, repo, run) {
  try {
    return run();
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

test("full protocol cycle: blocked unarmed, fence pending, approval arms, matching commit passes", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "11111111-1111-1111-1111-111111111111";
  withSession(home, repo, () => {
    const unarmed = runCore("pretooluse", toolPayload(session, COMMIT_COMMAND, repo), home);
    assert.equal(unarmed.status, 2, "an unarmed commit is blocked");
    assert.match(unarmed.stderr, /not approved/);

    const stop = runCore("stop", stopPayload(session, "transcript-commit-fence.jsonl"), home);
    assert.equal(stop.status, 0);
    const pending = JSON.parse(readFileSync(stateFile(home, session), "utf8"));
    assert.equal(pending.armed, false);
    assert.equal(pending.fence.type, "commit-message");
    assert.equal(pending.entries_seen, 2);

    assert.equal(runCore("pretooluse", toolPayload(session, COMMIT_COMMAND, repo), home).status, 2);

    const prompt = runCore("userpromptsubmit", promptPayload(session, "yes, approved"), home);
    assert.equal(prompt.status, 0);
    assert.equal(JSON.parse(readFileSync(stateFile(home, session), "utf8")).armed, true);

    const commit = runCore("pretooluse", toolPayload(session, COMMIT_COMMAND, repo), home);
    assert.equal(commit.status, 0);
    const consumed = JSON.parse(readFileSync(stateFile(home, session), "utf8"));
    assert.equal(consumed.armed, false);
    assert.equal(consumed.fence, null);
    assert.equal(consumed.entries_seen, 2, "the transcript marker survives consumption");
  });
});

test("a mismatched payload is refused and the arm stays for a corrected retry", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "22222222-2222-2222-2222-222222222222";
  withSession(home, repo, () => {
    runCore("stop", stopPayload(session, "transcript-commit-fence.jsonl"), home);
    runCore("userpromptsubmit", promptPayload(session, "approved"), home);
    const wrong = runCore(
      "pretooluse",
      toolPayload(session, 'git commit -m "Something else entirely"', repo),
      home,
    );
    assert.equal(wrong.status, 2);
    assert.match(wrong.stderr, /does not match/);
    assert.equal(
      JSON.parse(readFileSync(stateFile(home, session), "utf8")).armed,
      true,
      "a blocked attempt does not consume the approval",
    );
    const retry = runCore("pretooluse", toolPayload(session, COMMIT_COMMAND, repo), home);
    assert.equal(retry.status, 0);
  });
});

test("a commit on main is refused outright, armed and matching", () => {
  const home = makeHome();
  const repo = makeRepo(true);
  const session = "33333333-3333-3333-3333-333333333333";
  withSession(home, repo, () => {
    runCore("stop", stopPayload(session, "transcript-commit-fence.jsonl"), home);
    runCore("userpromptsubmit", promptPayload(session, "approved"), home);
    const result = runCore("pretooluse", toolPayload(session, COMMIT_COMMAND, repo), home);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /main/);
  });
});

test("a matching pr-message fence lets gh pr create through, and gh pr edit stays ungated", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "44444444-4444-4444-4444-444444444444";
  withSession(home, repo, () => {
    runCore("stop", stopPayload(session, "transcript-pr-fence.jsonl"), home);
    runCore("userpromptsubmit", promptPayload(session, "approved"), home);
    const create = runCore("pretooluse", toolPayload(session, PR_COMMAND, repo), home);
    assert.equal(create.status, 0);

    const edit = runCore(
      "pretooluse",
      toolPayload(session, 'gh pr edit 5 --title "Unapproved rewrite"', repo),
      home,
    );
    assert.equal(edit.status, 0);
  });
});

test("an editor-less commit is refused with a demand for -m with the approved text", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "55555555-5555-5555-5555-555555555555";
  withSession(home, repo, () => {
    runCore("stop", stopPayload(session, "transcript-commit-fence.jsonl"), home);
    runCore("userpromptsubmit", promptPayload(session, "approved"), home);
    const bare = runCore("pretooluse", toolPayload(session, "git commit", repo), home);
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /-m/);
    const amend = runCore("pretooluse", toolPayload(session, "git commit --amend --no-edit", repo), home);
    assert.equal(amend.status, 2);
    assert.match(amend.stderr, /-m/);
  });
});

test("an approval given before any fence arms nothing", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "66666666-6666-6666-6666-666666666666";
  withSession(home, repo, () => {
    runCore("userpromptsubmit", promptPayload(session, "approved"), home);
    assert.equal(existsSync(stateFile(home, session)), false);
    assert.equal(runCore("pretooluse", toolPayload(session, COMMIT_COMMAND, repo), home).status, 2);
  });
});

test("a later fence supersedes an earlier one through the stop event", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "77777777-7777-7777-7777-777777777777";
  withSession(home, repo, () => {
    runCore("stop", stopPayload(session, "transcript-two-fences.jsonl"), home);
    const state = JSON.parse(readFileSync(stateFile(home, session), "utf8"));
    assert.equal(state.fence.hash.length, 64);
    runCore("userpromptsubmit", promptPayload(session, "approved"), home);
    assert.equal(
      runCore(
        "pretooluse",
        toolPayload(session, 'git commit -m "First draft subject\n\nFirst draft body."', repo),
        home,
      ).status,
      2,
      "the superseded draft no longer authorizes anything",
    );
    assert.equal(
      runCore(
        "pretooluse",
        toolPayload(session, 'git commit -m "Corrected subject\n\nCorrected body."', repo),
        home,
      ).status,
      0,
    );
  });
});

test("the TTL sweep deletes state files older than 14 days on every core run", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "88888888-8888-8888-8888-888888888888";
  withSession(home, repo, () => {
    const stateDir = join(home, ".cache", "agent-kit", "approval-gate");
    mkdirSync(stateDir, { recursive: true });
    const stale = join(stateDir, "aaaa-stale");
    const fresh = join(stateDir, "bbbb-fresh");
    for (const file of [stale, fresh]) writeFileSync(file, '{"armed":false,"fence":null}');
    const day = 24 * 60 * 60 * 1000;
    const staleAt = new Date(Date.now() - 20 * day);
    utimesSync(stale, staleAt, staleAt);
    const result = runCore(
      "stop",
      {
        hook_event_name: "Stop",
        session_id: session,
        transcript_path: join(FIXTURES, "transcript-no-fence.jsonl"),
        cwd: repo,
      },
      home,
    );
    assert.equal(result.status, 0);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(fresh), true);
  });
});

test("with AG_GATE_STRICT_FENCES=0 the approval word alone arms the gate", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  const session = "99999999-9999-9999-9999-999999999999";
  withSession(home, repo, () => {
    const stop = runCore(
      "stop",
      stopPayload(session, "transcript-commit-fence.jsonl"),
      home,
      { AG_GATE_STRICT_FENCES: "0" },
    );
    assert.equal(stop.status, 0);
    assert.equal(
      existsSync(stateFile(home, session)),
      false,
      "the stop event does not scan fences in fallback mode",
    );
    const prompt = runCore("userpromptsubmit", promptPayload(session, "approved"), home, {
      AG_GATE_STRICT_FENCES: "0",
    });
    assert.equal(prompt.status, 0);
    const commit = runCore(
      "pretooluse",
      toolPayload(session, 'git commit -m "text that matches no fence"', repo),
      home,
      { AG_GATE_STRICT_FENCES: "0" },
    );
    assert.equal(commit.status, 0);
  });
});

test("non-Bash tools and unknown events pass through untouched", () => {
  const home = makeHome();
  const repo = makeRepo(false);
  withSession(home, repo, () => {
    const write = runCore(
      "pretooluse",
      {
        hook_event_name: "PreToolUse",
        session_id: "pass-through",
        tool_name: "Write",
        tool_input: { command: "git commit -m x" },
        cwd: repo,
      },
      home,
    );
    assert.equal(write.status, 0);
    const unknown = runCore("sessionstart", { session_id: "pass-through" }, home);
    assert.equal(unknown.status, 0);
    const malformed = spawnSync(process.execPath, [CORE, "pretooluse"], {
      input: "not json",
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(malformed.status, 0, "malformed stdin fails open for non-essential checks");
  });
});

test("the README registration snippet wires the three events to core.mjs", () => {
  const readme = readFileSync(join(HERE, "..", "README.md"), "utf8");
  const match = readme.match(/```json\n([\s\S]*?)```/);
  assert.ok(match, "the README carries a json registration snippet");
  const settings = JSON.parse(match[1]);
  const hooks = settings.hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["PreToolUse", "Stop", "UserPromptSubmit"]);
  const commandFor = (event) => {
    const group = hooks[event][0];
    return group.hooks[0].command;
  };
  assert.match(commandFor("Stop"), /core\.mjs stop$/);
  assert.match(commandFor("UserPromptSubmit"), /core\.mjs userpromptsubmit$/);
  assert.match(commandFor("PreToolUse"), /core\.mjs pretooluse$/);
  assert.equal(hooks.PreToolUse[0].matcher, "Bash");
});
