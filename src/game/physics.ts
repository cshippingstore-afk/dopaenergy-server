/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — Server-side Physics & Combat
   Authoritative simulation: movement, shooting, damage, zone
   ═══════════════════════════════════════════════════════════════════════ */

import {
  CELL, MAP_W, MAP_H, PLAYER_R, SPEED, WEAPONS,
  ZONE_PHASES, collideAndSlide, isSolid,
  type WeaponDef,
} from './config';

// ── Input from client ────────────────────────────────────────────────
export interface PlayerInput {
  seq:     number;   // sequence number for reconciliation
  keys:    number;   // bitmask: W=1, A=2, S=4, D=8
  angle:   number;   // mouse aim angle (radians)
  fire:    boolean;
  reload:  boolean;
  slot:    number;   // active inventory slot (0-4)
  sprint:  boolean;
}

// ── Server player state ──────────────────────────────────────────────
export interface ServerPlayer {
  id:           string;
  name:         string;
  x:            number;
  z:            number;
  angle:        number;
  hp:           number;
  shield:       number;
  alive:        boolean;
  kills:        number;
  placement:    number;

  // Inventory
  inventory:    InventorySlot[];
  activeSlot:   number;

  // Timing
  lastFireTime: number;  // ms timestamp
  reloading:    boolean;
  reloadEnd:    number;  // ms timestamp when reload completes

  // Anti-cheat
  lastInputSeq: number;
  lastMoveTime: number;

  // Wallet
  walletAddress: string;
}

export interface InventorySlot {
  weapon:  string;
  ammo:    number;
  reserve: number;
}

// ── Server projectile ────────────────────────────────────────────────
export interface ServerProjectile {
  x:       number;
  z:       number;
  vx:      number;
  vz:      number;
  ownerId: string;
  damage:  number;
  alive:   boolean;
  age:     number;  // seconds alive
}

// ── Loot drop ────────────────────────────────────────────────────────
export interface ServerDrop {
  id:    number;
  x:     number;
  z:     number;
  type:  string;   // weapon key or 'shield' | 'medkit' | 'ammo'
  taken: boolean;
}

// ── Zone state ───────────────────────────────────────────────────────
export interface ZoneState {
  phase:        number;
  centerX:      number;
  centerZ:      number;
  radius:       number;
  targetRadius: number;
  shrinking:    boolean;
  timer:        number;
  dmgTimers:    Map<string, number>;  // per-player zone damage cooldown
}

// ── Game state container ─────────────────────────────────────────────
export interface GameWorld {
  map:         number[][];
  players:     Map<string, ServerPlayer>;
  projectiles: ServerProjectile[];
  drops:       ServerDrop[];
  zone:        ZoneState;
  matchTime:   number;   // seconds since match started
  nextDropId:  number;
  rng:         () => number;
}

// ═══════════════════════════════════════════════════════════════════════
// PROCESS PLAYER INPUT (server-authoritative)
// ═══════════════════════════════════════════════════════════════════════

export function processInput(world: GameWorld, player: ServerPlayer, input: PlayerInput, dt: number, now: number): void {
  if (!player.alive) return;

  // Anti-cheat: reject old/duplicate inputs
  if (input.seq <= player.lastInputSeq) return;
  player.lastInputSeq = input.seq;

  // ── Slot switch ──
  if (input.slot >= 0 && input.slot < player.inventory.length) {
    if (player.activeSlot !== input.slot) {
      player.activeSlot = input.slot;
      player.reloading = false; // cancel reload on switch
    }
  }

  // ── Movement ──
  player.angle = input.angle;
  const slot = player.inventory[player.activeSlot];
  const weaponKey = slot ? slot.weapon : 'knife';
  const wep = WEAPONS[weaponKey] || WEAPONS.knife;
  const speedMul = wep.speedMul * (input.sprint ? 1.3 : 1.0);
  const spd = SPEED * speedMul * dt;

  let wx = 0, wz = 0;
  if (input.keys & 1) wz += spd;  // W
  if (input.keys & 4) wz -= spd;  // S
  if (input.keys & 2) wx -= spd;  // A
  if (input.keys & 8) wx += spd;  // D

  // Rotate by aim angle
  const sin = Math.sin(input.angle);
  const cos = Math.cos(input.angle);
  const mx = wx * cos - wz * sin;
  const mz = wx * sin + wz * cos;

  const result = collideAndSlide(world.map, player.x, player.z, mx, mz);

  // Anti-cheat: validate movement isn't too fast
  const dist = Math.hypot(result.x - player.x, result.z - player.z);
  const maxDist = SPEED * 1.5 * dt * 1.5; // generous margin
  if (dist <= maxDist) {
    player.x = result.x;
    player.z = result.z;
  }

  // ── Reload ──
  if (input.reload && !player.reloading && slot && slot.ammo < (WEAPONS[slot.weapon]?.ammo || 0) && slot.reserve > 0) {
    player.reloading = true;
    player.reloadEnd = now + (wep.reloadTime || 2) * 1000;
  }

  // Check reload completion
  if (player.reloading && now >= player.reloadEnd) {
    player.reloading = false;
    if (slot) {
      const wepDef = WEAPONS[slot.weapon];
      if (wepDef) {
        const need = wepDef.ammo - slot.ammo;
        const take = Math.min(need, slot.reserve);
        slot.ammo += take;
        slot.reserve -= take;
      }
    }
  }

  // ── Fire ──
  if (input.fire && !player.reloading && slot) {
    const fireInterval = 60000 / wep.rpm;
    if (now - player.lastFireTime >= fireInterval) {
      if (wep.type === 'melee') {
        // Melee: check nearby players
        processMelee(world, player, wep, now);
      } else if (slot.ammo > 0) {
        // Ranged: spawn projectile(s)
        const pellets = wep.pellets || 1;
        for (let p = 0; p < pellets; p++) {
          const spread = (Math.random() - 0.5) * wep.spread * 2;
          const angle = input.angle + spread;
          const projSpeed = 180;
          world.projectiles.push({
            x: player.x,
            z: player.z,
            vx: Math.sin(angle) * projSpeed,
            vz: Math.cos(angle) * projSpeed,
            ownerId: player.id,
            damage: wep.damage,
            alive: true,
            age: 0,
          });
        }
        slot.ammo--;
        player.lastFireTime = now;
      }
    }
  }
}

function processMelee(world: GameWorld, attacker: ServerPlayer, wep: WeaponDef, now: number): void {
  const fireInterval = 60000 / wep.rpm;
  if (now - attacker.lastFireTime < fireInterval) return;
  attacker.lastFireTime = now;

  for (const [, target] of world.players) {
    if (target.id === attacker.id || !target.alive) continue;
    const dist = Math.hypot(target.x - attacker.x, target.z - attacker.z);
    if (dist <= wep.range) {
      applyDamage(world, target, wep.damage, attacker);
      break; // only hit one target per swing
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DAMAGE
// ═══════════════════════════════════════════════════════════════════════

export function applyDamage(world: GameWorld, target: ServerPlayer, damage: number, attacker?: ServerPlayer): void {
  if (!target.alive) return;

  // Shield absorbs first
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    damage -= absorbed;
  }

  target.hp -= damage;

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    if (attacker && attacker.id !== target.id) {
      attacker.kills++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// UPDATE PROJECTILES
// ═══════════════════════════════════════════════════════════════════════

export function updateProjectiles(world: GameWorld, dt: number): void {
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (!p.alive) { world.projectiles.splice(i, 1); continue; }

    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.age += dt;

    // Out of bounds or hit wall
    if (isSolid(world.map, p.x, p.z) || p.x < 0 || p.z < 0 || p.x > MAP_W * CELL || p.z > MAP_H * CELL || p.age > 3) {
      world.projectiles.splice(i, 1);
      continue;
    }

    // Hit detection against players
    for (const [, player] of world.players) {
      if (player.id === p.ownerId || !player.alive) continue;
      const dist = Math.hypot(player.x - p.x, player.z - p.z);
      if (dist < PLAYER_R * 2) {
        const attacker = world.players.get(p.ownerId);
        applyDamage(world, player, p.damage, attacker);
        world.projectiles.splice(i, 1);
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// UPDATE ZONE
// ═══════════════════════════════════════════════════════════════════════

export function updateZone(world: GameWorld, dt: number): void {
  const zone = world.zone;
  if (zone.phase <= 0) return;

  if (zone.shrinking) {
    const phaseDef = ZONE_PHASES[zone.phase - 1];
    const remaining = zone.radius - zone.targetRadius;
    if (remaining > 0) {
      const shrinkSpeed = remaining / Math.max(phaseDef.shrinkTime, 0.1);
      zone.radius = Math.max(zone.targetRadius, zone.radius - shrinkSpeed * dt);
    }
    if (Math.abs(zone.radius - zone.targetRadius) < 1) {
      zone.radius = zone.targetRadius;
      zone.shrinking = false;
      if (zone.phase < ZONE_PHASES.length) {
        zone.timer = ZONE_PHASES[zone.phase].delay;
      }
    }
  } else {
    zone.timer -= dt;
    if (zone.timer <= 0 && zone.phase < ZONE_PHASES.length) {
      zone.phase++;
      zone.targetRadius = ZONE_PHASES[zone.phase - 1].radius;
      zone.shrinking = true;
    }
  }

  // Zone damage to all players
  for (const [, player] of world.players) {
    if (!player.alive) continue;
    const dist = Math.hypot(player.x - zone.centerX, player.z - zone.centerZ);
    if (dist > zone.radius) {
      const timer = zone.dmgTimers.get(player.id) || 0;
      if (timer <= 0) {
        zone.dmgTimers.set(player.id, 0.5);
        const dmg = 3 + zone.phase * 2;
        applyDamage(world, player, dmg);
      } else {
        zone.dmgTimers.set(player.id, timer - dt);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LOOT PICKUP
// ═══════════════════════════════════════════════════════════════════════

export function processPickup(world: GameWorld, player: ServerPlayer, dropId: number): boolean {
  const drop = world.drops.find(d => d.id === dropId && !d.taken);
  if (!drop || !player.alive) return false;

  const dist = Math.hypot(player.x - drop.x, player.z - drop.z);
  if (dist > CELL * 1.5) return false; // too far

  if (drop.type === 'medkit') {
    player.hp = Math.min(100, player.hp + 50);
    drop.taken = true;
    return true;
  }

  if (drop.type === 'shield') {
    player.shield = Math.min(100, player.shield + 50);
    drop.taken = true;
    return true;
  }

  if (drop.type === 'ammo') {
    player.inventory.forEach(s => {
      if (s && WEAPONS[s.weapon] && WEAPONS[s.weapon].type !== 'melee') {
        s.reserve += WEAPONS[s.weapon].maxAmmo;
      }
    });
    drop.taken = true;
    return true;
  }

  // Weapon pickup
  const wep = WEAPONS[drop.type];
  if (!wep) return false;

  // Find existing slot with this weapon or empty slot
  const existing = player.inventory.findIndex(s => s && s.weapon === drop.type);
  if (existing >= 0) {
    player.inventory[existing].reserve += wep.maxAmmo;
    drop.taken = true;
    return true;
  }

  const empty = player.inventory.findIndex((s, i) => i > 0 && !s);
  if (empty >= 0) {
    player.inventory[empty] = { weapon: drop.type, ammo: wep.ammo, reserve: wep.maxAmmo };
    drop.taken = true;
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// SPAWN LOOT DROPS
// ═══════════════════════════════════════════════════════════════════════

export function spawnDrops(world: GameWorld, count: number): void {
  const dropTypes = ['mp5', 'shotgun', 'ak47', 'awp', 'shield', 'medkit', 'ammo'];

  for (let i = 0; i < count; i++) {
    let x: number, z: number;
    let attempts = 0;
    do {
      x = (5 + world.rng() * (MAP_W - 10)) * CELL;
      z = (5 + world.rng() * (MAP_H - 10)) * CELL;
      attempts++;
    } while (isSolid(world.map, x, z) && attempts < 50);

    if (attempts >= 50) continue;

    world.drops.push({
      id: world.nextDropId++,
      x, z,
      type: dropTypes[Math.floor(world.rng() * dropTypes.length)],
      taken: false,
    });
  }
}
