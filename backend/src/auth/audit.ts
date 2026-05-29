import type { Request } from 'express';
import type { Pool } from 'pg';

// Wires the existing `audit_logs` table into the auth flow. Logging is
// best-effort: a failure to write an audit row must never break the request it
// describes, so callers fire-and-forget and we swallow errors here.

export type AuthAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.token_refresh'
  | 'auth.token_refresh_failed'
  | 'auth.token_revoke'
  | 'auth.address_attach';

export interface AuditContext {
  action: AuthAction;
  address?: string | null;
  entityType?: string;          // defaults to 'auth'
  entityId?: string | null;     // e.g. jti, address, primary_address
  details?: Record<string, unknown>;
}

/** Extract client IP + user agent from a request, honouring a trusted proxy. */
function requestMeta(req: Request): { ip: string; user_agent: string } {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    user_agent: req.get('user-agent') ?? 'unknown',
  };
}

/**
 * Record an auth event. Never throws — audit logging must not affect the
 * outcome of the operation being audited.
 */
export async function recordAudit(pool: Pool, req: Request, ctx: AuditContext): Promise<void> {
  try {
    const meta = requestMeta(req);
    const details = {
      ...meta,
      ...(ctx.details ?? {}),
    };
    await pool.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, address, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ctx.action,
        ctx.entityType ?? 'auth',
        ctx.entityId ?? null,
        ctx.address ?? null,
        JSON.stringify(details),
        Math.floor(Date.now() / 1000),
      ],
    );
  } catch (err) {
    console.error('[audit] failed to record event', ctx.action, err);
  }
}
