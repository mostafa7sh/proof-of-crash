// store access and refresh tokens in localStorage for authentication

const ACCESS_KEY = 'poc_access_token';
const REFRESH_KEY = 'poc_refresh_token';

let access: string | null = localStorage.getItem(ACCESS_KEY);
let refresh: string | null = localStorage.getItem(REFRESH_KEY);

// tokenStore provides methods to get, set, and clear access and refresh tokens
export const tokenStore = {
  getAccess: () => access,
  getRefresh: () => refresh,
  set(accessToken: string, refreshToken: string) {
    access = accessToken;
    refresh = refreshToken;
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    access = null;
    refresh = null;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// Broadcast forced logout (e.g. refresh failed) so the app can redirect.
export const AUTH_EXPIRED_EVENT = 'poc:auth-expired';
export function emitAuthExpired() {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}
