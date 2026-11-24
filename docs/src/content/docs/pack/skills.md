---
title: Skills
description: How to write skill sources, and how they are rendered for skillpack and for npx skills.
---

Skills are written once, in `src/skills/`, using [placeholders](/pack/placeholders/) for agent and skill names. `skillpack` renders them in two ways:

- **Installed:** by `skillpack add`, with the pack's scope as a prefix and the user's agents filled in.
- **Plain build:** by `skillpack build`, committed to `skills/`, for users of `npx skills`.

:::note[Skill format]
Skills in a pack are standard Agent Skills. This page only covers what `skillpack` adds: placeholders, `metadata.internal`, and how skills are rendered. For the format itself and how to write a good skill, see:

- [Agent Skills specification](https://agentskills.io/specification): the `SKILL.md` format, frontmatter fields, naming rules and optional folders.
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) (Claude docs): how skills are loaded, and authoring guidance.
:::

## Layout

Each skill is a folder in `src/skills/` with a `SKILL.md` file. The folder name is the skill's name.

```text
src/skills/
  plan-code/
    SKILL.md            # required
    references/         # optional: documents the agent reads when needed
      planning-guide.md
    assets/             # optional: templates, images, data
    scripts/            # optional: code the agent can run
  review/
    SKILL.md
```

Everything in the folder is installed, not just `SKILL.md`. The folder follows the spec's [directory structure](https://agentskills.io/specification#directory-structure) and [optional directories](https://agentskills.io/specification#optional-directories).

## `SKILL.md`

```md title="src/skills/plan-code/SKILL.md"
---
name: plan-code
description: Design production changes and sequence their tasks. Use when a spec is approved and the work needs a plan.
metadata:
  internal: "true"
---
1. **Delegate planning.** Hand the work to {{agent:author}} with the [planning guide](references/planning-guide.md).
2. **Use helpers for bounded work.** The planner delegates searches to {{agent:scout}}.
3. **Review independently.** Ask {{agent:auditor}} to review the plan.

After a PASS, hand off to {{skill:plan-tests}}. For review rules, see [review](../review/SKILL.md).
```

### Frontmatter

| Field | Required | Description |
|---|---|---|
| `name` | **Yes** | Must equal the folder name. No placeholders. Both outputs write any `_` as `-`. |
| `description` | **Yes** | What the skill does and when to use it. At most 1024 characters. Placeholders are allowed. |
| `metadata.internal` | **Yes** | Must be `"true"`. Hides the source from `npx skills` (see [below](#why-metadatainternal)). Removed from both outputs. |
| `license`, `compatibility`, `allowed-tools`, other `metadata` keys | No | As in the [spec's frontmatter fields](https://agentskills.io/specification#frontmatter). Copied to both outputs unchanged. |

### Names

- Lowercase letters and digits, separated by single `-` or `_`: `^[a-z0-9]+([-_][a-z0-9]+)*$`.
- At most 64 characters **including the scope prefix**. Installed names are `<scope>-<name>`, so with the scope `morovid` (7 characters) a skill name can have at most 56.

The [Agent Skills spec](https://agentskills.io/specification#name-field) allows only `-`, so both outputs write every `_` as `-`, in the scope too: `plan_code` in the pack `my_pack` installs as `my-pack-plan-code`, and the plain build names it `plan-code`. `skillpack validate` fails if two skills end up with the same name, such as `plan_code` and `plan-code`.

### Body

The body is the skill's instructions, in Markdown. It can use placeholders:

| Placeholder | Installed | Plain build |
|---|---|---|
| `{{agent:<name>}}` | The agent the user chose, e.g. `` `morovid-author` `` | The agent's [`fallback`](/pack/agents/#fallback) text |
| `{{skill:<name>}}` | `morovid-<name>` | `<name>` |
| `{{scope}}` | `morovid` | `morovid` |

Refer to agents and other skills **only** through placeholders. Plain mentions of names are never rewritten. See [Placeholders](/pack/placeholders/) for escaping and the exact rules.

## Other files

Every file in the skill folder is copied:

- **Text files** (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`): placeholders are replaced, as in `SKILL.md`.
- **Everything else**, including images and scripts: copied byte for byte.

`skillpack` never runs a pack's scripts: not during install, `sync` or `build`. When a skill contains executable files, `skillpack add` lists them before installing.

## Links between skills

Link to another skill in the same pack with a relative path to its folder:

```md
For review rules, see [review](../review/SKILL.md).
```

When a skill is installed, folder names get the scope prefix, so `skillpack` rewrites these links: `../review/SKILL.md` becomes `../morovid-review/SKILL.md`. The plain build keeps folder names unprefixed, so its links stay as written, except links to a skill whose name has `_`, which the plain build writes with `-`. Links inside a skill's own folder, such as `references/planning-guide.md`, never change.

Only relative links that point to another skill in `src/skills/` are rewritten. To name a skill in running text rather than link to it, use `{{skill:<name>}}`.

## Outputs

The same source produces two different folders:

| | Installed (`skillpack add`) | Plain build (`skillpack build`) |
|---|---|---|
| Location | `.agents/skills/morovid-plan-code/` | `skills/plan-code/` in the pack |
| Frontmatter `name` | `morovid-plan-code` | `plan-code` |
| `{{agent:author}}` | The bound agent, e.g. `` `morovid-author` `` | The agent's fallback text |
| `{{skill:plan-tests}}` | `morovid-plan-tests` | `plan-tests` |
| Links to other skills | Rewritten to prefixed folders | Unchanged, unless the target's name has `_` (written as `-`) |
| `metadata.internal` | Removed | Removed |
| Extra content | None; the folder's hash is recorded in the user's `skillpack-lock.json` | A comment after the frontmatter: generated from `src/skills/plan-code`, edit the source |

The same line in each output:

| Output | Rendered line |
|---|---|
| Installed, agent bound to generate | Hand the work to `morovid-author` with the planning guide. |
| Installed, agent bound to different built-in agents per harness | The planner delegates searches to `explore` (Codex: `explorer`). |
| Plain build | Hand the work to a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff) with the planning guide. |

Write sentences around `{{agent:…}}` so they read correctly with both an agent ID and the fallback text. "Hand the work to {{agent:author}}" works with both; "Start a fresh {{agent:author}}" becomes "Start a fresh a document-authoring subagent" in the plain build.

Rendering is deterministic: the same source and the same choices always produce byte-identical files. `skillpack` compares hashes to find local edits, and `build --check` uses the same property.

## The plain build

Run `build` in the pack root to write `skills/` from `src/skills/`:

```sh
npx @morovid/skillpack build
```

Commit `skills/` together with the sources. It's what `npx skills add morovid/skills` installs, with the same names as before the pack used `skillpack`.

Don't edit `skills/` by hand: the next `build` overwrites it. To check in CI that it's up to date:

```sh
npx @morovid/skillpack build --check
```

This exits with an error if any file in `skills/` differs from what `build` would write.

### Why `metadata.internal`

`npx skills` doesn't search the whole repository by default. `npx skills add` looks in these places, in order, and skips any skill whose name it has already found:

1. A `SKILL.md` at the repository root.
2. `skills/` (and `skills/.curated`, `.experimental`, `.system`), up to three levels deep.
3. Harness skill folders such as `.agents/skills/` and `.claude/skills/`, plus folders declared in `skills.sh.json` or plugin manifests.

It searches every folder (except `node_modules`, `.git`, `dist`, `build` and `__pycache__`), which reaches `src/skills/`, only when:

- nothing was found in those places, for example before the first `skillpack build`;
- the user passes `--full-depth`;
- the user runs `npx skills update`, which always searches every folder and keeps duplicate names, so it can tell where each installed skill now lives.

In those cases the sources in `src/skills/` would show up next to the plain build. `npx skills update` is the important one: when it finds two folders with the same skill name in a git repository, it warns about "multiple current paths" and **skips updating that skill**. `metadata.internal: "true"` hides the sources from all of these searches, so only the plain build is found.

`npx skills` does include internal skills when a user asks for one by name (`--skill plan-code`). The plain build in `skills/plan-code/` has the same name and is found first, so the user still gets the plain build.

That's why `metadata.internal` is required in every source `SKILL.md`, and `skillpack validate` fails without it. `skillpack` itself doesn't need it: it removes the key from both outputs.

## Validation

`skillpack validate` and `skillpack build` check every skill:

- `SKILL.md` exists and has `name`, `description` and `metadata.internal: "true"`.
- `name` equals the folder name, follows the naming rules, and `<scope>-<name>` fits in 64 characters.
- Every placeholder is known, and every agent and skill it names exists in the pack.
- `name` contains no placeholders.
