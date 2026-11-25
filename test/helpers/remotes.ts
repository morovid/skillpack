import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const validFixture = join(import.meta.dirname, "..", "fixtures", "packs", "valid");

export interface TestRemotes {
  root: string;
  env: NodeJS.ProcessEnv;
  /** Creates a bare repo served at https://github.com/<ownerRepo>. */
  add(ownerRepo: string, steps: RemoteStep[]): void;
  /** Adds a commit (and optionally a tag) to a repo created with `add`, and pushes it. */
  push(ownerRepo: string, step: RemoteStep): void;
  /** Maps https://github.com/<ownerRepo> to an arbitrary path (e.g. one that doesn't exist). */
  alias(ownerRepo: string, path: string): void;
}

export interface RemoteStep {
  /** Mutates the working tree before this commit. */
  apply(workDir: string): void;
  tag?: string;
}

const run = (cwd: string, args: string[], env: NodeJS.ProcessEnv) => execFileSync("git", args, { cwd, env, stdio: "pipe" });

export function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** Real git, no network: `url.<bare>.insteadOf` maps https://github.com/... to local bare repos. */
export function createRemotes(): TestRemotes {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sp-remotes-")));
  const gitconfig = join(root, "gitconfig");
  const rules: string[] = [];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  writeFileSync(gitconfig, "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[protocol \"file\"]\n\tallow = always\n[commit]\n\tgpgsign = false\n");
  const bares = new Map<string, { work: string; bare: string }>();
  return {
    root,
    env,
    alias(ownerRepo, path) {
      writeFileSync(gitconfig, `${require_read(gitconfig)}[url "${path}"]\n\tinsteadOf = https://github.com/${ownerRepo}\n`);
    },
    push(ownerRepo, step) {
      const { work, bare } = bares.get(ownerRepo)!;
      step.apply(work);
      run(work, ["add", "-A"], env);
      run(work, ["commit", "-q", "--allow-empty", "-m", "push"], env);
      if (step.tag) run(work, ["tag", step.tag], env);
      run(work, ["push", "-q", "--tags", bare, "HEAD:refs/heads/main"], env);
    },
    add(ownerRepo, steps) {
      const work = join(root, "work", ownerRepo);
      const bare = join(root, "bare", `${ownerRepo}.git`);
      mkdirSync(work, { recursive: true });
      run(work, ["init", "-q"], env);
      steps.forEach((step, i) => {
        step.apply(work);
        run(work, ["add", "-A"], env);
        run(work, ["commit", "-q", "--allow-empty", "-m", `commit ${i}`], env);
        if (step.tag) run(work, ["tag", step.tag], env);
      });
      mkdirSync(dirname(bare), { recursive: true });
      run(root, ["clone", "-q", "--bare", work, bare], env);
      bares.set(ownerRepo, { work, bare });
      rules.push(`[url "${bare}"]\n\tinsteadOf = https://github.com/${ownerRepo}\n`);
      writeFileSync(gitconfig, `${require_read(gitconfig)}${rules[rules.length - 1]}`);
    },
  };
}

import { readFileSync } from "node:fs";
const require_read = (p: string): string => readFileSync(p, "utf8");

export const copyValid = (work: string): void => void cpSync(validFixture, work, { recursive: true });

export function initProject(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sp-project-")));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
  return dir;
}
