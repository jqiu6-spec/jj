/** Tiny element builder: h('div', { class: 'x', onclick }, child, 'text'). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    // setProperty (not Object.assign) so custom properties like --swatch work.
    else if (key === 'style' && typeof value === 'object') Object.entries(value).forEach(([p, v]) => el.style.setProperty(p, v));
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Same as h() but for SVG elements. */
export function s(tag, props = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Only touch the DOM when the text actually changes (the HUD updates every frame). */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/** Radio-group keyboard behaviour for a set of role="radio" buttons. */
export function bindRovingRadios(container, onSelect) {
  container.addEventListener('keydown', (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    const radios = $$('[role="radio"]', container);
    const index = radios.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const next = radios[(index + keys[event.key] + radios.length) % radios.length];
    next.focus();
    onSelect(next.dataset.value);
  });
}

export function markRadios(container, value) {
  for (const radio of $$('[role="radio"]', container)) {
    const checked = radio.dataset.value === String(value);
    radio.setAttribute('aria-checked', String(checked));
    radio.tabIndex = checked ? 0 : -1;
  }
}
