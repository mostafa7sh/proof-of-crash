import type { Pool } from 'pg';

// ─── Account membership ──────────────────────────────────────────────────────
//
// An account (users.primary_address today; users.user_id after the Phase-1
// refactor) can own several signing-key addresses. That means **address
// inequality does NOT prove two actors are different people** — a single user
// can act from keys A, B and C. Any anti-self-dealing / anti-collusion check
// (consensus voting, self-proof) must compare ACCOUNTS, not raw addresses, or a
// multi-key user can submit with one key and "independently" approve with others.

/**
 * Resolve signing-key addresses to their owning account (user_primary_address).
 * Addresses with no registered key are omitted from the map.
 */
export async function accountsOf(pool: Pool, addresses: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const r = await pool.query<{ address: string; user_primary_address: string }>(
    `SELECT address, user_primary_address FROM user_addresses WHERE address = ANY($1)`,
    [unique],
  );
  return new Map(r.rows.map((x) => [x.address, x.user_primary_address]));
}

/**
 * True if two signing-key addresses belong to the same account. Equal addresses
 * are trivially the same account. Two distinct, unrelated, or unregistered
 * addresses are treated as different accounts.
 */
export async function sameAccount(pool: Pool, a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const map = await accountsOf(pool, [a, b]);
  const pa = map.get(a);
  const pb = map.get(b);
  if (!pa || !pb) return false; // an unregistered address can't share an account
  return pa === pb;
}
