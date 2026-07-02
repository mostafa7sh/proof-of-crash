import { useState } from 'react';
import { Coins, Send, Wallet as WalletIcon, Layers, Fingerprint, CheckCircle, KeyRound } from 'lucide-react';
import { useAuth, errorMessage } from '../context/AuthContext';
import { useBalance, useUtxos } from '../hooks/useData';
import { ledgerApi } from '../api';
import { Card, StatCard } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Hash } from '../components/Hash';
import { Loading, ErrorState, EmptyState } from '../components/states';
import { buildSignedTransfer } from '../utils/transaction';
import { formatAmount } from '../utils/format';
import { isHex, positiveNumber, validate } from '../utils/validation';

export function Wallet() {
  const { wallet, user, registerPasskey, refreshUser, passkeysSupported } = useAuth();
  const address = user?.address ?? wallet?.address ?? null;
  const balance = useBalance(address);
  const utxos = useUtxos(address);

  const hasPasskey = (user?.passkey_count ?? 0) > 0;
  const [pkBusy, setPkBusy] = useState(false);
  const [pkMsg, setPkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const addPasskey = async () => {
    setPkBusy(true);
    setPkMsg(null);
    try {
      await registerPasskey('My device');
      await refreshUser();   // update passkey_count so the card reflects it
      setPkMsg({ ok: true, text: 'Passkey registered — you can now use Easy Login on this device.' });
    } catch (e) {
      setPkMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setPkBusy(false);
    }
  };

  const [sendOpen, setSendOpen] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [errs, setErrs] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTx, setSentTx] = useState<string | null>(null);

  const send = async () => {
    if (!address) return;
    if (!wallet?.privateKey) {
      setSendError('Your signing key isn’t loaded this session. Load it below to sign the transfer.');
      return;
    }
    const e = {
      to: validate(to, [isHex('Recipient address', 64)]),
      amount: validate(amount, [positiveNumber('Amount')]),
    };
    setErrs(e);
    if (Object.values(e).some(Boolean)) return;

    setBusy(true);
    setSendError(null);
    try {
      const available = utxos.data?.utxos ?? [];
      const built = buildSignedTransfer({
        utxos: available,
        fromAddress: address,
        toAddress: to.trim().toLowerCase(),
        amount: Number(amount),
        privateKeyHex: wallet.privateKey,
      });
      const res = await ledgerApi.transfer({ inputs: built.inputs, outputs: built.outputs });
      setSentTx(res.tx_id);
      setSendOpen(false);
      setTo('');
      setAmount('');
      balance.reload();
      utxos.reload();
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const utxoCount = utxos.data?.utxos.length ?? 0;

  return (
    <div className="page stack gap-lg">
      <div className="page-header">
        <h1>Wallet</h1>
        <p className="muted">Your PoC token balance and unspent outputs.</p>
      </div>

      {sentTx && (
        <div className="alert alert-info">
          Transfer submitted to the mempool — tx <Hash value={sentTx} copyable /> will be included in the next block.
        </div>
      )}

      <div className="grid grid-3">
        <StatCard
          icon={<Coins />}
          accent="emerald"
          label="Balance"
          value={balance.loading ? '…' : formatAmount(balance.data?.balance ?? 0)}
          sub="POC"
        />
        <StatCard icon={<Layers />} accent="cyan" label="Unspent Outputs" value={utxos.loading ? '…' : utxoCount} sub="UTXOs" />
        <div className="card stat">
          <span className="stat-icon accent-purple"><WalletIcon /></span>
          <div className="stat-label">Receive Address</div>
          <div style={{ marginTop: 8 }}><Hash value={address} head={12} tail={8} /></div>
          <div className="stat-sub">Share to receive PoC</div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {!wallet?.privateKey && (balance.data?.balance ?? 0) > 0 && (
          <span className="faint text-xs">Load your signing key below to send</span>
        )}
        <Button disabled={!wallet?.privateKey || !balance.data || (balance.data.balance ?? 0) <= 0} onClick={() => setSendOpen(true)}>
          <Send /> Send PoC
        </Button>
      </div>

      <SigningKeyCard expectedAddress={address} />

      {passkeysSupported && (
        <Card title={<span className="row gap-sm"><Fingerprint style={{ width: 18, height: 18, color: 'var(--cyan-400)' }} /> Passkeys</span>}>
          <div className="stack-sm">
            {hasPasskey ? (
              <>
                <div className="row gap-sm emerald text-sm">
                  <CheckCircle style={{ width: 16, height: 16 }} />
                  A passkey is registered on your account — use Passkey login to sign in.
                </div>
                <p className="muted text-sm">
                  Passkeys sign you in only — your Ed25519 key still signs on-chain actions.
                </p>
              </>
            ) : (
              <>
                <p className="muted text-sm">
                  Register a passkey to enable phishing-resistant <strong>Easy Login</strong> on this device.
                  A passkey signs you in only — your Ed25519 wallet key still signs on-chain actions.
                </p>
                {pkMsg && <div className={`alert ${pkMsg.ok ? 'alert-success' : 'alert-danger'}`}>{pkMsg.text}</div>}
                <div>
                  <Button variant="secondary" loading={pkBusy} onClick={addPasskey}>
                    {pkMsg?.ok ? <CheckCircle /> : <Fingerprint />} Register a Passkey
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      <Card title="Unspent Outputs (UTXOs)" noPad>
        {utxos.loading ? (
          <div style={{ padding: 24 }}><Loading /></div>
        ) : utxos.error ? (
          <div style={{ padding: 24 }}><ErrorState message={utxos.error} onRetry={utxos.reload} /></div>
        ) : utxos.data && utxos.data.utxos.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Source Tx</th><th>Output #</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {utxos.data.utxos.map((u) => (
                  <tr key={`${u.tx_id}:${u.output_index}`}>
                    <td><Hash value={u.tx_id} copyable={false} /></td>
                    <td className="mono">{u.output_index}</td>
                    <td className="right emerald mono">{formatAmount(u.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            <EmptyState>No unspent outputs yet. Earn PoC by finding or verifying bugs.</EmptyState>
          </div>
        )}
      </Card>

      <Modal
        open={sendOpen}
        title="Send PoC"
        onClose={() => setSendOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={send}><Send /> Send</Button>
          </>
        }
      >
        <div className="stack">
          {sendError && <div className="alert alert-danger">{sendError}</div>}
          <Input label="Recipient address (64 hex chars)" value={to} onChange={(e) => setTo(e.target.value)} error={errs['to']} placeholder="recipient address" />
          <Input label="Amount (PoC)" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} error={errs['amount']} />
          <p className="field-hint">Available: {formatAmount(balance.data?.balance ?? 0)} PoC. Transfers are fee-free; change returns to you.</p>
        </div>
      </Modal>
    </div>
  );
}

// The user's Ed25519 signing key. NON-CUSTODIAL: the private key is never saved
// — not on the server, not in this browser. It's held in memory for the session
// only, so this card lets the user LOAD their key (paste the private key they
// saved at registration) to sign during the session. It never displays or
// stores the secret; the account already has a registered key, so there's no
// "generate" here (a fresh key wouldn't match this account's funds).
function SigningKeyCard({ expectedAddress }: { expectedAddress: string | null }) {
  const { wallet, importWallet } = useAuth();
  const [privKey, setPrivKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loaded = !!wallet?.privateKey;
  const mismatch = loaded && expectedAddress != null && wallet!.address !== expectedAddress;

  const doLoad = () => {
    setMsg(null);
    const err = validate(privKey, [isHex('Private key', 64)]);
    if (err) { setMsg({ ok: false, text: err }); return; }
    try {
      const w = importWallet(privKey.trim().toLowerCase());
      setPrivKey('');
      if (expectedAddress && w.address !== expectedAddress) {
        setMsg({ ok: false, text: 'This key doesn’t match your account address — it can’t sign for this account.' });
      } else {
        setMsg({ ok: true, text: 'Signing key loaded for this session (in memory only — never saved).' });
      }
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <Card title={<span className="row gap-sm"><KeyRound style={{ width: 18, height: 18, color: 'var(--cyan-400)' }} /> Ed25519 Signing Key</span>}>
      <div className="stack-sm">
        <p className="muted text-sm">
          Your Ed25519 key signs your <strong>votes</strong>, <strong>crash proofs</strong>, and{' '}
          <strong>token transfers</strong>. <strong>We never save your private key</strong> — not on the server
          and not in this browser. It lives in memory for this session only; paste it below to sign, and keep
          your own backup (there's no recovery).
        </p>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-danger'}`}>{msg.text}</div>}

        {expectedAddress && (
          <div>
            <p className="mono text-xs muted" style={{ marginBottom: 6 }}>Your address — SHA-256(public key)</p>
            <div className="code-block">{expectedAddress}</div>
          </div>
        )}

        {loaded ? (
          <>
            {mismatch && (
              <div className="alert alert-warn">The loaded key doesn’t match your account address — signing for this account will fail.</div>
            )}
            <div>
              <p className="mono text-xs muted" style={{ marginBottom: 6 }}>Public key — share freely</p>
              <div className="code-block">{wallet!.publicKey}</div>
            </div>
            <div className="row gap-sm emerald text-sm">
              <CheckCircle style={{ width: 15, height: 15 }} /> Signing key loaded for this session
            </div>
          </>
        ) : (
          <div className="stack-sm">
            <div className="alert alert-warn">
              Your signing key isn’t loaded. Paste your Ed25519 private key to sign this session — it's kept in
              memory only and never stored. It clears when you reload or sign out.
            </div>
            <Input label="Private key (64 hex chars)" value={privKey} onChange={(e) => setPrivKey(e.target.value)} placeholder="64 hex characters" />
            <div><Button variant="secondary" onClick={doLoad}><KeyRound /> Load signing key</Button></div>
          </div>
        )}
      </div>
    </Card>
  );
}
