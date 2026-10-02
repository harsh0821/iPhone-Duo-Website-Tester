// /__proxy/<scheme>/<host>/<path>?<query>
// A pass-through proxy for sites that refuse to be framed. The page is served
// unchanged except for: framing headers removed, a <base> pointing back at the
// real site (so images/CSS/scripts load straight from the origin), and a tiny
// bootstrap script. CORS-mode sub-requests (fonts, modules, fetch) are routed
// here by public/sw.js so they work from our origin.
import {
  IPHONE_UA, PROXY_PREFIX, TARGET_COOKIE, fetchPublic, fromProxyPath, toProxyPath, readCookie,
  readBody, decodeHtml, errorMessage, UserError,
} from './net.js';

const PASS_RESPONSE_HEADERS = [
  'content-type', 'cache-control', 'expires', 'last-modified', 'etag', 'content-language', 'content-disposition', 'vary',
];
const PASS_REQUEST_HEADERS = [
  'accept', 'accept-language', 'content-type', 'range', 'if-none-match', 'if-modified-since', 'cache-control',
];

function targetFromRequest(req) {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith(PROXY_PREFIX)) {
    return fromProxyPath(url.pathname.slice(PROXY_PREFIX.length), url.search);
  }
  // Vercel rewrite: /__proxy/:path* -> /api/proxy?__path=:path*
  const params = url.searchParams;
  if (params.has('__path')) {
    const rest = params.get('__path');
    params.delete('__path');
    const qs = params.toString();
    return fromProxyPath(rest, qs ? '?' + qs : '');
  }
  // Fallback: a proxied page navigated itself to one of *our* paths
  // (e.g. location.href = '/login'). Send it to the same path on the site.
  const fallback = params.has('__fallback') ? '/' + params.get('__fallback') : url.pathname;
  params.delete('__fallback');
  const origin = readCookie(req, TARGET_COOKIE);
  if (!origin) throw new UserError('Nothing to proxy', 404);
  const qs = params.toString();
  return new URL(fallback + (qs ? '?' + qs : ''), origin);
}

function upstreamHeaders(req, target) {
  const headers = { 'user-agent': IPHONE_UA };
  for (const name of PASS_REQUEST_HEADERS) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  // Present the request as coming from the site itself.
  const referer = req.headers.referer;
  if (referer) {
    try {
      const r = new URL(referer);
      headers.referer = r.pathname.startsWith(PROXY_PREFIX)
        ? fromProxyPath(r.pathname.slice(PROXY_PREFIX.length), r.search).href
        : new URL(r.pathname + r.search, target.origin).href;
    } catch { /* ignore */ }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') headers.origin = target.origin;
  return headers;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function bootstrapScript(finalUrl) {
  // Runs before any of the page's own scripts.
  return `(function(){
var T=new URL(${JSON.stringify(finalUrl.href)}),O=location.origin,P=${JSON.stringify(PROXY_PREFIX)};
function px(h){var u;try{u=new URL(h,document.baseURI)}catch(e){return h}
if(u.protocol!=='http:'&&u.protocol!=='https:')return h;
if(u.origin===O){if(u.pathname.indexOf(P)===0)return u.href;u=new URL(u.pathname+u.search+u.hash,T.origin)}
return O+P+u.protocol.slice(0,-1)+'/'+u.host+u.pathname+u.search+u.hash}
window.__duoProxy={target:T.href,toProxy:px};
['Worker','SharedWorker'].forEach(function(n){var W=window[n];if(!W)return;var P2=function(u,o){try{var a=new URL(u,document.baseURI);if(a.origin!==O&&(a.protocol==='https:'||a.protocol==='http:'))u=px(a.href)}catch(e){}return new W(u,o)};P2.prototype=W.prototype;window[n]=P2});
['pushState','replaceState'].forEach(function(n){var f=history[n];history[n]=function(s,t,u){
if(u!=null){try{var a=new URL(u,document.baseURI);if(a.origin===T.origin||a.origin===O)u=O+a.pathname+a.search+a.hash}catch(e){}}
return f.call(this,s,t,u)}});
try{history.replaceState(history.state,'',O+T.pathname+T.search+location.hash)}catch(e){}
try{navigator.serviceWorker&&navigator.serviceWorker.controller&&navigator.serviceWorker.controller.postMessage({type:'duo-target',origin:T.origin})}catch(e){}
addEventListener('click',function(e){
if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||a.hasAttribute('download'))return;
var t=(a.getAttribute('target')||'').toLowerCase();if(t&&t!=='_self')return;
var u;try{u=new URL(a.href)}catch(_){return}
if(u.protocol!=='http:'&&u.protocol!=='https:')return;
var here=T.origin+location.pathname+location.search;
if(u.hash&&(u.origin+u.pathname+u.search)===here)return;
e.preventDefault();location.href=px(u.href)});
addEventListener('submit',function(e){var f=e.target;if(f&&f.tagName==='FORM'){f.setAttribute('action',px(f.action||location.href))}},true);
if(window.navigation)navigation.addEventListener('navigate',function(e){
if(!e.cancelable||e.hashChange||e.downloadRequest||e.destination.sameDocument)return;
var u;try{u=new URL(e.destination.url)}catch(_){return}
if(u.protocol!=='http:'&&u.protocol!=='https:')return;
if(u.origin===O&&u.pathname.indexOf(P)===0)return;
e.preventDefault();
if(e.formData){var f=document.createElement('form');f.method='post';f.action=px(u.href);f.style.display='none';
e.formData.forEach(function(v,k){if(typeof v==='string'){var i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i)}});
(document.body||document.documentElement).appendChild(f);HTMLFormElement.prototype.submit.call(f);return}
location.href=px(u.href)});
})();`;
}

function rewriteHtml(html, finalUrl) {
  let out = html
    // A meta CSP could block our bootstrap; framing meta tags are ignored by browsers anyway.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi, '')
    // <meta http-equiv="refresh" content="0;url=..."> must stay inside the proxy too.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, (tag) => tag.replace(
      /(content\s*=\s*["'][^"']*?url\s*=\s*)([^"']+)/i,
      (_, lead, u) => {
        try {
          return lead + toProxyPath(new URL(u.trim().replace(/^['"]|['"]$/g, ''), finalUrl));
        } catch {
          return lead + u;
        }
      },
    ));

  // Form targets point back into the proxy (covers auto-submitting redirect forms).
  out = out.replace(/<form\b[^>]*>/gi, (tag) => tag.replace(
    /(\baction\s*=\s*)("([^"]*)"|'([^']*)')/i,
    (m, lead, _q, dq, sq) => {
      const raw = (dq ?? sq ?? '').replace(/&amp;/g, '&');
      try {
        const abs = new URL(raw, finalUrl);
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return m;
        return `${lead}"${escapeAttr(toProxyPath(abs))}"`;
      } catch {
        return m;
      }
    },
  ));

  let base = finalUrl.href;
  const existingBase = out.match(/<base\b[^>]*>/i);
  if (existingBase) {
    const href = attr(existingBase[0], 'href');
    if (href) {
      try { base = new URL(href, finalUrl).href; } catch { /* keep final url */ }
    }
  }

  const inject = `<base href="${escapeAttr(base)}"><script>${bootstrapScript(finalUrl)}</script>`;
  if (/<head\b[^>]*>/i.test(out)) return out.replace(/<head\b[^>]*>/i, (m) => m + inject);
  if (/<html\b[^>]*>/i.test(out)) return out.replace(/<html\b[^>]*>/i, (m) => m + '<head>' + inject + '</head>');
  return inject + out;
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui,sans-serif;color:#515a63;background:#f2f2f7;text-align:center;padding:24px;box-sizing:border-box"><div><strong style="display:block;color:#111820;font-size:17px;margin-bottom:6px">Preview unavailable</strong>${message.replace(/</g, '&lt;')}</div></body>`);
}

export async function handleProxy(req, res) {
  let target;
  try {
    target = targetFromRequest(req);
  } catch (err) {
    return sendError(res, err.status || 400, errorMessage(err));
  }

  const dest = req.headers['sec-fetch-dest'];
  const isDocument = dest === 'iframe' || dest === 'document' || dest === 'frame';

  try {
    const body = await readBody(req);
    const { response, finalUrl } = await fetchPublic(target, {
      method: req.method,
      headers: upstreamHeaders(req, target),
      body,
      followRedirects: false,
    });

    // Redirects stay inside the proxy so the frame keeps working.
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      res.statusCode = response.status;
      res.setHeader('location', toProxyPath(new URL(location, finalUrl)));
      res.setHeader('cache-control', 'no-store');
      return res.end();
    }

    res.statusCode = response.status;
    for (const name of PASS_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('x-duo-proxied', '1');

    const contentType = response.headers.get('content-type') || '';
    if (isDocument && /text\/html|application\/xhtml/i.test(contentType)) {
      const html = decodeHtml(Buffer.from(await response.arrayBuffer()), contentType);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('set-cookie', `${TARGET_COOKIE}=${encodeURIComponent(finalUrl.origin)}; Path=/; SameSite=Lax`);
      return res.end(rewriteHtml(html, finalUrl));
    }

    if (req.method === 'HEAD' || !response.body) return res.end();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  } catch (err) {
    if (res.headersSent) return res.end();
    if (isDocument) return sendError(res, 502, errorMessage(err));
    res.statusCode = 502;
    res.end();
  }
}
