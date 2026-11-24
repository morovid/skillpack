export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
}

export function colorEnabled(stream: { isTTY?: boolean }, env = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return stream.isTTY === true;
}

export function createStyle(enabled: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    bold: wrap(1, 22),
    dim: wrap(2, 22),
  };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
