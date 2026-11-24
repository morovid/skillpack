import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import agentSchema from "../../../schemas/v1/agent.json" with { type: "json" };
import configSchema from "../../../schemas/v1/config.json" with { type: "json" };
import lockSchema from "../../../schemas/v1/lock.json" with { type: "json" };
import modelsSchema from "../../../schemas/v1/models.json" with { type: "json" };
import packSchema from "../../../schemas/v1/pack.json" with { type: "json" };

export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

const sources = {
  pack: packSchema,
  agent: agentSchema,
  config: configSchema,
  models: modelsSchema,
  lock: lockSchema,
};
export type SchemaName = keyof typeof sources;

export interface SchemaIssue {
  /** JSON pointer to the offending value ("" is the document root). */
  path: string;
  message: string;
}

const compiled = new Map<SchemaName, ValidateFunction>();

function getValidator(name: SchemaName): ValidateFunction {
  let v = compiled.get(name);
  if (!v) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    v = ajv.compile(sources[name]);
    compiled.set(name, v);
  }
  return v;
}

export const formatPointer = (path: string): string => path || "/";

const escapePointer = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");
const show = (v: unknown): string => JSON.stringify(v);

/**
 * ajv reports every failing oneOf branch before the oneOf error itself. Keep only the
 * errors of branches that fit the value's type; if none fit, say what types are allowed.
 */
function collapseOneOf(errors: ErrorObject[]): ErrorObject[] {
  const out: ErrorObject[] = [];
  for (const err of errors) {
    if (err.keyword !== "oneOf") {
      out.push(err);
      continue;
    }
    const p = err.instancePath;
    const branch: ErrorObject[] = [];
    while (out.length > 0 && out[out.length - 1]!.instancePath.startsWith(p)) branch.unshift(out.pop()!);
    const typeErrs = branch.filter((e) => e.keyword === "type" && e.instancePath === p);
    const rest = branch.filter((e) => !typeErrs.includes(e));
    if (rest.length > 0) out.push(...rest);
    else if (typeErrs.length > 0) {
      const types = [...new Set(typeErrs.flatMap((e) => [e.params.type as string | string[]].flat()))];
      out.push({ ...err, keyword: "type", message: `must be ${types.join(" or ")}`, params: {} });
    } else if (branch.length > 0 && (err.params as { passingSchemas?: unknown }).passingSchemas == null) {
      out.push(...branch);
    } else {
      out.push({ ...err, message: "must match exactly one allowed form" });
    }
  }
  return out;
}

function toIssue(e: ErrorObject): SchemaIssue {
  const params = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "additionalProperties":
      return {
        path: `${e.instancePath}/${escapePointer(String(params.additionalProperty))}`,
        message: `unexpected property "${String(params.additionalProperty)}"`,
      };
    case "required":
      return { path: e.instancePath, message: `missing required property "${String(params.missingProperty)}"` };
    case "minLength":
      return { path: e.instancePath, message: params.limit === 1 ? "must not be empty" : (e.message ?? "invalid") };
    case "enum":
      return { path: e.instancePath, message: `must be one of ${(params.allowedValues as unknown[]).map(show).join(", ")}` };
    case "const":
      return { path: e.instancePath, message: `must be ${show(params.allowedValue)}` };
    case "pattern":
      return { path: e.instancePath, message: `must match pattern ${params.pattern}` };
    default:
      return { path: e.instancePath, message: e.message ?? "invalid" };
  }
}

export function validateAgainst(name: SchemaName, doc: unknown): SchemaIssue[] {
  const validate = getValidator(name);
  if (validate(doc)) return [];
  const issues: SchemaIssue[] = [];
  for (const e of collapseOneOf(validate.errors ?? [])) {
    if (e.keyword === "propertyNames") continue;
    const issue = toIssue(e);
    const key = (e as { propertyName?: string }).propertyName;
    if (key !== undefined) {
      issue.path = `${e.instancePath}/${escapePointer(key)}`;
      issue.message = `property name ${issue.message}`;
    }
    if (!issues.some((i) => i.path === issue.path && i.message === issue.message)) issues.push(issue);
  }
  return issues;
}

export type SchemaVersionResult = { version: number } | { error: string };

/** R-VER-1a: the format version comes from `$schema` (`/schemas/v<N>/`); no `$schema` means v1. */
export function schemaVersion(doc: unknown, file: string): SchemaVersionResult {
  const url = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>).$schema : undefined;
  if (typeof url !== "string") return { version: 1 };
  const m = /\/schemas\/v(\d+)\//.exec(url);
  if (!m) return { version: 1 };
  const version = Number(m[1]);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    return {
      error: `${file} uses format v${version}, which this skillpack version doesn't support (supported: ${SUPPORTED_SCHEMA_VERSIONS.map((v) => `v${v}`).join(", ")}). Upgrade skillpack.`,
    };
  }
  return { version };
}
