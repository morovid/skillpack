---
title: Manifest (skillpack.pack.json)
description: The pack manifest that names the pack and says which CLI versions and harnesses it supports.
---

Every pack has a `skillpack.pack.json` file at its root. It names the pack and says which CLI versions and harnesses the pack works with. Everything else (folders, versions, models) comes from conventions, git tags and the agent definitions.

```json title="skillpack.pack.json"
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/pack.json",
  "name": "morovid",
  "description": "Engineering workflow: spec, plan-code, plan-tests, implement, review",
  "cli": ">=0.1.0",
  "harnesses": ["opencode", "codex"]
}
```

The smallest valid manifest is just a name:

```json title="skillpack.pack.json"
{ "name": "morovid" }
```

## Keys

| Key | Required | Type | Description |
|---|---|---|---|
| [`$schema`](#schema) | No | string | Schema URL; sets the manifest format version |
| [`name`](#name) | **Yes** | string | The pack's scope, used as a prefix for its skills and agents |
| [`description`](#description) | No | string | One-line summary |
| [`cli`](#cli) | No | semver range | `skillpack` versions the pack works with |
| [`harnesses`](#harnesses) | No | array | Harnesses the pack supports |

Unknown keys are an error, so typos are caught by `skillpack validate` and by editors.

### `$schema`

```json
"$schema": "https://skillpack.morovid.com/schemas/v1/pack.json"
```

Turns on validation and autocomplete in editors. The `/v1/` folder is the **format version** of the manifest: a format change that breaks existing manifests gets a new folder (`/v2/`), and the CLI reads the version from this URL. A manifest without `$schema` is read as `v1`.

### `name`

```json
"name": "morovid"
```

The pack's **scope**. Every skill and agent the pack installs gets this name as a prefix, so two packs can both ship an `implement` skill:

| Source | Installed as |
|---|---|
| `src/skills/implement/` | `.agents/skills/morovid-implement/` |
| `src/agents/scout/` | `.opencode/agents/morovid-scout.md`, `.codex/agents/morovid-scout.toml` |

Rules:

- Lowercase letters and digits, separated by single `-` or `_`: `^[a-z0-9]+([-_][a-z0-9]+)*$`. Installed names always use `-`: `my_pack` installs skills as `my-pack-…` and agents as `my-pack-scout`.
- At most 24 characters. Installed skill names are limited to 64 characters, so this leaves at least 39 for the skill's own name.

If two installed packs use the same name, `skillpack add` fails before writing anything. The user can then install one of them under a different scope with `--as <scope>`.

### `description`

```json
"description": "Engineering workflow: spec, plan-code, plan-tests, implement, review"
```

A one-line summary, at most 300 characters. Shown by `add`, `list` and `check`.

### `cli`

```json
"cli": ">=0.1.0"
```

A [semver range](https://github.com/npm/node-semver#ranges) of `skillpack` versions the pack works with. If the running CLI is outside the range, every command that reads the pack fails and says which version is needed. Leave it out to accept any version.

### `harnesses`

```json
"harnesses": ["opencode", "codex"]
```

The harnesses the pack supports: `opencode`, `codex`, or both. If set, `skillpack` only offers these harnesses, and `-a` with any other harness fails. If left out, every harness the CLI supports is offered.

## Packs without a manifest

A repository without `skillpack.pack.json` can still be installed. `skillpack` finds its skills the same way `npx skills` does, uses the repository owner as the scope, and installs no agents and replaces no placeholders. It prints a warning that the pack has no manifest.
