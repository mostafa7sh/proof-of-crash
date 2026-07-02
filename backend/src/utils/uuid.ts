// Shared UUID helpers. The `apps.app_id` (and `crash_proofs.app_id`) columns are
// Postgres `UUID`, so a malformed identifier passed straight into a query throws
// `invalid input syntax for type uuid` — surfacing to the client as a generic
// 500. Routes call `isUuid()` first so they can return a precise 400 instead.

// Canonical RFC-4122 form (8-4-4-4-12 hex), case-insensitive. We accept any
// version/variant nibble because gen_random_uuid() emits v4 but we never want to
// reject a syntactically valid id the database would have accepted.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}
