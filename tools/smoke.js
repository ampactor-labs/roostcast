#!/usr/bin/env node
// Drives the real page in headless Chrome: picks a site, runs the season, waits
// for the sweep, and reports what the page actually said. Catches the whole class
// of bug that unit tests on the physics never will -- a typo in a selector, a
// canvas that never sizes, a promise that never resolves.
//
//   node tools/smoke.js [url]

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8731/index.html';
const PORT = 9222;

function chromeBin() {
  const candidates = [
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('no chrome found');
  return found;
}

function get(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  const chrome = spawn(chromeBin(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, '--window-size=1200,2400',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { const list = await get('/json/list'); target = list.find(t => t.type === 'page'); } catch (e) {}
  }
  if (!target) { chrome.kill(); throw new Error('chrome did not come up'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ||
                                 m.params.exceptionDetails.text));
    }
  };
  await new Promise(r => ws.onopen = r);

  const send = (method, params = {}) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(1800);

  const fail = [];
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
    if (!ok) fail.push(name);
  };

  console.log(`\nroostcast smoke test — ${URL_UNDER_TEST}\n`);

  check('page title', await evaluate('document.title.includes("Roostcast")'),
        await evaluate('document.title'));
  check('design options populated', (await evaluate('design.options.length')) >= 4,
        (await evaluate('design.options.length')) + ' designs');
  check('colour options populated', (await evaluate('color.options.length')) === 5);
  check('compass populated', (await evaluate('facing.options.length')) === 8);
  check('no errors on load', logs.filter(l => l.startsWith('EXCEPTION')).length === 0,
        logs.filter(l => l.startsWith('EXCEPTION'))[0] || '');

  // Lillooet in the heat-dome year: the case that should read as dangerous.
  await evaluate(`
    lat.value = '50.686'; lon.value = '-121.936';
    year.value = '2021'; design.value = 'four'; color.value = 'black';
    mount.value = 'pole'; facing.value = '90'; exposure.value = 'full';
    run.click(); true;
  `);

  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    ready = await evaluate('document.getElementById("results").className === "on" && !document.getElementById("run").disabled');
    const err = await evaluate('document.getElementById("err").textContent');
    if (err) { check('run without error', false, err); break; }
    if (ready) break;
  }
  check('simulation completed', ready);

  if (ready) {
    const verdict = await evaluate('document.querySelector("#verdict p").textContent');
    const stats = await evaluate('[...document.querySelectorAll(".stat .n")].map(e=>e.textContent).join(" | ")');
    const rows = await evaluate('document.querySelectorAll("#sweep tbody tr").length');
    const cmp = await evaluate('document.getElementById("tablecmp").textContent.slice(0,240)');
    const hm = await evaluate('(()=>{const c=document.getElementById("heat");return c.width>0&&c.height>0})()');
    const painted = await evaluate(`(()=>{
      const c=document.getElementById("heat");
      const d=c.getContext("2d").getImageData(60,60,1,1).data;
      return d[3]>0;
    })()`);

    check('heatmap canvas sized', hm);
    check('heatmap actually painted', painted);
    check('sweep table filled', rows >= 8, rows + ' rows');
    check('table comparison rendered', cmp.length > 60);

    console.log('\n  verdict:  ' + verdict);
    console.log('  stats:    ' + stats);
    console.log('\n  ' + cmp.replace(/\s+/g, ' ').trim() + '…\n');
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot.result?.data) {
    require('fs').writeFileSync('/tmp/claude-1000/-home-suds-Projects/170688c3-b9b0-4168-b519-82d7573a326d/scratchpad/roostcast.png',
      Buffer.from(shot.result.data, 'base64'));
    console.log('  screenshot -> scratchpad/roostcast.png');
  }

  const errs = logs.filter(l => l.startsWith('EXCEPTION') || l.startsWith('error'));
  if (errs.length) { console.log('\n  console errors:'); errs.forEach(e => console.log('    ' + e)); }

  ws.close(); chrome.kill();
  console.log(`\n${fail.length ? fail.length + ' FAILED' : 'all checks passed'}\n`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
