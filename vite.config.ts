import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'http';
import path from 'path';
import type { Plugin, ViteDevServer } from 'vite';
import {defineConfig, loadEnv} from 'vite';

const readRequestBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const base =
    (env.VITE_BASE ? String(env.VITE_BASE).trim() : '') ||
    (process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '/');
  const supabaseRestBridge: Plugin = {
    name: 'supabase-rest-bridge',
    configureServer(server: ViteDevServer) {
      if (!supabaseUrl) {
        return;
      }

      server.middlewares.use('/__supabase-rest', async (req, res) => {
        try {
          const requestPath = req.url ?? '/';
          const targetUrl = `${supabaseUrl}${requestPath}`;
          const body =
            req.method === 'GET' || req.method === 'HEAD'
              ? undefined
              : await readRequestBody(req);

          const allowedRequestHeaders = [
            'accept',
            'accept-profile',
            'apikey',
            'authorization',
            'content-profile',
            'content-type',
            'prefer',
            'range',
            'x-client-info',
          ] as const;

          const forwardedHeaders = new Headers();
          allowedRequestHeaders.forEach(headerName => {
            const headerValue = req.headers[headerName];
            if (Array.isArray(headerValue)) {
              forwardedHeaders.set(headerName, headerValue.join(', '));
            } else if (typeof headerValue === 'string' && headerValue.trim()) {
              forwardedHeaders.set(headerName, headerValue);
            }
          });

          const upstreamResponse = await fetch(targetUrl, {
            method: req.method,
            headers: forwardedHeaders,
            body,
          });

          res.statusCode = upstreamResponse.status;

          const allowedResponseHeaders = [
            'content-profile',
            'content-range',
            'content-type',
            'location',
            'prefer',
            'range-unit',
          ] as const;

          allowedResponseHeaders.forEach(headerName => {
            const headerValue = upstreamResponse.headers.get(headerName);
            if (headerValue) {
              res.setHeader(headerName, headerValue);
            }
          });

          const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
          res.end(responseBuffer);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Proxy failure';
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ message }));
        }
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), supabaseRestBridge],
    base,
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
