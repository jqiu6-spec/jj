// Mouse check (Settings): does the same hand movement always turn you the
// same amount, however you make it? Passes between the same two fixed
// stops, slowly, fast and in small nudges, under pointer lock. With nothing
// between the mouse and the page changing the counts (pointer acceleration,
// rounding of small moves, smoothing in mouse software), every pass adds up
// to the same number of counts, since the game turns the view by counts
// alone.
//
// In Chrome and Edge it runs the passes twice, with raw input and without,
// because the two take different routes from the mouse: raw input is the
// mouse's own counts as the system reports them (on macOS, its
// "unaccelerated" movement), and without it the counts are the pointer's
// movement, which is exact once the system's pointer acceleration is off.
// It then recommends whichever came out linear.

const PASSES = [
  { name: 'Slowly', tell: 'Put the mouse against the left stop. Click, move it <b>slowly</b> to the right stop (take about three seconds), then click again.' },
  { name: 'Fast', tell: 'Back against the left stop. Click, <b>flick it quickly</b> to the right stop (well under half a second), then click.' },
  { name: 'Small nudges', tell: 'Back against the left stop. Click, then get to the right stop in <b>lots of small, quick nudges</b>, as when you micro-adjust, then click.' },
];
// Hands aren't exact: passes within this share of the slow one count as the same.
const TOLERANCE = 0.06;
// Fewer counts than this in a slow pass: the stops are too close to measure.
const MIN_COUNTS = 150;

// `el` holds the check's markup (see index.html). `getRaw()` / `setRaw(on)`
// read and change the Raw input setting; `isChromium` (raw input possible)
// and `isMac` pick the passes and the advice.
export function initMouseCheck({ el, getRaw, setRaw, isChromium, isMac }) {
  const $ = (sel) => el.querySelector(sel);
  const pad = $('.mc-pad');
  const stepEl = $('.mc-step');
  const liveEl = $('.mc-live');
  const resultEl = $('.mc-result');
  let steps = []; // { pass, raw } in order
  let index = -1; // step under way, -1 when idle
  let pass = null; // counts of the pass being measured, between its clicks
  let results = [];
  let lockedRaw = null; // raw input granted to the current lock

  const showStep = () => {
    const s = steps[index];
    const group = isChromium ? ` <span class="mc-n">(raw input ${s.raw ? 'on' : 'off'})</span>` : '';
    stepEl.innerHTML = `<span class="mc-n">${index + 1} of ${steps.length}</span> ${PASSES[s.pass].tell}${group}`;
    const ready = document.pointerLockElement === pad && lockedRaw === s.raw;
    liveEl.textContent = ready ? 'Mouse locked. Click to begin this pass.'
      : document.pointerLockElement === pad ? `Click to switch raw input ${s.raw ? 'on' : 'off'}, then click again to begin.`
        : 'Click here to lock the mouse.';
  };

  // Lock the mouse to the pad, with or without raw input; while it's locked
  // this changes the kind of lock in place.
  async function lock(raw) {
    try {
      const p = raw ? pad.requestPointerLock({ unadjustedMovement: true }) : pad.requestPointerLock();
      if (p && p.then) await p;
      lockedRaw = raw && !!(p && p.then) && isChromium;
    } catch (err) {
      if (err && err.name === 'NotSupportedError') {
        const p = pad.requestPointerLock();
        if (p && p.then) await p;
        lockedRaw = false;
      } else {
        liveEl.textContent = 'The browser refused to lock the mouse. Click here again in a moment.';
        return;
      }
    }
    if (index >= 0) showStep();
  }

  $('.mc-start').addEventListener('click', () => {
    // Raw input first where there is any, then without.
    const modes = isChromium ? [true, false] : [false];
    steps = modes.flatMap((raw) => PASSES.map((_, pass) => ({ pass, raw })));
    index = 0;
    pass = null;
    results = [];
    resultEl.hidden = true;
    pad.hidden = false;
    showStep();
    lock(steps[0].raw);
  });

  pad.addEventListener('mousedown', (e) => {
    if (index < 0 || e.button !== 0) return;
    e.preventDefault();
    const s = steps[index];
    if (document.pointerLockElement !== pad || lockedRaw !== s.raw) { lock(s.raw); return; }
    if (!pass) {
      pass = { x: 0, reports: 0, biggest: 0, t0: performance.now() };
      liveEl.textContent = 'Measuring… click at the right stop.';
      return;
    }
    pass.time = (performance.now() - pass.t0) / 1000;
    results.push({ ...s, ...pass });
    pass = null;
    index++;
    if (index < steps.length) { showStep(); return; }
    index = -1;
    pad.hidden = true;
    document.exitPointerLock();
    report();
  });

  document.addEventListener('mousemove', (e) => {
    if (!pass || document.pointerLockElement !== pad) return;
    pass.x += e.movementX;
    const big = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
    if (big) {
      pass.reports++;
      if (big > pass.biggest) pass.biggest = big;
    }
    liveEl.textContent = `Measuring… ${Math.abs(pass.x).toLocaleString('en-US')} counts. Click at the right stop.`;
  });

  document.addEventListener('pointerlockchange', () => {
    if (index < 0) return;
    if (document.pointerLockElement !== pad) {
      pass = null;
      lockedRaw = null;
      liveEl.textContent = 'Mouse released. Click here to carry on with this pass.';
    } else {
      showStep();
    }
  });

  // One mode's passes: counts against its slow pass, and how far off the
  // others are.
  function judge(rows) {
    const base = Math.abs(rows[0].x);
    const out = rows.map((r) => ({
      name: PASSES[r.pass].name,
      counts: Math.abs(r.x),
      k: base ? Math.abs(r.x) / base : 0,
      rate: r.time > 0 ? Math.round(r.reports / r.time) : 0,
      biggest: r.biggest,
    }));
    const off = out.slice(1).map((r) => r.k - 1);
    return { rows: out, base, off, worst: Math.max(...off.map(Math.abs)), linear: base >= MIN_COUNTS && Math.max(...off.map(Math.abs)) <= TOLERANCE };
  }

  function describe(j) {
    const [fast, small] = j.off;
    const what = [];
    if (Math.abs(fast) > TOLERANCE) what.push(fast > 0 ? `quick moves came to ${Math.round(fast * 100)}% more counts than slow ones` : `quick moves came to ${Math.round(-fast * 100)}% fewer counts than slow ones`);
    if (Math.abs(small) > TOLERANCE) what.push(small < 0 ? `small nudges came to ${Math.round(-small * 100)}% fewer counts (small movements shrink)` : `small nudges came to ${Math.round(small * 100)}% more counts (small movements grow)`);
    return what.join('; ');
  }

  function report() {
    const groups = [true, false].map((raw) => results.filter((r) => r.raw === raw)).filter((g) => g.length);
    const judged = groups.map((g) => ({ raw: g[0].raw, ...judge(g) }));
    const tooShort = judged.find((j) => j.base < MIN_COUNTS);
    resultEl.hidden = false;
    if (tooShort) {
      resultEl.innerHTML = `<p>A slow pass came to only ${tooShort.base} counts, too few to compare. Use stops further apart (15 cm or more) and move left to right, then run the check again.</p>`;
      return;
    }
    const withRaw = judged.find((j) => j.raw);
    const without = judged.find((j) => !j.raw);
    const accelFix = isMac
      ? 'System Settings › Mouse › Pointer acceleration (under Advanced… on older macOS)'
      : 'Enhance pointer precision, in Settings › Bluetooth & devices › Mouse › Additional mouse settings › Pointer Options, with the pointer speed in the middle (6 of 11)';
    let verdict;
    let apply = null; // the Raw input setting to recommend
    if (withRaw && without) {
      if (withRaw.linear && without.linear) {
        verdict = `<p class="ok"><b>Linear both ways.</b> Small, slow and fast movements turn you by the same amount, with raw input and without, so the game gets your mouse exactly. If aiming still looks unstable, it's the picture rather than the mouse: press Esc in a run and check the line on the pause screen for late frames.</p>`;
      } else if (!withRaw.linear && without.linear) {
        apply = false;
        verdict = `<p class="bad"><b>Raw input isn't linear on this computer:</b> ${describe(withRaw)}. Without raw input it is. Turn Raw input off, and keep the system's pointer acceleration off: ${accelFix}.</p>`;
      } else if (withRaw.linear && !without.linear) {
        apply = true;
        verdict = `<p class="ok"><b>Raw input is linear; keep it on.</b> Without it, ${describe(without)}, which is the system's pointer acceleration: ${accelFix}.</p>`;
      } else {
        verdict = `<p class="bad"><b>Not linear either way:</b> with raw input, ${describe(withRaw)}; without, ${describe(without)}. Since both routes are off, it's likely the mouse itself: its software (Logitech G HUB, Razer Synapse, SteelSeries GG and the like) can add acceleration, smoothing, "angle snapping" or a "lift-off" cut; turn those off and run the check again.</p>`;
      }
    } else {
      const j = without || withRaw;
      verdict = j.linear
        ? `<p class="ok"><b>Linear.</b> Small, slow and fast movements turn you by the same amount, so the game gets your mouse exactly. If aiming still looks unstable, press Esc in a run and check the line on the pause screen for late frames.</p>`
        : `<p class="bad"><b>Not linear:</b> ${describe(j)}. This browser can't give raw input, so the system's pointer acceleration applies: turn off ${accelFix}, or play in Chrome or Edge.</p>`;
    }
    const table = judged.map((j) => j.rows.map((r) => `<tr><td>${isChromium ? `${j.raw ? 'Raw' : 'No raw'}: ` : ''}${r.name}</td><td>${r.counts.toLocaleString('en-US')}</td><td>${r.k.toFixed(2)}×</td><td>${r.rate}/s</td><td>${r.biggest}</td></tr>`).join('')).join('');
    const current = getRaw();
    const button = apply !== null && apply !== current
      ? `<button type="button" class="mc-start mc-apply">Turn Raw input ${apply ? 'on' : 'off'}</button>`
      : apply !== null ? `<p class="hint">Raw input is already ${apply ? 'on' : 'off'}.</p>` : '';
    resultEl.innerHTML = `${verdict}${button}
      <table class="mc-table"><thead><tr><th>Pass</th><th>Counts</th><th>vs slow</th><th>Reports</th><th>Biggest</th></tr></thead><tbody>${table}</tbody></table>
      <p class="hint">Counts are compared with the slow pass of the same kind. Reports: how many times a second the mouse sent movement; biggest: the largest single report, in counts.</p>`;
    const b = resultEl.querySelector('.mc-apply');
    if (b) {
      b.addEventListener('click', () => {
        setRaw(apply);
        b.replaceWith(Object.assign(document.createElement('p'), { className: 'hint', textContent: `Raw input is now ${apply ? 'on' : 'off'}; it applies from your next run.` }));
      });
    }
  }
}
