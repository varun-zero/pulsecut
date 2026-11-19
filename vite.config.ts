import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backendTarget = process.env.PULSECUT_API_URL || 'http://127.0.0.1:8756';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep the dependency scanner on our own app. Local reference clones under
  // research/ contain whole other frontends that would otherwise get bundled
  // and produce a second React copy ("Invalid hook call").
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { entries: ['index.html', 'src/**/*.{ts,tsx}'] },
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: false,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, req, res) => {
            if (!res || !('writeHead' in res) || res.headersSent) return;
            const method = (req.method || 'GET').toUpperCase();
            const url = req.url || '';
            // Gracefully report offline workspace on read probes so standalone local-file mode stays console-clean
            if (method === 'GET' && (url.startsWith('/api/clips') || url.startsWith('/api/jobs'))) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ backend_offline: true, clips: [], jobs: [] }));
              return;
            }
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error:
                  'PulseCut backend server is offline. Start it with `cargo run --bin pulsecut -- editor --addr 127.0.0.1:8756`.',
              })
            );
          });
        },
      },
      '/health': {
        target: backendTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (!res || !('writeHead' in res) || res.headersSent) return;
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, backend_offline: true }));
          });
        },
      },
    },
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
});
