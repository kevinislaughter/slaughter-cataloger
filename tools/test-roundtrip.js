#!/usr/bin/env node
/* Round-trip test: load real library CSVs, write them as 3.0, read them back,
   and require the records to be identical. Also reports, column by column,
   what changes in each file the first time it is saved as 3.0.

   usage: node tools/test-roundtrip.js <folder-with-csvs> [--slug=SLUG] [--quiet] */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
['js/core/csv.js', 'js/core/ids.js', 'js/core/schema.js', 'js/core/records.js', 'js/core/store.js']
  .forEach(f => { require(path.join(ROOT, f)); });
const SC = globalThis.SC;

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) || '/mnt/user-data/uploads';
const slugArg = (args.find(a => a.startsWith('--slug=')) || '').slice(7);
const quiet = args.includes('--quiet');

function loadDir(d) {
  return fs.readdirSync(d).filter(n => /\.csv$/i.test(n)).map(n => {
    const p = path.join(d, n);
    return SC.records.readFile(n, fs.readFileSync(p, 'utf8'), { lastModified: fs.statSync(p).mtimeMs, legacy: true });
  });
}
const strip = r => { const o = Object.assign({}, r); delete o._row; return o; };
function canon(state) {
  const out = {};
  ['titles', 'issues', 'contents'].forEach(k => {
    out[k] = Array.from(state[k].values()).map(strip).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  });
  out.library = state.library;
  return JSON.stringify(out);
}

let failures = 0;
const t0 = Date.now();
const files = loadDir(dir);
const built = SC.records.buildLibrary(files, { slug: slugArg, legacy: true });
const st = built.state;
console.log(`Library ${st.library.slug} "${st.library.name}": ${st.titles.size} titles, ${st.issues.size} issues, ${st.contents.size} contents items (${Date.now() - t0} ms)`);
console.log('Load report:');
built.report.forEach(r => console.log(`  [${r.level}] ${r.file ? r.file + ': ' : ''}${r.msg}`));

// write every file, read back, rebuild
const t1 = Date.now();
const written = {};
st.files.forEach((f, name) => { written[name] = SC.records.writeFile(st, name); });
const reread = Object.keys(written).map(n => SC.records.readFile(n, written[n], { lastModified: 1 }));
const rebuilt = SC.records.buildLibrary(reread, { slug: st.library.slug });
const same = canon(st) === canon(rebuilt.state);
console.log(`\nRound trip (write 3.0 -> read with the 3.0-only reader -> rebuild): ${same ? 'IDENTICAL' : 'DIFFERENT'} (${Date.now() - t1} ms)`);
const refused = reread.filter(r => !r.ok);
if (refused.length) { failures++; refused.forEach(r => console.log('  3.0 reader refused ' + r.name + ': ' + r.error)); }
const strictOnOld = files.filter(f => f.ok).map(f => SC.records.readFile(f.name, fs.readFileSync(path.join(dir, f.name), 'utf8'), {}));
const accepted = strictOnOld.filter(r => r.ok && r.schemaVersion !== SC.schema.VERSION);
console.log(`3.0-only reader refuses Beta 2 files: ${accepted.length ? 'NO (' + accepted.map(r => r.name).join(', ') + ')' : 'yes'}`);
if (accepted.length) failures++;
if (!same) {
  failures++;
  ['titles', 'issues', 'contents'].forEach(k => {
    const a = st[k], b = rebuilt.state[k];
    let shown = 0;
    a.forEach((ra, id) => {
      const rb = b.get(id);
      const ja = JSON.stringify(strip(ra)), jb = rb ? JSON.stringify(strip(rb)) : 'MISSING';
      if (ja !== jb && shown++ < 3) console.log(`  ${k} ${id}\n    before: ${ja.slice(0, 400)}\n    after:  ${jb.slice(0, 400)}`);
    });
    if (a.size !== b.size) console.log(`  ${k}: ${a.size} -> ${b.size} records`);
  });
}
const before = new Set(built.report.filter(r => r.level !== 'info').map(r => r.msg));
const rebuiltReport = rebuilt.report.filter(r => r.level !== 'info' && !before.has(r.msg));
if (rebuiltReport.length) { console.log('  New problems after saving:'); rebuiltReport.forEach(r => console.log('   ', r.level, r.file, r.msg)); failures++; }

// second write must be byte-identical to the first (stable output)
let stable = true;
rebuilt.state.files.forEach((f, name) => { if (SC.records.writeFile(rebuilt.state, name) !== written[name]) { stable = false; console.log('  not stable:', name); } });
console.log(`Second save byte-identical to first: ${stable ? 'yes' : 'NO'}`);
if (!stable) failures++;

// What changes on first save, per column
if (!quiet) {
  console.log('\nWhat the first 3.0 save changes, per file and column:');
  st.files.forEach((f, name) => {
    const orig = SC.csv.parse(fs.readFileSync(path.join(dir, name), 'utf8')).rows;
    const out = SC.csv.parse(written[name]).rows;
    const oh = orig[0], nh = out[0];
    const added = nh.filter(h => oh.indexOf(h) === -1), removed = oh.filter(h => nh.indexOf(h) === -1);
    console.log(`  ${name}  (${orig.length - 1} -> ${out.length - 1} rows)`);
    if (added.length) console.log(`    new columns: ${added.join(', ')}`);
    if (removed.length) console.log(`    REMOVED columns: ${removed.join(', ')}`);
    if (removed.length) failures++;
    if (orig.length !== out.length) { console.log('    ROW COUNT CHANGED'); failures++; return; }
    const changes = {};
    for (let i = 1; i < orig.length; i++) {
      oh.forEach((h, ci) => {
        const ni = nh.indexOf(h); if (ni === -1) return;
        if (h === 'Schema Version') return;
        const a = orig[i][ci] === undefined ? '' : orig[i][ci], b = out[i][ni] === undefined ? '' : out[i][ni];
        if (a !== b) { (changes[h] = changes[h] || []).push([a, b]); }
      });
    }
    Object.keys(changes).forEach(h => {
      const ex = changes[h][0];
      console.log(`    ${h}: ${changes[h].length} cell(s), e.g. ${JSON.stringify(ex[0]).slice(0, 70)} -> ${JSON.stringify(ex[1]).slice(0, 70)}`);
    });
    if (!Object.keys(changes).length) console.log('    no cell values change');
  });
}
console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
process.exit(failures ? 1 : 0);
