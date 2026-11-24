---
title: Placeholders
description: Where placeholders can be used, and exactly what each one becomes in every output.
---

Skills and agents in a pack refer to each other through placeholders, never by plain name. `skillpack` replaces each placeholder with the right value for where the file ends up: an installed skill, the plain build for `npx skills`, or a generated agent.

| Placeholder | Refers to |
|---|---|
| `{{agent:<name>}}` | An agent in this pack, by its folder name in `src/agents/` |
| `{{skill:<name>}}` | A skill in this pack, by its folder name in `src/skills/` |
| `{{scope}}` | The pack's scope |

The examples on this page use a pack named `morovid` with these agents:

| Agent | `fallback` |
|---|---|
| `author` | a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff) |
| `scout` | a read-only exploration subagent (or do the search yourself, with a narrow scope) |

## Skill placeholders

**Where:** in `src/skills/<name>/`:

- `SKILL.md`: the body and the `description`;
- every other text file in the skill folder (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`).

A skill has two outputs, so each placeholder has two sets of values.

### Supported placeholders

When the pack is installed with `skillpack`, skills go to `.agents/skills/`, which OpenCode and Codex share. So one file has to name the right agent for both harnesses.

| Placeholder | When | Replaced with | Example |
|---|---|---|---|
| `{{agent:author}}` | A generated agent in every harness | The generated agent's ID, in backticks | `` `morovid-author` `` |
| `{{agent:scout}}` | Different built-in agents per harness | The OpenCode ID, then the others in parentheses | `` `explore` (Codex: `explorer`) `` |
| `{{agent:scout}}` | An agent in one harness, none in another | The agent's ID, then the fallback text for the others | `` `explore` (Codex: a read-only exploration subagent (or do the search yourself, with a narrow scope)) `` |
| `{{agent:scout}}` | None in every harness | The agent's `fallback` text | a read-only exploration subagent (or do the search yourself, with a narrow scope) |
| `{{skill:review}}` | Always | The installed skill name: `<scope>-<name>`, with any `_` written as `-` | `morovid-review` |
| `{{scope}}` | Always | The scope the pack was installed under: its `name`, or the `--as` value | `morovid` |

Harnesses appear in a fixed order (OpenCode, then Codex), and only those the pack was installed for.

Example source line, and the installed result when the user chose generated agents in OpenCode and Codex:

```md
Hand the work to {{agent:author}}, then review it with {{skill:review}}.
```

```md
Hand the work to `morovid-author`, then review it with morovid-review.
```

### Plain build

Written by `skillpack build` to `skills/`, for users who install the pack with `npx skills`. It has no agents and no prefixes.

| Placeholder | Replaced with | Example |
|---|---|---|
| `{{agent:author}}` | The agent's `fallback` text | a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff) |
| `{{skill:review}}` | The skill's plain name, with any `_` written as `-` | `review` |
| `{{scope}}` | The pack's `name` | `morovid` |

The same source line in the plain build:

```md
Hand the work to a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff), then review it with review.
```

Because `{{agent:…}}` can become either an ID or a phrase, write sentences that read correctly both ways. See [Skills](/pack/skills/#outputs).

## Agent placeholders

**Where:** in `src/agents/<name>/`:

- `instructions.md`;
- `description` in `manifest.json`.

Each generated agent file belongs to one harness, so placeholders are resolved for that harness only. There are no per-harness phrases here.

### Supported placeholders

Written to `.opencode/agents/` and `.codex/agents/` when the user installs the pack with `skillpack`.

| Placeholder | When (in this harness) | Replaced with | Example in the OpenCode file | Example in the Codex file |
|---|---|---|---|---|
| `{{agent:scout}}` | A generated agent | The generated agent's ID in this harness, in backticks | `` `morovid-scout` `` | `` `morovid-scout` `` |
| `{{agent:scout}}` | A built-in agent | That agent's ID, in backticks | `` `explore` `` | `` `explorer` `` |
| `{{agent:scout}}` | None | The agent's `fallback` text | a read-only exploration subagent (or do the search yourself, with a narrow scope) | same |
| `{{skill:review}}` | Always | The installed skill name | `morovid-review` | `morovid-review` |
| `{{scope}}` | Always | The installed scope | `morovid` | `morovid` |

Example source line in `src/agents/author/instructions.md`, with `scout` set to the built-in agents in both harnesses:

```md
Delegate searches to {{agent:scout}}.
```

```md title=".opencode/agents/morovid-author.md (body)"
Delegate searches to `explore`.
```

```toml title=".codex/agents/morovid-author.toml"
developer_instructions = """
Delegate searches to `explorer`.
"""
```

### Plain build

Written by `skillpack build` to `dist/agents/`, for users who install the skills with `npx skills` and copy the agents by hand. They're meant to be copied as a set, next to the plain-build skills.

| Placeholder | Replaced with | Example |
|---|---|---|
| `{{agent:scout}}` | The generated agent's ID in that harness, in backticks | `` `morovid-scout` `` (OpenCode), `` `morovid-scout` `` (Codex) |
| `{{skill:review}}` | The skill's plain name, as `npx skills` installs it (any `_` written as `-`) | `review` |
| `{{scope}}` | The pack's `name` | `morovid` |

## Validation

`skillpack validate` and `skillpack build` fail on:

- an unknown placeholder, such as `{{agents:scout}}` or `{{ scope }}`;
- `{{agent:<name>}}` naming an agent that isn't in `src/agents/`;
- `{{skill:<name>}}` naming a skill that isn't in `src/skills/`.

Replacing placeholders is deterministic: the same sources and the same choices always produce byte-identical files.
