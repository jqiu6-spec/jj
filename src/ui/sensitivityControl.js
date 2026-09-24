import {
  clampDpi,
  clampSensitivity,
  cmPer360,
  degreesPerCount,
  DPI_MAX,
  DPI_MIN,
  edpi,
  formatSensitivity,
  inchesPer360,
  parseSensitivity,
  SENS_MAX,
  SENS_MIN,
  sensitivityToSlider,
  sliderToSensitivity,
} from '../core/sensitivity.js';
import { h, setText } from './dom.js';
import { formatCm, formatInt } from './format.js';

const SLIDER_STEPS = 6000;
const TICKS = ['0.0001', '0.001', '0.01', '0.1', '1', '10', '100'];
let uid = 0;

/** Arrow-key step that scales with the value: 0.4 → 0.01, 2.5 → 0.1, 0.004 → 0.0001. */
export function sensitivityStep(value, big = false) {
  const base = Math.max(10 ** (Math.floor(Math.log10(value)) - 1), SENS_MIN);
  return big ? base * 10 : base;
}

/**
 * Valorant sensitivity + DPI editor with a logarithmic slider and live
 * cm/360 readouts. Several instances can share one store and stay in sync.
 */
export function createSensitivityControl(store) {
  const id = `sens-${++uid}`;
  const input = h('input', {
    id: `${id}-value`,
    class: 'input sens-input',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': `${id}-help`,
  });
  const slider = h('input', {
    type: 'range',
    class: 'range log-range',
    min: 0,
    max: SLIDER_STEPS,
    step: 1,
    'aria-label': 'Valorant sensitivity slider, logarithmic from 0.0001 to 100',
  });
  const dpi = h('input', {
    id: `${id}-dpi`,
    class: 'input',
    type: 'number',
    inputmode: 'numeric',
    min: DPI_MIN,
    max: DPI_MAX,
    step: 1,
  });
  const help = h('p', { class: 'hint', id: `${id}-help` }, `Range ${SENS_MIN} – ${SENS_MAX}, up to 4 decimals. ↑/↓ to nudge.`);
  const out = {
    cm: h('dd'),
    inch: h('dd'),
    edpi: h('dd'),
    perCount: h('dd'),
  };

  const root = h(
    'div',
    { class: 'sens-control' },
    h(
      'div',
      { class: 'sens-row' },
      h('div', { class: 'sens-field' }, h('label', { class: 'label', for: input.id }, 'Valorant sensitivity'), input),
      h('div', { class: 'dpi-field' }, h('label', { class: 'label', for: dpi.id }, 'Mouse DPI'), dpi),
    ),
    h(
      'div',
      { class: 'slider-wrap' },
      slider,
      h(
        'div',
        { class: 'log-ticks', 'aria-hidden': 'true' },
        TICKS.map((t, i) => h('span', { style: { '--p': String(i / (TICKS.length - 1)) } }, t)),
      ),
    ),
    help,
    h(
      'dl',
      { class: 'readouts' },
      h('div', {}, h('dt', {}, 'cm/360'), out.cm),
      h('div', {}, h('dt', {}, 'in/360'), out.inch),
      h('div', {}, h('dt', {}, 'eDPI'), out.edpi),
      h('div', {}, h('dt', {}, '°/count'), out.perCount),
    ),
  );

  const showReadouts = (sens, dpiValue) => {
    setText(out.cm, formatCm(cmPer360(sens, dpiValue)));
    const inches = inchesPer360(sens, dpiValue);
    setText(out.inch, Number.isFinite(inches) ? `${inches.toFixed(inches >= 100 ? 1 : 2)} in` : '∞');
    const e = edpi(sens, dpiValue);
    setText(out.edpi, e >= 100 ? formatInt(e) : String(Number(e.toPrecision(3))));
    setText(out.perCount, `${Number(degreesPerCount(sens).toPrecision(4))}°`);
  };

  const setHelp = (message, isError) => {
    help.textContent = message ?? `Range ${SENS_MIN} – ${SENS_MAX}, up to 4 decimals. ↑/↓ to nudge.`;
    help.classList.toggle('is-error', Boolean(isError));
    input.setAttribute('aria-invalid', String(Boolean(isError)));
  };

  const render = (state) => {
    if (document.activeElement !== input) input.value = formatSensitivity(state.sensitivity);
    // While the slider has focus it is the source of truth; snapping its value
    // back from the rounded sensitivity would make it stick under arrow keys.
    if (document.activeElement !== slider) {
      slider.value = String(Math.round(sensitivityToSlider(state.sensitivity) * SLIDER_STEPS));
    }
    slider.setAttribute('aria-valuetext', formatSensitivity(state.sensitivity));
    if (document.activeElement !== dpi) dpi.value = String(state.dpi);
    showReadouts(state.sensitivity, state.dpi);
  };

  input.addEventListener('input', () => {
    const value = Number(input.value.trim().replace(',', '.'));
    if (input.value.trim() !== '' && Number.isFinite(value) && value >= SENS_MIN && value <= SENS_MAX) {
      setHelp(null, false);
      store.set('sensitivity', clampSensitivity(value));
    }
  });

  const commitInput = () => {
    const raw = Number(input.value.trim().replace(',', '.'));
    const parsed = parseSensitivity(input.value);
    if (parsed === null) {
      setHelp(`“${input.value}” isn’t a number. Enter a value from ${SENS_MIN} to ${SENS_MAX}.`, true);
      input.value = formatSensitivity(store.get().sensitivity);
      return;
    }
    if (raw < SENS_MIN || raw > SENS_MAX) setHelp(`Limited to ${formatSensitivity(parsed)} (range ${SENS_MIN} – ${SENS_MAX}).`, false);
    else setHelp(null, false);
    store.set('sensitivity', parsed);
    input.value = formatSensitivity(parsed);
  };
  input.addEventListener('change', commitInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commitInput();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const current = parseSensitivity(input.value) ?? store.get().sensitivity;
    const step = sensitivityStep(current, event.shiftKey);
    const next = clampSensitivity(current + (event.key === 'ArrowUp' ? step : -step));
    store.set('sensitivity', next);
    input.value = formatSensitivity(next);
    setHelp(null, false);
  });

  slider.addEventListener('input', () => {
    setHelp(null, false);
    store.set('sensitivity', sliderToSensitivity(Number(slider.value) / SLIDER_STEPS));
  });

  dpi.addEventListener('input', () => {
    const value = Number(dpi.value);
    if (Number.isInteger(value) && value >= DPI_MIN && value <= DPI_MAX) store.set('dpi', value);
  });
  dpi.addEventListener('change', () => {
    const value = Number(dpi.value);
    const next = dpi.value.trim() === '' || !Number.isFinite(value) ? store.get().dpi : clampDpi(value);
    store.set('dpi', next);
    dpi.value = String(next);
  });

  const unsubscribe = store.subscribe((state) => render(state));
  render(store.get());
  return { root, destroy: unsubscribe };
}
