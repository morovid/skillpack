/**
 * R-CLI-6: `install` defaults to --frozen-lockfile when the `CI` environment variable is set.
 * Like pnpm, any non-empty value counts as set except "false" and "0".
 */
export function isCI(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.CI;
  return v !== undefined && v !== "" && v !== "false" && v !== "0";
}
