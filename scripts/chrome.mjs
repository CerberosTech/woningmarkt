// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe. No npm dependencies.
// Used by scripts/check.mjs (console errors, layout checks, screenshots) and scripts/make-icons.mjs.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

export const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));

export async function launch() {
  if (!CHROME) throw new Error('Chrome not found. Set CHROME=/path/to/chrome.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const input = proc.stdio[3], output = proc.stdio[4];
  const calls = new Map(), listeners = new Set();
  let seq = 0, buf = '';
  output.setEncoding('utf8');
  output.on('data', chunk => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) {
      const msg = JSON.parse(buf.slice(0, i));
      if (msg.id && calls.has(msg.id)) { const c = calls.get(msg.id); calls.delete(msg.id); msg.error ? c.reject(new Error(`${c.method}: ${msg.error.message}`)) : c.resolve(msg.result); }
      else if (msg.method) for (const l of [...listeners]) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq; calls.set(id, { resolve, reject, method });
    input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });

  // stubs: { urlPattern: jsBody } answers matching requests locally (e.g. third-party scripts) instead of going to the network.
  async function open(width, height, { mobile = false, transparent = false, scale = 1, stubs = {} } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    const errors = [];
    const onMsg = msg => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) errors.push(`console.${msg.params.type}: ` + msg.params.args.map(a => a.value ?? a.description).join(' '));
      if (msg.method === 'Fetch.requestPaused') {
        const body = Object.entries(stubs).find(([p]) => new RegExp('^' + p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(msg.params.request.url))?.[1] ?? '';
        s('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
      }
      if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) errors.push(`log.${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim());
    };
    listeners.add(onMsg);
    await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable');
    if (Object.keys(stubs).length) await s('Fetch.enable', { patterns: Object.keys(stubs).map(urlPattern => ({ urlPattern, requestStage: 'Request' })) });
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const waitFor = method => new Promise(resolve => { const l = m => { if (m.sessionId === sessionId && m.method === method) { listeners.delete(l); resolve(m.params); } }; listeners.add(l); });
    const tab = {
      errors,
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async goto(url) {
        errors.length = 0;
        const loaded = waitFor('Page.loadEventFired');
        const nav = await s('Page.navigate', { url });
        if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
        await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error(`${url}: load timeout`)), 20000))]);
        await tab.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))');
      },
      async click(x, y) {
        for (const type of ['mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      },
      async shot({ fullPage = false } = {}) {
        const h = fullPage ? Math.min(12000, Math.ceil(await tab.eval('document.documentElement.scrollHeight'))) : height;
        const y = fullPage ? 0 : await tab.eval('window.scrollY');
        const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, clip: { x: 0, y, width, height: h, scale: 1 } });
        return Buffer.from(data, 'base64');
      },
      close: () => { listeners.delete(onMsg); return send('Target.closeTarget', { targetId }); },
    };
    return tab;
  }
  async function close() {
    const exited = new Promise(r => proc.once('exit', r)), wait = ms => new Promise(r => setTimeout(r, ms));
    try { await Promise.race([send('Browser.close'), wait(3000)]); } catch { /* already gone */ }
    await Promise.race([exited, wait(5000)]);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { open, close };
}
