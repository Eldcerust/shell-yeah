import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "sync-upstream.mjs");
const identity = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const passes = `"${process.execPath}" -e "process.exit(0)"`;
const fails = `"${process.execPath}" -e "process.exit(1)"`;

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...identity } });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

// A stand-in for the monorepo (a shell-yeah/ folder plus another plugin) and a fork split out of it
// that has a commit of its own and a bare remote to push to.
function world() {
  const root = mkdtempSync(join(tmpdir(), "sync-test-"));
  const mono = join(root, "mono");
  const fork = join(root, "fork");
  const origin = join(root, "origin.git");
  mkdirSync(mono);
  git(mono, "init", "-q", "-b", "main");
  write(mono, "shell-yeah/a.txt", "a1\na2\na3\n");
  write(mono, "shell-yeah/b.txt", "b1\nb2\nb3\n");
  write(mono, "other/x.txt", "x\n");
  git(mono, "add", "-A");
  git(mono, "commit", "-q", "-m", "init");
  git(mono, "subtree", "split", "--prefix", "shell-yeah", "-b", "split");

  mkdirSync(fork);
  git(fork, "init", "-q", "-b", "main");
  git(fork, "pull", "-q", mono, "split");
  write(fork, "b.txt", "b1\nFORK\nb3\n");
  git(fork, "commit", "-q", "-am", "fork change");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(fork, "remote", "add", "origin", origin);
  git(fork, "push", "-q", "origin", "main");

  const sync = (extra = {}) => {
    const result = spawnSync(process.execPath, [script], {
      cwd: fork,
      encoding: "utf8",
      env: { ...process.env, ...identity, UPSTREAM_URL: mono, SYNC_CHECKS: passes, ...extra },
    });
    return { code: result.status, out: result.stdout };
  };
  const upstreamCommit = (path, text, message = "upstream change") => {
    write(mono, path, text);
    git(mono, "add", "-A");
    git(mono, "commit", "-q", "-m", message);
  };
  return { root, mono, fork, origin, sync, upstreamCommit, head: () => git(fork, "rev-parse", "HEAD"), remote: () => git(origin, "rev-parse", "main"), clean: () => git(fork, "status", "--porcelain") === "" };
}

const done = (w) => rmSync(w.root, { recursive: true, force: true });
// Git on Windows may write CRLF.
const text = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("nothing new upstream: reports up to date and changes nothing", () => {
  const w = world();
  try {
    const before = w.head();
    const { code, out } = w.sync({ SYNC_PUSH: "1" });
    assert.equal(code, 0);
    assert.match(out, /Up to date/);
    assert.equal(w.head(), before);
  } finally { done(w); }
});

test("a clean upstream change is merged next to the fork's own, checked, and pushed", () => {
  const w = world();
  try {
    w.upstreamCommit("shell-yeah/a.txt", "a1\nUP\na3\n");
    w.upstreamCommit("other/x.txt", "x changed\n", "a different plugin, which must not come along");
    const { code, out } = w.sync({ SYNC_PUSH: "1" });
    assert.equal(code, 0, out);
    assert.match(out, /Merged upstream/);
    assert.equal(text(join(w.fork, "a.txt")), "a1\nUP\na3\n");
    assert.equal(text(join(w.fork, "b.txt")), "b1\nFORK\nb3\n", "the fork's own change survives");
    assert.equal(w.remote(), w.head(), "pushed");
    assert.equal(w.clean(), true);
    // Syncing again finds nothing new: the split gives the same commits every time.
    assert.match(w.sync().out, /Up to date/);
  } finally { done(w); }
});

test("without SYNC_PUSH the merge stays local", () => {
  const w = world();
  try {
    const remoteBefore = w.remote();
    w.upstreamCommit("shell-yeah/a.txt", "a1\nUP\na3\n");
    assert.equal(w.sync().code, 0);
    assert.equal(w.remote(), remoteBefore);
    assert.notEqual(w.head(), remoteBefore);
  } finally { done(w); }
});

test("a conflict changes nothing, names the files, and exits 2", () => {
  const w = world();
  try {
    const before = w.head();
    w.upstreamCommit("shell-yeah/b.txt", "b1\nUPSTREAM\nb3\n");
    const { code, out } = w.sync({ SYNC_PUSH: "1" });
    assert.equal(code, 2);
    assert.match(out, /Conflict/);
    assert.match(out, /b\.txt/);
    assert.equal(w.head(), before, "main is where it was");
    assert.equal(w.clean(), true, "no half-finished merge is left behind");
    assert.equal(w.remote(), before);
  } finally { done(w); }
});

test("a clean merge that fails the checks is undone and exits 3", () => {
  const w = world();
  try {
    const before = w.head();
    w.upstreamCommit("shell-yeah/a.txt", "a1\nUP\na3\n");
    const { code, out } = w.sync({ SYNC_CHECKS: fails, SYNC_PUSH: "1" });
    assert.equal(code, 3);
    assert.match(out, /checks fail/);
    assert.equal(w.head(), before);
    assert.equal(w.remote(), before);
  } finally { done(w); }
});

test("uncommitted changes and the wrong branch stop it before anything is fetched", () => {
  const w = world();
  try {
    write(w.fork, "scratch.txt", "x");
    const dirty = w.sync();
    assert.equal(dirty.code, 1);
    assert.match(dirty.out, /uncommitted/);
    rmSync(join(w.fork, "scratch.txt"));
    git(w.fork, "checkout", "-q", "-b", "feature");
    const wrong = w.sync();
    assert.equal(wrong.code, 1);
    assert.match(wrong.out, /not main/);
  } finally { done(w); }
});

test("an unreachable upstream exits 1 and changes nothing", () => {
  const w = world();
  try {
    const before = w.head();
    const { code } = w.sync({ UPSTREAM_URL: join(w.root, "does-not-exist") });
    assert.equal(code, 1);
    assert.equal(w.head(), before);
  } finally { done(w); }
});
