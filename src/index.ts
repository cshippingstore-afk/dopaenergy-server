/* ═══════════════════════════════════════════════════════════════════════
   DOPAENERGY — Game Server Entry Point
   Colyseus + Express with CORS, monitoring, and health checks
   ═══════════════════════════════════════════════════════════════════════ */

import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { ArenaRoom } from './rooms/ArenaRoom';

const PORT = parseInt(process.env.PORT || '2567', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── Express app ──────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://dopaenergy.com',
    'https://www.dopaenergy.com',
    /\.dopaenergy\.com$/,
  ],
  credentials: true,
}));

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    rooms: 0,
  });
});

// API: list active rooms
app.get('/api/rooms', async (_req, res) => {
  try {
    const rooms = await (gameServer as any).matchMaker?.query({ name: 'arena' }) || [];
    res.json(rooms.map((r: any) => ({
      roomId:    r.roomId,
      players:   r.clients,
      maxPlayers: r.maxClients,
      phase:     r.metadata?.phase || 'lobby',
      locked:    r.locked,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    res.json([]);
  }
});

// Colyseus monitor (admin panel at /monitor)
app.use('/monitor', monitor());

// ── HTTP server ──────────────────────────────────────────────────────
const httpServer = http.createServer(app);

// ── Colyseus game server ─────────────────────────────────────────────
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Register room types
gameServer.define('arena', ArenaRoom)
  .enableRealtimeListing();

// ── Start ────────────────────────────────────────────────────────────
httpServer.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                                                  ║');
  console.log('  ║     ⚡ DOPAENERGY GAME SERVER ⚡                ║');
  console.log('  ║                                                  ║');
  console.log(`  ║     WebSocket:  ws://${HOST}:${PORT}              `);
  console.log(`  ║     Monitor:    http://${HOST}:${PORT}/monitor    `);
  console.log(`  ║     Health:     http://${HOST}:${PORT}/health     `);
  console.log(`  ║     API:        http://${HOST}:${PORT}/api/rooms  `);
  console.log('  ║                                                  ║');
  console.log(`  ║     Environment: ${process.env.NODE_ENV || 'development'}  `);
  console.log('  ║                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});
