// Mobile screen picker (the white selector in the config card). Keyboard accessible.
import { MODES, iconMarkup } from './modes.js';

const CHECK = '<svg class="m-option__check" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class ModeDropdown {
  constructor({ trigger, menu, icon, label, onSelect }) {
    this.trigger = trigger;
    this.menu = menu;
    this.iconEl = icon;
    this.labelEl = label;
    this.onSelect = onSelect;
    this.open = false;
    this.activeIndex = 0;
    this.value = null;

    menu.innerHTML = MODES.map((m) => `
      <div class="m-option" role="option" id="m-opt-${m.id}" data-id="${m.id}" aria-selected="false">
        <span class="m-option__main">${iconMarkup(m.icon)}<span class="m-option__label">${m.label}</span></span>
        ${CHECK}
      </div>`).join('');
    this.options = [...menu.querySelectorAll('.m-option')];

    trigger.addEventListener('click', () => (this.open ? this.close() : this.show()));
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.show();
      }
    });
    menu.addEventListener('click', (e) => {
      const opt = e.target.closest('.m-option');
      if (opt) this.choose(opt.dataset.id);
    });
    menu.addEventListener('pointermove', (e) => {
      const opt = e.target.closest('.m-option');
      if (opt) this.highlight(this.options.indexOf(opt));
    });
    menu.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !menu.contains(e.target) && !trigger.contains(e.target)) this.close({ refocus: false });
    });
  }

  set(id) {
    const mode = MODES.find((m) => m.id === id);
    this.value = id;
    this.iconEl.innerHTML = iconMarkup(mode.icon);
    this.labelEl.textContent = mode.label;
    this.options.forEach((o) => o.setAttribute('aria-selected', String(o.dataset.id === id)));
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.menu.hidden = false;
    this.menu.classList.remove('is-leaving');
    this.menu.classList.add('is-entering');
    this.highlight(Math.max(0, MODES.findIndex((m) => m.id === this.value)));
    this.menu.focus({ preventScroll: true });
  }

  close({ refocus = true } = {}) {
    if (!this.open) return;
    this.open = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.menu.classList.remove('is-entering');
    this.menu.classList.add('is-leaving');
    this.menu.addEventListener('animationend', () => {
      if (!this.open) {
        this.menu.hidden = true;
        this.menu.classList.remove('is-leaving');
      }
    }, { once: true });
    if (refocus) this.trigger.focus({ preventScroll: true });
  }

  highlight(i) {
    this.activeIndex = (i + this.options.length) % this.options.length;
    this.options.forEach((o, idx) => o.classList.toggle('is-active', idx === this.activeIndex));
    this.menu.setAttribute('aria-activedescendant', this.options[this.activeIndex].id);
  }

  choose(id) {
    this.close();
    if (id !== this.value) {
      this.set(id);
      this.onSelect(id);
    }
  }

  onKey(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.highlight(this.activeIndex + 1); break;
      case 'ArrowUp': e.preventDefault(); this.highlight(this.activeIndex - 1); break;
      case 'Home': e.preventDefault(); this.highlight(0); break;
      case 'End': e.preventDefault(); this.highlight(this.options.length - 1); break;
      case 'Enter':
      case ' ': e.preventDefault(); this.choose(this.options[this.activeIndex].dataset.id); break;
      case 'Escape': e.preventDefault(); this.close(); break;
      case 'Tab': this.close({ refocus: false }); break;
      default:
    }
  }
}
