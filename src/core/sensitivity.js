// Sensitivity math. Everything is expressed in Valorant units: at sensitivity 1.0
// one mouse count rotates the camera 0.07 degrees, so a sensitivity typed here
// produces exactly the same cm/360 as the same number typed into Valorant.

/** Degrees of rotation per mouse count at Valorant sensitivity 1.0. */
export const VALORANT_YAW = 0.07;

export const SENS_MIN = 0.0001;
export const SENS_MAX = 100;
export const SENS_DECIMALS = 4;

export const DPI_MIN = 1;
export const DPI_MAX = 100000;

/** Horizontal field of view Valorant renders at (16:9). */
export const VALORANT_FOV = 103;

const LOG_MIN = Math.log10(SENS_MIN);
const LOG_MAX = Math.log10(SENS_MAX);

const CM_PER_INCH = 2.54;

/**
 * Games whose sensitivity can be converted to Valorant. `yaw` is degrees per
 * mouse count at sensitivity 1.0 in that game.
 */
export const GAMES = [
  { id: 'valorant', name: 'Valorant', yaw: VALORANT_YAW },
  { id: 'cs2', name: 'Counter-Strike 2 / CS:GO', yaw: 0.022 },
  { id: 'apex', name: 'Apex Legends', yaw: 0.022 },
  { id: 'overwatch', name: 'Overwatch 2', yaw: 0.0066 },
  { id: 'cod', name: 'Call of Duty (MW / Warzone)', yaw: 0.0066 },
];

/** Round without the usual binary floating point surprises (0.12345 -> 0.1235). */
export function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number((value * factor).toPrecision(12))) / factor;
}

/** Round to a number of significant figures. */
export function roundSignificant(value, digits) {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(digits));
}

/** Clamp a numeric sensitivity into the supported 0.0001–100 range (4 decimals). */
export function clampSensitivity(value) {
  if (!Number.isFinite(value)) return SENS_MIN;
  const rounded = roundTo(value, SENS_DECIMALS);
  return Math.min(SENS_MAX, Math.max(SENS_MIN, rounded));
}

/**
 * Parse user input into a valid sensitivity. Accepts numbers or strings
 * (a comma decimal separator is allowed). Returns null for unusable input.
 */
export function parseSensitivity(input) {
  if (input === null || input === undefined) return null;
  const text = typeof input === 'string' ? input.trim().replace(',', '.') : input;
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return clampSensitivity(value);
}

/** Format a sensitivity with up to 4 decimals and no trailing zeros. */
export function formatSensitivity(value) {
  const text = clampSensitivity(value).toFixed(SENS_DECIMALS);
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** Clamp DPI to a positive integer. */
export function clampDpi(value) {
  if (!Number.isFinite(value)) return 800;
  return Math.min(DPI_MAX, Math.max(DPI_MIN, Math.round(value)));
}

/**
 * The sensitivity slider is logarithmic so the whole 0.0001–100 range is usable:
 * every sixth of the track is one power of ten. Values snap to 3 significant figures.
 */
export function sliderToSensitivity(position) {
  const t = Math.min(1, Math.max(0, position));
  const raw = 10 ** (LOG_MIN + t * (LOG_MAX - LOG_MIN));
  return clampSensitivity(roundSignificant(raw, 3));
}

export function sensitivityToSlider(sensitivity) {
  const s = clampSensitivity(sensitivity);
  return (Math.log10(s) - LOG_MIN) / (LOG_MAX - LOG_MIN);
}

/** Degrees turned per mouse count. */
export function degreesPerCount(sensitivity, yaw = VALORANT_YAW) {
  return sensitivity * yaw;
}

/** Degrees turned for a number of mouse counts. */
export function countsToDegrees(counts, sensitivity, yaw = VALORANT_YAW) {
  return counts * sensitivity * yaw;
}

/** Physical mouse travel (cm) for one full 360° turn. */
export function cmPer360(sensitivity, dpi, yaw = VALORANT_YAW) {
  if (!(sensitivity > 0) || !(dpi > 0) || !(yaw > 0)) return Infinity;
  return (360 / (sensitivity * yaw) / dpi) * CM_PER_INCH;
}

export function inchesPer360(sensitivity, dpi, yaw = VALORANT_YAW) {
  return cmPer360(sensitivity, dpi, yaw) / CM_PER_INCH;
}

/** Effective DPI (sensitivity × DPI), the usual way players compare setups. */
export function edpi(sensitivity, dpi) {
  return sensitivity * dpi;
}

/** Sensitivity that gives a desired cm/360 at a DPI. */
export function sensitivityFromCm360(cm, dpi, yaw = VALORANT_YAW) {
  if (!(cm > 0) || !(dpi > 0) || !(yaw > 0)) return null;
  return (360 * CM_PER_INCH) / (cm * dpi * yaw);
}

/** Convert a sensitivity between games that share the same DPI (no FOV scaling). */
export function convertSensitivity(value, fromYaw, toYaw = VALORANT_YAW) {
  if (!(value > 0) || !(fromYaw > 0) || !(toYaw > 0)) return null;
  return (value * fromYaw) / toYaw;
}

/** Horizontal FOV -> vertical FOV (degrees) for a given aspect ratio. */
export function horizontalToVerticalFov(horizontalDeg, aspect) {
  const h = (horizontalDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}
