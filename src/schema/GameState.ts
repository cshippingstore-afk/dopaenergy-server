/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — Colyseus State Schema
   Binary-serialized game state, auto-synced to all clients via deltas
   ═══════════════════════════════════════════════════════════════════════ */

import { Schema, type, MapSchema, ArraySchema, filter } from '@colyseus/schema';

// ── Inventory Slot ───────────────────────────────────────────────────
export class InventorySlotSchema extends Schema {
  @type('string')  weapon:  string  = 'knife';
  @type('int16')   ammo:    number  = 0;
  @type('int16')   reserve: number  = 0;
}

// ── Player ───────────────────────────────────────────────────────────
export class PlayerSchema extends Schema {
  @type('string')  id:         string  = '';
  @type('string')  name:       string  = '';
  @type('float32') x:          number  = 0;
  @type('float32') z:          number  = 0;
  @type('float32') angle:      number  = 0;
  @type('int16')   hp:         number  = 100;
  @type('int16')   shield:     number  = 0;
  @type('boolean') alive:      boolean = true;
  @type('int16')   kills:      number  = 0;
  @type('int16')   placement:  number  = 0;
  @type('int8')    activeSlot: number  = 1;
  @type('boolean') reloading:  boolean = false;

  @type([InventorySlotSchema])
  inventory = new ArraySchema<InventorySlotSchema>();
}

// ── Loot Drop ────────────────────────────────────────────────────────
export class DropSchema extends Schema {
  @type('int32')   id:    number  = 0;
  @type('float32') x:     number  = 0;
  @type('float32') z:     number  = 0;
  @type('string')  type:  string  = '';
  @type('boolean') taken: boolean = false;
}

// ── Kill Feed Entry ──────────────────────────────────────────────────
export class KillFeedEntry extends Schema {
  @type('string')  killer:  string = '';
  @type('string')  victim:  string = '';
  @type('float64') time:    number = 0;
}

// ── Zone ─────────────────────────────────────────────────────────────
export class ZoneSchema extends Schema {
  @type('int8')    phase:        number  = 0;
  @type('float32') centerX:      number  = 0;
  @type('float32') centerZ:      number  = 0;
  @type('float32') radius:       number  = 700;
  @type('float32') targetRadius: number  = 700;
  @type('boolean') shrinking:    boolean = false;
  @type('float32') timer:        number  = 0;
}

// ── Match State ──────────────────────────────────────────────────────
export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

export class GameState extends Schema {
  @type('string')  matchPhase: string = 'lobby';
  @type('float32') matchTimer: number = 0;
  @type('float32') countdown:  number = 0;
  @type('int32')   mapSeed:    number = 0;
  @type('int8')    aliveCount: number = 0;

  @type({ map: PlayerSchema })
  players = new MapSchema<PlayerSchema>();

  @type([DropSchema])
  drops = new ArraySchema<DropSchema>();

  @type(ZoneSchema)
  zone = new ZoneSchema();

  @type([KillFeedEntry])
  killFeed = new ArraySchema<KillFeedEntry>();
}
