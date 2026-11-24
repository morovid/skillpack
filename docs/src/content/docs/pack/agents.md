---
title: Agent definitions
description: How to define an agent once and have skillpack generate it for OpenCode and Codex.
---

An agent definition describes one helper agent, such as a code scout or a document author, in a harness-neutral way. When a user installs the pack, `skillpack` turns it into an OpenCode agent and a Codex agent, using the models the user picked.

Each agent is a folder in `src/agents/` with two files:

```text
src/agents/
  author/
    manifest.json      # configuration
    instructions.md    # what the agent does
  scout/
    manifest.json
    instructions.md
```

The folder name is the **agent name**. Skills refer to the agent by name with a [placeholder](/pack/placeholders/), e.g. `{{agent:author}}`. The configuration and the instructions are separate files, so each can be linted on its own: `manifest.json` against a JSON Schema, and `instructions.md` with any Markdown linter.

## Example

```json title="src/agents/author/manifest.json"
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/agent.json",
  "description": "Drafts or revises spec, plan and test-plan artifacts from a self-contained handoff.",
  "fallback": "a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff)",
  "model": { "name": ["sonnet-5.5", "gpt-6.2-sol"], "effort": "high" },
  "spawn": ["scout", "scribe"],
  "capabilities": {
    "edit": { "allow": ["specs/*"] },
    "shell": { "allow": ["git diff *", "git log *", "git status *"] }
  }
}
```

```md title="src/agents/author/instructions.md"
You are a document author. Use targeted edits, not full rewrites of large files.
Delegate searches to {{agent:scout}} and mechanical edits to {{agent:scribe}}.
Never start other agents.
```

The smallest valid agent needs only a description and fallback text, plus non-empty instructions:

```json title="src/agents/scout/manifest.json"
{
  "description": "Finds code and answers questions about the codebase without changing anything.",
  "fallback": "a read-only exploration subagent (or do the search yourself, with a narrow scope)"
}
```

## Agent names

The folder name is the agent name. Agent names follow the same rules as skill names:

- Lowercase letters and digits, separated by single `-` or `_`: `^[a-z0-9]+([-_][a-z0-9]+)*$`.
- `<scope>-<agent name>` must fit in 64 characters, where the scope is the pack's [`name`](/pack/manifest/#name).

The installed agent ID is `<scope>-<agent name>`, always in kebab case: any `_` is written as `-`. It's the same in every harness, e.g. `morovid-author` in `.opencode/agents/morovid-author.md` and in `.codex/agents/morovid-author.toml`, so skills shared by OpenCode and Codex name the same agent. `skillpack validate` fails if two agents end up with the same ID, such as `code_scout` and `code-scout`.

## `instructions.md`

The agent's instructions: what it does, how it works and what it returns. Plain Markdown with no frontmatter. It may use [placeholders](/pack/placeholders/), e.g. `{{agent:scout}}` or `{{skill:review}}`. The file must exist and must not be empty.

| Harness | Where the instructions go |
|---|---|
| OpenCode | Body of `.opencode/agents/<OpenCode ID>.md`, used as the agent's system prompt |
| Codex | `developer_instructions` in `.codex/agents/<Codex ID>.toml`, followed by any restrictions Codex can't enforce (see [capabilities](#what-each-harness-enforces)) |

## `manifest.json`

| Key | Required | Type | Default | Description |
|---|---|---|---|---|
| [`$schema`](#schema) | No | string | – | Schema URL; sets the format version |
| [`description`](#description) | **Yes** | string | – | When to use this agent |
| [`fallback`](#fallback) | **Yes** | string | – | Text used in skills when there's no agent |
| [`model`](#model) | No | string or object | parent's model | Model name(s) and effort |
| [`mode`](#mode) | No | string | `subagent` | `subagent`, `primary` or `all` |
| [`spawn`](#spawn) | No | array | `[]` | Agents this agent may start |
| [`capabilities`](#capabilities) | No | object | see below | What the agent may do |

Unknown keys are an error.

### `$schema`

```json
"$schema": "https://skillpack.morovid.com/schemas/v1/agent.json"
```

Turns on validation and autocomplete in editors. `/v1/` is the format version: a change that breaks existing files gets a new folder (`/v2/`). A file without `$schema` is read as `v1`.

### `description`

```json
"description": "Finds code and answers questions about the codebase without changing anything."
```

Says when to use the agent. Both harnesses show it to the model that decides which agent to start, so describe the job, not the implementation. At most 1024 characters.

It may use these [placeholders](/pack/placeholders/):

| Placeholder | Becomes |
|---|---|
| `{{agent:<name>}}` | The ID of another agent in the pack, as bound by the user in this harness, e.g. `morovid-scout` |
| `{{skill:<name>}}` | The installed name of a skill in the pack, e.g. `morovid-review` |
| `{{scope}}` | The pack's scope, e.g. `morovid` |

```json
"description": "Reviews plans written with {{skill:plan-code}} before implementation starts."
```

### `fallback`

```json
"fallback": "a read-only exploration subagent (or do the search yourself, with a narrow scope)"
```

The phrase that replaces `{{agent:<name>}}` in the skills that use this agent, when there's no agent to name:

- the pack was installed with `npx skills`, which installs only skills and generates no agents, or
- the user installed it with `skillpack` but chose **none** for this agent.

Write it so the sentence around the placeholder still reads correctly, and say what to do instead. Don't name harness-specific agents such as `explore`: with `npx skills` there's no telling which harness reads the skill. No placeholders. At most 300 characters.

### `model`

The model the agent asks for, by a **harness-neutral name**: no provider prefix and no variant.

```json
"model": "sonnet-5.5"
```

```json
"model": { "name": ["sonnet-5.5", "gpt-6.2-sol"], "effort": "high" }
```

| Field | Description |
|---|---|
| `name` | A model name, or a list in order of preference. |
| `effort` | Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max`. Left out, the model's default is used. |

How it's resolved when the pack is installed, for each harness:

1. Each name is matched against the models available in the harness, ignoring the provider prefix and case, and treating `.` and `-` alike. So `sonnet-5.5` matches `github-copilot/claude-sonnet-5.5` and `anthropic/claude-sonnet-5-5`.
2. The first name with a match wins.
   - **One match:** it's used.
   - **Several matches** (e.g. the same model from two providers): the user picks one.
   - **No match** for any name: the user picks any available model or types one in.
3. The choice is saved per pack in the user's [`skillpack.models.json`](/user/models/), a local file that isn't committed, so every agent in the pack that asks for `sonnet-5.5` gets the same model. Other packs keep their own choices. The user can change it later with `skillpack configure` or by editing the file.

With `-y` there are no questions: with several matches, the provider of the harness's default model is preferred. With no match, or if the user skips the question, the agent is still generated, but without a model, so it uses the model of the agent that started it. Both cases print a warning. A missing model never changes how skills name the agent, so the user's committed skills stay the same on every machine.

How the result is written for each harness:

| Harness | Model | Effort |
|---|---|---|
| OpenCode | `model: <provider>/<model>`, e.g. `github-copilot/claude-sonnet-5.5` | Appended as the variant: `#high`. If the model has no variant with that name, the nearest one is used, with a warning. |
| Codex | `model = "<model>"`, e.g. `gpt-6.2-sol` | `model_reasoning_effort = "high"` |

List more than one name when the harnesses differ. In the example, OpenCode gets Sonnet, and Codex, which has no Sonnet, gets `gpt-6.2-sol`.

Leave `model` out to let the agent use the model of the agent that started it.

### `mode`

```json
"mode": "subagent"
```

| Value | Meaning |
|---|---|
| `subagent` (default) | Started by another agent |
| `primary` | A main agent the user selects. Codex has no primary agents, so there it's generated as a subagent, with a warning. |
| `all` | Both. In Codex it's a subagent. |

### `spawn`

```json
"spawn": ["scout", "scribe"]
```

Names of other agents in this pack that this agent may start. Leave it out, or leave it empty, for agents that start no others.

`skillpack validate` checks that every listed agent exists, that there are no cycles (an agent starting itself, directly or through others), and that the nesting is no deeper than each harness allows.

When the pack is installed, each name becomes the ID of the agent the user chose for it. If the user chose OpenCode's built-in `explore` agent for `scout`, `author` may start `explore`.

### `capabilities`

Agents are **denied by default**: an agent may only do what `capabilities` allows.

| Capability | Default | Type | Allows |
|---|---|---|---|
| `read` | `true` | boolean | Reading files |
| `search` | `true` | boolean | Finding files and searching their contents |
| `skills` | `true` | boolean | Loading skills |
| `edit` | `false` | boolean or patterns | Creating and changing files |
| `shell` | `false` | boolean or patterns | Running shell commands |
| `web` | `false` | boolean | Fetching URLs and searching the web |
| `questions` | `false` | boolean | Asking the user questions |
| `mcp` | `false` | boolean or server names | Using MCP tools |

`edit` and `shell` take `true`, `false`, or an object with `allow` and `deny` patterns:

```json
"edit": { "allow": ["specs/*", "docs/*"], "deny": ["docs/generated/*"] },
"shell": { "allow": ["git diff *", "git status *"] }
```

- If `allow` is left out, everything is allowed. Then `deny` removes exceptions.
- In patterns, `*` matches any characters, including `/`, and `?` matches one character.
- `edit` patterns are paths relative to the project root. `shell` patterns match the command text. A shell pattern ending in ` *` also matches the command with no arguments, so `git status *` matches `git status`.

`mcp` takes `true` (every MCP server the user has configured), `false`, or a list of server names:

```json
"mcp": ["github", "linear"]
```

#### What each harness enforces

OpenCode enforces all capabilities through agent permissions. Codex agents inherit the parent session's sandbox and approvals, so Codex can only switch off a few features. Everything else is added to the agent's instructions as text, and `skillpack` warns that it isn't enforced.

| Capability | OpenCode | Codex |
|---|---|---|
| `read`, `search` | Enforced | Instructions only |
| `edit` | Enforced | Instructions only |
| `shell: false` | Enforced | Enforced (`features.shell_tool = false`) |
| `shell` patterns | Enforced | Instructions only |
| `web` | Enforced | Instructions only |
| `skills: false` | Enforced | Enforced (`skills.include_instructions = false`) |
| `questions` | Enforced | – |
| `mcp` | Enforced | Instructions only |
| `spawn` | Enforced | Instructions only |

## What gets generated

For `author` in the `morovid` pack, bound to generated agents in both harnesses:

```md title=".opencode/agents/morovid-author.md"
---
# generated by skillpack from https://github.com/morovid/skills@v1.0.0 src/agents/author/ — do not edit; change with `skillpack configure`
# binding: generate github-copilot/claude-sonnet-5.5#high
# hash: sha256-3f2a…
description: Drafts or revises spec, plan and test-plan artifacts from a self-contained handoff.
mode: subagent
model: github-copilot/claude-sonnet-5.5#high
permissions:
  - { action: "*", resource: "*", effect: deny }
  - { action: read, resource: "*", effect: allow }
  - { action: glob, resource: "*", effect: allow }
  - { action: grep, resource: "*", effect: allow }
  - { action: skill, resource: "*", effect: allow }
  - { action: edit, resource: "specs/*", effect: allow }
  - { action: shell, resource: "git diff *", effect: allow }
  - { action: shell, resource: "git log *", effect: allow }
  - { action: shell, resource: "git status *", effect: allow }
  - { action: subagent, resource: "morovid-scout", effect: allow }
  - { action: subagent, resource: "morovid-scribe", effect: allow }
---
You are a document author. Use targeted edits, not full rewrites of large files.
Delegate searches to `morovid-scout` and mechanical edits to `morovid-scribe`.
Never start other agents.
```

```toml title=".codex/agents/morovid-author.toml"
# generated by skillpack from https://github.com/morovid/skills@v1.0.0 src/agents/author/ — do not edit; change with `skillpack configure`
# binding: generate gpt-6.2-sol/high
# hash: sha256-9c41…
name = "morovid-author"
description = "Drafts or revises spec, plan and test-plan artifacts from a self-contained handoff."
model = "gpt-6.2-sol"
model_reasoning_effort = "high"
developer_instructions = """
You are a document author. Use targeted edits, not full rewrites of large files.
Delegate searches to `morovid-scout` and mechanical edits to `morovid-scribe`.
Never start other agents.

Restrictions (not enforced by Codex; follow them strictly):
- Edit only files matching specs/*.
- Run only these shell commands: git diff, git log, git status.
- Don't use web or MCP tools.
- Start only these agents: morovid-scout, morovid-scribe.
"""
```

Generated agents are local to each user's machine: they contain the models from the user's `skillpack.models.json`, so they aren't committed. Each file carries a header with a hash of its contents, and `skillpack` won't overwrite one that was edited by hand unless the user passes `--force`. To change a model or binding, the user runs `skillpack configure`. See [Installed files](/user/installed-files/#generated-agents).

## Validation

`skillpack validate` checks:

- every `manifest.json` against the schema,
- every agent folder has a non-empty `instructions.md`,
- agent names and `<scope>-<agent name>` lengths,
- `spawn` targets exist, there are no cycles, and nesting stays within each harness's limit,
- placeholders in `instructions.md` and `description` refer to existing agents and skills, and `fallback` has none.
