// Small, dependency-free form validators. Each returns an error string or null.

export type Validator = (value: string) => string | null;

export function required(label = 'This field'): Validator {
  return (v) => (v.trim().length === 0 ? `${label} is required` : null);
}

export function maxLen(n: number, label = 'This field'): Validator {
  return (v) => (v.length > n ? `${label} must be ≤ ${n} characters` : null);
}

export function isHex(label = 'Value', length?: number): Validator {
  return (v) => {
    const s = v.trim().toLowerCase();
    if (!/^[0-9a-f]*$/.test(s)) return `${label} must be hexadecimal`;
    if (length !== undefined && s.length !== length) return `${label} must be ${length} hex chars`;
    return null;
  };
}

// Canonical RFC-4122 UUID (8-4-4-4-12 hex), case-insensitive. Mirrors the
// backend guard so the form can reject a malformed App ID before any request.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function isUuid(label = 'Value'): Validator {
  return (v) => (UUID_RE.test(v.trim()) ? null : `${label} must be a valid UUID (e.g. 123e4567-e89b-12d3-a456-426614174000)`);
}

export function inRange(min: number, max: number, label = 'Value'): Validator {
  return (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return `${label} must be a number`;
    if (n < min || n > max) return `${label} must be between ${min} and ${max}`;
    return null;
  };
}

export function positiveNumber(label = 'Amount'): Validator {
  return (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return `${label} must be a number`;
    if (n <= 0) return `${label} must be greater than 0`;
    return null;
  };
}

/** Run a list of validators; return the first error or null. */
export function validate(value: string, validators: Validator[]): string | null {
  for (const fn of validators) {
    const err = fn(value);
    if (err) return err;
  }
  return null;
}
