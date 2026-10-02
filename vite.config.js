import { defineConfig } from 'vite';
import { handleInspect } from './server/inspect.js';
import { handleProxy } from './server/proxy.js';

// Runs the same handlers Vercel serves from /api during `vite` and `vite preview`.
function duoApi() {
  const middleware = (req, res, next) => {
    const url = req.url || '';
    if (url.startsWith('/api/inspect')) return handleInspect(req, res);
    if (url.startsWith('/__proxy/')) return handleProxy(req, res);
    // A proxied page navigated to one of our own paths: forward it to the site.
    if (req.headers['sec-fetch-dest'] === 'iframe' && !url.startsWith('/@') && !url.startsWith('/api/')) {
      return handleProxy(req, res);
    }
    next();
  };
  return {
    name: 'duo-api',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [duoApi()],
});
