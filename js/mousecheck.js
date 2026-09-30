// Mouse check (Settings): does the same hand movement always turn you the
// same amount, however you make it? Three passes between the same two
// fixed stops, slowly, fast and in small nudges, under pointer lock and
// asking for raw input exactly as a run does. With nothing between the
// mouse and the page changing the counts (pointer acceleration, rounding of
// small moves, smoothing in mouse software), every pass adds up to the same
// number of counts, since the game turns the view by counts alone.

const PASSES = [
  { name: 'Slowly', tell: 'Put the mouse against the left stop. Click, move it <b>slowly</b> to the right stop (take about three seconds), then click again.' },
  { name: 'Fast', tell: 'Back against the left stop. Click, <b>flick it quickly</b> to the right stop (well under half a second), then click.' },
  { name: 'Small nudges', tell: 'Back against the left stop. Click, then get to the right stop in <b>lots of small, quick nudges</b>, as when you micro-adjust, then click.' },
];
// Hands aren't exact: passes within this share of the slow one count as the same.
const TOLERANCE = 0.06;
// Fewer counts than this in the slow pass: the stops are too close to measure.
const MIN_COUNTS = 150;

// `el` holds the check's markup (see index.html); `wantRaw()` says whether
// to ask for raw input (the Raw input setting); `isChromium` and `isMac`
// pick the advice.
export function initMouseCheck({ el, wantRaw, isChromium, isMac }) {
  const $ = (sel) => el.querySelector(sel);
  const pad = $('.mc-pad');
  const stepEl = $('.mc-step');
  const liveEl = $('.mc-live');
  const resultEl = $('.mc-result');
  let index = -1; // pass under way, -1 when idle
  let pass = null; // counts of the pass being measured, between its clicks
  let results = [];
  let raw = false; // raw input was granted for this check

  const showStep = () => {
    stepEl.innerHTML = `<span class="mc-n">${index + 1} of ${PASSES.length}</span> ${PASSES[index].tell}`;
    liveEl.textContent = document.pointerLockElement === pad ? 'Mouse locked. Click to begin this pass.' : 'Click here to lock the mouse.';
  };

  async function lock() {
    const ask = wantRaw();
    try {
      const p = ask ? pad.requestPointerLock({ unadjustedMovement: true }) : pad.requestPointerLock();
      if (p && p.then) await p;
      raw = ask && !!(p && p.then) && isChromium;
    } catch (err) {
      if (err && err.name === 'NotSupportedError') {
        const p = pad.requestPointerLock();
        if (p && p.then) await p;
        raw = false;
      } else {
        liveEl.textContent = 'The browser refused to lock the mouse. Click here again in a moment.';
      }
    }
  }

  $('.mc-start').addEventListener('click', () => {
    index = 0;
    pass = null;
    results = [];
    resultEl.hidden = true;
    pad.hidden = false;
    showStep();
    lock();
  });

  pad.addEventListener('mousedown', (e) => {
    if (index < 0 || e.button !== 0) return;
    e.preventDefault();
    if (document.pointerLockElement !== pad) { lock(); return; }
    if (!pass) {
      pass = { x: 0, y: 0, reports: 0, biggest: 0, t0: performance.now() };
      liveEl.textContent = 'Measuring… click at the right stop.';
      return;
    }
    pass.time = (performance.now() - pass.t0) / 1000;
    results.push(pass);
    pass = null;
    index++;
    if (index < PASSES.length) { showStep(); return; }
    index = -1;
    pad.hidden = true;
    document.exitPointerLock();
    report();
  });

  document.addEventListener('mousemove', (e) => {
    if (!pass || document.pointerLockElement !== pad) return;
    pass.x += e.movementX;
    pass.y += Math.abs(e.movementY);
    const big = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
    if (big) {
      pass.reports++;
      if (big > pass.biggest) pass.biggest = big;
    }
    liveEl.textContent = `Measuring… ${Math.abs(pass.x).toLocaleString('en-US')} counts. Click at the right stop.`;
  });

  document.addEventListener('pointerlockchange', () => {
    if (index >= 0 && document.pointerLockElement !== pad) {
      pass = null;
      liveEl.textContent = 'Mouse released. Click here to carry on with this pass.';
    } else if (index >= 0) {
      showStep();
    }
  });

  function report() {
    const [slow] = results;
    const base = Math.abs(slow.x);
    if (base < MIN_COUNTS) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p>The slow pass came to only ${base} counts, too few to compare. Use stops further apart (15 cm or more) and move left to right, then run the check again.</p>`;
      return;
    }
    const rows = results.map((r, i) => {
      const k = Math.abs(r.x) / base;
      const rate = r.time > 0 ? Math.round(r.reports / r.time) : 0;
      return { name: PASSES[i].name, counts: Math.abs(r.x), k, rate, biggest: r.biggest };
    });
    const off = rows.slice(1).map((r) => r.k - 1);
    const worst = Math.max(...off.map(Math.abs));
    const table = rows.map((r) => `<tr><td>${r.name}</td><td>${r.counts.toLocaleString('en-US')}</td><td>${r.k.toFixed(2)}×</td><td>${r.rate}/s</td><td>${r.biggest}</td></tr>`).join('');
    let verdict;
    if (worst <= TOLERANCE) {
      verdict = `<p class="ok"><b>Linear.</b> All three passes came within ${Math.round(worst * 100)}% of each other, so small, slow and fast movements turn you by the same amount; the game gets your mouse exactly. If aiming still looks unstable, it's the picture rather than the mouse: press Esc in a run and check the line on the pause screen for late frames.</p>`;
    } else {
      const [fast, small] = off;
      const what = [];
      if (Math.abs(fast) > TOLERANCE) what.push(fast > 0 ? `the fast pass came to ${Math.round(fast * 100)}% more counts than the slow one, so quick movements turn you further` : `the fast pass came to ${Math.round(-fast * 100)}% fewer counts than the slow one`);
      if (Math.abs(small) > TOLERANCE) what.push(small < 0 ? `small nudges came to ${Math.round(-small * 100)}% fewer counts, so small movements are being shrunk or lost` : `small nudges came to ${Math.round(small * 100)}% more counts, so small movements are being enlarged`);
      let fix;
      if (!raw) {
        fix = isMac
          ? 'Raw input isn\'t on, so macOS pointer acceleration changes the counts with speed. Play in Chrome or Edge with Raw input on, or turn off System Settings › Mouse › Pointer acceleration (under Advanced… on older macOS).'
          : 'Raw input isn\'t on, so Windows changes the counts with speed. Play in Chrome or Edge with Raw input on, or turn off Enhance pointer precision (Settings › Bluetooth & devices › Mouse › Additional mouse settings › Pointer Options) and set the pointer speed to the middle (6 of 11).';
      } else {
        fix = `Raw input is on, so the browser isn't adding acceleration: look at your mouse's own software (Logitech G HUB, Razer Synapse, SteelSeries GG and the like) for acceleration, smoothing, "angle snapping" or "lift-off" settings and turn them off.${isMac ? ' On macOS, Chrome\'s raw input can also round small moves: turn Raw input off above, turn off System Settings › Mouse › Pointer acceleration, and run the check again to compare.' : ' You can also turn Raw input off above and run the check again to compare.'}`;
      }
      verdict = `<p class="bad"><b>Not linear:</b> ${what.join('; ')}. Something between your mouse and the game changes the counts with how you move it. ${fix}</p>`;
    }
    resultEl.hidden = false;
    resultEl.innerHTML = `${verdict}
      <table class="mc-table"><thead><tr><th>Pass</th><th>Counts</th><th>vs slow</th><th>Reports</th><th>Biggest</th></tr></thead><tbody>${table}</tbody></table>
      <p class="hint">Raw input ${raw ? 'on' : 'off'} for this check. Reports: how many times a second the mouse sent movement; biggest: the largest single report, in counts.</p>`;
  }
}
