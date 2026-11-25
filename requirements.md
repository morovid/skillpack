# Skill pack installer: requirements and first iteration plan

The CLI is **`skillpack`**, published to npm as `@morovid/skillpack` (run as `npx @morovid/skillpack …`).

## 1. Goal

A CLI, run with `npx`, that installs **skill packs** from a git repository into a project, for **OpenCode** and **Codex**. A skill pack is a versioned repository of skills plus harness-neutral **agent definitions**. Unlike `npx skills` (vercel-labs/skills), it:

1. installs a specific **version** of a pack, taken from the repository's git tags;
2. generates **agent configs** for each harness from neutral definitions;
3. **scopes** skill and agent names to their pack, so two packs can each ship `implement`;
4. asks the user how each of the pack's **agents** is filled in each harness (generated, a built-in agent of the harness, or none), saves the choices in a config file, and regenerates skills and agents when the choices change;
5. matches the **models** that agents ask for (e.g. `sonnet-5.5`) to the models available in each harness, and warns when there's no match.

The same pack repository must keep working with `npx skills`. The pack ships a generated **plain build**: skills under their plain, unprefixed names (as `npx skills` installs them today), placeholders replaced with fallback text, no agents (section 3.8).

It should feel like `npx skills` and `pnpm`: the same source formats, `-a`, `-s` and `-y` flags, a committed lock file, and an `install` that restores the project from it. v1 installs into the current project only; there are no global installs (section 6).

## 2. Terms

| Term | Meaning |
|---|---|
| Pack | A remote git repository with a manifest at its root. Packs in subfolders and local paths aren't supported. |
| Manifest | `skillpack.pack.json` at the pack root: the pack's name, description, minimum CLI version and supported harnesses |
| Scope | The pack's `name` from the manifest, e.g. `morovid`: a short namespace for its skills and agents, used as a name prefix. The user can change it at install time with `--as`. |
| Version | A git tag of the pack repository (`v1.2.0` or `1.2.0`), or a branch or commit when the pack has no tags. The manifest has no version field. |
| Skill source | A skill in the pack's source folder, written with placeholders (`src/skills/<name>/SKILL.md`) |
| Plain build | Skills generated from the source for `npx skills`: plain (unprefixed) names, placeholders replaced with fallback text, no agents |
| Fallback text | A short phrase that each agent definition provides. It replaces `{{agent:<name>}}` wherever there's no concrete agent to name: in the plain build, and when the user binds the agent to **none**. It describes the kind of helper to use, so the skill still reads correctly. See R-PH-4. |
| Rendered skill | A skill as `skillpack` installs it: prefixed name, placeholders replaced with the user's chosen agents |
| Agent definition | A harness-neutral agent folder in the pack (`src/agents/<name>/`): requested model and effort, capabilities, fallback text, instructions |
| Agent name | The pack-local name of an agent definition (its folder name, e.g. `scout`), used in placeholders and in the selection config. User-facing text always says "agent"; each harness generator translates it to that harness's own concept. Installed names always use `-` (R-SCP-2). |
| Binding | The user's choice for one agent in one harness: **generate** the pack's agent, use a **built-in** agent of the harness, or **none** |
| Selection config | `skillpack.json` at the project root, committed: the packs, their requested versions, skills, harnesses and bindings. It's the team's intent and is edited by `configure` or by hand. |
| Models file | `skillpack.models.json` at the project root, not committed: the model mappings for this machine |
| Lock file | `skillpack-lock.json` at the project root, committed: the resolved commits and the hashes of the rendered skills |
| Harness | Target tool: `opencode` or `codex` |
| Model name | A harness-neutral model name an agent asks for, e.g. `sonnet-5.5` or `gpt-6.2-sol`, without provider or variant |
| Effort | A harness-neutral reasoning level an agent asks for (`low`, `medium`, `high`, …), mapped by the CLI to each harness's setting |
| Model mapping | The concrete model chosen for a model name, per pack and harness, e.g. `sonnet-5.5` → `github-copilot/claude-sonnet-5.5` in OpenCode. Stored in the models file. |
| Generated agent | An agent file written by `skillpack` for an agent bound to **generate**. Local to each machine: not committed, not in the lock. |

## 3. Requirements

Priority: **M** = must have in v1, **S** = should have in v1, **L** = later.

### 3.1 Sources and CLI

| ID | Pri | Requirement |
|---|---|---|
| R-SRC-1 | M | Accept `owner/repo` (GitHub) and full git URLs (HTTPS or SSH). The pack is always the repository root: `tree/<ref>/<path>` URLs and packs in subfolders aren't supported. Local paths and `file://` URLs aren't supported either, because every teammate must be able to fetch the pack; pack authors preview their pack with `render`. |
| R-SRC-2 | M | Use the user's existing git credentials (git credential helper, SSH). Never read or store tokens itself. `GITHUB_TOKEN` / `GH_TOKEN` are only used when already set. |
| R-SRC-3 | M | A repo without a manifest installs as an **unversioned** pack. Use `npx skills` discovery to find its skills. There are no placeholders or agents. Warn that it has no manifest. The scope comes from the repo owner, normalized: lowercased, every run of characters other than `a-z`, `0-9`, `-` and `_` replaced by `-`, and leading and trailing separators removed. If the result still isn't a valid scope (R-SCP-2), for example because it's longer than 24 characters, `--as` is required. |
| R-SRC-4 | M | **Source key.** Each pack is identified by its normalized source: `owner/repo` becomes `https://github.com/owner/repo`, a trailing `.git` and trailing `/` are removed, and the host is lowercased. SSH sources keep an SSH key, `ssh://<user>@<host>/<owner>/<repo>` (host lowercased, no `.git`), so the same repository over HTTPS and over SSH are different keys. `http://` URLs and HTTPS URLs with embedded credentials are rejected. The key is used in the selection config, the models file and the lock file. |
| R-SRC-5 | M | **No cache.** Every command that needs a pack's source fetches it into a temporary folder and deletes it afterwards. A locked commit is fetched with `git fetch --depth 1 origin <sha>`, falling back to a full clone when the server doesn't allow fetching by SHA. So every command that renders needs network access: `add`, `install`, `sync`, `configure`, `update`, `upgrade` and `doctor`. |
| R-CLI-1 | M | Commands: `add`, `remove`, `list`, `install` (make the project match `skillpack.json` and the lock file, R-VER-6), `check`, `update` (newest version within the requested range), `upgrade` (newest version overall, R-VER-7a), `configure` (change bindings), `sync` (regenerate from the selection config), `doctor` (requirements check). Pack authors also get `validate`, `build` (plain build) and `render` (preview without installing). |
| R-CLI-2 | M | Flags: `-a/--harness <opencode\|codex\|*>`, `-s/--skill <names\|*>`, `--agent <names\|*\|none>` (which of the pack's agents to use, R-CFG-12), `--as <scope>`, `-y/--yes`, `--dry-run`, `--force`, `--frozen-lockfile`, `--strict`; `configure` also takes `--models` and `--model <name>=<harness>:<concrete>` (R-CFG-4). There's no `--agents`, and `--agent` is never an alias for `--harness`. |
| R-CLI-3 | M | Interactive by default: pick skills, agents, harnesses and bindings. With `-y` it never prompts, uses the default bindings (R-CFG-3), and can run in CI. |
| R-CLI-4 | S | Detect installed harnesses: `opencode`/`codex` on `PATH`, plus the folders `.opencode/` and `.codex/` in the project and the harnesses' user config folders. Only offer the ones detected unless `-a` is given. |
| R-CLI-5 | M | Runs on Node ≥ 22 on macOS, Linux and Windows, with few dependencies. |
| R-CLI-6 | M | **Fixed defaults.** File names, paths, folder layout and default behavior are defined by the CLI. No config key or environment variable changes them. The one exception follows pnpm: when the `CI` environment variable is set, `install` defaults to `--frozen-lockfile` (R-VER-6). |
| R-CLI-7 | M | Commands that take a pack (`remove`, `update`, `upgrade`, `configure`, `sync`, `list`) accept either its scope (e.g. `morovid`) or its source (`morovid/skills` or the full URL). |

### 3.2 Manifest and versioning

| ID | Pri | Requirement |
|---|---|---|
| R-VER-1 | M | The pack root holds `skillpack.pack.json` (format in 4.2). Required: `name` (the scope). Optional: `$schema`, `description`, `cli` (a semver range of supported `skillpack` versions) and `harnesses` (the harnesses the pack supports). Folders are fixed by the CLI and not configurable: `src/skills/`, `src/agents/`, `skills/`, `dist/agents/`. |
| R-VER-1a | M | Every `skillpack` file format is versioned by its schema URL: `https://skillpack.morovid.com/schemas/v<N>/<file>.json`, for `pack.json`, `agent.json`, `config.json`, `models.json` and `lock.json`. The CLI reads the format version from the `$schema` URL; a file without `$schema` is read as `v1`. A major format change gets a new `v<N>` folder. |
| R-VER-1b | M | If `cli` doesn't include the running `skillpack` version, fail and say which version is needed. If `harnesses` is set, only offer those harnesses, and fail if `-a` names another. |
| R-VER-2 | M | `add <source>@<version>` installs an exact version. `<version>` may be a semver version (`1.2.0`), a range (`^1.2`), a tag, a branch or a commit SHA. It's written to the selection config as given. |
| R-VER-3 | M | Versions resolve to git tags named `v<version>`, falling back to `<version>`, found with `git ls-remote --tags`. Ranges pick the highest matching tag; pre-release tags are only picked when the range names a pre-release, as in npm. With no version, `add` picks the highest semver tag and writes `^<version>` to the selection config, as `npm install` does. If the pack has no semver tags, it writes the default branch name, and the pack follows that branch. |
| R-VER-4 | — | Dropped. The manifest has no `version` field; git tags are the only source of versions, so there's nothing to compare. |
| R-VER-5 | M | Write a lock file, `skillpack-lock.json`, at the project root (format in 4.9). It records the `cli` version that wrote it and, per pack (keyed by source, R-SRC-4): the `ref` the commit was resolved from (a full git ref, `refs/tags/<tag>` or `refs/heads/<branch>`, or `null` for a commit pin), the commit SHA, and a content hash for every rendered skill folder. All three are required. Nothing else: the requested version, harnesses, scope and bindings are in the selection config, and generated agents are local (R-AGT-11). |
| R-VER-6 | M | **`install` works like `pnpm install`:** it makes the project match `skillpack.json` and the lock file.<br>• A pack whose locked `ref` still satisfies its `version` is installed at the locked commit: a semver range needs a locked tag inside it, a commit needs a locked commit that starts with it, and any other name needs the locked tag or branch of that name. So a pack locked from a branch only satisfies that branch.<br>• A pack missing from the lock file, or whose `version` changed so the locked `ref` no longer satisfies it (including a switch to another branch), is resolved again, and the lock file is updated.<br>• A pack in the lock file but no longer in `skillpack.json` is removed.<br>• Skill folders listed in the lock file are rewritten when they're missing or differ from what the locked commit renders, and the changed folders are listed. Rendered skills are committed, so edits can be recovered from git. Folders not in the lock file are never touched (R-SKL-4).<br>• Agents are generated for the harnesses detected on this machine (R-CLI-4); other harnesses are skipped with a note.<br>`--frozen-lockfile` checks only the lock file and the skills: it fails, without writing anything, if the lock file would change or any skill folder differs from what the locked commit renders. It never generates agents, matches models or writes the models file. It's the default when `CI` is set (R-CLI-6). |
| R-VER-7 | M | `check` reports newer versions within each pack's requested range (for `update`) and newer versions outside it, such as a new major (for `upgrade`). `update` moves to the highest version within the range, without changing `skillpack.json`. Both `update` and `upgrade` re-render with the saved bindings, prompt only for agents that are new or were removed, and write bindings for new agents. If the pack's `name` changed between versions, skill folders and agent files move to the new prefix: old skill folders are found in the lock file and old agents by their headers, and both are protected as in R-SKL-4 and R-AGT-7. |
| R-VER-7a | M | `upgrade [pack]` moves to the highest semver tag, including new majors, and rewrites `version` in `skillpack.json`, keeping its form: `^1.2.0` becomes `^2.0.0`, `~1.2.0` becomes `~2.0.0`, an exact version stays exact, and any other range becomes `^<version>`. A pack that follows a branch, or is pinned to a commit or a non-semver tag, is left alone with a note. |
| R-VER-8 | — | Dropped. The manifest lives only in `skillpack.pack.json`, never in `package.json`: a `"skillpack"` key there would be ambiguous with the user's `skillpack.json`, and one location keeps lookup and `$schema` support simple. |
| R-VER-9 | L | Support npm packages as sources (`npm:@scope/pack@1.2.0`). |

### 3.3 Skill installation

| ID | Pri | Requirement |
|---|---|---|
| R-SKL-1 | M | Read skill sources from `src/skills/`. Each subfolder with a `SKILL.md` is one skill. |
| R-SKL-2 | M | Install rendered skills **flat** under `.agents/skills/<scope>-<name>/` in the project (names written as in R-SCP-2), the folder `npx skills` uses and both OpenCode and Codex read. Copy files; don't symlink. Rendered skills are committed. |
| R-SKL-3 | M | Install the whole skill folder, including `references/`, `assets/` and scripts. Placeholders are replaced in every text file (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`); binary files are copied unchanged. |
| R-SKL-4 | M | **Ownership through the lock file.** A skill folder belongs to `skillpack` only if the lock file lists it. Never overwrite or delete a folder that isn't listed unless `--force` is passed. Folders that are listed but whose content hash differs from the lock file (local edits) are kept by `add`, `sync`, `configure`, `update`, `upgrade` and `remove` unless `--force` is passed; `install` restores them (R-VER-6). No marker file is written into skill folders. |
| R-SKL-5 | S | Show the skill name, description and source before installing. Warn about any executable scripts the skill contains. |

### 3.4 Scoping and naming

| ID | Pri | Requirement |
|---|---|---|
| R-SCP-1 | M | Every installed skill and agent gets a name prefixed with its pack's scope, so two packs can both ship `implement`. Skills use a **flat** layout, so prefixed names work in every IDE or harness that only reads one folder level. |
| R-SCP-2 | M | **Names.** Scopes, skill names and agent names use lowercase letters and digits, separated by single `-` or `_`: `^[a-z0-9]+([-_][a-z0-9]+)*$`. A scope has at most 24 characters, and `<scope>-<name>` at most 64; skill and agent names have no separate length limit. Every output writes names with `-` only (kebab case), which the Agent Skills spec, OpenCode and Codex all accept: skill `plan_code` in pack `my_pack` installs as `my-pack-plan-code`, its agent `code_scout` as `my-pack-code-scout`, and the plain build writes the skill as `plan-code`. The folder name equals the frontmatter `name`; the renderer writes both. `validate` fails if two skills, or two agents, end up with the same name. |
| R-SCP-3 | M | **Same agent ID in every harness.** A generated agent's ID is `<scope>-<agent name>` in kebab case (R-SCP-2), the same in OpenCode and Codex, so one rendered skill folder (shared in `.agents/skills/`) names it correctly for both. OpenCode: `.opencode/agents/morovid-scout.md`. Codex: `.codex/agents/morovid-scout.toml` with `name = "morovid-scout"`. |
| R-SCP-4 | M | Fail before writing anything if two packs resolve to the same scope or scoped name. `--as <scope>` lets the user choose a different scope; it's saved as `scope` in the selection config. |
| R-SCP-5 | M | In rendered installs, rewrite relative links between a pack's skills to the installed folder names (`../review/SKILL.md` → `../morovid-review/SKILL.md`). The plain build keeps the source links, except links to a skill whose folder name changes because of R-SCP-2 (`../plan_code/` → `../plan-code/`). |
| R-SCP-6 | M | Skill and agent sources refer to agents and other skills only through placeholders (section 3.7). Plain mentions of names are never rewritten. |

### 3.5 Agent definitions and generation

| ID | Pri | Requirement |
|---|---|---|
| R-AGT-1 | M | Packs define each agent in its own folder, `src/agents/<name>/`, with two files: `manifest.json` (configuration, validated by `schemas/v1/agent.json`) and `instructions.md` (plain Markdown instructions, no frontmatter). The folder name is the agent name, following the naming rules in R-SCP-2. One folder serves every harness. |
| R-AGT-2 | M | `manifest.json` covers: `description` (required); `fallback` (required; text used when the agent is bound to none, see R-PH-4); `model` (a model name, or a list in order of preference, plus reasoning `effort`, see section 3.9; omitted means the agent uses the parent's model); `mode` (`subagent`, the default, `primary` or `all`); `spawn` (agents this agent may start; empty for leaf agents); and `capabilities` (`read`, `search`, `edit` and `shell` with allow/deny patterns, `web`, `skills`, `questions`, `mcp`). There are no per-harness overrides: the definition is fully harness-neutral. Harness differences in models are handled by listing several model names; harnesses a pack doesn't support are set pack-wide (R-VER-1). |
| R-AGT-2a | M | **Deny by default.** An agent may only do what `capabilities` lists. Defaults: `read`, `search` and `skills` on; `edit`, `shell`, `web`, `questions` and `mcp` off. Where a harness can't deny something (R-AGT-5), the restriction goes into the instructions and is reported as unenforced. |
| R-AGT-3 | M | **OpenCode generator:** for each agent bound to generate, write a Markdown agent with V2 frontmatter (`description`, `mode`, `model: provider/model#variant`, `permissions`) and the rendered `instructions.md` as the body. `permissions` is built from the capabilities: first deny everything, then allow what's listed, then apply the denials. `subagent` rules use the **bound** IDs of the agents in `spawn`. An agent bound to a built-in agent uses that agent's ID; an agent bound to none is left out. `mcp` allows the actions `<server>_*` for each listed server; `true` allows every MCP server in the OpenCode config at sync time, and `doctor` reports servers added later. |
| R-AGT-4 | M | **Codex generator:** write TOML with `name` (the agent ID, R-SCP-3), `description`, `model`, `model_reasoning_effort` and `developer_instructions` (the rendered `instructions.md`). Set `features.shell_tool = false` when the agent has no shell. Set `skills.include_instructions = false` when `capabilities.skills` is false. Codex has no primary agents: an agent with `mode: primary` is generated as an ordinary custom agent, with a warning that in Codex it can only be started as a subagent. |
| R-AGT-5 | M | **Enforcement report.** For every restriction the harness can't enforce, the generator adds it to the instructions as text and records an "unenforced" warning. Codex examples: limits on edit paths, shell patterns, web and MCP access, spawn allow-lists and read-only mode. `render`, `add`, `install`, `sync` and `doctor` print these warnings as one summary line per agent and harness (for example "4 restrictions not enforced"); the full list is shown with `--verbose` and always in `--json` output. The restrictions stay written in the agent's instructions. |
| R-AGT-6 | — | Dropped. Packs don't override built-in agents and don't suggest existing agents; the user can still bind an agent to a built-in agent (R-CFG-1). Step limits are also dropped: a skill that needs one says so in its instructions. |
| R-AGT-7 | M | Generated files start with a header (format in 4.7 and 4.8): the pack source, version (tag or commit) and source path, the binding line (`binding: generate; model: <model or none>; effort: <effort or default>`; the model is the concrete model, else the first requested name, and OpenCode models keep their provider prefix without the `#variant`), a content hash of the rest of the file, and "generated by skillpack, do not edit; change with `skillpack configure`". The header marks the file as owned by `skillpack`. `skillpack` only overwrites or deletes an agent file whose header names the pack and whose hash still matches; anything else needs `--force`. |
| R-AGT-8 | M | `validate` checks every `manifest.json` against the schema and that every agent folder has a non-empty `instructions.md`. It also checks that every `spawn` target exists, that no agent lists itself, and that no spawn cycles exist. The nesting depth implied by `spawn` isn't checked. |
| R-AGT-9 | S | Harness settings that agents need (e.g. Codex `[agents] max_concurrent_threads_per_session`, OpenCode `default_agent`) are defined by the CLI, not by packs. They're printed as snippets for the user to add. `skillpack` never edits harness config files. |
| R-AGT-10 | L | More harness generators (Claude Code, Cursor, etc.) behind the same interface. Skills already work there through `.agents/skills`; the generator adds agents and bindings. |
| R-AGT-11 | M | **Generated agents are local.** They contain concrete models from the models file, which differs per machine, so they aren't committed and aren't recorded in the lock file. Each engineer generates them with `install` (or `sync`), for the harnesses detected on their machine. They're kept out of git as in R-SAF-7. |

### 3.6 Bindings and the selection config

| ID | Pri | Requirement |
|---|---|---|
| R-CFG-1 | M | For each of the pack's agents and each target harness, `add` asks the user how the agent is filled:<br>1. **Generate** the pack's agent. Its model comes from the models file (R-REQ-2).<br>2. **Use a built-in agent** of the harness instead. Only built-in subagents are allowed, never custom agents, because teammates may not have them: OpenCode `general` and `explore`; Codex `default`, `worker` and `explorer`. The list is defined by the CLI.<br>3. **None**: no agent, and skills fall back to the agent's `fallback` text. |
| R-CFG-2 | M | Save the answers in the selection config, `skillpack.json` at the project root (format in 4.5), which is committed and shared by the team. Per pack, keyed by source (R-SRC-4): `version` (the requested version), `harnesses`, `skills`, an optional `scope` (only with `--as`), and `agents`: a binding per agent and harness, written as `"generate"`, `"existing:<id>"` (a built-in agent, R-CFG-1) or `"none"`. It holds nothing machine-specific: no models and no effort. There's one layer only, the project. `add`, `update`, `upgrade` and `configure` write every binding explicitly, so later changes to the pack or the CLI don't silently change them. |
| R-CFG-3 | M | **Default binding.** An agent or harness missing from the selection config is bound to **generate**. `-y` and accepting the defaults also choose generate. The default never depends on the machine, so rendered skills are the same everywhere (R-PH-5). Model problems never change a binding (R-REQ-4). |
| R-CFG-4 | M | `configure [pack] [agent…] [--harness]` re-asks for the chosen agents (or all), saves the selection config and models file, then runs `sync`. `--models` asks, for each model name the pack's generated agents request, which model to use in each harness (keep the current one, pick an available one, or type one); `--model <name>=<harness>:<concrete>` (repeatable, e.g. `--model sonnet-5.5=opencode:github-copilot/claude-sonnet-5.5`) sets a mapping without questions. Only the affected agents change. |
| R-CFG-5 | M | `sync` regenerates every rendered skill and generated agent from the pack source at the locked commit (fetched again, R-SRC-5), using the current selection config and models file, **without changing versions**. It runs after either file is edited by hand or by `configure`, and after a `git pull` that changed `skillpack.json`. It adds, updates and removes generated agent files to match the bindings. Files edited by hand are protected (R-SKL-4, R-AGT-7). |
| R-CFG-6 | — | Dropped. There's no pack cache; sources are fetched fresh (R-SRC-5). |
| R-CFG-7 | M | Skills are shared by all harnesses in `.agents/skills/`. If an agent has **different IDs** in different harnesses (e.g. built-in `explore` in OpenCode and `explorer` in Codex, or generated `morovid-scout` in one and built-in `explorer` in the other), render a harness-qualified phrase, e.g. "`explore` (Codex: `explorer`)": the first harness's ID, then the others in parentheses, in the fixed order OpenCode, Codex, limited to the installed harnesses. A harness bound to none shows the fallback text in its place. The phrase format is fixed by the CLI. If the IDs agree, render the plain ID. Agent IDs are wrapped in backticks; fallback text is not. |
| R-CFG-8 | S | `configure --show` prints the current bindings and warnings as a table, and a models table: model name, harness, mapped model, and status: `mapped`, `available` (not mapped yet, but one would match), `unavailable` (mapped, but no longer listed), `unverified` (mapped, but the list can't be read) or `not mapped`. |
| R-CFG-9 | S | Unknown keys and agents that no longer exist in the pack are reported by `doctor`, and kept until the user removes them. |
| R-CFG-10 | — | Dropped. There's no global config, so there are no layers to merge. |
| R-CFG-11 | — | Dropped. There are no global installs to override. |
| R-CFG-12 | M | `--agent <names>` binds every agent not listed to **none** in every selected harness; `--agent none` binds all of them to none, and `--agent '*'` (the default) leaves them to the prompts or defaults. It writes ordinary bindings, so there's no separate setting for it. |

### 3.7 Placeholders

| ID | Pri | Requirement |
|---|---|---|
| R-PH-1 | M | Syntax: `{{agent:<name>}}` (the bound agent ID), `{{skill:<name>}}` (the installed skill name: prefixed in rendered installs, plain in the plain build) and `{{scope}}`. Use `\{{` for a literal `{{`. |
| R-PH-2 | M | Placeholders may appear in skill files (R-SKL-3), in agent `instructions.md`, and in the `description` in agent `manifest.json`. |
| R-PH-3 | M | `validate` and `build` fail on unknown placeholders, an unclosed `{{` (not escaped with `\{{` and without a `}}` on the same line), unknown agents or skills, and placeholders inside the skill frontmatter `name` or an agent's `fallback`. |
| R-PH-4 | M | Where there's no agent to name (an agent bound to none, or the plain build), `{{agent:<name>}}` becomes the agent's `fallback` text. Fallback text is one neutral phrase per agent. It's written so the sentence around the placeholder still reads correctly, and it tells the model what to use instead. Example for `scout`: "a read-only exploration subagent (or do the search yourself, with a narrow scope)". The plain build doesn't know which harness will read it, so fallback text never names harness-specific agents. |
| R-PH-5 | M | Rendering is deterministic: the same inputs always produce byte-identical output, so hashes can be compared. Rendered skills depend only on the pack commit and the selection config, never on the models file or on which harnesses are detected, so they're identical on every machine. |
| R-PH-6 | M | Generated agent files belong to one harness, so placeholders in agent instructions and descriptions resolve for that harness only (e.g. `explorer` in Codex files when `scout` is bound to Codex's built-in `explorer`), never to a harness-qualified phrase. |

### 3.8 Pack layout and `npx skills` compatibility

| ID | Pri | Requirement |
|---|---|---|
| R-PKG-1 | M | Layout: sources with placeholders in `src/skills/` and `src/agents/`. A generated **plain build** goes in `skills/<name>/` (plain, unprefixed names, as today), which `npx skills` discovers by default. Both folders are committed. |
| R-PKG-2 | M | Source `SKILL.md` frontmatter carries `metadata.internal: "true"` (a string, as the Agent Skills spec types metadata values), so `npx skills` hides the placeholder versions when it searches beyond `skills/`: with `--full-depth`, when `skills/` is empty, and always in `npx skills update` (which otherwise finds two folders per skill name and skips updating them). When a user asks for one skill by name, `npx skills` includes internal skills, but finds the plain build in `skills/` first and skips the source with the same name. `build` and the renderer remove that key from their output. |
| R-PKG-3 | M | `skillpack build` writes the plain build: source names unchanged except `_` written as `-` (R-SCP-2), links as in R-SCP-5, placeholders replaced as in R-PH-4, no agents. After the frontmatter it adds a comment: "generated from `src/skills/<name>` by skillpack build; edit the source". |
| R-PKG-4 | M | `skillpack build --check` exits non-zero if `skills/` is out of date, for use in CI and pre-release checks. |
| R-PKG-5 | M | `skillpack` installs from `src/`, never from the plain build. |
| R-PKG-6 | S | `build` also writes ready-to-copy agents to `dist/agents/opencode/` and `dist/agents/codex/`, for users who install skills with `npx skills` and want to add agents by hand. In these agents, `{{agent:<name>}}` becomes the generated agent ID for that harness and `{{skill:<name>}}` the plain skill name, as `npx skills` installs it. OpenCode model IDs depend on the provider, so OpenCode agents leave out `model` and carry a comment naming the requested model and effort. Codex agents use the first model name and the mapped effort. A short `dist/agents/README.md` explains this. |
| R-PKG-7 | S | `skillpack init` creates a pack skeleton: manifest, `src/skills/example/`, `src/agents/example/` (`manifest.json` and `instructions.md`), and a CI snippet for `build --check`. |

### 3.9 Models

| ID | Pri | Requirement |
|---|---|---|
| R-REQ-1 | M | **Available models.** OpenCode: run `opencode models` (one `provider/model` per line; it doesn't list variants). Codex: run `codex debug models --bundled`, the catalog bundled with the binary, which includes each model's supported reasoning levels and needs no network or login. If that command can't run, Codex names are accepted as given and reported as "unverified". The same lists are offered in `configure`. If OpenCode's list can't be read, models can't be matched (R-REQ-4). |
| R-REQ-2 | M | **Model mapping.** Agents ask for a model by a harness-neutral name, e.g. `sonnet-5.5` (R-AGT-2). For each pack, model name and harness, the models file `skillpack.models.json` (format in 4.6) stores the concrete model chosen on this machine, e.g. `sonnet-5.5` → `github-copilot/claude-sonnet-5.5` in OpenCode. Every agent of that pack that asks for `sonnet-5.5` uses it; other packs keep their own mappings. The file isn't committed (R-SAF-7). When it's missing, as on a fresh clone, matching (R-REQ-3) fills it in. Changing a mapping (by hand or with `configure`) and running `sync` regenerates the affected agents; skills never change. |
| R-REQ-3 | M | **Matching.** When a model name has no mapping yet, match it against the available models: compare lowercase names with `.`, `_` and spaces treated as `-`, ignoring the provider prefix and variant, and accept a model whose name contains the requested name as whole `-`-separated parts (`sonnet-5.5` matches `claude-sonnet-5-5`, not `sonnet-5-50`). One match: use it. If some models equal the requested name exactly, only those count (`gpt-6-luna` isn't ambiguous with `gpt-6-luna-mini`). Several matches (e.g. the same model from two providers): ask the user; with `-y` or without a terminal, pick the first in sorted order and warn. Save the result in the models file. If the agent lists several model names, try them in order. |
| R-REQ-4 | M | **No match.** If none of an agent's model names match, ask the user to pick any available model or type one in, and save it in the models file. With `-y`, or if the user skips, generate the agent without a model, so it uses the parent's model, and warn that this can cost more; the agent's header says `model: none`, and its effort is left out too. The binding stays `generate`, so skills don't change. A name that Codex's catalog doesn't list is a normal no-match when the catalog can be read; only when it can't be read are Codex names accepted as "unverified", which only warns. `--strict` fails on a no-match, and when OpenCode's model list can't be read; it doesn't fail on unverified Codex models. |
| R-REQ-5 | M | **Effort.** Agents ask for a harness-neutral `effort`: `low`, `medium`, `high`, `xhigh` or `max`; left out, the model's default is used. The CLI maps it to each harness: Codex `model_reasoning_effort`; OpenCode the model's variant with the same name. OpenCode's variants can't be discovered (`opencode models` doesn't list them), so the effort is written as the variant of the same name (`provider/model#high`) and reported as unverified with a warning; if variants are ever known and the name isn't one, the nearest is used, with a warning. There's no per-agent model or effort override in v1. |
| R-REQ-6 | — | Dropped together with model tiers. |
| R-REQ-7 | M | `doctor` re-runs the checks for everything installed, fetching packs as needed (R-SRC-5). It reports:<br>• skill folders that differ from the lock file (edited by hand), or from what the locked commit renders with the current `skillpack.json` (out of sync: run `sync`);<br>• folders in `.agents/skills/` with an installed pack's prefix that aren't in the lock file;<br>• generated agents that are missing, edited (hash mismatch), or rendered for other bindings than `skillpack.json` (e.g. after a `git pull`: run `sync`);<br>• agent files with a `skillpack` header whose pack or agent is no longer configured;<br>• mapped models that are no longer available, and agents generated without a model (R-REQ-4);<br>• bindings to agents that aren't built-in (R-CFG-1), and agents or keys the pack doesn't know (R-CFG-9);<br>• local files that git tracks (R-SAF-7);<br>• restrictions the harness can't enforce (R-AGT-5), and MCP servers added since the last `sync` (R-AGT-3);<br>• the same pack installed by `npx skills` (R-SAF-6). |
| R-REQ-8 | — | Dropped. The manifest lists supported harnesses (R-VER-1) but not their versions. |

### 3.10 Safety and removal

| ID | Pri | Requirement |
|---|---|---|
| R-SAF-1 | M | `--dry-run` lists every file it would create, change or delete, and every change to `skillpack.json`, `skillpack.models.json`, `skillpack-lock.json` and `.git/info/exclude`. It works for `add`, `install`, `update`, `upgrade`, `configure`, `sync` and `remove`. |
| R-SAF-2 | M | Write to temporary files, then rename them into place. If any step fails, leave the project unchanged. |
| R-SAF-3 | M | `remove <pack\|skill\|agent>` deletes only skill folders listed in the lock file whose hashes still match, and generated agent files whose header names the pack and whose hash still matches. It removes the pack (or the skill or binding) from the selection config, models file, lock file and `.git/info/exclude`; if that leaves the models file without any pack, the file is deleted together with its exclude entry. Removing one skill from a pack whose `skills` is `"*"` rewrites it as the list of the remaining skills. Files edited since install are listed and kept unless `--force` is passed. |
| R-SAF-4 | M | Never run scripts from a pack during install, sync or build. |
| R-SAF-5 | S | Don't edit `.gitignore` or harness config files. Print which files to commit: `skillpack.json`, `skillpack-lock.json` and `.agents/skills/<scope>-*`. |
| R-SAF-6 | M | Leave alone skills installed by `npx skills` (folders not in `skillpack-lock.json`). The plain build isn't prefixed, so the same pack installed both ways would load twice (`implement` and `morovid-implement`). Detect this from `skills-lock.json` (same source) or identical descriptions, warn, and suggest `npx skills remove <names>`. Never remove them automatically. |
| R-SAF-7 | M | **Keep local files out of git through `.git/info/exclude`.** Every command that writes local files (`add`, `install`, `sync`, `configure`, `update`, `upgrade`, `remove`) keeps a block in the repository's exclude file (found with `git rev-parse --git-path info/exclude`; it's shared by all worktrees, so paths are added when a file is generated and removed only by `remove`) between the lines `# >>> skillpack` and `# <<< skillpack`. The block lists exact paths, not patterns: `skillpack.models.json` and each generated agent file. The user's own agents in the same folders aren't affected, and no committed file changes. Outside a git repository, print the paths instead. `doctor` warns when git already tracks one of these paths (excludes don't apply to tracked files) and suggests `git rm --cached <path>`. |

## 4. File formats (draft)

### 4.1 Pack layout

```text
skillpack.pack.json
src/
  skills/
    implement/SKILL.md          # placeholders, metadata.internal: "true"
    review/SKILL.md
    review/references/…
  agents/
    scout/
      manifest.json             # configuration (schemas/v1/agent.json)
      instructions.md           # instructions, placeholders allowed
    author/
      manifest.json
      instructions.md
skills/                         # generated by `skillpack build`, for npx skills (plain names)
  implement/SKILL.md
  review/…
dist/agents/                    # optional (R-PKG-6)
  opencode/morovid-scout.md
  codex/morovid-scout.toml
```

### 4.2 `skillpack.pack.json`

```jsonc
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/pack.json",
  "name": "morovid",
  "description": "Engineering workflow: spec, plan-code, plan-tests, implement, review",
  "cli": ">=0.1.0",
  "harnesses": ["opencode", "codex"]
}
```

Only `name` is required. The version comes from git tags; folders, harness settings and phrase formats are fixed by the CLI; models are requested by the agent definitions (4.4).

### 4.3 Skill source with placeholders: `src/skills/plan-code/SKILL.md` (excerpt)

```md
---
name: plan-code
description: Design production changes and sequence their tasks …
metadata:
  internal: "true"
---
1. **Delegate planning.** Hand the work to {{agent:author}} with the planning guide …
2. **Use helpers for bounded work.** The planner delegates searches to {{agent:scout}} …
4. **Review independently.** For size S use {{agent:verifier}}; for M and L use {{agent:auditor}} …
After a PASS, hand off to {{skill:plan-tests}}.
```

The same lines rendered in different ways:

| Output | Rendered line |
|---|---|
| `skillpack`, `author` bound to generate | Hand the work to `morovid-author` with the planning guide … |
| `skillpack`, `scout` bound to built-in agents | delegates searches to `explore` (Codex: `explorer`) … |
| Plain build (`npx skills`) | Hand the work to a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff) … |

### 4.4 Agent definition: `src/agents/author/`

`manifest.json`:

```json
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/agent.json",
  "description": "Drafts or revises spec, plan and test-plan artifacts from a self-contained handoff.",
  "fallback": "a document-authoring subagent (if none is configured, use the most capable available subagent with a narrow handoff)",
  "model": { "name": ["sonnet-5.5", "gpt-6.2-sol"], "effort": "high" },
  "spawn": ["scout", "scribe"],
  "capabilities": {
    "skills": false,
    "edit": { "allow": ["specs/*"] },
    "shell": { "allow": ["git diff *", "git log *", "git show *", "git status *"] }
  }
}
```

`instructions.md`:

```md
You are a document author. Use targeted edits, not full rewrites of large files.
Delegate searches to {{agent:scout}} and supplied mechanical edits to {{agent:scribe}}. Never start other agents.
```

`model.name` is a model name or a list in order of preference. Here OpenCode gets Sonnet, and Codex, which has no Sonnet, gets `gpt-6.2-sol`. `read` and `search` are on by default; everything not listed is denied.

### 4.5 Selection config: `skillpack.json` (committed)

```jsonc
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
    },
    "https://github.com/acme/skills": {
      "version": "main",
      "scope": "acme-work",
      "harnesses": ["opencode"],
      "skills": ["implement", "review"],
      "agents": {}
    }
  }
}
```

| Key | Required | Description |
|---|---|---|
| `packs.<source>` | — | One entry per pack, keyed by its normalized source (R-SRC-4) |
| `version` | Yes | The requested version: exact, range, tag, branch or commit (R-VER-2, R-VER-3). `update` stays within it; `upgrade` rewrites it. |
| `harnesses` | Yes | Harnesses the pack is installed for |
| `skills` | No | `"*"` (default) or a list of skill names (`-s`) |
| `scope` | No | Only when installed with `--as`; otherwise the manifest `name` is used |
| `agents.<agent>.<harness>` | No | `"generate"`, `"existing:<id>"` (built-in agents only) or `"none"`. Missing values mean `"generate"` (R-CFG-3). |

`add`, `update`, `upgrade` and `configure` write every agent explicitly, so later changes to the pack don't silently change bindings. Nothing here depends on the machine: models live in the models file.

### 4.6 Models file: `skillpack.models.json` (local, not committed)

```jsonc
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/models.json",
  "packs": {
    "https://github.com/morovid/skills": {
      "sonnet-5.5":  { "opencode": "github-copilot/claude-sonnet-5.5" },
      "haiku-5.5":   { "opencode": "github-copilot/claude-haiku-5.5" },
      "gpt-6.2-sol": { "opencode": "github-copilot/gpt-6.2-sol", "codex": "gpt-6.2-sol" },
      "gpt-6-luna":  { "codex": "gpt-6-luna" }
    }
  }
}
```

`packs.<source>.<model name>.<harness>` is the concrete model on this machine: `provider/model` for OpenCode, the model name for Codex. Missing entries are filled in by matching (R-REQ-3) the next time `add`, `install`, `sync` or `configure` runs.

### 4.7 Generated OpenCode output: `.opencode/agents/morovid-author.md` (local)

```md
---
# generated by skillpack from https://github.com/morovid/skills@v1.0.0 src/agents/author/ — do not edit; change with `skillpack configure`
# binding: generate; model: github-copilot/claude-sonnet-5.5; effort: high
# hash: sha256-3f2a…
description: Drafts or revises spec, plan and test-plan artifacts from a self-contained handoff.
mode: subagent
model: github-copilot/claude-sonnet-5.5#high
permissions:
  - { action: "*", resource: "*", effect: deny }
  - { action: read, resource: "*", effect: allow }
  - { action: glob, resource: "*", effect: allow }
  - { action: grep, resource: "*", effect: allow }
  - { action: edit, resource: "specs/*", effect: allow }
  - { action: shell, resource: "git diff *", effect: allow }
  # …
  - { action: subagent, resource: "explore", effect: allow }         # scout → built-in agent
  - { action: subagent, resource: "morovid-scribe", effect: allow }
---
…instructions with placeholders resolved…
```

The `hash` line covers every byte after the header lines. It lets `skillpack` detect hand edits without a lock file entry.

### 4.8 Generated Codex output: `.codex/agents/morovid-author.toml` (local)

```toml
# generated by skillpack from https://github.com/morovid/skills@v1.0.0 src/agents/author/ — do not edit; change with `skillpack configure`
# binding: generate; model: gpt-6.2-sol; effort: high
# hash: sha256-9c41…
name = "morovid-author"
description = "Drafts or revises spec, plan and test-plan artifacts from a self-contained handoff."
model = "gpt-6.2-sol"
model_reasoning_effort = "high"
developer_instructions = """
…instructions with placeholders resolved…

Restrictions (not enforced by Codex; follow them strictly):
- Edit only files matching specs/*.
- Run only these shell commands: git diff, git log, git show, git status.
- Don't use web or MCP tools.
- Start only these agents: morovid-scout, morovid-scribe.
"""

[skills]
include_instructions = false
```

### 4.9 Lock file: `skillpack-lock.json` (committed)

```jsonc
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/lock.json",
  "cli": "0.1.0",
  "packs": {
    "https://github.com/morovid/skills": {
      "ref": "refs/tags/v1.0.0",               // or "refs/heads/main"; null when pinned to a commit
      "commit": "386c5d6…",
      "skills": {
        ".agents/skills/morovid-plan-code": "sha256-…",
        ".agents/skills/morovid-review": "sha256-…"
      }
    }
  }
}
```

- `ref` is the full git ref the commit was resolved from: `refs/tags/<tag>`, `refs/heads/<branch>` (also for a pack without tags, which follows its default branch), or `null` when the pack is pinned to a commit. `ref`, `commit` and `skills` are all required. `install` compares `ref` with `version` in `skillpack.json` (R-VER-6).
- `cli` is the `skillpack` version that wrote the hashes. A newer CLI may render different bytes from the same inputs; `doctor` then says "re-render with `skillpack sync`" instead of "edited locally".
- A skill hash is SHA-256 over the folder's files sorted by relative path (`/` separators): for each file, its path, a NUL byte, the SHA-256 of its content and a newline. Text files (R-SKL-3) have CRLF replaced by LF before hashing, so git's line-ending conversion isn't seen as an edit. Written as `sha256-<hex>`.
- "Out of sync" is detected by rendering: if rendering the locked commit with the current `skillpack.json` gives different skill hashes, `doctor` reports it and `install --frozen-lockfile` fails.

### 4.10 Project files and git

| Path | In git | Written by |
|---|---|---|
| `skillpack.json` | Committed | `add`, `remove`, `configure`, `upgrade`, by hand |
| `skillpack-lock.json` | Committed | Every command that writes skills |
| `.agents/skills/<scope>-<name>/` | Committed | `add`, `install`, `sync`, `configure`, `update`, `upgrade`, `remove` |
| `skillpack.models.json` | Excluded (R-SAF-7) | `add`, `install`, `sync`, `configure`, by hand |
| `.opencode/agents/<OpenCode ID>.md` | Excluded (R-SAF-7) | `add`, `install`, `sync`, `configure`, `update`, `upgrade`, `remove` |
| `.codex/agents/<Codex ID>.toml` | Excluded (R-SAF-7) | same |

The managed block in `.git/info/exclude`:

```text
# >>> skillpack (managed; do not edit)
/skillpack.models.json
/.opencode/agents/morovid-author.md
/.codex/agents/morovid-author.toml
/.codex/agents/morovid-scout.toml
# <<< skillpack
```

After a fresh clone, the skills are already there. `npx @morovid/skillpack install` matches models, writes `skillpack.models.json`, generates the agents and adds the exclude block.

## 5. Known harness limits

The tool has to report these limits, not hide them:

| Topic | OpenCode | Codex |
|---|---|---|
| Model per agent | Enforced | Enforced |
| Edit and shell restrictions | Enforced (`permissions`) | Not enforced: agents inherit the parent session's sandbox and approvals. Only `features.shell_tool` can be switched off. |
| Spawn allow-list | Enforced (`subagent` rules) | Not enforced; instructions only. |
| Step limit | `steps` (not used by skillpack) | None |
| Primary agents | Supported (`mode: primary`) | None: custom agents are always subagents, so primary agents are generated as subagents (R-AGT-4) |
| Agent ID format | File name → ID, kebab case | `name` field, kebab case (R-SCP-3) |
| Listing available models | `opencode models` (no variants listed) | `codex debug models --bundled` (bundled catalog with reasoning levels); if it can't run, unverified |
| Built-in agents allowed in bindings (R-CFG-1) | `general`, `explore` | `default`, `worker`, `explorer` (a project custom agent with the same name overrides a built-in one) |
| Model ID portability | Depends on the provider (hence model names, matching and the local models file, R-REQ-2, R-REQ-3) | Same across clients, though some models may be missing in the IDE extension |
| Shared skill folder | `.agents/skills` (also read by Codex) | `.agents/skills` (also read by OpenCode), hence R-CFG-7 |

## 6. Out of scope for v1

- Global installs (`-g`), a global config, and project overrides of global packs.
- Packs in a subfolder of a repository (`tree/<ref>/<path>` sources), and local path sources.
- A local cache of pack sources; sources are fetched fresh (R-SRC-5).
- Editing harness config files (`--apply-config`); snippets are printed instead (R-AGT-9).
- Per-agent model or effort overrides in the user's config.
- Binding a pack's agent to a custom agent of the user or project; only built-in agents are allowed (R-CFG-1).
- A registry or search service (`find`), and telemetry.
- Agent generators for harnesses other than OpenCode and Codex. Skills still install to `.agents/skills`, which other tools also read.
- Running pack scripts or hooks after install.
- Dependencies between packs and npm sources (R-VER-9).

## 7. First iteration plan

Plan: a TypeScript CLI in a **separate repository** (`morovid/skillpack`), published to npm. This repo (`morovid/skills`) becomes the first pack and the main test fixture.

Dependencies: `yaml`, `smol-toml`, `semver`, `jsonc-parser`, `@clack/prompts` and `tinyglobby`, plus `git` installed on the system. Bundled with `tsup`, tested with `vitest`.

The core is a pure function, `render(packSource, bindings, models, harnesses) → files[]`, shared by `add`, `sync`, `build` and `render`. Commands only resolve inputs, call `render`, and hand the result to the transactional writer.

### Milestone 0: Schemas and checks (about 1 day)

1. Write JSON Schemas (under `schemas/v1/`) for `skillpack.pack.json`, agent `manifest.json`, the selection config, the models file and the lock file. `validate`, `configure` and the docs all use them.
2. Hands-on checks in both harnesses:
   - Does `npx skills` hide `metadata.internal` skills when run with `--full-depth` (R-PKG-2)?
   - Does a deny-everything rule (`"*"`) block tools a subagent needs?
   - Confirm the built-in subagents of each harness (R-CFG-1).
   - Do OpenCode and Codex accept comment lines at the top of agent files (the header, R-AGT-7)?
   - Does `git fetch --depth 1 origin <sha>` work on GitHub and the other hosts we care about (R-SRC-5)?

### Milestone 1: Pack format, rendering and `build` (about 3 days)

1. Manifest and source loader; agent definition parser; `validate`, including name collisions after normalization (R-AGT-8, R-PH-3, R-SCP-2).
2. Placeholder engine: `{{agent:}}`, `{{skill:}}`, `{{scope}}`, escaping, fallback text and harness-qualified phrases (R-PH-1…5, R-CFG-7).
3. Skill renderer with two modes: **install** (prefixed names, frontmatter rewrite, link rewriting) and **plain** (names normalized, links rewritten only for renamed skills). Both remove `metadata.internal` (R-SCP-2, R-SCP-5, R-PKG-2, R-PKG-3).
4. `build` and `build --check` for the plain build (R-PKG-3, R-PKG-4).
5. Convert `morovid/skills` to the source layout on a branch, run `build`, and check that `npx skills add ./ --list` shows only the plain build.

Done when: `skillpack build --check` passes in CI for `morovid/skills`, and `npx skills add` installs the plain build with no `{{` left in any file.

### Milestone 2: Sources, versions, install and lock (about 3 days)

1. CLI skeleton: commands, flags, `--dry-run`, non-interactive `-y`, packs named by scope or source (R-CLI-7).
2. Source resolver: parse and normalize sources (R-SRC-1, R-SRC-4), resolve versions from tags, including the default `^<latest>` (R-VER-2, R-VER-3), fetch into a temporary folder (R-SRC-5), fall back to the plain repo layout when there's no manifest (R-SRC-3).
3. Transactional writer: write to temp files, then rename; hash skill folders, protect against overwrites (R-SAF-1…3, R-SKL-4).
4. `add` for skills, using default bindings only (no prompts yet); write the selection config and lock file; `install` with pnpm semantics and `--frozen-lockfile`, including the `CI` default (R-VER-5, R-VER-6, R-CLI-6).
5. `list` and `remove`.

Done when: `npx skillpack add morovid/skills -a opencode -a codex -y` writes `"version": "^1.0.0"` and installs prefixed, rendered skills; a second pack with an `implement` skill installs next to it; and `install --frozen-lockfile` reproduces both on a clean checkout.

### Milestone 3: Agents, bindings, `configure` and `sync` (about 4 days)

1. OpenCode and Codex generators, permissions, headers with hashes, and the enforcement report (R-SCP-3, R-AGT-3…5, R-AGT-7).
2. Built-in agent lists and available models for each harness (section 5, R-REQ-1).
3. Interactive binding prompts in `add`; write the selection config and models file (R-CFG-1…3, R-CFG-12).
4. `configure` and `sync`, including adding and removing agent files when bindings change (R-CFG-4, R-CFG-5).
5. The managed `.git/info/exclude` block, and `install` generating agents on a fresh clone for detected harnesses (R-AGT-11, R-SAF-7).
6. Snapshot tests for every generator and binding type (generate / built-in / none, same vs different IDs per harness).

Done when: switching `scout` in OpenCode from "generate" to the built-in `explore` with `skillpack configure morovid scout` deletes `.opencode/agents/morovid-scout.md` and its exclude entry, updates the `subagent` rules in `morovid-author.md`, and re-renders `.agents/skills/morovid-*` to say "`explore` (Codex: `morovid-scout`)".

### Milestone 4: Models, updates and release (about 3 days)

1. Model matching, the models file, effort mapping, no-match handling and `--strict` (R-REQ-2…5).
2. `doctor` (R-REQ-7, R-CFG-9).
3. `check`, `update` and `upgrade`, keeping bindings, prompting only for new or removed agents, and moving files when a pack's name changes (R-VER-7, R-VER-7a).
4. Harness config snippets, defined by the CLI and printed (R-AGT-9).
5. `dist/agents` output (R-PKG-6) and `init` (R-PKG-7), if time allows.
6. Docs: README, pack author guide, and a guide for users coming from `npx skills`. Publish `0.1.0`; tag `morovid/skills` `v1.0.0`.

### Testing approach

- Unit tests: source parsing and normalization, owner-to-scope normalization, version resolution, name validation and per-output name forms, link rewriting, placeholder rendering (including escapes and harness-qualified phrases), model name matching, effort mapping, both generators, permission building, the hash function, `upgrade`'s version rewriting, and the exclude block writer.
- Golden-file tests: for one fixture pack, render every combination of harness set and binding type, and compare with checked-in output (R-PH-5).
- Fixture packs: a minimal pack, a pack without a manifest, two packs that both define `implement`, a pack with `_` in skill and agent names, a pack with a spawn cycle, one with an unknown placeholder, and one with two skills that normalize to the same name (all three must fail `validate`), and a pack whose requested model matches nothing.
- End-to-end: run against temp git repos created during the test, with tags `v1.0.0` / `v1.1.0` / `v2.0.0`, for `add` → `configure` → `sync` → `update` → `upgrade` → `remove` → `install --frozen-lockfile`. Also:
  - a fresh clone with no models file: `install` must generate agents, write the models file and add the exclude block, and `git status` must show no changes;
  - `install` after editing `version` in `skillpack.json` (a range, and a switch from one branch to another), after removing a pack from it, and after editing a rendered skill;
  - `install` with `CI` set and an out-of-date lock file must fail.
- Compatibility: run `npx skills add <fixture> --list` (with and without `--full-depth`) to check that only the plain build is visible.
- Manual smoke test in OpenCode and Codex for each release: start the scoped agents and check the model and permissions.

## 8. Decisions and open questions

### Decided

- Installed skills are flat and prefixed: `<scope>-<name>` (R-SCP-1, R-SCP-2).
- Names may use `-` or `_` in the pack; every output writes them in kebab case, so a generated agent has the same ID in OpenCode and Codex (R-SCP-2, R-SCP-3).
- Skills and agents refer to agents and skills only through placeholders (R-PH-1…5).
- User-facing text always says "agent", never "role"; generators translate to each harness's own terms.
- The user chooses how each agent is filled for each harness: generate, a built-in agent, or none. Custom agents can't be bound, because teammates may not have them. The choices live in `skillpack.json`, and `configure` / `sync` regenerate the files (R-CFG-1…7).
- Bindings never depend on the machine: missing bindings mean `generate`, and a model that doesn't match produces an agent without a model, not a `none` binding (R-CFG-3, R-REQ-4).
- Codex has no primary agents, so primary agents are generated there as subagents (R-AGT-4).
- `npx skills` keeps working through a committed plain build in `skills/`, generated from `src/`. The plain build keeps plain, unprefixed names, so `npx skills` users get the same names as today (R-PKG-1…5).
- Fallback text is one neutral phrase per agent and never names harness-specific agents (R-PH-4).
- File names: the pack author writes `skillpack.pack.json`; the user's project has `skillpack.json` (intent), `skillpack-lock.json` (result) and `skillpack.models.json` (this machine's models), paired like `package.json` and `package-lock.json`. Users outnumber pack authors, so they get the short name. `skills.json` was rejected: it reads as part of `npx skills` (next to its `skills-lock.json`), and `npx skills` may adopt that name later.
- Packs are keyed by their normalized source URL in every user file. Commands accept the scope or the source. The scope comes from the manifest and is only stored when overridden with `--as` (R-SRC-4, R-SCP-4, R-CLI-7).
- Project scope only: no global installs, no global config, no layers (section 6).
- A pack is a whole remote repository; packs in subfolders and local paths aren't supported (R-SRC-1).
- No pack cache: sources are fetched fresh into a temporary folder, so rendering commands need network access (R-SRC-5).
- Versions work like npm: `add` without a version writes `^<latest tag>`, or the default branch if there are no tags; `update` stays within the range; `upgrade` moves to the latest version and rewrites the range (R-VER-3, R-VER-7, R-VER-7a).
- `install` works like `pnpm install`: it resolves packs whose requested version changed (including a switch to another branch), removes packs no longer configured, restores skill folders, and defaults to `--frozen-lockfile` in CI. `--frozen-lockfile` checks only skills and the lock file (R-VER-6).
- No marker files in skill folders. Skill ownership comes from the lock file; agent ownership from the generated header (R-SKL-4, R-AGT-7).
- The lock file holds only the `cli` version and, per pack, the `ref` it was resolved from, the commit and the skill hashes. Everything else is in the selection config or derived by rendering (R-VER-5).
- **What's committed and what's local:** rendered skills depend only on committed inputs, so they're committed and identical for everyone. Generated agents depend on machine-specific models, so they and `skillpack.models.json` stay local. Each engineer runs `skillpack install`, like `pnpm install`. Local files are kept out of git with exact paths in a managed block in `.git/info/exclude`, so `.gitignore` is never edited and the user's own agents aren't affected (R-AGT-11, R-SAF-7).
- The selection config holds only bindings (`generate`, `existing:<id>`, `none`); models and effort live in the models file or in the pack (R-CFG-2, R-REQ-2, R-REQ-5).
- Defaults are fixed by the CLI and can't be changed by config or environment, except pnpm's `CI` default for `--frozen-lockfile` (R-CLI-6). Harness config is never edited; snippets are printed (R-AGT-9).
- Flags: `-a/--harness` picks harnesses and `--agent` picks the pack's agents (R-CLI-2).
- The manifest is minimal: `name` (which is the scope), `description`, `cli` and `harnesses`. No `version` (git tags are the version), no configurable folders, no harness config snippets, no phrase templates, no author, license or repository (R-VER-1).
- Every file format is versioned by its schema URL: `/schemas/v1/…` (R-VER-1a).
- Models: agents ask for harness-neutral model names and effort levels. The CLI matches names to available models, asks when several match, and stores the choice per pack in `skillpack.models.json`. Each pack keeps its own model choices: a choice made for one pack is never applied to, or suggested for, another. Pack-supplied tiers and profiles were rejected as too much to learn for pack authors and users (R-REQ-2…5).
- Agents are folders: `src/agents/<name>/manifest.json` (configuration, validated by schema) and `instructions.md` (plain Markdown). Config and text are linted separately; the folder name is the agent name (R-AGT-1).
- Agent capabilities are denied by default; `read`, `search` and `skills` are the only defaults that are on. MCP servers are a capability (R-AGT-2a).
- No step limits, no built-in agent overrides, no pack-suggested existing agents (R-AGT-6), and no per-harness overrides in agent definitions (R-AGT-2).

### Alternatives considered for `npx skills` compatibility

| Option | Why it wasn't chosen |
|---|---|
| Publish the plain build on a separate `dist` branch or tags | `main` stays clean, but `npx skills` users must remember `@dist`, and the two outputs drift apart more easily |
| No plain build: skills read agent names from a config file at runtime | No generation step, but costs tokens and is fragile, and it doesn't work without `skillpack` |
| One shared output for both tools, with fallback text where placeholders would go | Simpler, but loses exact agent names, which is the main point of the agent work |

### Alternatives considered for keeping engineers in sync

| Option | Why it wasn't chosen |
|---|---|
| Commit generated agents too | Each engineer's `sync` rewrites them with their own provider and model, so they churn in every diff |
| Generate everything locally, skills included (pure `pnpm install` model) | A fresh clone has no skills until someone runs `install`, and tools that never run `skillpack` (CI agents, cloud agents, web IDEs) don't see them |
| Store unrendered pack sources in the project | Redundant: the selection config and lock file already pin the exact commit |
| Have `skillpack` manage a block in `.gitignore` | Changes a committed file, and adds ignore rules for teammates who never installed anything. `.git/info/exclude` applies exactly where the local files exist. |
| A `.skillpack.json` marker in each skill folder | Duplicates the lock file now that there are no global installs |
| Bind to custom agents | Teammates may not have them, so committed skills would name agents that don't exist |
| Fall back to `none` when no model matches | Makes the committed skills depend on each machine's models |

### Open

1. **Names:** the npm package is `@morovid/skillpack` (scoped, so no clash with the unrelated `skillpack` package). The file names are decided (see above).
