import compression from 'compression';
import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { GameManager } from './gameManager.js';
import type { JoinSuccessPayload, RoomSettings, SocketAck } from './shared/types.js';
import { VideoStore } from './videoStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3001);
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
  // Allow compact walkie-talkie PTT audio clips (<= 256 KB) cleanly
  maxHttpBufferSize: 512 * 1024,
  // Battery-friendly heartbeat intervals (avoid aggressive mobile radio wakeups)
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

const videoStore = new VideoStore();

const gameManager = new GameManager(videoStore, (roomCode) => {
  const members = gameManager.getRoomSockets(roomCode);
  for (const { socketId, playerId } of members) {
    const snapshot = gameManager.buildSnapshotFor(roomCode, playerId);
    if (snapshot) {
      io.to(socketId).emit('room:state', snapshot);
    }
  }
});

// Health endpoint for Render
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()) });
});

// Live 360° video ping upload (raw binary body — no gallery file input used on client)
app.post(
  '/api/rooms/:code/video',
  express.raw({ type: ['video/*', 'application/octet-stream'], limit: '8mb' }),
  async (req, res) => {
    try {
      const roomCode = String(req.params.code ?? '');
      const playerId = String(req.header('x-player-id') ?? '');
      const sessionToken = String(req.header('x-session-token') ?? '');
      const pingRound = Number(req.header('x-ping-round') ?? 0);
      const challengeCode = String(req.header('x-challenge-code') ?? '');
      const durationMs = Number(req.header('x-duration-ms') ?? 0);
      const mimeType = String(req.header('content-type') ?? 'video/webm');

      if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
        res.status(400).json({ ok: false, error: 'Missing video data.' });
        return;
      }

      const result = await gameManager.submitVideoPing({
        roomCode,
        playerId,
        sessionToken,
        pingRound,
        challengeCode,
        durationMs,
        mimeType,
        buffer: req.body,
      });

      if (!result.ok) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }

      res.json({ ok: true, item: result.item });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      res.status(500).json({ ok: false, error: message });
    }
  }
);

// Byte-range video streaming (required for iOS Safari <video> playback!)
app.get('/api/videos/:id', (req, res) => {
  const id = String(req.params.id ?? '');
  const meta = videoStore.get(id);
  if (!meta || !fs.existsSync(meta.filePath)) {
    res.status(404).json({ ok: false, error: 'Video expired or not found.' });
    return;
  }

  const stat = fs.statSync(meta.filePath);
  const total = stat.size;
  const range = req.headers.range;
  const isDownload = req.query.download === '1';

  if (isDownload) {
    const ext = meta.mimeType.includes('mp4') ? 'mp4' : 'webm';
    res.setHeader('Content-Disposition', `attachment; filename="manhunt-ping-${id}.${ext}"`);
  }

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(meta.filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', String(total));
    fs.createReadStream(meta.filePath).pipe(res);
  }
});

// Serve built Vite client in production (and locally when built)
const clientDistDir = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir, { maxAge: IS_PROD ? '1d' : 0 }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

io.on('connection', (socket) => {
  socket.on(
    'room:create',
    (payload: { name: string }, ack?: (res: SocketAck<JoinSuccessPayload>) => void) => {
      const res = gameManager.createRoom(socket.id, payload?.name ?? '');
      if (!res.ok) {
        ack?.({ ok: false, error: res.error });
        return;
      }
      ack?.({
        ok: true,
        data: {
          roomCode: res.roomCode,
          playerId: res.playerId,
          sessionToken: res.sessionToken,
        },
      });
    }
  );

  socket.on(
    'room:join',
    (
      payload: { code: string; name: string },
      ack?: (res: SocketAck<JoinSuccessPayload>) => void
    ) => {
      const res = gameManager.joinRoom(socket.id, payload?.code ?? '', payload?.name ?? '');
      if (!res.ok) {
        ack?.({ ok: false, error: res.error });
        return;
      }
      ack?.({
        ok: true,
        data: {
          roomCode: res.roomCode,
          playerId: res.playerId,
          sessionToken: res.sessionToken,
        },
      });
    }
  );

  socket.on(
    'room:reconnect',
    (
      payload: { roomCode: string; playerId: string; sessionToken: string },
      ack?: (res: SocketAck) => void
    ) => {
      const res = gameManager.reconnectPlayer(
        socket.id,
        payload?.roomCode ?? '',
        payload?.playerId ?? '',
        payload?.sessionToken ?? ''
      );
      if (!res.ok) {
        ack?.({ ok: false, error: res.error, errorCode: res.errorCode });
        return;
      }
      ack?.({ ok: true });
    }
  );

  socket.on('room:leave', () => {
    gameManager.leaveRoom(socket.id);
  });

  socket.on(
    'room:settings',
    (patch: Partial<RoomSettings>, ack?: (res: SocketAck) => void) => {
      const res = gameManager.updateSettings(socket.id, patch ?? {});
      ack?.(res);
    }
  );

  socket.on(
    'room:kick',
    (payload: { playerId: string }, ack?: (res: SocketAck) => void) => {
      const res = gameManager.kickPlayer(socket.id, payload?.playerId ?? '');
      if (res.ok && res.kickedSocketId) {
        io.to(res.kickedSocketId).emit('room:kicked', { reason: 'Removed by lobby host.' });
      }
      ack?.({ ok: res.ok, error: res.error });
    }
  );

  socket.on('game:start', (_payload: unknown, ack?: (res: SocketAck) => void) => {
    ack?.(gameManager.startGame(socket.id));
  });

  socket.on('game:skipWheel', (_payload: unknown, ack?: (res: SocketAck) => void) => {
    ack?.(gameManager.skipWheel(socket.id));
  });

  socket.on(
    'location:update',
    (
      payload: { lat: number; lng: number; accuracy: number; isGpsPing?: boolean },
      ack?: (res: SocketAck) => void
    ) => {
      if (!payload || typeof payload.lat !== 'number' || typeof payload.lng !== 'number') {
        ack?.({ ok: false, error: 'Invalid location payload.' });
        return;
      }
      ack?.(gameManager.updateLocation(socket.id, payload));
    }
  );

  socket.on('game:selfCaught', (_payload: unknown, ack?: (res: SocketAck) => void) => {
    ack?.(gameManager.markSelfCaught(socket.id));
  });

  socket.on(
    'game:claimTag',
    (payload: { targetPlayerId: string }, ack?: (res: SocketAck) => void) => {
      ack?.(gameManager.claimTag(socket.id, payload?.targetPlayerId ?? ''));
    }
  );

  socket.on(
    'game:respondTag',
    (payload: { accept: boolean }, ack?: (res: SocketAck) => void) => {
      ack?.(gameManager.respondTagClaim(socket.id, Boolean(payload?.accept)));
    }
  );

  socket.on(
    'game:hostEliminate',
    (payload: { targetPlayerId: string }, ack?: (res: SocketAck) => void) => {
      ack?.(gameManager.hostForceEliminate(socket.id, payload?.targetPlayerId ?? ''));
    }
  );

  socket.on('game:end', (_payload: unknown, ack?: (res: SocketAck) => void) => {
    ack?.(gameManager.endGameEarly(socket.id));
  });

  socket.on('game:resetLobby', (_payload: unknown, ack?: (res: SocketAck) => void) => {
    ack?.(gameManager.resetToLobby(socket.id));
  });

  socket.on('game:useRadarToken', (_payload: unknown, ack?: (res: SocketAck) => void) => {
    const res = gameManager.useRadarToken(socket.id);
    if (!res.ok) {
      ack?.({ ok: false, error: res.error });
      return;
    }
    // Emit updated snapshot ONLY to this runner so hunters receive zero signal
    const privateSnap = gameManager.buildSnapshotFor(res.roomCode, res.playerId);
    if (privateSnap) {
      socket.emit('room:state', privateSnap);
    }
    ack?.({ ok: true });
  });

  socket.on(
    'radio:setChannel',
    (payload: { channel: number }, ack?: (res: SocketAck<{ channel: number }>) => void) => {
      const res = gameManager.setRadioChannel(socket.id, Number(payload?.channel ?? 1));
      if (!res.ok) {
        ack?.({ ok: false, error: res.error });
        return;
      }
      // Private update ONLY to this socket so switching channels to spy is completely silent
      const privateSnap = gameManager.buildSnapshotFor(res.roomCode, res.playerId);
      if (privateSnap) {
        socket.emit('room:state', privateSnap);
      }
      ack?.({ ok: true, data: { channel: res.channel } });
    }
  );

  socket.on('radio:txStart', () => {
    const res = gameManager.getRadioRecipients(socket.id, false);
    if (!res.ok) return;
    for (const targetSocketId of res.recipientSocketIds) {
      io.to(targetSocketId).emit('radio:activity', { channel: res.channel, active: true });
    }
  });

  socket.on('radio:txEnd', () => {
    const res = gameManager.getRadioRecipients(socket.id, false);
    if (!res.ok) return;
    for (const targetSocketId of res.recipientSocketIds) {
      io.to(targetSocketId).emit('radio:activity', { channel: res.channel, active: false });
    }
  });

  socket.on(
    'radio:transmit',
    (
      payload: { audio: Buffer | ArrayBuffer | Uint8Array; mimeType: string; durationMs: number },
      ack?: (res: SocketAck) => void
    ) => {
      const res = gameManager.getRadioRecipients(socket.id, true);
      if (!res.ok) {
        ack?.({ ok: false, error: res.error });
        return;
      }

      const raw = payload?.audio;
      const buf = Buffer.isBuffer(raw)
        ? raw
        : raw instanceof Uint8Array
          ? Buffer.from(raw)
          : raw instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(raw))
            : null;

      if (!buf || buf.byteLength === 0 || buf.byteLength > 262_144) {
        ack?.({ ok: false, error: 'Invalid radio audio clip.' });
        return;
      }

      const mimeType =
        typeof payload.mimeType === 'string' && payload.mimeType.startsWith('audio/')
          ? payload.mimeType.slice(0, 60)
          : 'audio/webm';
      const durationMs =
        typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
          ? Math.max(200, Math.min(20_000, Math.round(payload.durationMs)))
          : 2000;

      const outgoing = {
        id: crypto.randomBytes(6).toString('hex'),
        channel: res.channel,
        mimeType,
        durationMs,
        sentAt: Date.now(),
        audio: buf,
      };

      for (const targetSocketId of res.recipientSocketIds) {
        io.to(targetSocketId).emit('radio:incoming', outgoing);
      }

      ack?.({ ok: true });
    }
  );

  socket.on('disconnect', () => {
    gameManager.handleDisconnect(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`MANHUNT IRL server running on http://localhost:${PORT}`);
});
