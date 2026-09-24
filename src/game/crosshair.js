// Valorant-style crosshair drawn in device pixels so sizes match the in-game
// values (a 2px line is two physical pixels, independent of browser zoom).

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Rectangles (relative to the centre pixel corner) for each crosshair element.
 * Odd thicknesses are nudged so both sides of the crosshair get the same gap.
 */
export function crosshairRects(cfg) {
  const rects = [];
  const lines = (length, thickness, offset, opacity) => {
    if (length <= 0 || opacity <= 0) return;
    const half = Math.floor(thickness / 2);
    const odd = thickness % 2;
    const near = offset + odd;
    rects.push({ x: near, y: -half, w: length, h: thickness, opacity }); // right
    rects.push({ x: -offset - length, y: -half, w: length, h: thickness, opacity }); // left
    rects.push({ x: -half, y: near, w: thickness, h: length, opacity }); // bottom
    rects.push({ x: -half, y: -offset - length, w: thickness, h: length, opacity }); // top
  };
  if (cfg.innerLines) lines(cfg.innerLength, cfg.innerThickness, cfg.innerOffset, cfg.innerOpacity);
  if (cfg.outerLines) lines(cfg.outerLength, cfg.outerThickness, cfg.outerOffset, cfg.outerOpacity);
  if (cfg.centerDot && cfg.centerDotOpacity > 0) {
    const size = cfg.centerDotThickness;
    const half = Math.floor(size / 2);
    rects.push({ x: -half, y: -half, w: size, h: size, opacity: cfg.centerDotOpacity });
  }
  return rects;
}

/** Draw the crosshair centred on (cx, cy), which should be integer pixels. */
export function drawCrosshair(ctx, cx, cy, cfg) {
  const rects = crosshairRects(cfg);
  const [r, g, b] = hexToRgb(cfg.color);
  if (cfg.outline && cfg.outlineOpacity > 0) {
    const o = cfg.outlineThickness;
    ctx.fillStyle = `rgba(0, 0, 0, ${cfg.outlineOpacity})`;
    for (const rect of rects) {
      ctx.fillRect(cx + rect.x - o, cy + rect.y - o, rect.w + o * 2, rect.h + o * 2);
    }
  }
  for (const rect of rects) {
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${rect.opacity})`;
    ctx.fillRect(cx + rect.x, cy + rect.y, rect.w, rect.h);
  }
}

/** Size a full-screen overlay canvas to device pixels and draw the crosshair at its centre. */
export function renderCrosshairOverlay(canvas, cfg) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  drawCrosshair(ctx, Math.floor(width / 2), Math.floor(height / 2), cfg);
}
