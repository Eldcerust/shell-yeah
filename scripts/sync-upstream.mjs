// Brings the original Shell Yeah into this fork.
//
// The original is a folder (shell-yeah/) in Steve Castaneda's paseo-plugins repository, so there is
// nothing to fork or pull directly. This clones that repository, splits out the folder's history with
// `git subtree split` (which gives the same commits every time, so the fork already holds everything
// up to its last sync), and merges the result into this repository's main.
//
// Run it from a clean checkout of main. Exit codes:
//   0  up to date, or merged (and pushed when SYNC_PUSH=1)
//   1  not run: wrong branch, uncommitted changes, or the original could not be read
//   2  the merge conflicts; nothing is changed
//   3  the merge is clean but the checks fail; nothing is changed
//   4  the merge is clean and passes but could not be pushed
//
// Settings, all optional:
//   UPSTREAM_URL     the repository that holds the original   (default: stevecastaneda/paseo-plugins)
//   UPSTREAM_PREFIX  the original's folder inside it           (default: shell-yeah)
//   SYNC_BRANCH      the branch to merge into                  (default: main)
//   SYNC_CHECKS      what must pass first                      (default: install, typecheck, test)
//   SYNC_PUSH        1 to push the merge to origin
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const upstream = process.env.UPSTREAM_URL ?? "https://github.com/stevecastaneda/paseo-plugins.git";
const prefix = process.env.UPSTREAM_PREFIX ?? "shell-yeah";
const branch = process.env.SYNC_BRANCH ?? "main";
const checks = process.env.SYNC_CHECKS ?? "npm ci --ignore-scripts && npm run typecheck && npm test";
const push = process.env.SYNC_PUSH === "1";

function git(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

function stop(code, message) {
  console.log(message);
  process.exitCode = code;
}

const work = mkdtempSync(join(tmpdir(), "shell-yeah-sync-"));
try {
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (current !== branch) {
    stop(1, `Not run: on ${current}, not ${branch}.`);
  } else if (git(["status", "--porcelain"]).out !== "") {
    stop(1, "Not run: there are uncommitted changes.");
  } else {
    const clone = join(work, "upstream");
    git(["clone", "--quiet", "--no-tags", upstream, clone]);
    git(["subtree", "split", "--prefix", prefix, "-b", "sync-split", "HEAD"], { cwd: clone });
    git(["fetch", "--quiet", clone, "+sync-split:refs/sync/upstream"]);

    const incoming = git(["rev-parse", "--short", "refs/sync/upstream"]).out;
    if (git(["merge-base", "--is-ancestor", "refs/sync/upstream", "HEAD"], { allowFailure: true }).status === 0) {
      stop(0, `Up to date with upstream (${incoming}).`);
    } else {
      const before = git(["rev-parse", "HEAD"]).out;
      const merged = git(["merge", "--no-edit", "-m", `Merge upstream Shell Yeah (${incoming})`, "refs/sync/upstream"], { allowFailure: true });
      if (merged.status !== 0) {
        const files = git(["diff", "--name-only", "--diff-filter=U"]).out;
        git(["merge", "--abort"], { allowFailure: true });
        stop(2, `Conflict merging upstream ${incoming}. Nothing was changed. Resolve these by hand:\n${files || "(none listed)"}`);
      } else if (spawnSync(checks, { shell: true, stdio: "inherit" }).status !== 0) {
        git(["reset", "--hard", before]);
        stop(3, `The merge of upstream ${incoming} is clean but the checks fail. Nothing was changed.`);
      } else if (push && git(["push", "origin", `HEAD:${branch}`], { allowFailure: true }).status !== 0) {
        stop(4, `Merged upstream ${incoming} and the checks pass, but the push failed. The merge is local.`);
      } else {
        const now = git(["rev-parse", "--short", "HEAD"]).out;
        stop(0, `Merged upstream ${incoming}; the fork is now at ${now}${push ? " and pushed" : ""}.`);
      }
    }
  }
} catch (error) {
  stop(1, `Not run: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
