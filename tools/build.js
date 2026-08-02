#!/usr/bin/env node
// Inline the sources into one file so the whole thing runs from a USB stick, an
// email attachment, or a laptop in a field station with no internet worth the
// name. Module scripts cannot load over file://; this can.
//
//   node tools/build.js  ->  dist/roostcast.html

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const order = ['solar.js', 'presets.js', 'thermal.js', 'climate.js', 'ui.js'];
const bundle = order.map(f => {
  const src = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  return `/* ===== src/${f} ===== */\n${src}`;
}).join('\n');

const tagBlock = order.map(f => `<script src="src/${f}"></script>`).join('\n');
if (!html.includes(tagBlock)) {
  console.error('index.html script tags no longer match the expected block; build aborted.');
  process.exit(1);
}

const out = html.replace(tagBlock, '<script>\n' + bundle + '\n</script>');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'roostcast.html');
fs.writeFileSync(dest, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`dist/roostcast.html  ${kb} kB  (${order.length} sources inlined)`);
