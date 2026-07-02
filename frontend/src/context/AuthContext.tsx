import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { authApi, errorMessage } from '../api';
import { tokenStore, AUTH_EXPIRED_EVENT } from '../api/tokenStore';
import { generateWallet, walletFromPrivateKey, signRegister, signLogin } from '../utils/wallet';
import { solveAuthPow } from '../utils/pow';
import type { AuthSession, AuthUser, Wallet } from '../types';

const WALLET_KEY = 'poc_wallet';

interface AuthContextValue {
  wallet: Wallet | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  initializing: boolean;
  createWallet: () => Wallet;
  importWallet: (privateKeyHex: string) => Wallet;
  forgetWallet: () => void;
  register: () => Promise<void>;
  login: () => Promise<void>;
  advancedLogin: (onStep?: (step: CeremonyStep) => void) => Promise<void>;
  manualLogin: (address: string, challenge: string, signature: string, powNonce: string) => Promise<void>;
  passkeyLogin: () => Promise<void>;
  registerPasskey: (label?: string) => Promise<void>;
  registerPasskeyAccount: (username?: string) => Promise<{ wallet: Wallet }>;
  passkeysSupported: boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Phases of the WebAuthn/passkey-style challenge–response ceremony, surfaced to
// the UI so the user can see each step happen.
export type CeremonyStep = 'challenge' | 'sign' | 'verify' | 'done';

const AuthContext = createContext<AuthContextValue | null>(null);

// Non-custodial: the private key is NEVER written to storage. Any wallet saved
// by an older build is migrated into memory for this session only, then wiped
// from localStorage so the secret is never persisted again.
function loadLegacyWalletOnce(): Wallet | null {
  const raw = localStorage.getItem(WALLET_KEY);
  if (raw) localStorage.removeItem(WALLET_KEY);
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as Wallet;
    return w?.privateKey ? w : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // The signing wallet lives in memory ONLY. The session token (tokenStore) is
  // what survives a reload; after a reload the user re-loads their key to sign.
  const [wallet, setWallet] = useState<Wallet | null>(loadLegacyWalletOnce);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const applySession = useCallback((s: AuthSession) => {
    tokenStore.set(s.token, s.refresh_token);
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await authApi.me();
    setUser(me);
  }, []);

  const createWallet = useCallback(() => {
    const w = generateWallet();
    setWallet(w);   // memory only — never persisted
    return w;
  }, []);

  const importWallet = useCallback((privateKeyHex: string) => {
    const w = walletFromPrivateKey(privateKeyHex.trim().toLowerCase());
    setWallet(w);   // memory only — never persisted
    return w;
  }, []);

  const register = useCallback(async () => {
    if (!wallet) throw new Error('No wallet');
    const { challenge, pow_difficulty } = await authApi.challenge(wallet.address);
    const pow_nonce = solveAuthPow(challenge, pow_difficulty);
    const signature = signRegister(wallet, challenge);
    const session = await authApi.register({
      public_key: wallet.publicKey,
      address: wallet.address,
      challenge,
      signature,
      pow_nonce,
    });
    applySession(session);
    await refreshUser();
  }, [wallet, applySession, refreshUser]);

  const login = useCallback(async () => {
    if (!wallet) throw new Error('No wallet');
    const { challenge, pow_difficulty } = await authApi.challenge(wallet.address);
    const pow_nonce = solveAuthPow(challenge, pow_difficulty);
    const signature = signLogin(wallet, challenge);
    const session = await authApi.login({ address: wallet.address, challenge, signature, pow_nonce });
    applySession(session);
    await refreshUser();
  }, [wallet, applySession, refreshUser]);

  // Passkey-style ceremony with visible progress: request a server nonce, solve
  // the anti-spam proof-of-work, sign it locally with the Ed25519 key, then
  // submit for server-side verification. Same crypto as login(), step-instrumented.
  const advancedLogin = useCallback(async (onStep?: (step: CeremonyStep) => void) => {
    if (!wallet) throw new Error('No wallet');
    onStep?.('challenge');
    const { challenge, pow_difficulty } = await authApi.challenge(wallet.address);
    const pow_nonce = solveAuthPow(challenge, pow_difficulty);
    onStep?.('sign');
    const signature = signLogin(wallet, challenge);
    onStep?.('verify');
    const session = await authApi.login({ address: wallet.address, challenge, signature, pow_nonce });
    applySession(session);
    await refreshUser();
    onStep?.('done');
  }, [wallet, applySession, refreshUser]);

  // Manual "Advanced" login: the user supplies a pre-computed signature over the
  // login message (cold/offline signing) — no private key touches the browser.
  // The browser still solves the PoW (a computation, not a secret).
  const manualLogin = useCallback(async (address: string, challenge: string, signature: string, powNonce: string) => {
    const session = await authApi.login({
      address: address.trim().toLowerCase(),
      challenge: challenge.trim().toLowerCase(),
      signature: signature.trim().toLowerCase(),
      pow_nonce: powNonce,
    });
    applySession(session);
    await refreshUser();
  }, [applySession, refreshUser]);

  // Passkey (WebAuthn) login — session only, phishing-resistant. No wallet needed
  // to sign in; an Ed25519 key is still required to act on-chain afterwards.
  const passkeyLogin = useCallback(async () => {
    const { flow_id, options } = await authApi.webauthn.authOptions();
    const response = await startAuthentication(options);
    const session = await authApi.webauthn.authVerify({ flow_id, response });
    applySession(session);
    await refreshUser();
  }, [applySession, refreshUser]);

  // Add a passkey to the CURRENT account (authenticated).
  const registerPasskey = useCallback(async (label?: string) => {
    const { flow_id, options } = await authApi.webauthn.registerOptions();
    const response = await startRegistration(options);
    await authApi.webauthn.registerVerify({ flow_id, response, ...(label ? { label } : {}) });
  }, []);

  // webauthn.io-style passkey onboarding for a NEW account. Because a passkey
  // cannot sign on-chain, this also provisions the account's Ed25519 key so the
  // account can vote/submit/transfer. Steps:
  //   1. generate an Ed25519 keypair in the browser (the on-chain signing key),
  //   2. register the account with it (challenge-response + PoW — the server
  //      only ever receives the PUBLIC key), which returns a session,
  //   3. attach a passkey to that account for one-tap future logins.
  // The passkey is REQUIRED to complete registration: if the ceremony is
  // cancelled or fails, the whole thing is rolled back (session dropped, key
  // forgotten) so the user is NOT left logged in. Returns the in-memory wallet
  // so the UI can prompt the user to back up the private key (never stored).
  const registerPasskeyAccount = useCallback(async (username?: string) => {
    const w = generateWallet();
    const { challenge, pow_difficulty } = await authApi.challenge(w.address);
    const pow_nonce = solveAuthPow(challenge, pow_difficulty);
    const signature = signRegister(w, challenge);
    const session = await authApi.register({
      public_key: w.publicKey,
      address: w.address,
      challenge,
      signature,
      pow_nonce,
    });
    // Authenticate transiently so the passkey attach (requireAuth) can run, but
    // don't surface a logged-in wallet until the passkey actually succeeds.
    applySession(session);

    try {
      const { flow_id, options } = await authApi.webauthn.registerOptions(username);
      const response = await startRegistration(options);
      await authApi.webauthn.registerVerify({ flow_id, response, ...(username ? { label: username } : {}) });
    } catch (e) {
      // Passkey cancelled/failed → abort the registration: drop the session and
      // the key so the user is not logged in. (Nothing secret was persisted.)
      tokenStore.clear();
      setUser(null);
      setWallet(null);
      throw new Error(
        e instanceof Error && /already|exists/i.test(e.message)
          ? e.message
          : 'Passkey registration was cancelled — you are not signed in. Please try again.',
      );
    }

    setWallet(w);   // memory only — never persisted
    await refreshUser();
    return { wallet: w };
  }, [applySession, refreshUser]);

  const logout = useCallback(async () => {
    try {
      await authApi.revoke('current');
    } catch {
      // best effort — clear locally regardless
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const forgetWallet = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setWallet(null);
  }, []);

  // On mount: if we have a session token, hydrate the user.
  useEffect(() => {
    let active = true;
    (async () => {
      if (tokenStore.getAccess() || tokenStore.getRefresh()) {
        try {
          const me = await authApi.me();
          if (active) setUser(me);
        } catch {
          tokenStore.clear();
        }
      }
      if (active) setInitializing(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Forced logout when a token refresh fails anywhere in the app.
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      wallet,
      user,
      isAuthenticated: !!user,
      initializing,
      createWallet,
      importWallet,
      forgetWallet,
      register,
      login,
      advancedLogin,
      manualLogin,
      passkeyLogin,
      registerPasskey,
      registerPasskeyAccount,
      passkeysSupported: browserSupportsWebAuthn(),
      logout,
      refreshUser,
    }),
    [wallet, user, initializing, createWallet, importWallet, forgetWallet, register, login, advancedLogin, manualLogin, passkeyLogin, registerPasskey, registerPasskeyAccount, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { errorMessage };
