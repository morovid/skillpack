import { CancelledError, type Prompts } from "../../src/core/prompts/index.js";

export const CANCEL = Symbol("cancel");
export interface Asked {
  kind: "select" | "multiselect" | "confirm";
  message: string;
  options?: { value: string; label: string; hint?: string }[];
  initial?: unknown;
}

/** Prompts that answer from a script (select: a value, multiselect: values, confirm: boolean; CANCEL aborts). */
export function scriptedPrompts(answers: unknown[]): { prompts: Prompts; asked: Asked[] } {
  const asked: Asked[] = [];
  const next = (a: Asked): unknown => {
    asked.push(a);
    if (answers.length === 0) throw new Error(`unscripted prompt: ${a.message}`);
    const v = answers.shift();
    if (v === CANCEL) throw new CancelledError();
    return v;
  };
  const prompts: Prompts = {
    select: async (o) => next({ kind: "select", message: o.message, options: o.options, initial: o.initial }) as never,
    multiselect: async (o) => next({ kind: "multiselect", message: o.message, options: o.options, initial: o.initial }) as never,
    confirm: async (o) => next({ kind: "confirm", message: o.message, initial: o.initial }) as never,
  };
  return { prompts, asked };
}
