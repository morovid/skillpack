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

## Publishing

```sh
pnpm publish     # runs typecheck, test and build first (prepublishOnly)
```
