# This fork

A fork of [Shell Yeah](https://github.com/stevecastaneda/paseo-plugins/tree/main/shell-yeah) by Steve Castaneda (MIT). It adds two switches at the bottom of the Run window: **Auto-run** and **Auto forward results**. Both are off by default. See "Running commands automatically" in the [README](README.md).

## Staying in sync with the original

Shell Yeah is a folder in the `paseo-plugins` repository, so there is no repository to fork or pull directly. `scripts/sync-upstream.mjs` clones that repository, splits out the folder's history with `git subtree split` (it gives the same commits every time, so this repository already holds everything up to its last sync) and merges the result into `main`.

A GitHub Action (`.github/workflows/sync-upstream.yml`) runs it every day at 05:23 UTC, and on demand from the Actions tab. It only pushes when:

1. the merge is clean, and
2. `npm ci`, `npm run typecheck` and `npm test` pass.

Otherwise `main` is left as it was and the Action opens one issue, "Upstream sync needs attention", with the last lines of the log. The run is marked failed so GitHub emails you.

GitHub switches scheduled workflows off after 60 days without activity in a public repository. If the daily run stops appearing, open the Actions tab and re-enable it, or run it from there.

### By hand

From a clean checkout of `main`:

```bash
node scripts/sync-upstream.mjs        # merges and checks, does not push
git push origin main
```

On a conflict nothing is changed and the files are listed. To resolve them:

```bash
git fetch https://github.com/stevecastaneda/paseo-plugins.git main
git subtree split --prefix=shell-yeah -b upstream-split FETCH_HEAD   # run inside a clone of paseo-plugins
```

Or, simpler, in a clone of `paseo-plugins` run `git subtree split --prefix=shell-yeah -b upstream-split`, then in this repository `git pull <path-to-that-clone> upstream-split`, fix the conflicts, run `npm run typecheck && npm test`, commit and push.

The script's exit code says what happened: `0` up to date or merged, `1` not run (wrong branch, uncommitted changes, upstream unreachable), `2` conflict, `3` checks failed, `4` could not push.

### Pulling into the copy Paseo runs

The Action only updates GitHub. Paseo runs the plugin from a local folder, so pull there and reload:

```bash
git pull
paseo plugin reload shell-yeah
```

### Tests for the sync script

```bash
node --test scripts/sync-upstream.test.mjs
```

They build a fake `paseo-plugins` and a fork in temporary folders and run the script through an up-to-date, clean, conflicting, failing-checks and unreachable case.
