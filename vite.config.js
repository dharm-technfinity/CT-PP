import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'add-charset',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] || '';
          if (url === '/pos' || url.startsWith('/pos/')) {
            req.url = '/pos.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
          } else if (url === '/caratdesk-pos' || url.startsWith('/caratdesk-pos/')) {
            req.url = '/caratdesk-pos.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
          }
          if (req.url?.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    // Caddy reverse-proxies this hostname to localhost:5173 over HTTPS (see /etc/caddy/Caddyfile
    // on the AWS box) so pages that need a secure context — e.g. the camera-based QR scanner on
    // caratdesk-tag-search.html — work when accessed over the network instead of just localhost.
    allowedHosts: ['3-109-11-132.sslip.io'],
    proxy: {
      '/api': {
        target: 'https://ppj-dev1.m.frappe.cloud',
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: '',
      },
      '/files': {
        target: 'https://ppj-dev1.m.frappe.cloud',
        changeOrigin: true,
        secure: false,
      },
      '/private/files': {
        target: 'https://ppj-dev1.m.frappe.cloud',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        pos: 'pos.html',
        'caratdesk-pos': 'caratdesk-pos.html',
      },
    },
  },
});
