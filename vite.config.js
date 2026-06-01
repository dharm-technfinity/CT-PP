import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: '/caratdesk.html',
    proxy: {
      '/api': {
        target: 'https://ppj-dev1.m.frappe.cloud',
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: '',
      }
    }
  },
  // Ensure HTML files are served with UTF-8 charset
  plugins: [
    {
      name: 'add-charset',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
          }
          next();
        });
      }
    }
  ]
});