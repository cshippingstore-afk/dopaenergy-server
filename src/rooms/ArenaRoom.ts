/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — Arena Room
   Colyseus room that manages the full match lifecycle:
   lobby → countdown → playing → ended
   ═══════════════════════════════════════════════════════════════════════ */

import { Room, Client } from 'colyseus';
import {
  GameState, PlayerSchema, DropSchema, KillFeedEntry,
  InventorySlotSchema,
} from '../schema/GameState';
import {
  GameWorld, ServerPlayer, ZoneState,
  processInput, updateProjectiles, updateZone,
  processPickup, spawnDrops, type PlayerInput,
} from '../game/physics';
import {
  CELL, MAP_W, MAP_H, WEAPONS, ZONE_PHASES,
  MIN_PLAYERS, MAX_PLAYERS, LOBBY_COUNTDOWN,
  PREMATCH_COUNTDOWN, TICK_RATE, TICK_MS,
  generateMap, findSpawnPoint, ENTRY_FEE,
} from '../game/config';
import { DopaVerifier } from '../services/DopaVerifier';
import { MatchSettler, type PlayerResult } from '../services/MatchSettler';

// ── Seeded PRNG ──────────────────────────────────────────────────────
function createRng(seed: number) {
  let s = seed | 0;
  return function rand(): number {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ArenaRoom extends Room<GameState> {
  // ── Internal state (not synced to clients) ──
  private world!:         GameWorld;
  private serverPlayers   = new Map<string, ServerPlayer>();
  private dopaVerifier    = new DopaVerifier();
  private matchSettler    = new MatchSettler();
  private nextPlacement   = 0;
  private matchId         = '';
  private lobbyTimer      = -1;
  private prematchTimer   = -1;
  private dropSpawnTimer  = 0;

  // ═════════════════════════════════════════════════════════════════════
  // ROOM LIFECYCLE
  // ═════════════════════════════════════════════════════════════════════

  onCreate(options: any) {
    this.maxClients = MAX_PLAYERS;
    this.matchId = `ARENA-${Date.now().toString(36).toUpperCase()}`;

    console.log(`[Arena] Room ${this.matchId} created`);

    // Initialize state
    const state = new GameState();
    const seed = options.seed || Math.floor(Math.random() * 2147483647);
    state.mapSeed = seed;
    state.matchPhase = 'lobby';
    this.setState(state);

    // Build world
    const rng = createRng(seed);
    const map = generateMap(seed);

    this.world = {
      map,
      players: new Map(),
      projectiles: [],
      drops: [],
      zone: {
        phase: 0,
        centerX: MAP_W * CELL / 2,
        centerZ: MAP_H * CELL / 2,
        radius: MAP_W * CELL * 0.7,
        targetRadius: MAP_W * CELL * 0.7,
        shrinking: false,
        timer: 0,
        dmgTimers: new Map(),
      },
      matchTime: 0,
      nextDropId: 1,
      rng,
    };

    // ── Register message handlers ──
    this.onMessage('input', (client, data: PlayerInput) => {
      const player = this.serverPlayers.get(client.sessionId);
      if (player && this.state.matchPhase === 'playing') {
        processInput(this.world, player, data, TICK_MS / 1000, Date.now());
      }
    });

    this.onMessage('pickup', (client, data: { dropId: number }) => {
      const player = this.serverPlayers.get(client.sessionId);
      if (player && this.state.matchPhase === 'playing') {
        processPickup(this.world, player, data.dropId);
      }
    });

    this.onMessage('chat', (client, data: { text: string }) => {
      const player = this.serverPlayers.get(client.sessionId);
      if (player && typeof data.text === 'string') {
        const sanitized = data.text.slice(0, 100).replace(/[<>]/g, '');
        this.broadcast('chat', { name: player.name, text: sanitized });
      }
    });

    // ── Start game loop ──
    this.setSimulationInterval((dt) => this.gameLoop(dt), TICK_MS);

    console.log(`[Arena] Room ready — seed: ${seed}, waiting for players...`);
  }

  // ═════════════════════════════════════════════════════════════════════
  // PLAYER JOIN
  // ═════════════════════════════════════════════════════════════════════

  async onJoin(client: Client, options: any) {
    const name = (options.name || `Player_${client.sessionId.slice(0, 4)}`).slice(0, 16);
    const walletAddress = options.walletAddress || '';

    console.log(`[Arena] ${name} joining (${client.sessionId})...`);

    // Verify DOPA balance (paid arena only)
    if (options.paidArena) {
      const result = await this.dopaVerifier.verifyBalance(walletAddress);
      if (!result.valid) {
        client.send('error', { code: 'INSUFFICIENT_DOPA', message: result.message });
        client.leave();
        return;
      }
    }

    // Don't allow joining mid-match
    if (this.state.matchPhase === 'playing' || this.state.matchPhase === 'ended') {
      client.send('error', { code: 'MATCH_IN_PROGRESS', message: 'Match already in progress' });
      client.leave();
      return;
    }

    // Create server player
    const spawnPoints = Array.from(this.serverPlayers.values()).map(p => ({ x: p.x, z: p.z }));
    const spawn = findSpawnPoint(this.world.map, spawnPoints, this.world.rng);

    const serverPlayer: ServerPlayer = {
      id: client.sessionId,
      name,
      x: spawn.x,
      z: spawn.z,
      angle: 0,
      hp: 100,
      shield: 0,
      alive: true,
      kills: 0,
      placement: 0,
      inventory: [
        { weapon: 'knife',  ammo: Infinity, reserve: Infinity },
        { weapon: 'pistol', ammo: 12,       reserve: 24 },
      ],
      activeSlot: 1,
      lastFireTime: 0,
      reloading: false,
      reloadEnd: 0,
      lastInputSeq: 0,
      lastMoveTime: Date.now(),
      walletAddress,
    };

    this.serverPlayers.set(client.sessionId, serverPlayer);
    this.world.players.set(client.sessionId, serverPlayer);

    // Sync to Colyseus state
    const schemaPlayer = new PlayerSchema();
    schemaPlayer.id = client.sessionId;
    schemaPlayer.name = name;
    schemaPlayer.x = spawn.x;
    schemaPlayer.z = spawn.z;
    schemaPlayer.hp = 100;
    schemaPlayer.alive = true;
    schemaPlayer.activeSlot = 1;

    // Inventory
    const knifeSlot = new InventorySlotSchema();
    knifeSlot.weapon = 'knife'; knifeSlot.ammo = 9999; knifeSlot.reserve = 9999;
    const pistolSlot = new InventorySlotSchema();
    pistolSlot.weapon = 'pistol'; pistolSlot.ammo = 12; pistolSlot.reserve = 24;
    schemaPlayer.inventory.push(knifeSlot, pistolSlot);

    this.state.players.set(client.sessionId, schemaPlayer);
    this.state.aliveCount = this.countAlive();

    // Notify all
    this.broadcast('playerJoined', { name, total: this.state.players.size });

    // Send map seed to this client
    client.send('init', { sessionId: client.sessionId, mapSeed: this.state.mapSeed });

    console.log(`[Arena] ${name} joined. Players: ${this.state.players.size}/${MAX_PLAYERS}`);

    // Check lobby countdown trigger
    this.checkLobbyStart();
  }

  // ═════════════════════════════════════════════════════════════════════
  // PLAYER LEAVE
  // ═════════════════════════════════════════════════════════════════════

  onLeave(client: Client, consented: boolean) {
    const player = this.serverPlayers.get(client.sessionId);
    const name = player?.name || client.sessionId;

    console.log(`[Arena] ${name} left (consented: ${consented})`);

    if (player && player.alive && this.state.matchPhase === 'playing') {
      // Kill them — no disconnect grace in arena
      player.alive = false;
      this.nextPlacement--;
      player.placement = this.nextPlacement;

      const schemaPlayer = this.state.players.get(client.sessionId);
      if (schemaPlayer) {
        schemaPlayer.alive = false;
        schemaPlayer.placement = player.placement;
      }

      this.addKillFeed('DISCONNECT', name);
      this.state.aliveCount = this.countAlive();
      this.checkVictory();
    }

    // Remove from lobby if not playing yet
    if (this.state.matchPhase === 'lobby' || this.state.matchPhase === 'countdown') {
      this.serverPlayers.delete(client.sessionId);
      this.world.players.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      this.state.aliveCount = this.countAlive();

      // Cancel countdown if below min
      if (this.state.players.size < MIN_PLAYERS && this.state.matchPhase === 'countdown') {
        this.state.matchPhase = 'lobby';
        this.lobbyTimer = -1;
        this.broadcast('lobbyCancelled', { reason: 'Not enough players' });
      }
    }
  }

  onDispose() {
    console.log(`[Arena] Room ${this.matchId} disposed`);
  }

  // ═════════════════════════════════════════════════════════════════════
  // MAIN GAME LOOP (runs at TICK_RATE Hz)
  // ═════════════════════════════════════════════════════════════════════

  private gameLoop(dtMs: number) {
    const dt = dtMs / 1000;

    switch (this.state.matchPhase) {
      case 'lobby':
        // Just waiting for players
        break;

      case 'countdown':
        this.lobbyTimer -= dt;
        this.state.countdown = Math.max(0, Math.ceil(this.lobbyTimer));
        if (this.lobbyTimer <= 0) {
          this.startPrematch();
        }
        break;

      case 'prematch':
        this.prematchTimer -= dt;
        this.state.countdown = Math.max(0, Math.ceil(this.prematchTimer));
        if (this.prematchTimer <= 0) {
          this.startMatch();
        }
        break;

      case 'playing':
        this.updatePlaying(dt);
        break;

      case 'ended':
        // Match over — room will auto-dispose after timeout
        break;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // LOBBY → COUNTDOWN → PREMATCH → PLAYING
  // ═════════════════════════════════════════════════════════════════════

  private checkLobbyStart() {
    if (this.state.matchPhase !== 'lobby') return;
    if (this.state.players.size >= MIN_PLAYERS) {
      this.state.matchPhase = 'countdown';
      this.lobbyTimer = LOBBY_COUNTDOWN;
      this.state.countdown = LOBBY_COUNTDOWN;
      this.broadcast('countdownStarted', { seconds: LOBBY_COUNTDOWN });
      console.log(`[Arena] Lobby countdown started: ${LOBBY_COUNTDOWN}s`);
    }
  }

  private startPrematch() {
    this.state.matchPhase = 'prematch' as any;
    this.prematchTimer = PREMATCH_COUNTDOWN;
    this.state.countdown = PREMATCH_COUNTDOWN;

    // Lock room — no more joins
    this.lock();

    // Respawn all players at fresh positions
    const spawnsTaken: Array<{x: number, z: number}> = [];
    for (const [id, player] of this.serverPlayers) {
      const spawn = findSpawnPoint(this.world.map, spawnsTaken, this.world.rng);
      spawnsTaken.push(spawn);
      player.x = spawn.x;
      player.z = spawn.z;
      player.hp = 100;
      player.shield = 0;
      player.alive = true;

      const schema = this.state.players.get(id);
      if (schema) {
        schema.x = spawn.x;
        schema.z = spawn.z;
        schema.hp = 100;
        schema.alive = true;
      }
    }

    this.broadcast('prematch', { seconds: PREMATCH_COUNTDOWN });
    console.log(`[Arena] Prematch countdown: ${PREMATCH_COUNTDOWN}s`);
  }

  private startMatch() {
    this.state.matchPhase = 'playing';
    this.state.matchTimer = 0;
    this.nextPlacement = this.state.players.size + 1;

    // Initialize zone
    this.world.zone = {
      phase: 1,
      centerX: MAP_W * CELL / 2,
      centerZ: MAP_H * CELL / 2,
      radius: MAP_W * CELL * 0.7,
      targetRadius: MAP_W * CELL * 0.7,
      shrinking: false,
      timer: ZONE_PHASES[0].delay,
      dmgTimers: new Map(),
    };
    this.syncZone();

    // Spawn initial loot
    spawnDrops(this.world, 80);
    this.syncDrops();

    this.state.aliveCount = this.countAlive();
    this.broadcast('matchStarted', { players: this.state.players.size });

    console.log(`[Arena] MATCH STARTED — ${this.state.players.size} players!`);
  }

  // ═════════════════════════════════════════════════════════════════════
  // PLAYING STATE UPDATE
  // ═════════════════════════════════════════════════════════════════════

  private updatePlaying(dt: number) {
    this.world.matchTime += dt;
    this.state.matchTimer = this.world.matchTime;

    // Process projectiles
    const aliveBeforeProjectiles = new Map<string, boolean>();
    for (const [id, p] of this.serverPlayers) aliveBeforeProjectiles.set(id, p.alive);

    updateProjectiles(this.world, dt);

    // Check for kills from projectiles
    for (const [id, player] of this.serverPlayers) {
      if (aliveBeforeProjectiles.get(id) && !player.alive) {
        this.onPlayerDied(id);
      }
    }

    // Update zone
    updateZone(this.world, dt);
    this.syncZone();

    // Check for zone kills
    for (const [id, player] of this.serverPlayers) {
      if (!player.alive && !aliveBeforeProjectiles.has(id)) continue;
      if (aliveBeforeProjectiles.get(id) && !player.alive) {
        // Already handled above
      } else if (!player.alive && player.placement === 0) {
        this.onPlayerDied(id, 'THE ZONE');
      }
    }

    // Sync all player positions to schema
    this.syncPlayers();

    // Periodic loot drops
    this.dropSpawnTimer -= dt;
    if (this.dropSpawnTimer <= 0) {
      this.dropSpawnTimer = 30; // every 30 seconds
      spawnDrops(this.world, 10);
      this.syncDrops();
    }

    // Update alive count
    this.state.aliveCount = this.countAlive();

    // Check victory
    this.checkVictory();
  }

  // ═════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═════════════════════════════════════════════════════════════════════

  private onPlayerDied(id: string, killedBy?: string) {
    const player = this.serverPlayers.get(id);
    if (!player || player.placement > 0) return;

    this.nextPlacement--;
    player.placement = this.nextPlacement;

    const schema = this.state.players.get(id);
    if (schema) {
      schema.alive = false;
      schema.hp = 0;
      schema.placement = player.placement;
    }

    // Determine killer
    const killer = killedBy || this.findKiller(id);
    this.addKillFeed(killer, player.name);

    this.broadcast('playerDied', {
      victim: player.name,
      killer,
      placement: player.placement,
      alive: this.countAlive(),
    });

    console.log(`[Arena] ${player.name} eliminated (#${player.placement}) by ${killer}`);
  }

  private findKiller(victimId: string): string {
    // Check recent projectile owners
    // In a more sophisticated system, track last damage source
    return 'Unknown';
  }

  private checkVictory() {
    const alive = Array.from(this.serverPlayers.values()).filter(p => p.alive);
    if (alive.length <= 1 && this.state.matchPhase === 'playing') {
      if (alive.length === 1) {
        const winner = alive[0];
        winner.placement = 1;
        const schema = this.state.players.get(winner.id);
        if (schema) schema.placement = 1;

        this.broadcast('victory', { winner: winner.name, kills: winner.kills });
        console.log(`[Arena] ${winner.name} WINS with ${winner.kills} kills!`);
      }

      this.endMatch();
    }
  }

  private endMatch() {
    this.state.matchPhase = 'ended';

    // Build results
    const results: PlayerResult[] = Array.from(this.serverPlayers.values()).map(p => ({
      id: p.id,
      name: p.name,
      walletAddress: p.walletAddress,
      placement: p.placement,
      kills: p.kills,
      survived: this.world.matchTime,
      alive: p.alive,
    }));

    // Settle rewards
    const settlement = this.matchSettler.settle(this.matchId, results);

    // Send results to each player
    for (const reward of settlement.rewards) {
      const client = this.clients.find(c => c.sessionId === reward.playerId);
      if (client) {
        client.send('matchResults', {
          matchId: this.matchId,
          ...reward,
          grossPool: settlement.grossPool,
          netPool: settlement.netPool,
          burnAmount: settlement.burnAmount,
          playerCount: settlement.playerCount,
        });
      }
    }

    // Distribute on-chain rewards
    this.matchSettler.distributeRewards(settlement).then(ok => {
      if (ok) console.log(`[Arena] Rewards distributed for ${this.matchId}`);
    });

    // Auto-dispose room after 30 seconds
    this.clock.setTimeout(() => {
      this.disconnect();
    }, 30000);

    console.log(`[Arena] Match ${this.matchId} ENDED`);
  }

  // ═════════════════════════════════════════════════════════════════════
  // STATE SYNC HELPERS
  // ═════════════════════════════════════════════════════════════════════

  private syncPlayers() {
    for (const [id, player] of this.serverPlayers) {
      const schema = this.state.players.get(id);
      if (!schema) continue;

      schema.x          = player.x;
      schema.z          = player.z;
      schema.angle      = player.angle;
      schema.hp         = player.hp;
      schema.shield     = player.shield;
      schema.alive      = player.alive;
      schema.kills      = player.kills;
      schema.activeSlot = player.activeSlot;
      schema.reloading  = player.reloading;

      // Sync inventory
      for (let i = 0; i < player.inventory.length; i++) {
        const inv = player.inventory[i];
        if (inv && schema.inventory[i]) {
          schema.inventory[i]!.weapon  = inv.weapon;
          schema.inventory[i]!.ammo    = Math.min(inv.ammo, 9999);
          schema.inventory[i]!.reserve = Math.min(inv.reserve, 9999);
        }
      }
    }
  }

  private syncZone() {
    const z = this.world.zone;
    this.state.zone.phase        = z.phase;
    this.state.zone.centerX      = z.centerX;
    this.state.zone.centerZ      = z.centerZ;
    this.state.zone.radius       = z.radius;
    this.state.zone.targetRadius = z.targetRadius;
    this.state.zone.shrinking    = z.shrinking;
    this.state.zone.timer        = z.timer;
  }

  private syncDrops() {
    // Clear and rebuild — Colyseus handles diffing
    this.state.drops.clear();
    for (const d of this.world.drops) {
      if (d.taken) continue;
      const schema = new DropSchema();
      schema.id   = d.id;
      schema.x    = d.x;
      schema.z    = d.z;
      schema.type = d.type;
      schema.taken = false;
      this.state.drops.push(schema);
    }
  }

  private addKillFeed(killer: string, victim: string) {
    const entry = new KillFeedEntry();
    entry.killer = killer;
    entry.victim = victim;
    entry.time   = this.world.matchTime;
    this.state.killFeed.push(entry);
    // Keep last 20 entries
    while (this.state.killFeed.length > 20) {
      this.state.killFeed.shift();
    }
  }

  private countAlive(): number {
    let count = 0;
    for (const [, p] of this.serverPlayers) {
      if (p.alive) count++;
    }
    return count;
  }
}
