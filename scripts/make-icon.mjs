#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * App mark for the window, the installer, and a Windows desktop shortcut.
 *
 * Source of truth is `assets/osade.png`. `build/icon.png` is what electron-builder converts;
 * `build/icon.ico` is what a `.lnk` on the Desktop can actually display.
 *
 *   node scripts/make-icon.mjs
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'osade.png');
if (!existsSync(src)) throw new Error(`missing app icon: ${src}`);

const out = join(root, 'build');
mkdirSync(out, { recursive: true });
const pngDest = join(out, 'icon.png');
const icoDest = join(out, 'icon.ico');
copyFileSync(src, pngDest);
writeFileSync(icoDest, pngToIco(readFileSync(src)));
process.stdout.write(`wrote ${pngDest}\n`);
process.stdout.write(`wrote ${icoDest}\n`);

/** One PNG-in-ICO image. Vista+ (and every machine Osade runs on) reads this natively. */
function pngToIco(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}
