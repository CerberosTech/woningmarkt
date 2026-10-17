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
fs.writeFileSync('src/apple-touch-icon.png', await render(180, 180, iconPage(180).replace('rx="6"', 'rx="0"')));
const ico = Buffer.alloc(22); ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
fs.writeFileSync('src/favicon.ico', Buffer.concat([ico, png32]));
const og = `<html><head><style>
body{margin:0;width:1200px;height:630px;background:#fff;font-family:system-ui,-apple-system,sans-serif;color:#14272d;display:grid;grid-template-columns:640px 560px;overflow:hidden}
.t{padding:78px 0 0 72px}.b{display:flex;align-items:center;gap:18px;font:700 34px Charter,Georgia,serif}
h1{font:700 64px/1.08 Charter,Georgia,serif;margin:56px 0 22px;letter-spacing:-.01em}p{font-size:28px;line-height:1.35;color:#4b5d62;margin:0}
.m{background:#f1f6f5;display:flex;align-items:center;justify-content:center}.m svg{height:600px;width:auto}
#gm path{stroke:#fff;stroke-width:.35}#pv path{fill:none;stroke:#14272d;stroke-width:.9}
.bar{position:absolute;left:72px;bottom:64px;width:120px;height:6px;background:#0d6e74}
</style></head><body><div class="t"><div class="b">${icon.replace('<svg ', '<svg width="54" height="54" ')}Woningmarkt NL</div>
<h1>Huizenprijzen per gemeente</h1><p>Kaart, trends en rekenhulpen met officiële CBS-cijfers.</p><p style="margin-top:14px">House prices by municipality, in English too.</p><div class="bar"></div></div>
<div class="m">${map}</div></body></html>`;
fs.writeFileSync('src/og-image.png', await render(1200, 630, og));
await b.close();
console.log('icons and og-image written to src/');
