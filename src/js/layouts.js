// Desktop "Layouts" list: every screen mode is always visible; the selected one
// grows (bigger icon + label, dot) between two short separators.
import { MODES, iconMarkup } from './modes.js';

export class LayoutList {
  constructor(root, { onSelect }) {
    this.root = root;
    this.onSelect = onSelect;
    this.value = null;

    root.innerHTML = MODES.map((m) => `
      <button class="layout" type="button" role="radio" aria-checked="false" data-id="${m.id}">
        <span class="layout__sep layout__sep--top" aria-hidden="true"><img src="/assets/layout-separator.svg" alt=""></span>
        <span class="layout__card">
          <span class="layout__main">${iconMarkup(m.icon)}<span class="layout__label">${m.label}</span></span>
          <img class="layout__dot" src="/assets/selected-dot.svg" alt="">
        </span>
        <span class="layout__sep layout__sep--bottom" aria-hidden="true"><img src="/assets/layout-separator.svg" alt=""></span>
      </button>`).join('');
    this.items = [...root.querySelectorAll('.layout')];

    root.addEventListener('click', (e) => {
      const item = e.target.closest('.layout');
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
      this.items.find((el) => el.dataset.id === next.id).focus();
    });
  }

  set(id) {
    this.value = id;
    for (const el of this.items) {
      const on = el.dataset.id === id;
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on ? 0 : -1;
    }
  }

  choose(id) {
    if (id === this.value) return;
    this.set(id);
    this.onSelect(id);
  }
}
