# @morovid/skillpack

Install versioned skill packs, with scoped skills and generated agents, for OpenCode and Codex. See [requirements.md](./requirements.md).

## Usage

```sh
npx @morovid/skillpack <command>
pnpm dlx @morovid/skillpack <command>
```

When installed (`npm i -g @morovid/skillpack`), the command is `skillpack`.

## Development

Requires Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm build       # bundle src/cli.ts to dist/cli.js with tsup
pnpm dev         # rebuild on change
pnpm start       # run dist/cli.js
pnpm typecheck
pnpm test        # vitest
```

## Project layout

```
src/cli.ts              entry point: runs main(), sets the exit code
src/main.ts             argv parsing, dispatch, error to exit code (0 ok, 1 failure, 2 usage)
src/help.ts             root and per-command help text
src/commands/index.ts   command registry (name -> Command)
src/commands/types.ts   Command interface
src/commands/<name>/    one folder per command: index.ts (definition and output), checks/ etc.
src/core/               shared logic: names, paths, ajv schemas, pack loaders, frontmatter,
                        placeholders (tokenizer + renderer), render/ (pure skill renderer),
                        hash, bindings, agents/ (OpenCode and Codex generators, headers), install/ (planInstall),
                        fs/ (tree reader, diff, atomic folder replace), diagnostics, output
test/                   vitest tests; fixture packs in test/fixtures/packs/
```

To add a command, create `src/commands/<name>/index.ts` exporting a `Command`, then add it to the list in `src/commands/index.ts`. Put anything a second command could reuse in `src/core/`.

Currently implemented:

- `skillpack validate [dir] [--strict] [--json]`
- `skillpack build [dir] [--check] [--json]`: writes the plain build to `skills/` (owned by `build`: stale folders are removed); `--check` exits 1 if it's out of date.
- `skillpack check [pack…] [--exit-code] [--json]`, `skillpack update [pack…]` and `skillpack upgrade [pack…] [--include-prerelease]`: show newer versions (read-only), move within the requested range, or move to the newest version and rewrite `version` in `skillpack.json`.
- `skillpack render [dir] [-a <harness>] [--agent …] [--bind <agent>[.<harness>]=<binding>] [--as <scope>] [--out <dir>] [--json]`: previews an install (shared skills, generated OpenCode and Codex agents, bindings, unenforced-restriction warnings); `--out` writes the tree into an empty directory.

## Publishing

```sh
pnpm publish     # runs typecheck, test and build first (prepublishOnly)
```
