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
src/core/               shared logic: names, paths, schema validator, pack loaders,
                        frontmatter, placeholders, diagnostics, output, harness, version
test/                   vitest tests; fixture packs in test/fixtures/packs/
```

To add a command, create `src/commands/<name>/index.ts` exporting a `Command`, then add it to the list in `src/commands/index.ts`. Put anything a second command could reuse in `src/core/`.

Currently implemented: `skillpack validate [dir] [--strict] [--json]`.

## Publishing

```sh
pnpm publish     # runs typecheck, test and build first (prepublishOnly)
```
