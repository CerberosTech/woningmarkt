// Renders src/icon.svg to favicon.ico (32 px PNG inside ICO) and apple-touch-icon.png (180 px),
// and src/og-image.png (1200x630) from the built municipality map. Run after `node build.mjs`.
// The OG image carries no figures, so it stays correct when the data changes.
import fs from 'node:fs'; import { launch } from './chrome.mjs';
const icon = fs.readFileSync('src/icon.svg', 'utf8');
const map = fs.readFileSync('dist/kaart/index.html', 'utf8').match(/<svg id="nlmap"[\s\S]*?<\/svg>/)[0].replace(/<title[\s\S]*?<\/desc>/, '');
const b = await launch();
const render = async (w, h, html, transparent = false) => { const t = await b.open(w, h, { transparent }); await t.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html)); const png = await t.shot(); await t.close(); return png; };
const iconPage = s => `<html><body style="margin:0"><div style="width:${s}px;height:${s}px">${icon.replace('<svg ', `<svg width="${s}" height="${s}" `)}</div></body></html>`;
const png32 = await render(32, 32, iconPage(32), true);
fs.writeFileSync('src/apple-touch-icon.png', await render(180, 180, iconPage(180).replace('rx="7"', 'rx="0"')));
const ico = Buffer.alloc(22); ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
fs.writeFileSync('src/favicon.ico', Buffer.concat([ico, png32]));
const font = `@font-face{font-family:B;src:url(data:font/woff2;base64,${fs.readFileSync('src/fonts/bricolage.woff2').toString('base64')}) format("woff2");font-weight:200 800}`;
const og = `<html><head><style>${font}
body{margin:0;width:1200px;height:630px;background:#0e1a2e;font-family:B,system-ui,sans-serif;color:#eef2f8;display:grid;grid-template-columns:660px 540px;overflow:hidden}
.t{padding:74px 0 0 76px}.b{display:flex;align-items:center;gap:16px;font-weight:760;font-size:34px;letter-spacing:-.03em}
h1{font-weight:760;font-size:74px;line-height:1.02;margin:64px 0 26px;letter-spacing:-.04em}p{font-size:28px;line-height:1.35;color:#b3c0d3;margin:0}
.m{display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 90% at 50% 45%,#13233d,#0e1a2e 70%)}.m svg{height:600px;width:auto}
#gm path{stroke:#0e1a2e;stroke-width:.5}#pv path{fill:none;stroke:rgba(238,242,248,.5);stroke-width:.9}#hl{display:none}
.bar{position:absolute;left:76px;bottom:66px;width:120px;height:6px;border-radius:3px;background:#ff7a1a}
</style></head><body><div class="t"><div class="b">${icon.replace('<svg ', '<svg width="52" height="52" ')}Woningmarkt NL</div>
<h1>Huizenprijzen per gemeente</h1><p>Kaart, trends en rekenhulpen met officiële CBS-cijfers.</p><p style="margin-top:14px">House prices by municipality, in English too.</p><div class="bar"></div></div>
<div class="m">${map}</div></body></html>`;
fs.writeFileSync('src/og-image.png', await render(1200, 630, og));
await b.close();
console.log('icons and og-image written to src/');
