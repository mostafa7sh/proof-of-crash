import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './layouts/AppLayout';
import { Loading } from './components/states';
import { Login } from './pages/Login';

// importing the landing page lazily to reduce initial bundle 
// size and improve load performance.
const Landing = lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })));
import { Dashboard } from './pages/Dashboard';
import { Proofs } from './pages/Proofs';
import { ProofDetail } from './pages/ProofDetail';
import { Mempool } from './pages/Mempool';
import { Leaderboard } from './pages/Leaderboard';
import { Application } from './pages/Application';
import { Submit } from './pages/Submit';
import { Explorer } from './pages/Explorer';
import { BlockDetail } from './pages/BlockDetail';
import { Wallet } from './pages/Wallet';
import { NotFound } from './pages/NotFound';

// providing the main elements of the app,
// including routing and authentication context.
export default function App() {
  return (
    // AuthProvider wraps the entire app to provide authentication state and methods
    <AuthProvider>
      {/* BrowserRouter enables client-side routing,
      allowing navigation without full page reloads */}
      <BrowserRouter>
        {/* Routes define the mapping between URL paths and the components
        that should be rendered for those paths. */}
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Top-nav shell wraps the public landing and all protected screens. */}
          <Route element={<AppLayout />}>
            <Route
              path="/"
              element={
                <Suspense fallback={<div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><Loading /></div>}>
                  <Landing />
                </Suspense>
              }
            />
            {/* Protected routes require authentication to access. */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/proofs" element={<Proofs />} />
              <Route path="/proofs/:proofId" element={<ProofDetail />} />
              <Route path="/mempool" element={<Mempool />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/apps/:appId" element={<Application />} />
              <Route path="/submit" element={<Submit />} />
              <Route path="/explorer" element={<Explorer />} />
              <Route path="/explorer/:blockHash" element={<BlockDetail />} />
              <Route path="/wallet" element={<Wallet />} />
            </Route>
            <Route path="/404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
