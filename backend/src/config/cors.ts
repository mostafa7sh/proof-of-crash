import type { CorsOptions } from 'cors';

// Environment-driven CORS. CORS_ALLOWED_ORIGINS is a comma-separated allowlist
// (e.g. "https://app.example.com,https://admin.example.com"). Credentials are
// enabled by default so the HttpOnly cookie mode works cross-origin.
//
// Production safety: a wildcard ("*") allowlist is refused when
// NODE_ENV=production — wildcard + credentials is both insecure and rejected by
// browsers.

export function buildCorsOptions(): CorsOptions {
  const isProd = process.env['NODE_ENV'] === 'production';
  const allowCredentials = (process.env['CORS_ALLOW_CREDENTIALS'] ?? 'true').toLowerCase() !== 'false';

  const origins = (process.env['CORS_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const hasWildcard = origins.includes('*');

  if (isProd && hasWildcard) {
    throw new Error('CORS_ALLOWED_ORIGINS must not be "*" in production');
  }

  // No explicit allowlist:
  //  - dev: reflect any origin (convenient for local frontends)
  //  - prod: deny all cross-origin (same-origin requests still work)
  if (origins.length === 0) {
    return {
      origin: isProd ? false : true,
      credentials: allowCredentials,
    };
  }

  if (hasWildcard) {
    // Dev-only wildcard. Cannot combine "*" with credentials per the spec, so
    // reflect the request origin instead when credentials are on.
    return allowCredentials
      ? { origin: true, credentials: true }
      : { origin: '*', credentials: false };
  }

  return {
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header) and allowlisted origins.
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: allowCredentials,
  };
}
