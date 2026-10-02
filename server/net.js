// Shared networking helpers for the inspect + proxy handlers.
// Every upstream request goes through fetchPublic(), which refuses to talk to
// private / loopback / link-local addresses (SSRF guard) on every redirect hop.
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const PROXY_PREFIX = '/__proxy/';
export const TARGET_COOKIE = 'duo_target';

// Mobile Safari on iOS 18: what the page would see on a real iPhone.
export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'string') throw new UserError('Enter a website URL');
  let value = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UserError('That does not look like a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserError('Only http and https links work');
  if (!url.hostname.includes('.') && !net.isIP(url.hostname)) throw new UserError('That does not look like a valid URL');
  url.hash = '';
  return url;
}

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

const hostCache = new Map();
async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UserError('Local addresses cannot be previewed');
  }
  const cached = hostCache.get(host);
  if (cached && cached.until > Date.now()) {
    if (!cached.ok) throw new UserError('Private network addresses cannot be previewed');
    return;
  }
  let addresses;
  if (net.isIP(host)) addresses = [{ address: host }];
  else {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new UserError('We could not find that website', 502);
    }
  }
  const ok = addresses.length > 0 && addresses.every((a) => !isPrivateIP(a.address));
  hostCache.set(host, { ok, until: Date.now() + 60_000 });
  if (!ok) throw new UserError('Private network addresses cannot be previewed');
}

/**
 * fetch() with manual redirects so every hop is SSRF-checked.
 * followRedirects=false returns the 3xx response itself (the proxy rewrites it).
 */
export async function fetchPublic(url, { followRedirects = true, maxRedirects = 6, ...init } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    const location = response.headers.get('location');
    if (followRedirects && response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && init.method === 'POST')) {
        init = { ...init, method: 'GET', body: undefined };
      }
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new UserError('That website redirects too many times', 502);
}

// "https://www.apple.com/mac/?a=1" -> "/__proxy/https/www.apple.com/mac/?a=1"
export function toProxyPath(absUrl) {
  const u = new URL(absUrl);
  return `${PROXY_PREFIX}${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`;
}

// Inverse of toProxyPath. Accepts the part after the prefix plus the query string.
export function fromProxyPath(rest, search = '') {
  const m = rest.match(/^(https?)\/([^/?#]+)(\/.*)?$/);
  if (!m) throw new UserError('Bad proxy path');
  return new URL(`${m[1]}://${m[2]}${m[3] || '/'}${search}`);
}

export function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function errorMessage(err) {
  if (err instanceof UserError) return err.message;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'That website took too long to respond';
  return 'We could not reach that website';
}

export async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body !== undefined && req.body !== null) {
    // Vercel may pre-parse bodies.
    if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body;
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function decodeHtml(buffer, contentType) {
  const header = /charset=([^;]+)/i.exec(contentType || '')?.[1]?.trim();
  const sniff = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 2048).toString('latin1'))?.[1];
  const charset = (header || sniff || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}
