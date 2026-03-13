/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — DOPA Token Verifier
   Verifies Solana wallet has enough DOPA to enter the arena.
   Production: connects to Solana RPC to check SPL token balance.
   ═══════════════════════════════════════════════════════════════════════ */

import { ENTRY_FEE } from '../game/config';

export interface VerifyResult {
  valid:    boolean;
  balance:  number;
  message:  string;
}

export class DopaVerifier {
  private mintAddress: string;
  private rpcUrl: string;

  constructor(mintAddress?: string, rpcUrl?: string) {
    // Replace with real mint address at launch
    this.mintAddress = mintAddress || 'DoPA1iquidityArena2025xSoLaNaMaiNnEt3Token';
    this.rpcUrl = rpcUrl || 'https://api.mainnet-beta.solana.com';
  }

  /**
   * Verify a wallet has enough DOPA to pay the entry fee.
   * Currently returns a simulated balance for development.
   * Production: call Solana RPC getTokenAccountsByOwner
   */
  async verifyBalance(walletAddress: string): Promise<VerifyResult> {
    // ── Development mode: always approve ──
    if (process.env.NODE_ENV !== 'production') {
      return {
        valid: true,
        balance: ENTRY_FEE * 10, // simulate having plenty
        message: 'DEV MODE — balance check bypassed',
      };
    }

    // ── Production: real Solana RPC call ──
    try {
      const balance = await this.fetchTokenBalance(walletAddress);
      return {
        valid: balance >= ENTRY_FEE,
        balance,
        message: balance >= ENTRY_FEE
          ? `Balance verified: ${balance.toLocaleString()} DOPA`
          : `Insufficient DOPA: ${balance.toLocaleString()} / ${ENTRY_FEE.toLocaleString()} required`,
      };
    } catch (err: any) {
      console.error('[DopaVerifier] RPC error:', err.message);
      return {
        valid: false,
        balance: 0,
        message: 'Failed to verify balance — try again',
      };
    }
  }

  /**
   * Fetch DOPA token balance from Solana RPC.
   * Uses getTokenAccountsByOwner with the DOPA mint.
   */
  private async fetchTokenBalance(walletAddress: string): Promise<number> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        walletAddress,
        { mint: this.mintAddress },
        { encoding: 'jsonParsed' },
      ],
    };

    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    const accounts = json?.result?.value || [];

    if (accounts.length === 0) return 0;

    // Sum all token accounts for this mint
    let total = 0;
    for (const account of accounts) {
      const info = account?.account?.data?.parsed?.info;
      if (info?.tokenAmount?.uiAmount) {
        total += info.tokenAmount.uiAmount;
      }
    }

    return total;
  }

  /**
   * Create entry fee escrow transaction (stub).
   * Production: build SPL transfer instruction from player to escrow wallet.
   */
  async createEntryTransaction(walletAddress: string): Promise<string | null> {
    if (process.env.NODE_ENV !== 'production') {
      return 'DEV_TX_' + Date.now().toString(36);
    }

    // TODO: Build real SPL transfer transaction
    // 1. Create transfer instruction: player -> escrow wallet
    // 2. Serialize and return base64 for client to sign
    // 3. Client signs with wallet provider and submits
    // 4. Server confirms on-chain before granting access
    return null;
  }
}
