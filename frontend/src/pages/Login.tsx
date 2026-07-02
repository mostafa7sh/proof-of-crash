import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, KeyRound, Fingerprint, CheckCircle, Terminal, ShieldAlert, Cpu } from 'lucide-react';
import { useAuth, errorMessage, type CeremonyStep } from '../context/AuthContext';
import { authApi } from '../api';
import { deriveAddress } from '../utils/wallet';
import { solveAuthPow } from '../utils/pow';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input, TextArea } from '../components/Input';
import { Hash } from '../components/Hash';
import { Spinner } from '../components/states';
import { BrandShield } from '../components/BrandShield';
import { isHex, validate } from '../utils/validation';
import type { Wallet } from '../types';

type Mode = 'passkey' | 'key';

// The Ed25519 challenge–response ceremony, in order, for the step indicator.
const CEREMONY: Array<{ step: CeremonyStep; label: string }> = [
  { step: 'challenge', label: 'Request a challenge + solve anti-spam proof-of-work' },
  { step: 'sign', label: 'Sign the challenge locally with your private key' },
  { step: 'verify', label: 'Server verifies the signature against your public key' },
];

/**
 * Two clearly separated authentication modes:
 *   • Passkey (WebAuthn)        — phishing-resistant session login.
 *   • Cryptographic key (Ed25519) — explicit Register, then challenge-response
 *     Login (auto-signed or cold/offline manual paste). No implicit account
 *     creation: an unregistered key cannot log in.
 */
export function Login() {
  const { wallet, createWallet, importWallet, forgetWallet, register, advancedLogin, manualLogin, passkeyLogin, registerPasskeyAccount, passkeysSupported } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('passkey');
  const [busy, setBusy] = useState<'register' | 'login' | 'passkey' | 'manual' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [importErr, setImportErr] = useState<string | null>(null);
  const [step, setStep] = useState<CeremonyStep | null>(null);
  // Whether the private key is shown for backup. Auto-revealed right after
  // generating a fresh keypair (the server never stores it, so this is the
  // user's one chance to save it); hidden by default for an existing key.
  const [revealKey, setRevealKey] = useState(false);

  // Passkey (webauthn.io-style) onboarding state.
  const [pkUsername, setPkUsername] = useState('');
  const [pkResult, setPkResult] = useState<{ wallet: Wallet } | null>(null);
  const [pkRevealKey, setPkRevealKey] = useState(false);

  // Manual (offline) Ed25519 panel state.
  const [manualOpen, setManualOpen] = useState(false);
  const [mPub, setMPub] = useState('');
  const [mAddr, setMAddr] = useState('');
  const [mChallenge, setMChallenge] = useState('');
  const [mPow, setMPow] = useState('');
  const [mSig, setMSig] = useState('');
  const [mErr, setMErr] = useState<string | null>(null);
  const [mWorking, setMWorking] = useState(false);

  const done = () => navigate('/dashboard');

  const onImport = () => {
    const err = validate(importKey, [isHex('Private key', 64)]);
    setImportErr(err);
    if (err) return;
    try {
      importWallet(importKey);
      setImportMode(false);
      setImportKey('');
      setError(null);
      setRevealKey(false); // an imported key is already backed up by the user
    } catch (e) {
      setImportErr(errorMessage(e));
    }
  };

  const run = async (kind: 'register' | 'login' | 'passkey', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    if (kind === 'login') setStep('challenge');
    try {
      await fn();
      done();
    } catch (e) {
      setError(errorMessage(e));
      setStep(null);
    } finally {
      setBusy(null);
    }
  };

  // Passkey "Register" (webauthn.io-style): provision the account's Ed25519 key,
  // register the account, and attach a passkey — then reveal the private key so
  // the user can back it up before continuing (the server never stores it).
  const doPasskeyRegister = async () => {
    setBusy('register');
    setError(null);
    try {
      const res = await registerPasskeyAccount(pkUsername.trim() || undefined);
      setPkResult(res);
      setPkRevealKey(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // Manual: derive the address from the pasted key, fetch a challenge, solve the
  // PoW, and show the exact message the user must sign offline.
  const mRequestChallenge = async () => {
    setMErr(null);
    const err = validate(mPub, [isHex('Public key', 64)]);
    if (err) { setMErr(err); return; }
    setMWorking(true);
    try {
      const address = deriveAddress(mPub.trim().toLowerCase());
      const { challenge, pow_difficulty } = await authApi.challenge(address);
      const nonce = solveAuthPow(challenge, pow_difficulty);
      setMAddr(address);
      setMChallenge(challenge);
      setMPow(nonce);
      setMSig('');
    } catch (e) {
      setMErr(errorMessage(e));
    } finally {
      setMWorking(false);
    }
  };

  const mSubmit = async () => {
    const err = validate(mSig, [isHex('Signature', 128)]);
    if (err) { setMErr(err); return; }
    setBusy('manual');
    setMErr(null);
    try {
      await manualLogin(mAddr, mChallenge, mSig, mPow);
      done();
    } catch (e) {
      setMErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const stepIndex = step === null ? -1 : step === 'done' ? CEREMONY.length : CEREMONY.findIndex((c) => c.step === step);
  const manualMessage = mChallenge ? `poc-login-v1:${mChallenge}:${mAddr}` : '';

  return (
    <div className="auth-shell">
      <div className="hero-grid" />
      <div className="auth-card stack" style={{ position: 'relative', zIndex: 1 }}>
        <Link to="/" className="auth-brand" style={{ textDecoration: 'none' }}>
          <span className="brand-mark"><BrandShield /></span>
          <div className="center">
            <h1 className="brand-word" style={{ fontSize: 24 }}>Proof<b style={{ color: 'var(--cyan-400)' }}>Of</b>Crash</h1>
            <p className="muted text-sm">Decentralized bug-validation platform</p>
          </div>
        </Link>

        {/* Mode switch — the two methods are explicitly separated. */}
        <div className="tabs">
          <button className={`tab ${mode === 'passkey' ? 'active' : ''}`} onClick={() => setMode('passkey')}>
            <Fingerprint style={{ width: 15, height: 15 }} /> Passkey
          </button>
          <button className={`tab ${mode === 'key' ? 'active' : ''}`} onClick={() => setMode('key')}>
            <KeyRound style={{ width: 15, height: 15 }} /> Cryptographic Key
          </button>
        </div>

        <Card>
          {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

          {mode === 'passkey' ? (
            // ── A. Passkey (WebAuthn) — webauthn.io-style Register / Authenticate ──
            <div className="stack">
              <div className="stack-sm">
                <h2 className="row gap-sm"><Fingerprint style={{ width: 20, height: 20, color: 'var(--cyan-400)' }} /> Passkey</h2>
                <p className="muted text-sm">
                  Register a passkey, then authenticate with your device's biometrics or security key
                  (WebAuthn) — phishing-resistant and syncable across your devices.
                </p>
              </div>

              {!passkeysSupported ? (
                <div className="alert alert-warn">This browser doesn't support passkeys. Use the Cryptographic Key tab.</div>
              ) : pkResult ? (
                // Post-register: confirm + reveal the Ed25519 key to back up, then continue.
                <div className="stack-sm">
                  <div className="alert alert-success">
                    Success! Your passkey and account are registered. Next time, just Authenticate.
                  </div>
                  <div className="alert alert-warn" style={{ display: 'flex', gap: 10 }}>
                    <ShieldAlert style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} />
                    <span className="text-xs">
                      <strong>Save your Ed25519 private key.</strong> Your passkey signs you in, but on-chain actions
                      (votes, proofs, transfers) use this key. The server never stores it — this is the only copy.
                    </span>
                  </div>
                  <p className="muted text-xs mono" style={{ marginBottom: 0 }}>Public key</p>
                  <Hash value={pkResult.wallet.publicKey} full copyable />
                  {pkRevealKey ? (
                    <>
                      <p className="muted text-xs mono" style={{ marginBottom: 0 }}>Private key — copy &amp; store safely</p>
                      <Hash value={pkResult.wallet.privateKey} full copyable />
                    </>
                  ) : (
                    <div><Button variant="secondary" size="sm" onClick={() => setPkRevealKey(true)}><KeyRound /> Reveal private key</Button></div>
                  )}
                  <Button block onClick={done}><CheckCircle /> I've saved my key — Continue</Button>
                </div>
              ) : (
                <div className="stack-sm">
                  <Input label="Username" value={pkUsername} onChange={(e) => setPkUsername(e.target.value)} placeholder="example_username" />
                  <div className="row gap-sm">
                    <Button block loading={busy === 'register'} disabled={busy !== null} onClick={doPasskeyRegister}>
                      <Fingerprint /> Register
                    </Button>
                    <Button block variant="secondary" loading={busy === 'passkey'} disabled={busy !== null} onClick={() => run('passkey', passkeyLogin)}>
                      <Fingerprint /> Authenticate
                    </Button>
                  </div>
                  <p className="field-hint" style={{ marginBottom: 0 }}>
                    <strong>Register</strong> creates a new account — a passkey for one-tap login plus an Ed25519
                    signing key you'll back up next. Already have a passkey? Just <strong>Authenticate</strong>.
                  </p>
                </div>
              )}
            </div>
          ) : (
            // ── B. Cryptographic key (Ed25519) ──────────────────────────────
            <div className="stack">
              <div className="stack-sm">
                <h2 className="row gap-sm"><KeyRound style={{ width: 20, height: 20, color: 'var(--cyan-400)' }} /> Cryptographic Key (Ed25519)</h2>
                <p className="muted text-sm">
                  Your on-chain identity. <strong>Register once</strong>, then log in by signing a
                  challenge. There is no implicit account creation — an unregistered key cannot log in.
                </p>
              </div>

              {!wallet ? (
                !importMode ? (
                  <div className="stack-sm">
                    <Button block onClick={() => { setError(null); createWallet(); setRevealKey(true); }}><Shield /> Generate New Keypair</Button>
                    <Button variant="secondary" block onClick={() => setImportMode(true)}><KeyRound /> Import Private Key</Button>
                    <p className="field-hint" style={{ marginBottom: 0 }}>
                      We'll generate an Ed25519 keypair in your browser. The server only ever stores your
                      public key — you must save the private key yourself.
                    </p>
                  </div>
                ) : (
                  <div className="stack-sm">
                    <Input label="Private key (64 hex chars)" value={importKey} onChange={(e) => setImportKey(e.target.value)} placeholder="abcd1234…" error={importErr} autoFocus />
                    <div className="row gap-sm">
                      <Button onClick={onImport}>Import</Button>
                      <Button variant="ghost" onClick={() => setImportMode(false)}>Cancel</Button>
                    </div>
                  </div>
                )
              ) : (
                <div className="stack">
                  <div className="stack-sm">
                    <div className="row-between">
                      <span className="card-title" style={{ margin: 0 }}>Your keypair</span>
                      <Button variant="ghost" size="sm" onClick={() => { forgetWallet(); setRevealKey(false); }}>Switch key</Button>
                    </div>

                    <p className="muted text-xs mono" style={{ marginBottom: 0 }}>Public key — registered on-chain (safe to share)</p>
                    <Hash value={wallet.publicKey} full copyable />

                    <p className="muted text-xs mono" style={{ marginBottom: 0 }}>Address — SHA-256(public key)</p>
                    <Hash value={wallet.address} full copyable />

                    {/* Non-custodial backup: the server NEVER receives or stores the
                        private key, so the user must save it themselves. */}
                    <div className="alert alert-warn" style={{ display: 'flex', gap: 10 }}>
                      <ShieldAlert style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} />
                      <span className="text-xs">
                        <strong>Save your private key now.</strong> Proof of Crash never stores private keys — the copy
                        below is the only one. Anyone with it controls your account, and if you lose it the account is
                        unrecoverable. Store it somewhere safe before you register.
                      </span>
                    </div>
                    {revealKey ? (
                      <div className="stack-sm">
                        <p className="muted text-xs mono" style={{ marginBottom: 0 }}>Private key — copy &amp; store, then hide</p>
                        <Hash value={wallet.privateKey} full copyable />
                        <div><Button variant="ghost" size="sm" onClick={() => setRevealKey(false)}>Hide private key</Button></div>
                      </div>
                    ) : (
                      <div><Button variant="secondary" size="sm" onClick={() => setRevealKey(true)}><KeyRound /> Reveal private key to back up</Button></div>
                    )}
                  </div>

                  {/* Explicit two-step: register first, then login. */}
                  <div className="stack-sm">
                    <p className="field-hint" style={{ marginBottom: 0 }}>Step 1 — first time on this key</p>
                    <Button variant="secondary" block loading={busy === 'register'} disabled={busy !== null} onClick={() => run('register', register)}>
                      <Shield /> Register Account
                    </Button>
                    <p className="field-hint" style={{ marginBottom: 0, marginTop: 6 }}>Step 2 — returning</p>
                    <Button block loading={busy === 'login'} disabled={busy !== null} onClick={() => run('login', () => advancedLogin(setStep))}>
                      <Fingerprint /> Sign In
                    </Button>
                  </div>

                  {step !== null && (
                    <ol className="ceremony">
                      {CEREMONY.map((c, i) => {
                        const state = stepIndex > i ? 'done' : stepIndex === i ? 'active' : 'pending';
                        return (
                          <li key={c.step} className={`ceremony-row ${state}`}>
                            <span className="ceremony-icon">
                              {state === 'done' ? <CheckCircle /> : state === 'active' ? <Spinner size={16} /> : <span className="ceremony-dot" />}
                            </span>
                            <span>{c.label}</span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              )}

              {/* Manual / offline signing */}
              <div className="divider"><span>or sign offline</span></div>
              <button className="row gap-sm cyan text-sm mono" onClick={() => setManualOpen((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: 'fit-content' }}>
                <Terminal style={{ width: 15, height: 15 }} /> {manualOpen ? 'Hide manual login' : 'Manual login (paste public key + signature)'}
              </button>
              {manualOpen && (
                <div className="stack-sm">
                  {mErr && <div className="alert alert-danger">{mErr}</div>}
                  <TextArea label="Public key (64 hex chars)" value={mPub} onChange={(e) => setMPub(e.target.value)} rows={2} placeholder="your Ed25519 public key…" />
                  <div><Button variant="secondary" size="sm" loading={mWorking} disabled={busy !== null} onClick={mRequestChallenge}>Request challenge</Button></div>
                  {mChallenge && (
                    <>
                      <p className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Cpu style={{ width: 13, height: 13 }} /> Proof-of-work solved (nonce {mPow}).</p>
                      <div>
                        <p className="muted text-xs mono" style={{ marginBottom: 6 }}>Sign this exact message with your private key (offline / CLI):</p>
                        <div className="code-block">{manualMessage}</div>
                      </div>
                      <TextArea label="Signature (128 hex chars)" value={mSig} onChange={(e) => setMSig(e.target.value)} rows={2} placeholder="ed25519 signature…" />
                      <div><Button loading={busy === 'manual'} disabled={busy !== null} onClick={mSubmit}>Sign In</Button></div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="alert alert-warn" style={{ display: 'flex', gap: 10 }}>
          <ShieldAlert style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} />
          <span className="text-xs">
            <strong>Non-custodial:</strong> there is no password reset. Back up your private key and add
            a second key or a synced passkey — if you lose every key, the account is unrecoverable.
          </span>
        </div>

        <p className="center faint text-xs">
          Your private key is never saved — not on the server, not in this browser. It's held in memory
          for this session only. Demo wallet: do not use real funds.
        </p>
      </div>
    </div>
  );
}
