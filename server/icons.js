// Generates the app icons (PNG) at startup if missing — pure Node, no image libraries.
// Draws the Ascend mark: twin mountain peaks in volt on near-black, with a rising dot.

import zlib from 'node:zlib';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#101216');
const PEAK_BACK = hex('#71911B');
const PEAK_FRONT = hex('#C8F542');
const DOT = hex('#F3F5F7');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Geometry in unit space
const BASE = 0.80;
const BACK = [[0.64, 0.34], [0.34, BASE], [0.96, BASE]];
const FRONT = [[0.36, 0.24], [0.04, BASE], [0.68, BASE]];
const DOT_C = [0.815, 0.185];
const DOT_R = 0.055;

function colorAt(u, v) {
  if ((u - DOT_C[0]) ** 2 + (v - DOT_C[1]) ** 2 <= DOT_R ** 2) return DOT;
  if (inTriangle(u, v, ...FRONT)) return PEAK_FRONT;
  if (inTriangle(u, v, ...BACK)) return PEAK_BACK;
  return BG;
}

function render(size) {
  const SS = 3; // supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = colorAt(u, v);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = 255;
    }
  }
  return encodePng(size, px);
}

export function ensureIcons(publicDir) {
  const dir = path.join(publicDir, 'icons');
  mkdirSync(dir, { recursive: true });
  const targets = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ];
  for (const [name, size] of targets) {
    const file = path.join(dir, name);
    if (!existsSync(file)) writeFileSync(file, render(size));
  }
}
