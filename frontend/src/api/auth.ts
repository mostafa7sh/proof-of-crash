import { client } from './client';
import type { AuthSession, AuthUser, ChallengeResponse } from '../types';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

// getting authentication data from the backend API
export const authApi = {
  // request a challenge for the given address, returning the challenge string and its expiration time
  challenge(address: string) {
    return client
      .post<ChallengeResponse>('/api/auth/challenge', { address })
      .then((r) => r.data);
  },

  // register a new user with the provided public key, address, challenge, signature, and proof-of-work nonce
  register(body: { public_key: string; address: string; challenge: string; signature: string; pow_nonce: string }) {
    return client.post<AuthSession>('/api/auth/register', body).then((r) => r.data);
  },

  // log in an existing user with the provided address, challenge, signature, and proof-of-work nonce
  login(body: { address: string; challenge: string; signature: string; pow_nonce: string }) {
    return client.post<AuthSession>('/api/auth/login', body).then((r) => r.data);
  },

  // retrieve the current authenticated user's information, returning the user object
  me() {
    return client.get<AuthUser>('/api/auth/me').then((r) => r.data);
  },

  // attach a new address to the current authenticated user's account
  attachAddress(body: {
    public_key: string;
    address: string;
    challenge: string;
    signature: string;          // new key proves possession
    existing_signature: string; // an existing account key authorizes this address
  }) {
    return client.post('/api/auth/addresses', body).then((r) => r.data);
  },

  // revoke the current session or all sessions for the authenticated user
  revoke(scope: 'current' | 'all' = 'current') {
    return client.post('/api/auth/revoke', { scope }).then((r) => r.data);
  },

  // WebAuthn / passkeys — session-only login. Registration is authenticated
  // (add a passkey to the current account); authentication is public.
  webauthn: {
    // initiate a WebAuthn registration flow, returning the flow ID and registration options.
    // An optional username becomes the credential's display name in the authenticator prompt.
    registerOptions(username?: string) {
      return client
        .post<{ flow_id: string; options: PublicKeyCredentialCreationOptionsJSON }>(
          '/api/auth/webauthn/register/options',
          username ? { username } : {},
        )
        .then((r) => r.data);
    },
    // verify the WebAuthn registration response, returning the flow ID and registration result
    registerVerify(body: { flow_id: string; response: RegistrationResponseJSON; label?: string }) {
      return client.post('/api/auth/webauthn/register/verify', body).then((r) => r.data);
    },
    // initiate a WebAuthn authentication flow, returning the flow ID and authentication options
    authOptions() {
      return client
        .post<{ flow_id: string; options: PublicKeyCredentialRequestOptionsJSON }>('/api/auth/webauthn/authenticate/options')
        .then((r) => r.data);
    },
    // verify the WebAuthn authentication response, returning the authenticated session
    authVerify(body: { flow_id: string; response: AuthenticationResponseJSON }) {
      return client.post<AuthSession>('/api/auth/webauthn/authenticate/verify', body).then((r) => r.data);
    },
  },
};
