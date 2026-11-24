---
title: JSON Schemas
description: Machine-readable schemas for skillpack's file formats.
---

Every `skillpack` file format has a JSON Schema. Add its URL as `$schema` to get validation and autocomplete in editors.

| File | Schema | Written by |
|---|---|---|
| `skillpack.pack.json` | [`/schemas/v1/pack.json`](/schemas/v1/pack.json) | Pack author. See [Manifest](/pack/manifest/). |
| `src/agents/<name>/manifest.json` | [`/schemas/v1/agent.json`](/schemas/v1/agent.json) | Pack author. See [Agent definitions](/pack/agents/). |
| `skillpack.json` | [`/schemas/v1/config.json`](/schemas/v1/config.json) | `skillpack` or the user. See [Selection config](/user/config/). |
| `skillpack.models.json` | [`/schemas/v1/models.json`](/schemas/v1/models.json) | `skillpack` or the user. See [Models file](/user/models/). |
| `skillpack-lock.json` | [`/schemas/v1/lock.json`](/schemas/v1/lock.json) | `skillpack` only. See [Lock file](/user/lock-file/). |

## Versioning

Schema URLs have the form `https://skillpack.morovid.com/schemas/v<N>/<file>.json`. The `v<N>` folder is the **format version** of the file: `skillpack` reads it from `$schema`, and a file without `$schema` is read as `v1`. A change that breaks existing files gets a new folder (`/v2/`); older versions stay published.
