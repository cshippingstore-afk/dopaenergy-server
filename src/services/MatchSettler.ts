/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — Match Settlement Service
   Calculates and distributes DOPA rewards after a match ends.
   Production: executes SPL token transfers from escrow wallet.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  ENTRY_FEE, BURN_PCT, PLACE_PCTS,
  KILL_POOL_PCT, SPEC_POOL_PCT,
} from '../game/config';

export interface PlayerResult {
  id:            string;
  name:          string;
  walletAddress: string;
  placement:     number;
  kills:         number;
  survived:      number;  // seconds survived
  alive:         boolean;
}

export interface RewardBreakdown {
  playerId:      string;
  walletAddress: string;
  name:          string;
  placement:     number;
  kills:         number;
  placeReward:   number;
  killReward:    number;
  specReward:    number;
  entryFee:      number;
  netProfit:     number;
}

export interface MatchSettlement {
  matchId:     string;
  playerCount: number;
  grossPool:   number;
  burnAmount:  number;
  netPool:     number;
  rewards:     RewardBreakdown[];
  timestamp:   number;
}

export class MatchSettler {

  /**
   * Calculate rewards for all players based on match results.
   */
  settle(matchId: string, results: PlayerResult[]): MatchSettlement {
    const playerCount = results.length;
    const grossPool   = playerCount * ENTRY_FEE;
    const burnAmount  = Math.round(grossPool * BURN_PCT);
    const netPool     = grossPool - burnAmount;

    // Sort by placement
    const sorted = [...results].sort((a, b) => a.placement - b.placement);

    // Total kills for kill pool distribution
    const totalKills = sorted.reduce((sum, p) => sum + p.kills, 0);
    const killPool   = Math.round(netPool * KILL_POOL_PCT);
    const killPerKill = totalKills > 0 ? killPool / totalKills : 0;

    // Spectator pool (placeholder — evenly split among top 3 for now)
    const specPool = Math.round(netPool * SPEC_POOL_PCT);

    const rewards: RewardBreakdown[] = sorted.map(player => {
      // Placement reward
      const placePct  = PLACE_PCTS[Math.min(player.placement, PLACE_PCTS.length - 1)] || 0;
      const placeReward = Math.round(netPool * placePct);

      // Kill reward
      const killReward = Math.round(player.kills * killPerKill);

      // Spectator prediction cut (top 3 split for now)
      let specReward = 0;
      if (player.placement <= 3) {
        const specShares = [0, 0.50, 0.30, 0.20]; // 1st=50%, 2nd=30%, 3rd=20%
        specReward = Math.round(specPool * (specShares[player.placement] || 0));
      }

      const netProfit = placeReward + killReward + specReward - ENTRY_FEE;

      return {
        playerId:      player.id,
        walletAddress: player.walletAddress,
        name:          player.name,
        placement:     player.placement,
        kills:         player.kills,
        placeReward,
        killReward,
        specReward,
        entryFee:      ENTRY_FEE,
        netProfit,
      };
    });

    const settlement: MatchSettlement = {
      matchId,
      playerCount,
      grossPool,
      burnAmount,
      netPool,
      rewards,
      timestamp: Date.now(),
    };

    console.log(`[MatchSettler] Match ${matchId} settled:`);
    console.log(`  Players: ${playerCount}, Pool: ${netPool.toLocaleString()} DOPA`);
    rewards.slice(0, 5).forEach(r => {
      console.log(`  #${r.placement} ${r.name}: ${r.netProfit >= 0 ? '+' : ''}${r.netProfit.toLocaleString()} DOPA`);
    });

    return settlement;
  }

  /**
   * Execute on-chain reward transfers (stub).
   * Production: batch SPL transfers from escrow to winner wallets.
   */
  async distributeRewards(settlement: MatchSettlement): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[MatchSettler] DEV MODE — skipping on-chain transfers for match ${settlement.matchId}`);
      return true;
    }

    // TODO: Production implementation
    // 1. Load escrow wallet keypair from secure storage
    // 2. For each reward > 0, create SPL transfer instruction
    // 3. Bundle into a single transaction (or multiple if needed)
    // 4. Sign with escrow keypair
    // 5. Submit to Solana with confirmation
    // 6. Log transaction signatures for audit trail
    console.log(`[MatchSettler] Distributing ${settlement.rewards.length} reward transfers...`);
    return true;
  }
}
