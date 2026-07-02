import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import type { Wallet } from '../types';

// @noble/ed25519 v2 needs a sha512 implementation wired in for sync signing.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/** Derive the platform address from a public key: hex(SHA256(publicKeyBytes)). */
export function deriveAddress(publicKeyHex: string): string {
  return bytesToHex(sha256(hexToBytes(publicKeyHex)));
}

/** Generate a fresh Ed25519 keypair + derived address. */
export function generateWallet(): Wallet {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  const publicKey = bytesToHex(pub);
  return {
    privateKey: bytesToHex(priv),
    publicKey,
    address: deriveAddress(publicKey),
  };
}

/** Reconstruct a wallet from an imported 64-hex-char private key. */
export function walletFromPrivateKey(privateKeyHex: string): Wallet {
  const priv = hexToBytes(privateKeyHex);
  if (priv.length !== 32) throw new Error('Private key must be 32 bytes (64 hex chars)');
  const pub = ed.getPublicKey(priv);
  const publicKey = bytesToHex(pub);
  return { privateKey: privateKeyHex, publicKey, address: deriveAddress(publicKey) };
}

// Domain-separated messages must match the backend (auth/messages.ts).
function registerMessage(challenge: string, address: string, publicKey: string): string {
  return ['poc-register-v1', challenge, address, publicKey].join(':');
}
function loginMessage(challenge: string, address: string): string {
  return ['poc-login-v1', challenge, address].join(':');
}
// An existing account key authorizes attaching a specific new address.
function attachMessage(challenge: string, primaryAddress: string, newAddress: string): string {
  return ['poc-attach-v1', challenge, primaryAddress, newAddress].join(':');
}

/** Sign a UTF-8 message string with the wallet's key, returning a hex signature. */
function signMessage(message: string, privateKeyHex: string): string {
  return bytesToHex(ed.sign(utf8ToBytes(message), hexToBytes(privateKeyHex)));
}

export function signRegister(w: Wallet, challenge: string): string {
  return signMessage(registerMessage(challenge, w.address, w.publicKey), w.privateKey);
}

export function signLogin(w: Wallet, challenge: string): string {
  return signMessage(loginMessage(challenge, w.address), w.privateKey);
}

/** The new key proves possession (same message shape as registration). */
export function signAttachNewKey(newWallet: Wallet, challenge: string): string {
  return signMessage(registerMessage(challenge, newWallet.address, newWallet.publicKey), newWallet.privateKey);
}

/** An existing account key authorizes attaching `newAddress` to `primaryAddress`. */
export function signAttachAuthorize(existing: Wallet, challenge: string, primaryAddress: string, newAddress: string): string {
  return signMessage(attachMessage(challenge, primaryAddress, newAddress), existing.privateKey);
}

/** Sign raw bytes (e.g. a 32-byte transaction id), returning a hex signature. */
export function signBytes(bytesHex: string, privateKeyHex: string): string {
  return bytesToHex(ed.sign(hexToBytes(bytesHex), hexToBytes(privateKeyHex)));
}
