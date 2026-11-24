export const NAME_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
export const MAX_SCOPE_LENGTH = 24;
export const MAX_SCOPED_NAME_LENGTH = 64;

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function toKebab(name: string): string {
  return name.replaceAll("_", "-");
}

export function scopedName(scope: string, name: string): string {
  return `${toKebab(scope)}-${toKebab(name)}`;
}

/** Problem with a scope, or null when it is valid (R-SCP-2). */
export function scopeProblem(scope: string): string | null {
  if (!isValidName(scope)) return `scope "${scope}" must match ^[a-z0-9]+([-_][a-z0-9]+)*$`;
  if (scope.length > MAX_SCOPE_LENGTH) return `scope "${scope}" is ${scope.length} characters; the limit is ${MAX_SCOPE_LENGTH}`;
  return null;
}

/** Names whose `<scope>-<name>` exceeds the limit. */
export function overlongScopedNames(scope: string, names: Iterable<string>): string[] {
  return [...names].map((n) => scopedName(scope, n)).filter((n) => n.length > MAX_SCOPED_NAME_LENGTH);
}
