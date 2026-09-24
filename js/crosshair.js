// Draws the crosshair onto a canvas, centred. Sizes are in CSS pixels.

export function drawCrosshair(canvas, cfg) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 96;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = canvas.height = Math.round(size * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const c = size / 2;
  const { style, color, length, thickness, gap, dot, outline } = cfg;

  const shapes = [];
  const bar = (x, y, w, h) => shapes.push(['rect', x, y, w, h]);
  const t = thickness;
  if (style === 'cross' || style === 'crossdot') {
    bar(c - t / 2, c - gap - length, t, length); // up
    bar(c - t / 2, c + gap, t, length); // down
    bar(c - gap - length, c - t / 2, length, t); // left
    bar(c + gap, c - t / 2, length, t); // right
  }
  if (style === 'crossdot' || style === 'dot' || style === 'circle') {
    shapes.push(['dot', c, c, Math.max(dot, 0.5)]);
  }
  if (style === 'circle') {
    shapes.push(['ring', c, c, gap + length / 2, t]);
  }

  const paint = (pad, fill) => {
    g.fillStyle = fill;
    g.strokeStyle = fill;
    for (const s of shapes) {
      if (s[0] === 'rect') {
        g.fillRect(s[1] - pad, s[2] - pad, s[3] + pad * 2, s[4] + pad * 2);
      } else if (s[0] === 'dot') {
        g.beginPath();
        g.arc(s[1], s[2], s[3] / 2 + pad, 0, Math.PI * 2);
        g.fill();
      } else {
        g.lineWidth = s[4] + pad * 2;
        g.beginPath();
        g.arc(s[1], s[2], s[3], 0, Math.PI * 2);
        g.stroke();
      }
    }
  };
  if (outline) paint(1, 'rgba(0,0,0,0.85)');
  paint(0, color);
}
