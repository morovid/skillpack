---
title: Lock file (skillpack-lock.json)
description: The committed record of the exact commit of each pack and the hash of every installed skill.
---

`skillpack-lock.json` at the project root records what `skillpack` installed: the exact commit of each pack and a hash of every skill folder it wrote. It's committed next to [`skillpack.json`](/user/config/), like `package-lock.json` next to `package.json`. `skillpack` writes it; don't edit it by hand.

```json title="skillpack-lock.json"
{
  "$schema": "https://skillpack.morovid.com/schemas/v1/lock.json",
  "cli": "0.1.0",
  "packs": {
    "https://github.com/morovid/skills": {
      "version": "v1.0.0",
      "commit": "386c5d6e0b7a4f9d2c1e8b3a5f6d7c8e9a0b1c2d",
      "skills": {
        ".agents/skills/morovid-plan-code": "sha256-3f2a…",
        ".agents/skills/morovid-review": "sha256-9c41…"
      }
    }
  }
}
```

| Key | Description |
|---|---|
| `cli` | The `skillpack` version that wrote the file. A newer version may render slightly different files; `doctor` then tells you to run `sync` instead of reporting your skills as edited. |
| `packs.<source>` | One entry per pack, with the same key as in `skillpack.json`. |
| `version` | The tag the requested version resolved to, or `null` for a branch, a commit or a pack without tags. |
| `commit` | The exact commit the skills were rendered from. |
| `skills` | Every skill folder written, relative to the project root, with a hash of its contents. |

That's all. The requested version, harnesses, skills, scope and bindings are in `skillpack.json`. Generated agents aren't in the lock file at all: they depend on your machine's models, so each engineer generates their own (see [Installed files](/user/installed-files/#generated-agents)).

## What the lock file is for

- **Reproducing installs.** `skillpack install` fetches exactly these commits, so everyone gets the same skills even if the requested range now matches a newer tag.
- **Ownership.** A folder in `.agents/skills/` belongs to `skillpack` only if it's listed here. `skillpack` never overwrites or deletes any other folder, such as one installed by `npx skills`, unless you pass `--force`.
- **Detecting edits.** If a folder's hash no longer matches, it was edited by hand. `sync`, `configure`, `update`, `upgrade` and `remove` keep it and list it, unless you pass `--force`. `install` restores it (see below).

## `install`

`skillpack install` works like `pnpm install`: it makes the project match `skillpack.json` and the lock file.

| Situation | What `install` does |
|---|---|
| The locked version still matches the pack's `version` | Installs the locked commit |
| A pack is new in `skillpack.json`, or its `version` changed and the locked version no longer matches | Resolves the version again and updates the lock file |
| A pack is in the lock file but no longer in `skillpack.json` | Removes its skills and agents |
| A listed skill folder is missing or differs from what the locked commit renders | Rewrites it and lists it. Skills are committed, so you can get edits back from git. |
| Agents | Generates them for the harnesses found on this machine; skips the others with a note |

## Hashes

A skill hash covers every file in the folder:

1. Files are sorted by their path inside the folder, written with `/`.
2. For each file: its path, a NUL byte, the SHA-256 of its contents, and a newline.
3. The hash is the SHA-256 of all of that, written as `sha256-<hex>`.

Text files (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`) have CRLF line endings turned into LF first, so git's line-ending conversion on Windows doesn't count as an edit.

Rendering is deterministic: the same commit and the same `skillpack.json` always produce the same files, and so the same hashes, on every machine.

## Checking that everything is in sync

`skillpack install --frozen-lockfile` renders the locked commits with the current `skillpack.json` and fails, without writing anything, if the lock file or any committed skill folder would change. It only checks skills and the lock file: it never generates agents or looks at models, so it works on a CI machine without OpenCode or Codex. It catches:

- a skill edited by hand;
- a change to `skillpack.json` without `skillpack install` or `sync`;
- a lock file that doesn't match the committed skills.

As in pnpm, `--frozen-lockfile` is the default when the `CI` environment variable is set.

`skillpack doctor` runs the same check and tells you what to do.

## Merge conflicts

The lock file is generated from `skillpack.json` and the pack commits. If it conflicts in a merge, resolve `skillpack.json` first, take either side of the lock file, and run `skillpack install`. It resolves again any pack whose locked version no longer matches.
