export type DiagnosticLevel = "error" | "warning";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  file?: string;
  line?: number;
}

type Extra = { file?: string | undefined; line?: number | undefined };

export class Diagnostics {
  readonly items: Diagnostic[] = [];

  add(level: DiagnosticLevel, code: string, message: string, extra: Extra = {}): void {
    const d: Diagnostic = { level, code, message };
    if (extra.file !== undefined) d.file = extra.file;
    if (extra.line !== undefined) d.line = extra.line;
    this.items.push(d);
  }

  error(code: string, message: string, extra?: Extra): void {
    this.add("error", code, message, extra);
  }

  warn(code: string, message: string, extra?: Extra): void {
    this.add("warning", code, message, extra);
  }

  get errorCount(): number {
    return this.items.filter((d) => d.level === "error").length;
  }

  get warningCount(): number {
    return this.items.filter((d) => d.level === "warning").length;
  }
}
