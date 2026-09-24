const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatInt(value) {
  return integer.format(Math.round(value));
}

export function formatPercent(value, decimals = 1) {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatSeconds(value, decimals = 2) {
  return `${value.toFixed(decimals)} s`;
}

export function formatCm(value) {
  if (!Number.isFinite(value)) return '∞';
  if (value >= 1000) return `${formatInt(value)} cm`;
  return `${value.toFixed(value >= 100 ? 1 : 2)} cm`;
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Signed difference for PB comparisons: "+120" / "−45". */
export function formatDelta(value) {
  const rounded = Math.round(value);
  if (rounded === 0) return '±0';
  return rounded > 0 ? `+${formatInt(rounded)}` : `−${formatInt(-rounded)}`;
}
