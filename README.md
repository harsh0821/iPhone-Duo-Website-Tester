# iPhone Duo Website Tester

Paste a URL and see the live website on the iPhone Duo in all five screen modes:
Outer Portrait, Outer Landscape, Inner Portrait, Inner Landscape and Inner Split.
The UI is a 1:1 build of the Figma "Final Design" section (1920 × 1000 frames).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` outputs a static site to `dist/`; the
`/api` folder deploys as Vercel serverless functions (`vercel.json` holds the rewrites).

## Viewports

From the reported panel specs at iPhone's @3x scale (edit in `src/js/modes.js`):

| Screen | Panel | CSS viewport |
|---|---|---|
| Outer (5.5") | 1422 × 2088 px | 474 × 696 pt |
| Inner (7.8") | 2713 × 1920 px | 904 × 640 pt |
| Inner Split | two apps + 13 pt divider | 445 × 640 pt each |

Pages are laid out exactly as Mobile Safari would: `width=device-width` gets the
viewport width; no viewport tag gets the 980 px desktop layout, zoomed to fit.

## How live rendering works

1. `/api/inspect` fetches the page once server side: can it be framed, what its
   viewport tag says, title and icon.
2. Sites that allow framing load directly in an iframe.
3. Sites that refuse framing (`X-Frame-Options` / `frame-ancestors`) load through
   `/__proxy/…`: the page is unchanged apart from framing headers being dropped, a
   `<base>` back to the real site, and a small bootstrap that keeps links, forms,
   redirects, history and workers inside the proxy. `public/sw.js` routes CORS
   requests (web fonts, ES modules, fetch) through the proxy so they keep working.
4. Proxied pages are same origin, so the tester can measure real horizontal overflow
   at each viewport and report it in the status area.

Known limits of the proxy: sites that pick content from their own hostname (e.g.
Airbnb's regional redirect), WebSockets, and logged-in state (cookies are not carried).

## Structure

```
index.html            markup for the 1920 × 1000 stage
src/styles/           tokens.css (Figma values), app.css
src/js/modes.js       every Figma measurement + viewport per mode
src/js/devices.js     device builds, spring rotation, fold/unfold morph, split glide
src/js/pane.js        one iframe window: viewport fit, overlays, overflow check
src/js/spring.js      Apple-style spring baked into CSS linear() easing
server/               inspect + proxy handlers (shared by Vite dev and Vercel)
api/                  Vercel function entry points
public/sw.js          proxy helper service worker (scope /__proxy/)
public/assets/        bezels, background, icons exported from Figma
```

## Before going public

The proxy will fetch any public site for anyone who calls it. It blocks private and
local addresses (SSRF guard) but has no rate limit; add one (or Vercel's firewall
rules) before sharing the URL widely.
