// Re-capture the splash screen stills (apple.com at each screen viewport, 2x, iPhone UA).
// Usage: node scripts/capture-splash-screens.mjs <tempDir> <url> <out.jpg> <width> <height>
//   inner 904 640 -> public/assets/splash/apple-inner.jpg
//   outer 474 696 -> public/assets/splash/apple-outer.jpg
//   inner portrait 640 904, rotated 90deg clockwise -> apple-inner-upright.jpg
// Needs Chrome at the default Windows path.
// Capture a site at an exact CSS viewport with an iPhone UA, 2x. Args: SP url out width height
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [SP, url, out, W, H] = process.argv.slice(2);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new','--remote-debugging-port=9338','--hide-scrollbars','--window-size=1200,1200',`--user-data-dir=${SP}/chrome-cap`,'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);
const page = (await (await fetch('http://127.0.0.1:9338/json')).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Network.enable');
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H + 200, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
await sleep(9000);
// Drop the regional "choose another country" banner so the page is the standard one.
const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const hit=[...document.querySelectorAll('[id*=locale i],[class*=locale i],[id*=geo i],[class*=geo i]')].filter(e=>/country or region/i.test(e.textContent||''));hit.forEach(e=>e.remove());window.scrollTo(0,0);return hit.map(e=>e.id||e.className).slice(0,3)})()` });
console.log('removed', JSON.stringify(r.result?.result?.value));
await sleep(1200);
// Start the frame at the top of the site's own nav bar (where the banner was).
const top = (await send('Runtime.evaluate', { returnByValue: true, expression: `Math.round((document.querySelector('#globalnav, nav, header')||document.body).getBoundingClientRect().top)` })).result.result.value;
console.log('nav top', top);
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: { x: 0, y: top, width: +W, height: +H, scale: 1 } });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
ws.close(); chrome.kill(); process.exit(0);
