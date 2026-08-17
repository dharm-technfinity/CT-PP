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
