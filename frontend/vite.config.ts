import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy forwards API + health calls to the backend, avoiding CORS in dev.
// Override the target with VITE_PROXY_TARGET if the backend runs elsewhere.
const target = process.env['VITE_PROXY_TARGET'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
});
