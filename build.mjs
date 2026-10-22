#!/usr/bin/env node
/**
 * Bundle the editor (Paper.js included) and inline CSS + JS into the
 * single-file distribution next to this script.
 *
 * Usage: npm run build
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceHtml = path.join(here, 'index.html');
const sourceCss = path.join(here, 'editor.css');
const sourceJs = path.join(here, 'editor.js');
const bundlePath = path.join(here, 'editor.bundle.js');
const output = path.join(here, 'svg-editor.html');

const CSS_LINK = '<link rel="stylesheet" href="editor.css">';
const JS_LINK = '<script src="editor.bundle.js"></script>';
const BANNER = '<!-- Generated from the sources in this directory by `npm run build` — edit those, not this file. -->\n';
const withoutFinalNewline = (text) => (text.endsWith('\n') ? text.slice(0, -1) : text);

await esbuild.build({
  entryPoints: [sourceJs],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  outfile: bundlePath,
  minify: true,
  legalComments: 'inline',
  logLevel: 'silent'
});

const [html, css, js] = await Promise.all([
  readFile(sourceHtml, 'utf8'),
  readFile(sourceCss, 'utf8'),
  readFile(bundlePath, 'utf8')
]);

if (!html.includes(CSS_LINK)) throw new Error(`Missing ${CSS_LINK} in ${sourceHtml}`);
if (!html.includes(JS_LINK)) throw new Error(`Missing ${JS_LINK} in ${sourceHtml}`);
if (css.includes('</style>')) throw new Error('editor.css contains a closing </style> tag');
if (js.includes('</script>')) throw new Error('editor.bundle.js contains a closing </script> tag');

const bundled = html
  .replace('<!doctype html>', '<!doctype html>\n' + BANNER)
  // Function replacers keep `$$` and other `$` patterns in the sources intact.
  .replace(CSS_LINK, () => '<style>\n' + withoutFinalNewline(css) + '\n</style>')
  .replace(JS_LINK, () => '<script>\n' + withoutFinalNewline(js) + '\n</script>');

if (bundled.includes(CSS_LINK) || bundled.includes(JS_LINK)) {
  throw new Error('One or more external asset references were not inlined');
}

await writeFile(output, bundled, 'utf8');

const kb = (value) => (Buffer.byteLength(value, 'utf8') / 1024).toFixed(1) + ' KB';
console.log(`Built ${path.relative(process.cwd(), output)} (${kb(bundled)})`);
console.log(`  css ${kb(css)} · js ${kb(js)} · shell ${kb(html)}`);