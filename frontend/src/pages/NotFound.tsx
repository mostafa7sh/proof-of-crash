import { Link } from 'react-router-dom';
import { Ghost } from 'lucide-react';

export function NotFound() {
  return (
    <div className="page">
      <div className="state" style={{ padding: '80px 24px' }}>
        <Ghost style={{ width: 56, height: 56, color: 'var(--cyan-400)' }} />
        <h1 style={{ fontSize: 56, margin: 0 }} className="gradient-text">404</h1>
        <p className="muted">This page doesn't exist on-chain.</p>
        <Link to="/dashboard" className="btn btn-secondary">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
