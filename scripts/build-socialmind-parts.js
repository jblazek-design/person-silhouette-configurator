#!/usr/bin/env node
// Builds socialmind/parts.js from socialmind/assets/parts/**/*.svg
// (Socialmind "Characters factory" Figma exports, 800x800 frames).
// - strips the white frame background, keeps the root's fill="none" via a wrapper <g>
// - normalises "black" to the ink colour
// - prefixes every id (clipPath / mask / gradient) with __ID__ so the renderer can
//   make ids unique per rendered instance (the same part is on screen several times)
// - in hand parts the body-coloured fills become __SKIN__ so arms follow the base colour
// - file-name tags after the Figma number (any order, separated by spaces/dashes):
//     "182 - Back"     drawn behind the body ("Front" / no tag = normal position); a back/
//                      or front/ subfolder works too
//     "1 - Shape 2"    part fits base shape 2 only ("General" / no tag = fits every shape);
//                      a "Shape 2/" subfolder tags every file inside the same way
//   the same Figma number may exist once per shape (hats): ids become e.g. hat-182-s2
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'socialmind');
const SRC = path.join(ROOT, 'assets', 'parts');
const OUT = path.join(ROOT, 'parts.js');

const FRAME = 800;
const INK = '#080015';
const BODY = '#9D65F7'; // colour the arms were drawn in (= tone index 7)

// folder → category key, in drawer order
const CATEGORIES = [
  ['legs', 'legs'],
  ['eyes', 'eyes'],
  ['arms', 'hands'],
  ['hats', 'hat'],
  ['pets', 'pet']
];
const SKIN_CATEGORIES = new Set(['hands']);

const num = (f) => parseInt(path.basename(f, '.svg'), 10);
const byNumber = (a, b) => num(a) - num(b);
const svgFiles = (dir) => fs.readdirSync(dir).filter(f => f.endsWith('.svg')).sort(byNumber);

// Tags in a file name, after the Figma number: { slot: 'back'|null, fit: shapeNumber|null }
function tagsOf(name) {
  const stem = path.basename(name, '.svg');
  const n = num(name);
  if (Number.isNaN(n)) throw new Error('file name must start with the Figma number: ' + name);
  const rest = stem.slice(String(n).length).toLowerCase();
  const fit = rest.match(/\bshape\s*(\d+)\b/);
  return { slot: /\bback\b/.test(rest) ? 'back' : null, fit: fit ? parseInt(fit[1], 10) : null };
}

// Part files of a category: top-level *.svg plus optional back/, front/ and "Shape N/" subfolders.
function partFiles(dir) {
  const entries = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      const slotDir = /^(back|front)$/i.test(f) ? f.toLowerCase() : null;
      const shapeDir = f.match(/^shape\s*(\d+)$/i);
      if (!slotDir && !shapeDir) throw new Error('unexpected folder ' + full);
      for (const g of fs.readdirSync(full).filter(x => x.endsWith('.svg'))) {
        const t = tagsOf(g);
        const fit = shapeDir ? parseInt(shapeDir[1], 10) : t.fit;
        if (shapeDir && t.fit && t.fit !== fit) throw new Error(`file tagged Shape ${t.fit} sits in folder ${f}: ${g}`);
        entries.push({ file: path.join(full, g), name: g, slot: slotDir === 'back' ? 'back' : t.slot, fit });
      }
    } else if (f.endsWith('.svg')) {
      entries.push({ file: full, name: f, ...tagsOf(f) });
    }
  }
  // by Figma number, then by shape — so every shape sees the same order
  return entries.sort((a, b) => num(a.name) - num(b.name) || (a.fit || 0) - (b.fit || 0));
}

function inner(svg, file) {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error('no <svg> root in ' + file);
  if (!/viewBox="0 0 800 800"/.test(svg)) throw new Error('unexpected viewBox in ' + file);
  let s = m[1];
  s = s.replace(/<rect width="800" height="800" fill="white"\s*\/>/, '');
  s = s.replace(/stroke="black"/g, `stroke="${INK}"`).replace(/fill="black"/g, `fill="${INK}"`);
  s = s.replace(/\sid="([^"]+)"/g, ' id="__ID__$1"');
  s = s.replace(/url\(#([^)]+)\)/g, 'url(#__ID__$1)');
  s = s.replace(/href="#([^"]+)"/g, 'href="#__ID__$1"');
  s = s.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
  if (/<rect width="800" height="800" fill="white"\s*\/>/.test(s.replace(/<clipPath[\s\S]*?<\/clipPath>/g, ""))) throw new Error("background rect left in " + file);
  // The Figma root <svg> carries fill="none"; open stroke paths rely on inheriting it,
  // otherwise they get the default black fill and render as solid wedges.
  return `<g fill="none">${s}</g>`;
}

// ---- base: 3 shapes × N colours (same path in every colour file) ----
const shapes = [];
let tones = null;
for (const dir of ['shape-1', 'shape-2', 'shape-3']) {
  const files = svgFiles(path.join(SRC, 'base', dir));
  const fills = [];
  let d = null;
  for (const f of files) {
    const tag = tagsOf(f).fit;
    if (tag && tag !== shapes.length + 1) throw new Error(`file tagged Shape ${tag} sits in folder ${dir}: ${f}`);
    const svg = fs.readFileSync(path.join(SRC, 'base', dir, f), 'utf8');
    const pm = svg.match(/<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"\s*\/>/);
    if (!pm) throw new Error('unexpected base file ' + dir + '/' + f);
    if (d && d !== pm[1]) throw new Error('shape differs between colours: ' + dir + '/' + f);
    d = pm[1];
    fills.push(pm[2].toUpperCase());
  }
  if (tones && tones.join() !== fills.join()) throw new Error('tone set differs in ' + dir);
  tones = fills;
  shapes.push({ id: dir, d });
}

// ---- parts ----
const parts = {};
let total = shapes.length * tones.length;
for (const [folder, key] of CATEGORIES) {
  const dir = path.join(SRC, folder);
  parts[key] = partFiles(dir).map(e => {
    let svg = inner(fs.readFileSync(e.file, 'utf8'), path.relative(SRC, e.file));
    if (SKIN_CATEGORIES.has(key)) svg = svg.split(`fill="${BODY}"`).join('fill="__SKIN__"');
    const n = num(e.name);
    const part = { id: `${key}-${n}${e.fit ? '-s' + e.fit : ''}`, n, svg };
    if (e.slot === 'back') part.layer = 'back'; // 'front' is the default position
    if (e.fit) {
      if (e.fit < 1 || e.fit > shapes.length) throw new Error(`unknown shape ${e.fit} in ${e.file}`);
      part.fit = e.fit; // 1-based base shape this part is drawn for
    }
    return part;
  });
  const ids = parts[key].map(p => p.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error('duplicate part ' + dup + ' (same Figma number twice for one shape)');
  total += parts[key].length;
}

const out = `// Generated by scripts/build-socialmind-parts.js — do not edit by hand.
// Source: Socialmind "Characters factory" Figma exports (800x800 frames). ${total} files.
window.SM_PARTS = ${JSON.stringify({ frame: FRAME, ink: INK, body: BODY, tones, shapes, parts })};
`;
fs.writeFileSync(OUT, out);
const counts = Object.fromEntries(Object.entries(parts).map(([k, v]) => {
  const info = [];
  for (let s = 1; s <= shapes.length; s++) { const c = v.filter(p => p.fit === s).length; if (c) info.push(`shape${s}: ${c}`); }
  const general = v.filter(p => !p.fit).length; if (general && general !== v.length) info.push(`general: ${general}`);
  const back = v.filter(p => p.layer === 'back').length; if (back) info.push(`back: ${back}`);
  return [k, v.length + (info.length ? ' (' + info.join(', ') + ')' : '')];
}));
console.log('wrote', OUT, (out.length / 1024).toFixed(1) + 'KB', { shapes: shapes.length, tones: tones.length, ...counts });
