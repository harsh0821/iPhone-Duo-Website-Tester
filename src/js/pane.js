// One app window on the device screen: an iframe rendered at the real CSS
// viewport, scaled to fill the pane, plus empty / loading / error overlays.
const SANDBOX = [
  'allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox',
  'allow-modals', 'allow-downloads', 'allow-presentation', 'allow-pointer-lock',
].join(' ');

const LOAD_TIMEOUT = 25_000;

// Desktop browsers (Windows especially) give iframes a classic scrollbar that
// eats layout width; iPhone scrollbars overlay. Frames are made this much wider
// and the scrollbar is clipped off, so the page lays out at the true viewport.
let scrollbar = null;
function scrollbarWidth() {
  if (scrollbar !== null) return scrollbar;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  scrollbar = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return scrollbar;
}

export class Pane {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'pane';
    this.el.dataset.state = 'empty';
    this.el.innerHTML = `
      <div class="pane__inner"><div class="pane__overlay">
        <div class="pane__spinner">${Array.from({ length: 8 }, (_, i) => `<i style="transform:rotate(${i * 45}deg);animation-delay:${-0.8 + i * 0.1}s"></i>`).join('')}</div>
        <p class="pane__message pane__message--empty"><strong>Paste a URL</strong>Your website loads here, live.</p>
        <p class="pane__message pane__message--error"><strong>Couldn’t load this site</strong><span class="pane__error-text"></span></p>
      </div></div>`;
    this.inner = this.el.firstElementChild;
    this.errorText = this.el.querySelector('.pane__error-text');
    this.frame = null;
    this.src = null;
    this.fit = null;
    this.loaded = null;
  }

  setBox({ left, width, height, radius }) {
    Object.assign(this.el.style, {
      left: `${left}px`,
      width: `${width}px`,
      height: `${height}px`,
      borderRadius: `${radius}px`,
    });
    this.box = { width, height };
  }

  /** Render the page at layoutWidth × layoutHeight CSS px and cover-fit it to the pane. */
  setViewport(layoutWidth, layoutHeight) {
    this.fit = { layoutWidth, layoutHeight };
    this.applyFit();
  }

  applyFit() {
    if (!this.frame || !this.fit || !this.box) return;
    const { layoutWidth, layoutHeight } = this.fit;
    const k = Math.max(this.box.width / layoutWidth, this.box.height / layoutHeight);
    // Anchored in px (not 50%) so the page stays put while the pane box animates.
    Object.assign(this.frame.style, {
      width: `${layoutWidth + scrollbarWidth()}px`,
      height: `${layoutHeight}px`,
      left: `${(this.box.width - layoutWidth * k) / 2}px`,
      top: `${(this.box.height - layoutHeight * k) / 2}px`,
      transform: `scale(${k})`,
    });
  }

  load(src) {
    this.clear();
    this.src = src;
    this.el.dataset.state = 'loading';
    const frame = document.createElement('iframe');
    frame.className = 'pane__frame';
    frame.title = 'Website preview';
    frame.setAttribute('sandbox', SANDBOX);
    frame.allow = 'autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture';
    this.frame = frame;
    this.applyFit();

    this.loaded = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.frame !== frame) return;
        this.showError('The site took too long to load.');
        resolve(false);
      }, LOAD_TIMEOUT);
      frame.addEventListener('load', () => {
        if (this.frame !== frame || frame.src === 'about:blank') return;
        clearTimeout(timer);
        this.el.dataset.state = 'ready';
        this.adoptBackground();
        resolve(true);
      }, { once: true });
    });

    frame.src = src;
    this.inner.prepend(frame);
    return this.loaded;
  }

  /** Match the pane colour to the page so transitions never flash white on dark sites. */
  adoptBackground() {
    try {
      const doc = this.frame.contentDocument;
      if (!doc) return;
      const pick = (el) => el && getComputedStyle(el).backgroundColor;
      const clear = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
      const bg = [pick(doc.body), pick(doc.documentElement)].find((c) => !clear(c));
      if (bg) this.el.style.setProperty('--pane-bg', bg);
    } catch {
      /* cross-origin frame: keep white */
    }
  }

  /** Horizontal overflow in CSS px, or null when the frame can't be inspected (cross-origin). */
  measureOverflow() {
    try {
      const win = this.frame?.contentWindow;
      const doc = this.frame?.contentDocument;
      if (!win || !doc?.documentElement) return null;
      const width = doc.documentElement.clientWidth || win.innerWidth;
      const scroll = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
      return Math.max(0, Math.round(scroll - width));
    } catch {
      return null;
    }
  }

  showError(message) {
    this.el.dataset.state = 'error';
    this.errorText.textContent = message;
  }

  showEmpty() {
    this.clear();
    this.el.dataset.state = 'empty';
  }

  clear() {
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
    this.src = null;
    this.loaded = null;
    this.el.style.removeProperty('--pane-bg');
  }
}
