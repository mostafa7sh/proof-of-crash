import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Bug, Layers, Upload, Blocks, Trophy, Wallet as WalletIcon, Menu, X, LogOut } from 'lucide-react';
import { BrandShield } from '../components/BrandShield';
import { useAuth } from '../context/AuthContext';
import { truncate } from '../utils/format';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/proofs', label: 'Bug Proofs', icon: Bug },
  { to: '/mempool', label: 'Mempool', icon: Layers },
  { to: '/submit', label: 'Submit', icon: Upload },
  { to: '/explorer', label: 'Ledger', icon: Blocks },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/wallet', label: 'Wallet', icon: WalletIcon },
];

/**
 * Top navigation shell (matches the Figma Layout). Wraps both the public
 * Landing page and the protected app screens; the wallet chip reflects the
 * real session, falling back to a "Connect" link when signed out.
 */
export function AppLayout() {
  const { user, wallet, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const address = user?.address ?? wallet?.address ?? null;

  const onLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="topnav-inner">
          <NavLink to={user ? '/dashboard' : '/'} className="brand" onClick={() => setOpen(false)}>
            <span className="brand-mark"><BrandShield /></span>
            <span className="brand-word">Proof<b>Of</b>Crash</span>
          </NavLink>

          <nav className="topnav-links desktop">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Icon /> {label}
              </NavLink>
            ))}
          </nav>

          <div className="row gap-sm">
            {address ? (
              <NavLink to="/wallet" className="wallet-chip" title={address}>
                <WalletIcon />
                <span>{truncate(address, 6, 4)}</span>
              </NavLink>
            ) : (
              <NavLink to="/login" className="wallet-chip">Connect Wallet</NavLink>
            )}
            {user && (
              <button className="logout-chip" onClick={onLogout} title="Log out">
                <LogOut /> <span>Log Out</span>
              </button>
            )}
            <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Menu">
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="mobile-menu">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon /> {label}
              </NavLink>
            ))}
            {user && (
              <button
                className="nav-link"
                onClick={onLogout}
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <LogOut /> Sign out
              </button>
            )}
          </nav>
        )}
      </header>

      <div className="main">
        <main className="content">
          <Outlet />
        </main>
        <footer className="footer">
          <div className="footer-inner">
            <p className="foot-main">Decentralized Bug Discovery • Secured by Blockchain</p>
            <p className="foot-sub">© 2026 ProofOfCrash Protocol</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
