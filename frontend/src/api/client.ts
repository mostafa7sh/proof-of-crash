import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { tokenStore, emitAuthExpired } from './tokenStore';
import type { ApiError } from '../types';

// Create an axios client with the base URL and default headers for JSON requests.
export const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Attach the access token to every request.
client.interceptors.request.use((config) => {
  const token = tokenStore.getAccess();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 Unauthorized responses by attempting to refresh the access token.
let refreshing: Promise<boolean> | null = null;

// Try to refresh the access token using the refresh token. Returns true if successful, false otherwise.
async function tryRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;
  try {
    // Bare axios (no interceptors) to avoid recursion.
    const res = await axios.post(
      `${import.meta.env.VITE_API_URL ?? ''}/api/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { 'Content-Type': 'application/json' }, withCredentials: true },
    );
    tokenStore.set(res.data.token, res.data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// Intercept responses to handle 401 errors and attempt token refresh if needed.
client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';

    const isAuthCall = url.includes('/api/auth/refresh') || url.includes('/api/auth/login') || url.includes('/api/auth/register');

    if (status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      refreshing = refreshing ?? tryRefresh();
      const ok = await refreshing;
      refreshing = null;
      if (ok) return client(original);
      tokenStore.clear();
      emitAuthExpired();
    }
    return Promise.reject(error);
  },
);

// Extract a user-friendly error message from an unknown error object, prioritizing API error messages.
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiError | undefined;
    if (data?.error) return data.error;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
