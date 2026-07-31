/**
 * Generate the app icons.
 *
 * Everything is drawn analytically and encoded to PNG here rather than exported
 * from a design tool, so the icons are reproducible: change a number, re-run,
 * and every size regenerates consistently. Run with `npm run icons`.
 *
 * The mark is a stack of two cards on the app's violet-to-fuchsia gradient —
 * the same colours as the UI, and legible at home-screen size where anything
 * more detailed turns to mush.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

/** Supersampling factor. 4x is plenty for edges this soft. */
const SS = 4;

const GRADIENT_FROM = [124, 58, 237]; // violet
const GRADIENT_TO = [192, 38, 211]; // fuchsia

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRectDistance(px, py, cx, cy, w, h, r) {
  const dx = Math.abs(px - cx) - (w / 2 - r);
  const dy = Math.abs(py - cy) - (h / 2 - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/** Same, but for a rect rotated about its own centre. */
function rotatedRectDistance(px, py, cx, cy, w, h, r, degrees) {
  const a = (-degrees * Math.PI) / 180;
  const ox = px - cx;
  const oy = py - cy;
  const rx = ox * Math.cos(a) - oy * Math.sin(a);
  const ry = ox * Math.sin(a) + oy * Math.cos(a);
  return roundedRectDistance(rx, ry, 0, 0, w, h, r);
}

function overlay(base, colour, alpha) {
  return [
    base[0] + (colour[0] - base[0]) * alpha,
    base[1] + (colour[1] - base[1]) * alpha,
    base[2] + (colour[2] - base[2]) * alpha,
  ];
}

/** Colour and coverage for one supersample point, in 0..1 unit space. */
function sample(u, v) {
  // Background plate: a rounded square, so the icon looks right on platforms
  // that don't apply their own mask.
  const plate = roundedRectDistance(u, v, 0.5, 0.5, 1, 1, 0.22);
  if (plate > 0) return null;

  const t = Math.min(1, Math.max(0, (u + v) / 2));
  let rgb = [
    GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t,
    GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t,
    GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t,
  ];

  // Back card, tilted and translucent — reads as a deck rather than one card.
  if (rotatedRectDistance(u, v, 0.575, 0.45, 0.34, 0.46, 0.045, 11) < 0) {
    rgb = overlay(rgb, [255, 255, 255], 0.42);
  }

  // Front card.
  const front = rotatedRectDistance(u, v, 0.435, 0.535, 0.36, 0.48, 0.05, -7);
  if (front < 0) {
    rgb = [255, 255, 255];

    // Two bars suggesting a question and its answer.
    const a = (7 * Math.PI) / 180;
    const ox = u - 0.435;
    const oy = v - 0.535;
    const lx = ox * Math.cos(a) - oy * Math.sin(a);
    const ly = ox * Math.sin(a) + oy * Math.cos(a);

    const bar = (cy, w) =>
      roundedRectDistance(lx, ly, 0, cy, w, 0.035, 0.0175) < 0;
    if (bar(-0.075, 0.2)) rgb = [124, 58, 237];
    if (bar(0.02, 0.13)) rgb = [216, 180, 254];
  }

  return rgb;
}

function render(size) {
  const S = size * SS;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x * SS + sx + 0.5) / S;
          const v = (y * SS + sy + 0.5) / S;
          const c = sample(u, v);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            hits++;
          }
        }
      }

      const total = SS * SS;
      const i = (y * size + x) * 4;
      if (hits === 0) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      } else {
        // Un-premultiply: average colour over covered samples only, with
        // coverage carried in alpha. Averaging over all samples instead would
        // darken every edge towards transparent black.
        out[i] = Math.round(r / hits);
        out[i + 1] = Math.round(g / hits);
        out[i + 2] = Math.round(b / hits);
        out[i + 3] = Math.round((hits / total) * 255);
      }
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per scanline; filter 0 (none) compresses fine on flat art.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  ["public/icon-192x192.png", 192],
  ["public/icon-512x512.png", 512],
  ["public/apple-icon.png", 180],
  ["src/app/icon.png", 512],
];

for (const [path, size] of targets) {
  const png = encodePng(render(size), size);
  writeFileSync(path, png);
  console.log(`${path.padEnd(28)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
