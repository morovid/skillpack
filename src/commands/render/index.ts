import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { toAgentSpec } from "../../core/agents/index.js";
import {
  BindingError, agentIdFor, bindingOf, bindingsFromOptions, formatBinding, type Bindings,
} from "../../core/bindings.js";
import { replaceFolder } from "../../core/fs/atomic.js";
import { HARNESSES, HARNESS_INFO, isHarness, sortHarnesses, type Harness } from "../../core/harness.js";
import { planInstall } from "../../core/install/plan.js";
import { overlongScopedNames, scopeProblem } from "../../core/names.js";
import { createStyle, formatAgentWarnings, formatDiagnostics, plural } from "../../core/output.js";
import { listSkillSources, loadAgentDefinitions, loadPackManifest, loadSkillFiles } from "../../core/pack/index.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";
import { validatePack } from "../validate/validate-pack.js";

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

function selectHarnesses(flags: string[], supported: readonly Harness[]): Harness[] {
  const names = flags.flatMap((f) => f.split(",")).map((s) => s.trim()).filter(Boolean);
  if (names.length === 0 || names.includes("*")) return sortHarnesses(supported);
  for (const n of names) {
    if (!isHarness(n)) throw new UsageError(`unknown harness "${n}" (use ${HARNESSES.join(", ")} or *)`);
    if (!supported.includes(n)) {
      throw new UsageError(`this pack doesn't support the harness "${n}" (supported: ${supported.join(", ")})`);
    }
  }
  return sortHarnesses(names as Harness[]);
}

export const render: Command = {
  name: "render",
  summary: "Preview what installing a pack would write, without installing",
  usage:
    "skillpack render [dir] [-a <harness>]... [--agent <names|*|none>] [--bind <agent>[.<harness>]=<binding>]... [--as <scope>] [--out <dir>] [--verbose] [--json]",
  options: {
    harness: { type: "string", short: "a", multiple: true },
    agent: { type: "string" },
    bind: { type: "string", multiple: true },
    as: { type: "string" },
    out: { type: "string" },
    json: { type: "boolean" },
    verbose: { type: "boolean" },
  },
  optionHelp: {
    harness: "Harness to render for: opencode, codex or * (repeatable or comma list)",
    agent: "Agents to use; the others are bound to none (names, * or none)",
    bind: "Binding: <agent>[.<harness>]=generate|none|existing:<id> (repeatable)",
    as: "Install under this scope instead of the pack's name",
    out: "Write the rendered tree into this empty or new directory",
    json: "Print the result as JSON (always lists every restriction)",
    verbose: "List every unenforced restriction instead of one line per agent",
  },
  async run(ctx) {
    if (ctx.positionals.length > 1) throw new UsageError("expected at most one directory");
    const dir = resolve(ctx.cwd, ctx.positionals[0] ?? ".");
    const json = ctx.values.json === true;
    const s = createStyle(ctx.color);

    const validation = validatePack(dir, { cliVersion: CLI_VERSION });
    const diag = validation.diagnostics;
    if (diag.errorCount > 0 || validation.name === undefined) {
      if (json) ctx.stdout(JSON.stringify({ ok: false, reason: "invalid-pack", diagnostics: diag.items }, null, 2) + "\n");
      else {
        ctx.stdout(formatDiagnostics(diag.items, s));
        ctx.stdout(s.red(`✖ ${plural(diag.errorCount, "error")}, ${plural(diag.warningCount, "warning")}; nothing rendered`) + "\n");
      }
      return 1;
    }

    const manifest = loadPackManifest(dir).result;
    const supported = ((manifest.ok ? (manifest.value as { harnesses?: Harness[] }).harnesses : undefined) ?? HARNESSES) as Harness[];
    const harnesses = selectHarnesses(strings(ctx.values.harness), supported);

    const sources = listSkillSources(dir).filter((x) => x.skillFile !== null);
    const specs = loadAgentDefinitions(dir).map(toAgentSpec);

    const scope = typeof ctx.values.as === "string" ? ctx.values.as : validation.name;
    const problem = scopeProblem(scope);
    if (problem) throw new UsageError(`--as: ${problem}`);
    const long = overlongScopedNames(scope, [...sources.map((x) => x.name), ...specs.map((x) => x.name)]);
    if (long.length > 0) throw new UsageError(`--as: installed names too long (max 64): ${long.join(", ")}`);

    let bindings: Bindings;
    try {
      bindings = bindingsFromOptions({
        agents: specs.map((a) => a.name),
        harnesses,
        agentOption: typeof ctx.values.agent === "string" ? ctx.values.agent : undefined,
        binds: strings(ctx.values.bind),
      });
    } catch (e) {
      if (e instanceof BindingError) throw new UsageError(e.message);
      throw e;
    }

    const plan = planInstall({
      scope,
      pack: { source: basename(dir), version: "local" },
      skills: sources.map((x) => loadSkillFiles(x.name, x.dir)),
      agents: specs,
      harnesses,
      bindings,
    });

    const outFlag = typeof ctx.values.out === "string" ? resolve(ctx.cwd, ctx.values.out) : undefined;
    if (outFlag !== undefined) {
      if (existsSync(outFlag) && readdirSync(outFlag).length > 0) {
        ctx.stderr(`skillpack render: --out ${outFlag} is not empty; refusing to write\n`);
        return 1;
      }
      if (plan.files.length > 0) replaceFolder(outFlag, plan.files);
    }

    if (json) {
      const bindingJson = Object.fromEntries(
        specs.map((a) => [
          a.name,
          Object.fromEntries(
            harnesses.map((h) => {
              const b = bindingOf(bindings, a.name, h);
              return [h, { binding: formatBinding(b), id: agentIdFor(scope, a.name, b) }];
            }),
          ),
        ]),
      );
      ctx.stdout(
        JSON.stringify(
          {
            ok: true,
            scope,
            harnesses,
            written: outFlag ?? null,
            files: plan.files.map((f) => ({ path: f.path, sha256: createHash("sha256").update(f.content).digest("hex") })),
            bindings: bindingJson,
            warnings: plan.warnings,
            diagnostics: diag.items,
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }

    if (diag.warningCount > 0) ctx.stdout(formatDiagnostics(diag.items, s));
    ctx.stdout(`${s.bold("Files")}\n`);
    for (const f of plan.files) ctx.stdout(`  ${f.path}\n`);

    if (specs.length > 0) {
      ctx.stdout(`\n${s.bold("Bindings")}\n`);
      const cell = (a: string, h: Harness): string => {
        const b = bindingOf(bindings, a, h);
        return b.kind === "generate" ? `generate (${agentIdFor(scope, a, b)})` : formatBinding(b);
      };
      const rows = specs.map((a) => [a.name, ...harnesses.map((h) => cell(a.name, h))]);
      const head = ["agent", ...harnesses.map((h) => HARNESS_INFO[h].displayName)];
      const widths = head.map((_, i) => Math.max(...[head, ...rows].map((r) => r[i]!.length)));
      for (const [i, r] of [head, ...rows].entries()) {
        const line = `  ${r.map((c, j) => c.padEnd(widths[j]!)).join("  ").trimEnd()}\n`;
        ctx.stdout(i === 0 ? s.dim(line) : line);
      }
    }

    if (plan.warnings.length > 0) {
      ctx.stdout(`\n${s.bold("Warnings")}\n`);
      ctx.stdout(formatAgentWarnings(plan.warnings, s, ctx.values.verbose === true));
    }

    const agentFiles = plan.files.filter((f) => !f.path.startsWith(".agents/")).length;
    const skillCount = sources.length;
    ctx.stdout(
      "\n" +
        s.green(
          `✔ rendered ${plural(skillCount, "skill")} and ${plural(agentFiles, "agent file")} for ${harnesses.join(", ")}` +
            (outFlag ? ` into ${outFlag}` : " (preview; use --out <dir> to write)"),
        ) +
        "\n",
    );
    return 0;
  },
};
