---
title: CLI
description: skillpack commands and flags.
---

:::caution[Draft]
This page is a stub. Content will be written from `requirements.md`.
:::

## Covers

- Source formats: `owner/repo` and git URLs (HTTPS or SSH), with `@<version>`. A pack is always a whole remote repository; local paths aren't supported.
- How sources are normalized into the keys used in `skillpack.json`, `skillpack.models.json` and `skillpack-lock.json`, and naming a pack in commands by its scope or its source.
- User commands: `add`, `remove`, `list`, `install`, `check`, `update`, `upgrade`, `configure`, `sync`, `doctor`.
- `install` semantics, following `pnpm install`, and `--frozen-lockfile` as the default when `CI` is set.
- What `add` writes as `version`: `^<latest tag>`, or the default branch.
- `check` shows, read-only, the newest version within each pack's range (for `update`) and the newest overall (for `upgrade`); `--exit-code` exits 1 when anything is outdated. `update` moves to the newest version within the requested range and leaves `version` alone; `upgrade` moves to the newest overall (`--include-prerelease` to count prereleases) and rewrites `version` in the same form (`^1.2.0` to `^2.0.0`, `~1.2.0` to `~2.0.0`, an exact version stays exact). Packs that follow a branch or are pinned to a commit or a non-semver tag are left alone by `upgrade`. Both ask only about agents that are new in the new version, drop bindings of agents that are gone, and move skills and agents to a new prefix when the pack's `name` changed.
- Pack author commands: `validate`, `build`, `render`, `init`.
- Flags: `-a/--harness`, `-s/--skill`, `--agent`, `--as`, `-y`, `--dry-run`, `--force`, `--frozen-lockfile`, `--strict` (fail when a model can't be matched), `--models` and `--model <name>=<harness>:<model>` for `configure`.
- Project scope only: there's no `-g`.

Requirements: R-SRC-1, R-SRC-4, R-CLI-1 to R-CLI-7, R-VER-2, R-VER-3, R-VER-6, R-VER-7, R-VER-7a.
