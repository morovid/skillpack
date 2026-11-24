---
title: Environment
description: Credentials and external tools that skillpack uses.
---

:::caution[Draft]
This page is a stub. Content will be written from `requirements.md`.
:::

## Covers

- `git` and the user's git credentials (credential helper, SSH); fresh fetches into a temporary folder, with no cache.
- `GITHUB_TOKEN` and `GH_TOKEN`, used only when already set.
- Harness detection: `opencode` and `codex` on `PATH`, and their config folders.
- `opencode models` and the Codex model check.
- `skills-lock.json` from `npx skills`, read to detect duplicate installs.
- No environment variables change `skillpack`'s paths or defaults.

Requirements: R-SRC-2, R-SRC-5, R-CLI-4, R-CLI-5, R-CLI-6, R-REQ-1, R-SAF-6.
