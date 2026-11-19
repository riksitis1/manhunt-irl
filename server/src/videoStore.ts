import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface StoredVideoMeta {
  id: string;
  roomCode: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

const MAX_VIDEO_BYTES = 8 * 1024 * 1024; // 8 MB hard cap (10s @ 650kbps is ~0.8-1.2 MB)
const BASE_DIR = path.join(os.tmpdir(), 'manhunt-irl-videos');

function sanitizeExt(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('mp4')) return '.mp4';
  if (lower.includes('quicktime')) return '.mov';
  return '.webm';
}

export class VideoStore {
  private readonly items = new Map<string, StoredVideoMeta>();

  constructor() {
    fsSync.mkdirSync(BASE_DIR, { recursive: true });
  }

  async saveVideo(roomCode: string, buffer: Buffer, mimeType: string): Promise<StoredVideoMeta> {
    if (buffer.byteLength === 0) {
      throw new Error('Empty video payload');
    }
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      throw new Error('Video exceeds 8MB limit');
    }

    const id = crypto.randomBytes(9).toString('hex');
    const cleanMime = mimeType.split(';')[0]?.trim() || 'video/webm';
    const ext = sanitizeExt(cleanMime);
    const roomDir = path.join(BASE_DIR, roomCode);
    await fs.mkdir(roomDir, { recursive: true });

    const filePath = path.join(roomDir, `${id}${ext}`);
    await fs.writeFile(filePath, buffer);

    const meta: StoredVideoMeta = {
      id,
      roomCode,
      filePath,
      mimeType: cleanMime,
      sizeBytes: buffer.byteLength,
      createdAt: Date.now(),
    };
    this.items.set(id, meta);
    return meta;
  }

  get(videoId: string): StoredVideoMeta | undefined {
    return this.items.get(videoId);
  }

  async deleteVideo(videoId: string): Promise<void> {
    const meta = this.items.get(videoId);
    if (!meta) return;
    this.items.delete(videoId);
    await fs.unlink(meta.filePath).catch(() => {});
  }

  async deleteRoomVideos(roomCode: string): Promise<void> {
    for (const [id, meta] of this.items.entries()) {
      if (meta.roomCode === roomCode) {
        this.items.delete(id);
      }
    }
    const roomDir = path.join(BASE_DIR, roomCode);
    await fs.rm(roomDir, { recursive: true, force: true }).catch(() => {});
  }
}
