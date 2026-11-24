---
title: Paths
description: Every path skillpack reads or writes. All of them are fixed and relative to the project root.
---

`skillpack` works in the current project only. Every path is fixed: no config key or environment variable changes it.

## Project

| Path | Committed | Written by | See |
|---|---|---|---|
| `skillpack.json` | Yes | `add`, `remove`, `configure`, `upgrade`, you | [Selection config](/user/config/) |
| `skillpack-lock.json` | Yes | `add`, `install`, `sync`, `configure`, `update`, `upgrade`, `remove` | [Lock file](/user/lock-file/) |
| `.agents/skills/<scope>-<name>/` | Yes | same | [Installed files](/user/installed-files/#rendered-skills) |
| `skillpack.models.json` | No | `add`, `install`, `sync`, `configure`, you | [Models file](/user/models/) |
| `.opencode/agents/<scope>-<agent>.md` | No | `add`, `install`, `sync`, `configure`, `update`, `upgrade`, `remove` | [Installed files](/user/installed-files/#generated-agents) |
| `.codex/agents/<scope>-<agent>.toml` | No | same | same |
| `.git/info/exclude` | – | the block between `# >>> skillpack` and `# <<< skillpack` only | [Installed files](/user/installed-files/#what-goes-into-git) |

## Read only

| Path | Why |
|---|---|
| `skills-lock.json` | Written by `npx skills`; read to find the same pack installed twice |
| `.opencode/`, `.codex/` and the harnesses' user config folders | To detect harnesses |

## Pack sources

Pack sources aren't cached. Each command that needs one fetches it into a new folder in the system's temporary folder and deletes it when done.

## Pack repository

For pack authors, the folders in a pack are fixed too: `skillpack.pack.json`, `src/skills/`, `src/agents/`, `skills/` and `dist/agents/`. See [Folder structure](/pack/folder-structure/).
