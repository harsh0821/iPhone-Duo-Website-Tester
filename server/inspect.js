// GET /api/inspect?url=...
// Fetches the page once server-side and reports what the front end needs to
// render it faithfully: can it be framed directly, what its viewport meta tag
// asks for (drives the layout width, exactly like Mobile Safari), title, icon.
import {
  IPHONE_UA, fetchPublic, normalizeTarget, requestOrigin, sendJson, errorMessage, decodeHtml, UserError,
} from './net.js';

const MAX_HTML = 2_000_000;

function allowsFraming(headers, pageOrigin) {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin') || xfo.includes('allow-from')) return false;

  const csp = headers.get('content-security-policy');
  if (!csp) return true;
  const page = new URL(pageOrigin);
  // Multiple CSP headers arrive comma-joined; every policy has to allow us.
  for (const policy of csp.split(',')) {
    const directive = policy.split(';').map((d) => d.trim()).find((d) => d.toLowerCase().startsWith('frame-ancestors'));
    if (!directive) continue;
    const sources = directive.split(/\s+/).slice(1);
    const allowed = sources.some((src) => {
      if (src === '*') return true;
      if (src === "'none'" || src === "'self'") return false;
      const m = src.match(/^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/i);
      if (!m) return false;
      if (m[1] && m[1] !== page.protocol.slice(0, -1)) return false;
      const host = m[3].toLowerCase();
      return m[2] ? page.hostname.endsWith('.' + host) : page.hostname === host;
    });
    if (!allowed) return false;
  }
  return true;
}

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function parseHead(html, baseUrl) {
  const head = html.slice(0, 400_000);
  const metas = head.match(/<meta\b[^>]*>/gi) || [];
  const viewportTag = metas.find((t) => (attr(t, 'name') || '').toLowerCase() === 'viewport');
  const viewport = viewportTag ? attr(viewportTag, 'content') : null;

  const title = (head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  const links = (head.match(/<link\b[^>]*>/gi) || []).map((t) => ({
    rel: (attr(t, 'rel') || '').toLowerCase(),
    href: attr(t, 'href'),
    sizes: attr(t, 'sizes') || '',
  })).filter((l) => l.href && !/^data:,?$/.test(l.href));
  const size = (l) => Math.max(0, ...l.sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
  const touch = links.filter((l) => l.rel.includes('apple-touch-icon')).sort((a, b) => size(b) - size(a))[0];
  const icons = links.filter((l) => /(^|\s)icon(\s|$)/.test(l.rel)).sort((a, b) => size(b) - size(a));
  const best = touch || icons.find((l) => !l.href.endsWith('.svg')) || icons[0];
  let icon;
  try {
    icon = new URL(best ? best.href : '/favicon.ico', baseUrl).href;
  } catch {
    icon = null;
  }
  return { viewport, title, icon };
}

export async function handleInspect(req, res) {
  let target;
  try {
    target = normalizeTarget(new URL(req.url, 'http://local').searchParams.get('url'));
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: errorMessage(err) });
  }

  try {
    const { response, finalUrl } = await fetchPublic(target, {
      headers: {
        'user-agent': IPHONE_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': req.headers['accept-language'] || 'en-GB,en;q=0.9',
      },
    });

    const pageOrigin = requestOrigin(req);
    const contentType = response.headers.get('content-type') || '';
    const isHtml = /html|xml/i.test(contentType);
    // An https page can't frame plain http, so http sites always go through the proxy.
    const mixed = pageOrigin.startsWith('https:') && finalUrl.protocol === 'http:';
    const frameable = allowsFraming(response.headers, pageOrigin) && !mixed;

    let meta = { viewport: null, title: '', icon: null };
    if (isHtml) {
      const buf = Buffer.from(await response.arrayBuffer());
      meta = parseHead(decodeHtml(buf.subarray(0, MAX_HTML), contentType), finalUrl);
    } else {
      response.body?.cancel();
    }

    sendJson(res, 200, {
      ok: true,
      finalUrl: finalUrl.href,
      status: response.status,
      isHtml,
      frameable,
      viewport: meta.viewport,
      title: meta.title || finalUrl.hostname,
      icon: meta.icon,
    });
  } catch (err) {
    sendJson(res, err instanceof UserError ? err.status : 502, { ok: false, error: errorMessage(err) });
  }
}
