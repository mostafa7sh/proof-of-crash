import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Upload, FileCode, Shield, AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { appsApi, proofsApi, errorMessage } from '../api';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input, TextArea, Select } from '../components/Input';
import { Hash } from '../components/Hash';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { required, maxLen, validate, isHex, isUuid } from '../utils/validation';

type Tab = 'app' | 'proof';
const LANGUAGES = ['c', 'cpp', 'python', 'rust', 'go'];
const FORMATS = ['stdin', 'argv', 'file', 'binary'];

export function Submit() {
  // Arriving from an application/mempool "Submit Proof" link pre-targets that
  // app: `?app=<uuid>` opens the Proof tab with the id already filled and locked.
  const [params] = useSearchParams();
  const presetApp = params.get('app');
  const [tab, setTab] = useState<Tab>(presetApp ? 'proof' : 'app');

  return (
    <div className="page stack">
      <div className="page-header">
        <h1>Submit</h1>
        <p className="muted">Register a target application, or submit a crash proof against one.</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'app' ? 'active' : ''}`} onClick={() => setTab('app')}>Upload App</button>
        <button className={`tab ${tab === 'proof' ? 'active' : ''}`} onClick={() => setTab('proof')}>Submit Proof</button>
      </div>

      <div className="split">
        <div>{tab === 'app' ? <UploadApp onUploaded={() => setTab('proof')} /> : <SubmitProof presetAppId={presetApp} />}</div>
        <InfoSidebar mode={tab} />
      </div>
    </div>
  );
}

function UploadApp({ onUploaded }: { onUploaded: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('c');
  const [sourceCode, setSourceCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<{ app_id: string; content_hash: string } | null>(null);

  const submit = async () => {
    const errs = {
      name: validate(name, [required('Name'), maxLen(255, 'Name')]),
      sourceCode: validate(sourceCode, [required('Source code')]),
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setBusy(true);
    setApiError(null);
    try {
      const res = await appsApi.create({
        name,
        description: description || undefined,
        language,
        source_code: sourceCode,
      });
      setResult(res);
    } catch (e) {
      setApiError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Card title="App registered">
        <div className="stack">
          <div className="alert alert-success">Your target is registered. Use its App ID to submit crash proofs.</div>
          <dl className="dl">
            <dt>App ID</dt>
            <dd><Hash value={result.app_id} full /></dd>
            <dt>Content hash</dt>
            <dd><Hash value={result.content_hash} head={14} tail={10} /></dd>
          </dl>
          <div className="row gap-sm wrap">
            <Button onClick={onUploaded}>Submit a proof for this app</Button>
            <Button variant="ghost" onClick={() => { setResult(null); setName(''); setDescription(''); setSourceCode(''); }}>
              Upload another
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Register a target application">
      <div className="stack">
        {apiError && <div className="alert alert-danger">{apiError}</div>}
        <Input label="Project Name *" value={name} onChange={(e) => setName(e.target.value)} error={errors['name']} placeholder="tiny-parser" />
        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" />
        <Select label="Language *" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
        <TextArea
          label="Source Code *"
          value={sourceCode}
          onChange={(e) => setSourceCode(e.target.value)}
          error={errors['sourceCode']}
          placeholder="Paste the program source…"
          rows={12}
        />
        <div><Button loading={busy} onClick={submit}><Upload /> Register App</Button></div>
      </div>
    </Card>
  );
}

function SubmitProof({ presetAppId }: { presetAppId?: string | null }) {
  const navigate = useNavigate();
  const [appId, setAppId] = useState(presetAppId ?? '');
  // When a target arrives from an app/mempool link the field is locked to avoid
  // accidental edits; "change" unlocks it so the user can still retarget.
  const [locked, setLocked] = useState(!!presetAppId);
  const [inputFormat, setInputFormat] = useState('stdin');
  const [crashInput, setCrashInput] = useState('');
  const [encoding, setEncoding] = useState<'text' | 'hex'>('text');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const submit = async () => {
    const errs: Record<string, string | null> = {
      appId: validate(appId, [required('App ID'), isUuid('Target App ID')]),
      crashInput: validate(crashInput, [required('Crash input')]),
    };
    if (encoding === 'hex') errs['crashInput'] = errs['crashInput'] || validate(crashInput, [isHex('Crash input')]);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setBusy(true);
    setApiError(null);
    try {
      const crashHex = encoding === 'hex' ? crashInput.trim().toLowerCase() : bytesToHex(utf8ToBytes(crashInput));
      const res = await proofsApi.create({ app_id: appId.trim(), crash_input: crashHex, input_format: inputFormat });
      navigate(`/proofs/${res.proof_id}`);
    } catch (e) {
      setApiError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Submit a crash proof">
      <div className="stack">
        {apiError && <div className="alert alert-danger">{apiError}</div>}
        <div className="input-icon field">
          <Input
            label="Target App ID *"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            error={errors['appId']}
            placeholder="UUID of the target app"
            readOnly={locked}
            hint={locked ? 'Target pre-filled from the application page.' : undefined}
          />
          {locked && (
            <button
              type="button"
              className="row gap-sm cyan text-xs mono"
              onClick={() => setLocked(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', width: 'fit-content' }}
            >
              <Lock style={{ width: 12, height: 12 }} /> Locked to this application — change target
            </button>
          )}
        </div>
        <Select label="Input Format *" value={inputFormat} onChange={(e) => setInputFormat(e.target.value)}>
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Select label="Input Encoding" value={encoding} onChange={(e) => setEncoding(e.target.value as 'text' | 'hex')}>
          <option value="text">Plain text (auto hex-encoded)</option>
          <option value="hex">Raw hex bytes</option>
        </Select>
        <TextArea
          label="Crash Input *"
          value={crashInput}
          onChange={(e) => setCrashInput(e.target.value)}
          error={errors['crashInput']}
          placeholder={encoding === 'hex' ? '4141414141…' : 'The input that triggers the crash'}
          rows={8}
        />
        <div><Button loading={busy} onClick={submit}><FileCode /> Submit Proof</Button></div>
      </div>
    </Card>
  );
}

function InfoSidebar({ mode }: { mode: Tab }) {
  return (
    <div className="stack">
      <Card>
        <div className="row gap-sm" style={{ marginBottom: 16 }}>
          <Shield style={{ width: 22, height: 22, color: 'var(--cyan-400)' }} />
          <h3>How It Works</h3>
        </div>
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {[
            'Register your application as a fuzzing target',
            'Community downloads and tests it locally',
            'Crashing inputs are submitted as proofs',
            'Verifiers reproduce and score each crash',
            'Finalized crashes are added to the blockchain',
          ].map((t) => (
            <li key={t} className="row text-sm muted" style={{ alignItems: 'flex-start', gap: 8 }}>
              <CheckCircle style={{ width: 16, height: 16, color: 'var(--cyan-400)', flexShrink: 0, marginTop: 2 }} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="card-warn">
        <div className="row gap-sm" style={{ marginBottom: 16 }}>
          <AlertCircle style={{ width: 22, height: 22, color: 'var(--yellow)' }} />
          <h3 style={{ color: 'var(--yellow)' }}>{mode === 'app' ? 'Submission Rules' : 'Proof Rules'}</h3>
        </div>
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {(mode === 'app'
            ? [
                'Source is hashed on-chain (content_hash)',
                'Anyone can submit crash proofs against it',
                'Identify your app by its returned App ID',
              ]
            : [
                'Crash input is stored as hex bytes',
                'You cannot vote on your own proof',
                'Voting opens for a fixed window after submission',
                'Reward is minted only after consensus',
              ]
          ).map((t) => (
            <li key={t} className="row text-sm muted" style={{ alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: 'var(--yellow)' }}>•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
