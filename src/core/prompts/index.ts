export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** The prompts commands use. Commands depend on this interface, so tests can script the answers. Cancelling throws CancelledError. */
export interface Prompts {
  select<T extends string>(o: { message: string; options: Option<T>[]; initial?: T }): Promise<T>;
  multiselect<T extends string>(o: { message: string; options: Option<T>[]; initial?: T[]; required?: boolean }): Promise<T[]>;
  confirm(o: { message: string; initial?: boolean }): Promise<boolean>;
  /** Free text; `validate` returns an error message or undefined. */
  text(o: { message: string; placeholder?: string; validate?: (value: string) => string | undefined }): Promise<string>;
}

/** R-CLI-3: prompts run only when both stdin and stdout are terminals. */
export const isInteractive = (streams: { stdin?: { isTTY?: boolean }; stdout?: { isTTY?: boolean } } = process): boolean =>
  streams.stdin?.isTTY === true && streams.stdout?.isTTY === true;

/**
 * The terminal implementation, on @clack/prompts. The library is imported on the first question,
 * so commands that never prompt don't load it.
 */
export function createClackPrompts(): Prompts {
  let lib: Promise<typeof import("@clack/prompts")> | undefined;
  const clack = (): Promise<typeof import("@clack/prompts")> => (lib ??= import("@clack/prompts"));
  const done = async <V>(value: V | symbol): Promise<V> => {
    const { isCancel } = await clack();
    if (isCancel(value)) throw new CancelledError();
    return value as V;
  };
  return {
    async select(o) {
      const c = await clack();
      const options = o.options.map((x) => ({ value: x.value, label: x.label, ...(x.hint ? { hint: x.hint } : {}) }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return done(await c.select({ message: o.message, options: options as any, ...(o.initial !== undefined ? { initialValue: o.initial } : {}) }) as any);
    },
    async multiselect(o) {
      const c = await clack();
      const options = o.options.map((x) => ({ value: x.value, label: x.label, ...(x.hint ? { hint: x.hint } : {}) }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return done(await c.multiselect({ message: o.message, options: options as any, required: o.required ?? false, ...(o.initial ? { initialValues: o.initial } : {}) }) as any);
    },
    async text(o) {
      const c = await clack();
      return done<string>(
        await c.text({
          message: o.message,
          ...(o.placeholder ? { placeholder: o.placeholder } : {}),
          ...(o.validate ? { validate: (v: string | undefined) => o.validate!(v ?? "") } : {}),
        }),
      );
    },
    async confirm(o) {
      const c = await clack();
      return done<boolean>(await c.confirm({ message: o.message, ...(o.initial !== undefined ? { initialValue: o.initial } : {}) }));
    },
  };
}
