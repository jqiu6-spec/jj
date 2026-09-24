// Valorant automatic weapons. Fire rate is rounds per second; damage is the
// close-range value (0–15 m in Valorant, which covers the whole arena). Score
// stays weapon-independent; the weapon changes shot cadence, damage numbers
// and the look, sound and feel of firing.

export const WEAPONS = [
  {
    id: 'vandal',
    name: 'Vandal',
    kind: 'rifle',
    fireRate: 9.75,
    damage: { head: 160, body: 40, legs: 34 },
    magazine: 25,
  },
  {
    id: 'phantom',
    name: 'Phantom',
    kind: 'rifle',
    suppressed: true,
    fireRate: 11,
    damage: { head: 156, body: 39, legs: 33 },
    magazine: 30,
  },
  {
    id: 'spectre',
    name: 'Spectre',
    kind: 'smg',
    suppressed: true,
    fireRate: 13.33,
    damage: { head: 78, body: 26, legs: 22 },
    magazine: 30,
  },
  {
    id: 'odin',
    name: 'Odin',
    kind: 'lmg',
    fireRate: 12,
    // Spins up to its full rate over roughly a second of continuous fire.
    spinUp: { fireRate: 15.6, time: 1.25 },
    damage: { head: 95, body: 38, legs: 32 },
    magazine: 100,
  },
];

export const DEFAULT_WEAPON = 'vandal';

export function getWeapon(id) {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

/** Rounds per second after `burstTime` seconds of holding the trigger. */
export function fireRateAt(weapon, burstTime) {
  if (!weapon.spinUp) return weapon.fireRate;
  const t = Math.min(1, Math.max(0, burstTime / weapon.spinUp.time));
  return weapon.fireRate + (weapon.spinUp.fireRate - weapon.fireRate) * t;
}

/** Damage of one shot in a hit zone ('target' is an orb: counts as a body hit). */
export function damageFor(weapon, zone) {
  if (!zone) return 0;
  return weapon.damage[zone] ?? weapon.damage.body;
}
