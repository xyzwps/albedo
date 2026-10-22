#!/usr/bin/env node
/**
 * Development server: rebuild the editor bundle on change and serve this directory.
 * The production single-file artifact is still produced by ./build.mjs.
 */
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4173;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const ctx = await esbuild.context({
  entryPoints: [path.join(here, 'editor.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(here, 'editor.bundle.js'),
  legalComments: 'inline',
  logLevel: 'info'
});
await ctx.watch();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(here, '.' + requested);
    if (!file.startsWith(here + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    res.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Albedo dev server → http://127.0.0.1:${port}/`);
});