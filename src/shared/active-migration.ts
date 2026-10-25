/** Upgrade only our persisted settings and business records, never third-party API payloads.
 * Existing active values (including false) take precedence over the legacy enabled flag.
 */
export function migrateActiveFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => migrateActiveFields(item)) as T;
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key !== "enabled" || typeof item !== "boolean") next[key] = migrateActiveFields(item);
  }
  if (typeof record.active !== "boolean" && typeof record.enabled === "boolean")
    next.active = record.enabled;
  return next as T;
}
