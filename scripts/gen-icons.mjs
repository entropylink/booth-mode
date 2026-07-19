// Deterministic PWA icon generator — no dependencies, regenerable.
//
// Draws the app glyph into an RGBA buffer and encodes PNG with node's built-in
// zlib. Run: `node scripts/gen-icons.mjs booth|forge`. Writes into public/.
//
// The alternative — a design tool or an image dependency — would leave binary
// blobs in the repo that nobody can regenerate. This script IS the source.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = process.argv[2] === "forge" ? "forge" : "booth";
const THEME = {
  booth: { accent: [217, 164, 65], bg: [23, 26, 33], glyph: "tent" }, // market gold
  forge: { accent: [224, 105, 42], bg: [23, 26, 33], glyph: "spark" }, // ember orange
}[app];

// --- tiny raster canvas -----------------------------------------------------

function canvas(size) {
  const buf = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // alpha-over onto existing pixel
    const ia = a / 255;
    buf[i] = buf[i] * (1 - ia) + r * ia;
    buf[i + 1] = buf[i + 1] * (1 - ia) + g * ia;
    buf[i + 2] = buf[i + 2] * (1 - ia) + b * ia;
    buf[i + 3] = 255;
  };
  const fillBg = (c) => {
    for (let i = 0; i < size * size; i++) {
      buf[i * 4] = c[0];
      buf[i * 4 + 1] = c[1];
      buf[i * 4 + 2] = c[2];
      buf[i * 4 + 3] = 255;
    }
  };
  const fillRect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c);
  };
  // scanline polygon fill (even-odd) with 4x vertical supersampling for edges
  const fillPoly = (pts, c) => {
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const SS = 4;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let s = 0; s < SS; s++) {
        const sy = y + (s + 0.5) / SS;
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i];
          const [x2, y2] = pts[(i + 1) % pts.length];
          if (y1 <= sy && y2 > sy) xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1));
          else if (y2 <= sy && y1 > sy) xs.push(x2 + ((sy - y2) / (y1 - y2)) * (x1 - x2));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) {
            set(x, y, c, 255 / SS + (s === 0 ? 0 : 0));
          }
        }
      }
    }
  };
  const star = (cx, cy, R, r, c) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? R : r;
      pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    fillPoly(pts, c);
  };
  return { buf, set, fillBg, fillRect, fillPoly, star };
}

function draw(size, safe) {
  const c = canvas(size);
  c.fillBg(THEME.bg);
  const g = safe ? 0.62 : 0.78; // maskable safe zone
  const cx = size / 2, cy = size / 2;
  const scale = (v) => v * g;

  if (THEME.glyph === "tent") {
    const w = scale(size * 0.5), h = scale(size * 0.5);
    // counter
    c.fillRect(cx - w * 0.42, cy + h * 0.05, w * 0.84, h * 0.3, THEME.accent);
    // two dark stall-front stripes on the counter
    c.fillRect(cx - w * 0.16, cy + h * 0.05, w * 0.06, h * 0.3, THEME.bg);
    c.fillRect(cx + w * 0.1, cy + h * 0.05, w * 0.06, h * 0.3, THEME.bg);
    // awning
    c.fillPoly(
      [
        [cx, cy - h * 0.42],
        [cx - w * 0.5, cy - h * 0.02],
        [cx + w * 0.5, cy - h * 0.02],
      ],
      THEME.accent,
    );
    // scalloped lower edge of the awning
    const stripes = 5;
    for (let i = 0; i < stripes; i++) {
      if (i % 2 === 1) continue;
      const x0 = cx - w * 0.5 + (w / stripes) * i;
      const x1 = cx - w * 0.5 + (w / stripes) * (i + 1);
      c.fillPoly(
        [
          [x0, cy - h * 0.02],
          [x1, cy - h * 0.02],
          [(x0 + x1) / 2, cy - h * 0.02 + h * 0.14],
        ],
        THEME.accent,
      );
    }
  } else {
    // spark
    c.star(cx, cy, scale(size * 0.32), scale(size * 0.09), THEME.accent);
    c.set; // no-op keep
    // small secondary spark upper-right
    const off = scale(size * 0.24);
    c.star(cx + off, cy - off, scale(size * 0.32) * 0.42, scale(size * 0.09) * 0.42, THEME.accent);
  }
  return { buf: c.buf, size };
}

// --- PNG encoder ------------------------------------------------------------

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(buf, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // rows with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(buf.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- write ------------------------------------------------------------------

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(publicDir, { recursive: true });

const outputs = [
  ["pwa-192x192.png", draw(192, false)],
  ["pwa-512x512.png", draw(512, false)],
  ["pwa-maskable-512x512.png", draw(512, true)],
  ["apple-touch-icon.png", draw(180, false)],
];

for (const [name, { buf, size }] of outputs) {
  writeFileSync(join(publicDir, name), encodePNG(buf, size));
  console.log("wrote", name, `${size}x${size}`);
}
