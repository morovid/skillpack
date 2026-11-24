---
title: Folder structure
description: The files and folders in a skill pack repository, what each one contains, and which are hand-written.
---

A pack is a git repository with a fixed structure at its root. Packs in a subfolder of a repository aren't supported. `skillpack` reads the sources in `src/` and the [manifest](/pack/manifest/); you never tell it where things are.

```text
morovid/                          # pack root
  skillpack.pack.json
  src/
    skills/
      plan-code/
        SKILL.md                  # required
        references/…              # optional
      review/
        SKILL.md
    agents/
      author/
        manifest.json             # configuration
        instructions.md           # instructions
      scout/
        manifest.json
        instructions.md
  skills/                         # plain build, for npx skills
    plan-code/
      SKILL.md
    review/
      SKILL.md
  dist/agents/                    # optional, for npx skills users
    README.md
    opencode/morovid-author.md
    codex/morovid-author.toml
```

## What each part contains

| Path | Hand-written | Contains |
|---|---|---|
| `skillpack.pack.json` | Yes | The pack's name (its scope), description, required CLI versions and supported harnesses. See [Manifest](/pack/manifest/). |
| `src/skills/<name>/` | Yes | One folder per skill: `SKILL.md` and optional `references/`, `assets/` and `scripts/`. The folder name is the skill name, and placeholders are allowed. See [Skills](/pack/skills/). |
| `src/agents/<name>/` | Yes | One folder per agent: `manifest.json` for its configuration and `instructions.md` for what it does. The folder name is the agent name. See [Agent definitions](/pack/agents/). |
| `skills/` | No | The plain build, written by `skillpack build` from `src/skills/`: unchanged skill names (any `_` written as `-`), placeholders filled in for a build without agents, and no `metadata.internal`. This is what `npx skills` finds. See [Skill placeholders](/pack/placeholders/#plain-build). |
| `dist/agents/` | No | Optional ready-to-copy agents, written by `skillpack build`, for users who install the skills with `npx skills` and add agents by hand: one file per harness, plus a short README. See [Agent placeholders](/pack/placeholders/#plain-build-1). |

## Sources and generated files

`src/` is the only place you edit. `skillpack add` installs from `src/`, never from the plain build.

- **`src/` and `skills/` are both committed.** `npx skills` reads the repository directly, so the plain build has to be there. After changing a source, run `skillpack build` and commit the result. `skillpack build --check` fails when `skills/` is out of date, which is useful in CI and before a release.
- **`dist/agents/` is optional.** Commit it if you want to offer ready-to-copy agents; leave it out otherwise. Keep it in step with `skills/`; `skillpack build` writes both.
- **Don't edit `skills/` or `dist/agents/` by hand.** The next `skillpack build` overwrites them.

`skillpack` never changes `.gitignore`. It prints which generated paths and config files to commit.

## Repositories without a manifest

A repository with no `skillpack.pack.json` still installs, as an **unversioned** pack. `skillpack` finds its skills the same way `npx skills` does, takes the scope from the repository owner, and warns that there's no manifest. Such a pack has no placeholders and no agents.
