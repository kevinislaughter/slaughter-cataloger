#!/usr/bin/env node
/* Slaughter Cataloger 3 — release check: make sure no listed term appears in the package.

   node tools/scan-terms.js <term list> [folder or file ...]        (default folder: the repository)

   The term list is kept OUTSIDE the repository (it would otherwise publish the very terms it
   guards against); a list found inside a folder being scanned is refused. One term per line:
     id:<TOKEN>       a code that must not appear as a whole token (case-sensitive)
     block:<phrase>   a word or phrase that must not appear (any case, accents and punctuation ignored)
     review:<word>    reported for a person to look at; does not fail the check
   Lines starting with # are comments.

   Every text file is read (images, archives and fonts are listed as not scanned). Exit status:
   0 = no id/block term found, 1 = found (each hit is listed), 2 = usage error. */
'use strict';
const fs = require('fs'), path = require('path');

const [listFile, ...dirsArg] = process.argv.slice(2);
if (!listFile) { console.error('usage: node tools/scan-terms.js <term list> [folder or file ...]'); process.exit(2); }
const root = path.resolve(__dirname, '..');
const dirs = dirsArg.length ? dirsArg.map(d => path.resolve(d)) : [root];

// The list must live outside what is published: a list inside the folder would itself be published.
const listPath = path.resolve(listFile);
const inside = dirs.find(d => listPath === d || listPath.startsWith(d + path.sep));
if (inside) {
  console.error('The term list is inside ' + inside + ', which is being scanned (and would be published). Keep it outside the repository.');
  process.exit(2);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '_backups']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|otf|epub)$/i;

// Words: runs of letters and digits, compared without case or accents.
const fold = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = s => fold(s).match(/[\p{L}\p{N}]+/gu) || [];

const terms = { id: [], block: [], review: [] };
for (const raw of fs.readFileSync(listFile, 'utf8').split(/\r?\n/)) {
  const m = /^(id|block|review):(.+)$/.exec(raw.trim());
  if (!m) continue;
  const t = m[2].trim();
  if (m[1] === 'id') terms.id.push(t);
  else { const w = words(t); if (w.length) terms[m[1]].push({ text: t, w }); }
}

const files = [], notScanned = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (BINARY.test(e.name)) notScanned.push(p);
    else files.push(p);
  }
}
dirs.forEach(d => { if (fs.statSync(d).isDirectory()) walk(d); else (BINARY.test(d) ? notScanned : files).push(d); });

const hits = [], reviews = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  const lineOf = idx => text.slice(0, idx).split('\n').length;
  // Codes: whole tokens, exact case.
  for (const t of terms.id) {
    const re = new RegExp('(?<![A-Za-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'g');
    let m; while ((m = re.exec(text))) hits.push({ file: rel, line: lineOf(m.index), kind: 'id', term: t });
  }
  // Words and phrases: an index of where each word occurs, then each term's words in sequence.
  const toks = [], starts = [];
  const re = /[\p{L}\p{N}]+/gu; const folded = fold(text);
  let m; while ((m = re.exec(folded))) { toks.push(m[0]); starts.push(m.index); }
  const at = new Map();
  toks.forEach((w, i) => { if (!at.has(w)) at.set(w, []); at.get(w).push(i); });
  const find = term => {
    const out = [];
    for (const i of at.get(term.w[0]) || []) {
      let ok = true;
      for (let k = 1; k < term.w.length; k++) if (toks[i + k] !== term.w[k]) { ok = false; break; }
      if (ok) out.push(i);
    }
    return out;
  };
  for (const t of terms.block) for (const i of find(t)) hits.push({ file: rel, line: lineOf(starts[i]), kind: 'block', term: t.text });
  for (const t of terms.review) { const n = find(t).length; if (n) reviews.set(t.text, (reviews.get(t.text) || 0) + n); }
}

const byFile = new Map();
hits.forEach(h => { if (!byFile.has(h.file)) byFile.set(h.file, []); byFile.get(h.file).push(h); });
byFile.forEach((list, f) => {
  console.log(f + ': ' + list.length + ' hit(s)');
  list.slice(0, 40).forEach(h => console.log('  line ' + h.line + '  [' + h.kind + '] ' + h.term));
  if (list.length > 40) console.log('  … and ' + (list.length - 40) + ' more');
});
if (reviews.size) console.log('\nTo look at (not failing): ' + Array.from(reviews.entries()).sort((a, b) => b[1] - a[1]).map(([t, n]) => t + ' ×' + n).join(', '));
console.log('\nScanned ' + files.length + ' text files against ' + (terms.id.length + terms.block.length) + ' terms; ' +
  notScanned.length + ' image/archive files not scanned' + (notScanned.length ? ' (' + notScanned.map(p => path.relative(root, p)).join(', ') + ')' : '') + '.');
if (hits.length) { console.log('FAILED: ' + hits.length + ' listed term(s) found in ' + byFile.size + ' file(s).'); process.exit(1); }
console.log('PASSED: no listed term found.');
