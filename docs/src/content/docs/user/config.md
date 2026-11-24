---
title: Selection config (skillpack.json)
description: The committed file that lists a project's packs, their versions and skills, and how each agent is filled in each harness.
---

`skillpack.json` at the project root says what the project wants: which packs, which versions, which skills, and how each of the pack's agents is filled in each harness. It's committed, so the whole team gets the same skills.

`skillpack add`, `configure`, `upgrade` and `remove` write it. You can also edit it by hand and then run `skillpack install` or `skillpack sync`.

```json title="skillpack.json"
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/config.json",
  "packs": {
    "https://github.com/morovid/skills": {
      "version": "^1.0.0",
      "harnesses": ["opencode", "codex"],
      "skills": "*",
      "agents": {
        "scout":   { "opencode": "existing:explore", "codex": "generate" },
        "author":  { "opencode": "generate", "codex": "generate" },
        "auditor": { "opencode": "generate", "codex": "none" }
      }
    }
  }
}
```

The file holds nothing that depends on your machine. The concrete models for generated agents are in [`skillpack.models.json`](/user/models/), which isn't committed.

## Packs

Each key in `packs` is the pack's **source**, normalized:

| You type | Key |
|---|---|
| `morovid/skills` | `https://github.com/morovid/skills` |
| `https://github.com/morovid/skills.git` | `https://github.com/morovid/skills` |
| `git@github.com:morovid/skills.git` | `git@github.com:morovid/skills` |

A pack is always a whole remote repository. Packs in a subfolder of a repository and local paths aren't supported, because every teammate has to be able to fetch the pack.

In commands, you can name a pack by its scope or its source: `skillpack configure morovid` and `skillpack configure morovid/skills` do the same thing.

| Key | Required | Description |
|---|---|---|
| `version` | **Yes** | The version you asked for: `1.2.0`, a range such as `^1.0.0`, a tag, a branch or a commit SHA. See [Versions](#versions). |
| `harnesses` | **Yes** | The harnesses the pack is installed for: `opencode`, `codex` or both. |
| `skills` | No | `"*"` (the default) for every skill in the pack, or a list of skill names. Set with `-s`. Removing one skill with `skillpack remove` turns `"*"` into the list of the remaining skills. |
| `scope` | No | The prefix for the pack's skills and agents, if not the pack's own name. Set with `--as`, for example when two packs have the same name. |
| `agents` | No | How each agent is filled in each harness (see below). |

## Versions

| You run | `version` becomes |
|---|---|
| `skillpack add morovid/skills` | `^<latest tag>`, e.g. `^1.4.0`, like `npm install`. If the pack has no version tags, the default branch, e.g. `main`. |
| `skillpack add morovid/skills@1.2.0` | `1.2.0` (also `@^1.2`, `@v1.2.0`, `@main` or `@<commit>`, as given) |
| `skillpack update` | Unchanged. Moves to the newest version within the range. |
| `skillpack upgrade` | Rewritten to the newest version, including a new major: `^1.4.0` becomes `^2.0.0`, an exact version stays exact. Packs on a branch or commit are left alone. |

`skillpack check` lists the newer versions that `update` and `upgrade` would install. Both prompt only for agents that are new in the pack.

## Agents

`agents.<agent>.<harness>` is the **binding** for one agent of the pack in one harness. `<agent>` is the agent's name in the pack, such as `scout`.

| Value | Meaning |
|---|---|
| `"generate"` | Generate the pack's agent for this harness. Its model comes from [`skillpack.models.json`](/user/models/). |
| `"existing:<id>"` | Use one of the harness's built-in agents instead: `general` or `explore` in OpenCode; `default`, `worker` or `explorer` in Codex. Skills name that agent. |
| `"none"` | No agent. Skills use the agent's fallback text, which tells the model what to do instead. |

Custom agents, your own or the project's, can't be bound: a teammate may not have them, and the committed skills would name an agent that doesn't exist.

Agents and harnesses left out of the file are bound to `generate`. `add`, `update`, `upgrade` and `configure` write every binding explicitly, so a new pack version can't silently change one. A binding never depends on your machine: if no available model matches what an agent asks for, the agent is still generated, without a model (see [Models file](/user/models/#how-its-filled-in)).

`--agent scout,author` sets every other agent to `none`, and `--agent none` sets all of them to `none`.

### Different agents per harness

A generated agent has the same ID in every harness, such as `morovid-scout`. Skills are shared by OpenCode and Codex, so when an agent is bound to different agents in the two harnesses, the skill names both:

```json
"scout": { "opencode": "existing:explore", "codex": "existing:explorer" }
```

```md
Delegate searches to `explore` (Codex: `explorer`).
```

## Changing the config

| Do this | Then |
|---|---|
| `skillpack configure [pack] [agent…]` | Asks again for the chosen agents (or all of them), saves the file and runs `sync`. |
| `skillpack configure --show` | Prints the current bindings, models and warnings. |
| Edit bindings by hand | Run `skillpack sync`. |
| Edit `version`, or add or remove a pack by hand | Run `skillpack install`. It resolves the changed packs and updates the lock file, like `pnpm install`. |
| Pull a teammate's change to the file | Run `skillpack install` to regenerate your agents. `skillpack doctor` tells you when it's needed. |

`sync` re-renders skills and agents from the locked commit of each pack. It never changes versions; use `update` or `upgrade` for that.

Agents and keys that no longer exist in the pack are reported by `skillpack doctor` and kept until you remove them.

## Defaults are fixed

File names, paths and folders are defined by `skillpack`. No setting in this file, and no environment variable, changes them. See [Paths](/reference/paths/).
