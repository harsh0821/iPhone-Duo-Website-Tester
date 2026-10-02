// "Popular websites": a fixed list of the four sites from the design.
// Rendered into every target (desktop shows 4, mobile 2); the site on screen is highlighted.
const SITES = [
  { url: 'https://www.apple.com', icon: '/assets/logo-apple.svg' },
  { url: 'https://www.notion.so', icon: '/assets/logo-notion.svg' },
  { url: 'https://www.airbnb.com', icon: '/assets/logo-airbnb.svg' },
  { url: 'https://www.figma.com', icon: '/assets/logo-figma.png', figma: true },
];

export function displayUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

const sameSite = (a, b) => displayUrl(a) === displayUrl(b);

export class PopularSites {
  /**
   * @param targets [{ el, limit, arrow }] lists to render into
   */
  constructor(targets, { onPick }) {
    this.targets = targets;
    this.onPick = onPick;
    this.current = null;
    this.render();
  }

  setCurrent(url) {
    this.current = url;
    for (const { el } of this.targets) {
      el.querySelectorAll('.recent').forEach((btn) => {
        btn.toggleAttribute('aria-current', !!url && sameSite(url, btn.dataset.url));
      });
    }
  }

  render() {
    for (const { el, limit, arrow } of this.targets) {
      el.replaceChildren(...SITES.slice(0, limit).map((site) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recent';
        btn.dataset.url = site.url;
        btn.title = `Test ${site.url}`;
        btn.innerHTML = `
          <span class="recent__icon${site.figma ? ' recent__icon--figma' : ''}"><img src="${site.icon}" alt=""></span>
          <span class="recent__url">${displayUrl(site.url)}</span>
          <img class="recent__go" src="${arrow}" alt="">`;
        btn.addEventListener('click', () => this.onPick(site.url));
        li.append(btn);
        return li;
      }));
    }
  }
}
