// Layout pickers: the desktop "Display layouts" list and the mobile sideways
// row. Both are radio groups over MODES; picking one calls onSelect.
import { MODES, thumbMarkup } from './modes.js';

const DOT = '<img class="layout__dot" src="/assets/selected-dot.svg" alt="" width="8" height="8">';

const desktopCard = (m) => `
  <button class="layout" type="button" role="radio" aria-checked="false" data-id="${m.id}">
    <span class="layout__main">
      ${thumbMarkup(m)}
      <span class="layout__text">
        <span class="layout__title">${m.label}</span>
        <span class="layout__desc">${m.desc}</span>
      </span>
    </span>
    ${DOT}
  </button>`;

const mobileCard = (m) => `
  <button class="m-layout" type="button" role="radio" aria-checked="false" data-id="${m.id}" aria-label="${m.label}">
    ${thumbMarkup(m)}
    <span class="m-layout__label" aria-hidden="true"><span>${m.lines[0]}</span><span>${m.lines[1]}</span></span>
  </button>`;

export class LayoutPicker {
  /**
   * @param variant 'desktop' | 'mobile'
   */
  constructor(root, { variant = 'desktop', onSelect }) {
    this.root = root;
    this.variant = variant;
    this.onSelect = onSelect;
    this.value = null;
    root.innerHTML = MODES.map(variant === 'mobile' ? mobileCard : desktopCard).join('');
    this.items = [...root.querySelectorAll('[role="radio"]')];

    root.addEventListener('click', (e) => {
      const item = e.target.closest('[role="radio"]');
      if (item) this.choose(item.dataset.id);
    });
    // Radio group keyboard behaviour: arrows move and select.
    root.addEventListener('keydown', (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const i = MODES.findIndex((m) => m.id === this.value);
      const next = MODES[(i + step + MODES.length) % MODES.length];
      this.choose(next.id);
      this.items.find((el) => el.dataset.id === next.id).focus({ preventScroll: true });
    });

    if (variant === 'mobile') {
      // Hide the "more this way" shade once the row is scrolled to its end.
      const wrap = root.parentElement;
      const edge = () => wrap.classList.toggle('is-at-end', root.scrollLeft + root.clientWidth >= root.scrollWidth - 4);
      root.addEventListener('scroll', edge, { passive: true });
      requestAnimationFrame(edge);
    }
  }

  set(id, { reveal = false } = {}) {
    this.value = id;
    for (const el of this.items) {
      const on = el.dataset.id === id;
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on ? 0 : -1;
    }
    if (reveal && this.variant === 'mobile') this.reveal(id);
  }

  /** Glide the selected card into view in the sideways row. */
  reveal(id, { instant = false } = {}) {
    const el = this.items.find((x) => x.dataset.id === id);
    if (!el) return;
    const pad = 14.845;
    const left = el.offsetLeft - pad;
    const right = el.offsetLeft + el.offsetWidth + pad - this.root.clientWidth;
    const target = this.root.scrollLeft > left ? left : this.root.scrollLeft < right ? right : null;
    if (target !== null) this.root.scrollTo({ left: Math.max(0, target), behavior: instant ? 'auto' : 'smooth' });
  }

  choose(id) {
    if (id === this.value) return;
    this.set(id, { reveal: true });
    this.onSelect(id);
  }
}
