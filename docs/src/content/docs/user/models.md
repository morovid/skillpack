---
title: Models file (skillpack.models.json)
description: The local, uncommitted file that maps the models a pack's agents ask for to the models available on your machine.
---

Agents in a pack ask for models by a neutral name, such as `sonnet-5.5`. Which model that is depends on your machine: one engineer has it through GitHub Copilot, another through Anthropic directly. `skillpack.models.json` records the choice for your machine.

```json title="skillpack.models.json"
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/models.json",
  "packs": {
    "https://github.com/morovid/skills": {
      "sonnet-5.5":  { "opencode": "github-copilot/claude-sonnet-5.5" },
      "gpt-6.2-sol": { "opencode": "github-copilot/gpt-6.2-sol", "codex": "gpt-6.2-sol" },
      "gpt-6-luna":  { "codex": "gpt-6-luna" }
    }
  }
}
```

`packs.<source>.<model name>.<harness>` is the model to use:

| Harness | Value | Example |
|---|---|---|
| OpenCode | `provider/model`, without a variant | `github-copilot/claude-sonnet-5.5` |
| Codex | The model name | `gpt-6.2-sol` |

Pack keys are the same sources as in [`skillpack.json`](/user/config/#packs). Each pack keeps its own choices: picking a model for one pack never changes another.

The reasoning effort comes from the agent definition and becomes an OpenCode variant (`#high`) or Codex `model_reasoning_effort`. It isn't set here.

## Not committed

This file and the agents generated from it stay on your machine. `skillpack` adds them to `.git/info/exclude`, so git ignores them without any change to `.gitignore`. See [Installed files](/user/installed-files/#what-goes-into-git).

## How it's filled in

You don't need to write this file. When a model name has no entry, for example on a fresh clone, `skillpack add`, `install`, `sync` and `configure` match it against the models available in each harness:

1. The provider prefix and case are ignored, and `.`, `_` and spaces count as `-`. So `sonnet-5.5` matches `github-copilot/claude-sonnet-5.5` and `anthropic/claude-sonnet-5-5`.
2. If the agent lists several model names, the first one with a match wins.
3. **One match:** it's used. **Several matches:** you pick one. **No match:** you pick any available model or type one in.
4. The choice is saved here.

With `-y`, and in `install`, `sync` and non-interactive runs, there are no questions: with several matches the first by name (`provider/model`) is used. With no match, or if you skip the question, the agent is generated without a model, so it uses the model of the agent that starts it, which can cost more. Both cases print a warning. `--strict` turns a missing match, or an OpenCode model list that can't be read, into an error, and nothing is written.

A missing model never changes the agent's binding in `skillpack.json`, so the committed skills stay the same for everyone.

OpenCode's models come from `opencode models`. If that fails (OpenCode isn't installed), models can't be matched: the agents are generated without a model and a warning says so. `opencode models` doesn't list variants, so an agent's `effort` is written as the variant of the same name (`#high`) and reported as unverified.

Codex's models come from the catalog bundled with the binary (`codex debug models --bundled`). Names are matched against it like OpenCode's. If `codex` isn't installed or the catalog can't be read, the first requested name is accepted as given and reported as unverified; `--strict` doesn't fail on that.

`install --frozen-lockfile` never matches models and never writes this file.

## Changing a model

Run `skillpack configure --models` (asks for each model name), `skillpack configure --model sonnet-5.5=opencode:github-copilot/claude-sonnet-5.5`, or edit the file and run `skillpack sync`. `skillpack configure --show` lists every model the pack asks for with its status: `mapped`, `available` (not mapped yet, but one would match), `unavailable` (mapped, but no longer listed), `unverified` or `not mapped`. Only generated agents change; skills never depend on models.
