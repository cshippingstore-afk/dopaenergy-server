/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — Shared Game Configuration
   Single source of truth for all game constants.
   Mirror of arena.js values — keep in sync!
   ═══════════════════════════════════════════════════════════════════════ */

// ── Map ──────────────────────────────────────────────────────────────
export const CELL   = 10;
export const MAP_W  = 100;
export const MAP_H  = 100;
export const PLAYER_R = 1.5;
export const SPEED  = 45;

// ── Weapons ──────────────────────────────────────────────────────────
export interface WeaponDef {
  label:      string;
  damage:     number;
  range:      number;
  rpm:        number;
  ammo:       number;
  maxAmmo:    number;
  spread:     number;
  reloadTime: number;
  type:       string;
  speedMul:   number;
  pellets?:   number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  knife:   { label: 'KNIFE',  damage: 40,  range: 15,  rpm: 120, ammo: Infinity, maxAmmo: Infinity, spread: 0,     reloadTime: 0,   type: 'melee',   speedMul: 1.15 },
  pistol:  { label: 'USP-S',  damage: 30,  range: 150, rpm: 400, ammo: 12, maxAmmo: 24,  spread: 0.02,  reloadTime: 2.2, type: 'pistol',  speedMul: 1.0  },
  mp5:     { label: 'MP5',    damage: 18,  range: 120, rpm: 750, ammo: 30, maxAmmo: 120, spread: 0.05,  reloadTime: 2.5, type: 'smg',     speedMul: 1.05 },
  shotgun: { label: 'NOVA',   damage: 18,  range: 80,  rpm: 70,  ammo: 8,  maxAmmo: 32,  spread: 0.15,  reloadTime: 3.5, type: 'shotgun', speedMul: 0.95, pellets: 8 },
  ak47:    { label: 'AK-47',  damage: 36,  range: 200, rpm: 600, ammo: 30, maxAmmo: 90,  spread: 0.03,  reloadTime: 2.5, type: 'rifle',   speedMul: 0.9  },
  awp:     { label: 'AWP',    damage: 115, range: 400, rpm: 41,  ammo: 5,  maxAmmo: 20,  spread: 0.005, reloadTime: 3.6, type: 'sniper',  speedMul: 0.85 },
};

// ── Zone phases ──────────────────────────────────────────────────────
export interface ZonePhase {
  delay:      number;   // seconds before shrinking starts
  radius:     number;   // target safe-zone radius (world units)
  shrinkTime: number;   // seconds to shrink to target
}

export const ZONE_PHASES: ZonePhase[] = [
  { delay: 45, radius: 420, shrinkTime: 15 },
  { delay: 30, radius: 300, shrinkTime: 12 },
  { delay: 25, radius: 200, shrinkTime: 10 },
  { delay: 20, radius: 120, shrinkTime: 8  },
  { delay: 15, radius: 60,  shrinkTime: 6  },
  { delay: 10, radius: 20,  shrinkTime: 5  },
];

// ── Economy ──────────────────────────────────────────────────────────
export const ENTRY_FEE       = 100_000;   // DOPA per arena entry
export const BURN_PCT        = 0.03;      // 3% burned permanently
export const KILL_POOL_PCT   = 0.12;      // 12% of net pool shared by kills
export const SPEC_POOL_PCT   = 0.05;      // 5% spectator prediction cut

// Placement reward percentages (index = placement, 1-indexed)
export const PLACE_PCTS = [0, 0.50, 0.20, 0.10, 0.06, 0.04, 0.025, 0.025, 0.015, 0.015, 0.01];

// ── Lobby ────────────────────────────────────────────────────────────
export const MIN_PLAYERS       = 5;
export const MAX_PLAYERS       = 50;
export const LOBBY_COUNTDOWN   = 60;      // seconds after min reached
export const PREMATCH_COUNTDOWN = 5;      // seconds before gameplay starts

// ── Server tick ──────────────────────────────────────────────────────
export const TICK_RATE   = 20;            // server updates per second
export const TICK_MS     = 1000 / TICK_RATE;

// ── Loot drop types ─────────────────────────────────────────────────
export const DROP_TYPES = ['mp5', 'shotgun', 'ak47', 'awp', 'shield', 'medkit', 'ammo'] as const;
export type DropType = typeof DROP_TYPES[number];

// ── Map generation (seeded) ─────────────────────────────────────────
export function generateMap(seed: number): number[][] {
  // Simple seeded PRNG (mulberry32)
  let s = seed | 0;
  function rand(): number {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const map: number[][] = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(0));

  // Border walls
  for (let x = 0; x < MAP_W; x++) { map[0][x] = 1; map[MAP_H - 1][x] = 1; }
  for (let y = 0; y < MAP_H; y++) { map[y][0] = 1; map[y][MAP_W - 1] = 1; }

  // City blocks
  const B = (bx: number, by: number, w: number, h: number) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (by + dy > 0 && by + dy < MAP_H - 1 && bx + dx > 0 && bx + dx < MAP_W - 1)
        map[by + dy][bx + dx] = 1;
    }
  };

  for (let by = 5; by < MAP_H - 10; by += 14) {
    for (let bx = 5; bx < MAP_W - 10; bx += 14) {
      if (rand() > 0.75) continue;
      B(bx, by, 6 + Math.floor(rand() * 5), 6 + Math.floor(rand() * 5));
    }
  }

  // Central plaza — clear spawn area
  for (let cy = 40; cy <= 60; cy++)
    for (let cx = 40; cx <= 60; cx++)
      map[cy][cx] = 0;

  // Scattered cover
  for (let i = 0; i < 200; i++) {
    const cx = Math.floor(rand() * MAP_W);
    const cy = Math.floor(rand() * MAP_H);
    if (cx > 45 && cx < 55 && cy > 45 && cy < 55) continue;
    if (cx > 0 && cx < MAP_W - 1 && cy > 0 && cy < MAP_H - 1 && map[cy][cx] === 0)
      map[cy][cx] = 2;
  }

  return map;
}

// ── Physics helpers ─────────────────────────────────────────────────
export function isSolid(map: number[][], x: number, z: number): boolean {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  if (cx < 0 || cz < 0 || cx >= MAP_W || cz >= MAP_H) return true;
  return map[cz][cx] === 1 || map[cz][cx] === 2;
}

export function collideAndSlide(
  map: number[][],
  entX: number, entZ: number,
  wishX: number, wishZ: number
): { x: number; z: number } {
  let nx = entX + wishX;
  let nz = entZ + wishZ;
  const r = PLAYER_R * 0.8;

  if (wishX > 0) { if (isSolid(map, nx + r, entZ + r) || isSolid(map, nx + r, entZ - r)) nx = entX; }
  else if (wishX < 0) { if (isSolid(map, nx - r, entZ + r) || isSolid(map, nx - r, entZ - r)) nx = entX; }

  if (wishZ > 0) { if (isSolid(map, entX + r, nz + r) || isSolid(map, entX - r, nz + r)) nz = entZ; }
  else if (wishZ < 0) { if (isSolid(map, entX + r, nz - r) || isSolid(map, entX - r, nz - r)) nz = entZ; }

  return { x: nx, z: nz };
}

// ── Spawn point finder ──────────────────────────────────────────────
export function findSpawnPoint(map: number[][], taken: Array<{x: number, z: number}>, rng: () => number): { x: number; z: number } {
  const margin = 5 * CELL;
  const maxW = MAP_W * CELL - margin;
  const maxH = MAP_H * CELL - margin;

  for (let attempt = 0; attempt < 100; attempt++) {
    const x = margin + rng() * (maxW - margin);
    const z = margin + rng() * (maxH - margin);

    if (isSolid(map, x, z)) continue;

    // Ensure minimum distance from other spawns
    const tooClose = taken.some(t => Math.hypot(t.x - x, t.z - z) < 40);
    if (tooClose) continue;

    return { x, z };
  }

  // Fallback: center plaza area
  return { x: 50 * CELL, z: 50 * CELL };
}
