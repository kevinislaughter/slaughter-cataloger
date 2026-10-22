#!/usr/bin/env node
/* Backups are never written over (second readiness review, F2-01).
   Runs js/platform/storage.js in Node against an in-memory folder (the File System Access API's
   shape), with the clock frozen on one second and the random part of backup folder names forced
   to collide, and checks every recovery copy by reading its bytes back.
   usage: node tools/test-backups.js */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const STORAGE = path.join(ROOT, 'js', 'platform', 'storage.js');

// ── One second, frozen; random tags that always clash ──────────────────
const RealDate = Date;
const FROZEN = new RealDate(2026, 9, 9, 14, 33, 5).getTime();
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FROZEN); } static now() { return FROZEN; } };
Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: a => a.fill(0) }, configurable: true, writable: true });

globalThis.SC = {};
['csv', 'ids', 'schema', 'records'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const H = t => SC.records.hashText(t);
// A fresh copy of the storage module = another session, or another tab.
function newStorage() { delete require.cache[require.resolve(STORAGE)]; require(STORAGE); return SC.storage; }

// ── An in-memory folder ────────────────────────────────────────────────
// It holds what was written: a string (text written) or bytes (bytes written), and gives a file's
// bytes (arrayBuffer) and lossy text, as the browser does.
// failDirs: names whose creation throws; corrupt: dirs whose writes are garbled; failClose: close() throws.
const enc = new TextEncoder();
const bytesOf = v => (typeof v === 'string' ? enc.encode(v) : v);
const txt = v => (v == null ? v : typeof v === 'string' ? v : new TextDecoder().decode(v));
const hex = v => Array.from(bytesOf(v), b => b.toString(16).padStart(2, '0')).join(' ');
function err(name, msg) { const e = new Error(msg); e.name = name; return e; }
function folder(name, opts) {
  opts = opts || {};
  const files = new Map(), dirs = new Map();
  const d = { kind: 'directory', name, files, dirs, opts,
    async getDirectoryHandle(n, o) {
      if (files.has(n)) throw err('TypeMismatchError', 'is a file');
      if (!dirs.has(n)) {
        if (!(o && o.create)) throw err('NotFoundError', 'not found');
        if ((opts.failDirs || []).indexOf(n) !== -1 || (opts.failDirs || []).indexOf('*') !== -1) throw err('QuotaExceededError', 'disk full (test)');
        dirs.set(n, folder(n, { corrupt: opts.corruptChildren, corruptChildren: opts.corruptChildren, failClose: opts.failCloseChildren, failCloseChildren: opts.failCloseChildren }));
      }
      return dirs.get(n);
    },
    async getFileHandle(n, o) {
      if (dirs.has(n)) throw err('TypeMismatchError', 'is a folder');
      if (!files.has(n)) { if (!(o && o.create)) throw err('NotFoundError', 'not found'); files.set(n, ''); }
      return { kind: 'file', name: n,
        async getFile() { const v = files.get(n); return { lastModified: FROZEN, text: async () => txt(v), arrayBuffer: async () => bytesOf(v).slice().buffer }; },
        async createWritable() {
          const parts = [];
          return { write: async t => { parts.push(t); }, abort: async () => {},
            close: async () => {
              if (opts.failClose) throw err('InvalidStateError', 'Cannot close a ERRORED writable stream (test)');
              let v = parts.every(x => typeof x === 'string') ? parts.join('') : (() => { const bs = parts.map(bytesOf), out = new Uint8Array(bs.reduce((a, b) => a + b.length, 0)); let o = 0; bs.forEach(b => { out.set(b, o); o += b.length; }); return out; })();
              if (opts.corrupt) v = v.slice(1);
              files.set(n, v);
            } };
        } };
    },
    async removeEntry(n) { files.delete(n); dirs.delete(n); },
    async *values() { for (const n of files.keys()) yield await d.getFileHandle(n); for (const [n, x] of dirs) yield x; }
  };
  return d;
}
const allBackups = root => {
  const out = [];
  const b = root.dirs.get('_backups');
  if (b) b.dirs.forEach((x, dn) => x.files.forEach((v, fn) => { if (fn !== 'BACKUPS.txt') out.push({ path: '_backups/' + dn + '/' + fn, text: txt(v), raw: v }); }));
  return out;
};
const rawPath = (root, p) => { if (!p) return undefined; const parts = p.split('/'); let x = root; for (const q of parts.slice(0, -1)) x = x && x.dirs.get(q); return x ? x.files.get(parts[parts.length - 1]) : undefined; };
const readPath = (root, p) => txt(rawPath(root, p));
const live = (root, n) => txt(root.files.get(n));

let fails = 0, count = 0;
const ok = (c, what, detail) => { count++; if (!c) { fails++; console.log('FAIL ' + what + (detail ? '\n   ' + detail : '')); } };
const save = (st, root, name, from, to, extra) => st.writeFiles(root, [Object.assign({ name, text: to, baseline: H(from), mustExist: true }, extra || {})], {});

(async () => {
  console.log('· Two sessions in the same second, same file (review test 1; the reviewer\'s repro)');
  {
    const root = folder('lib'); root.files.set('X.csv', 'v1 original');
    const st = newStorage();
    const r1 = await save(st, root, 'X.csv', 'v1 original', 'v2');
    st.resetSessionBackups();                                   // a new session (reopened folder)
    const r2 = await save(st, root, 'X.csv', 'v2', 'v3');
    const texts = allBackups(root).map(b => b.text).sort();
    ok(JSON.stringify(texts) === JSON.stringify(['v1 original', 'v2']), 'both earlier versions survive, byte for byte', JSON.stringify(allBackups(root)));
    ok(r1.backupFolder && r2.backupFolder && r1.backupFolder !== r2.backupFolder, 'each session has its own backup folder (' + r1.backupFolder + ', ' + r2.backupFolder + ')');
    ok(readPath(root, (r1.backupPaths || {})['X.csv']) === 'v1 original' && readPath(root, (r2.backupPaths || {})['X.csv']) === 'v2', 'each reported path holds that session\'s copy');
    ok(live(root, 'X.csv') === 'v3', 'the library file holds the last save');
  }

  console.log('· Two tabs (two copies of the module) in the same second, same folder name drawn (review test 3)');
  {
    const root = folder('lib'); root.files.set('X.csv', 'v1 original');
    const tabA = newStorage(), tabB = newStorage();
    const ra = await save(tabA, root, 'X.csv', 'v1 original', 'v2 from A');
    const rb = await save(tabB, root, 'X.csv', 'v2 from A', 'v3 from B');
    const texts = allBackups(root).map(b => b.text).sort();
    ok(JSON.stringify(texts) === JSON.stringify(['v1 original', 'v2 from A']), 'neither tab writes over the other\'s copy', JSON.stringify(allBackups(root)));
    ok(ra.backupFolder !== rb.backupFolder, 'the clashing folder name is not reused (' + ra.backupFolder + ', ' + rb.backupFolder + ')');
  }

  console.log('· Two changes made elsewhere to the same file within one second (review test 2)');
  {
    const root = folder('lib'); root.files.set('X.csv', 'v1 original');
    const st = newStorage();
    await save(st, root, 'X.csv', 'v1 original', 'v2');
    root.files.set('X.csv', 'edited elsewhere, first');
    const c1 = await save(st, root, 'X.csv', 'v2', 'v3');
    root.files.set('X.csv', 'edited elsewhere, second');
    const c2 = await save(st, root, 'X.csv', 'v3', 'v4');
    const texts = allBackups(root).map(b => b.text).sort();
    ok(JSON.stringify(texts) === JSON.stringify(['edited elsewhere, first', 'edited elsewhere, second', 'v1 original']), 'every version replaced is kept: the original and both outside edits', JSON.stringify(allBackups(root)));
    ok(c1.conflicts.length === 1 && c2.conflicts.length === 1 && c1.conflicts[0].backup !== c2.conflicts[0].backup, 'each conflict names its own copy (' + (c1.conflicts[0] || {}).backup + ', ' + (c2.conflicts[0] || {}).backup + ')');
    ok(readPath(root, c1.conflicts[0].backup) === 'edited elsewhere, first' && readPath(root, c2.conflicts[0].backup) === 'edited elsewhere, second', 'and each named copy holds that version');
    const log = txt(root.dirs.get('_backups').dirs.values().next().value.files.get('BACKUPS.txt')) || '';
    ok((log.match(/\tX(\.changed-on-disk-[\d-]+)?(-\d+)?\.csv\tX\.csv\t/g) || []).length === 3 && /changed on disk/.test(log), 'BACKUPS.txt lists all three copies with their original file and why');
  }

  console.log('· A folder of the chosen name already there (copied in by hand, say)');
  {
    const root = folder('lib'); root.files.set('X.csv', 'v1 original');
    const pre = await root.getDirectoryHandle('_backups', { create: true });
    const old = await pre.getDirectoryHandle('20261009-143305-00000000', { create: true });
    old.files.set('X.csv', 'an older backup');
    const r = await save(newStorage(), root, 'X.csv', 'v1 original', 'v2');
    ok(txt(old.files.get('X.csv')) === 'an older backup', 'the existing backup is untouched');
    ok(r.backupFolder === '_backups/20261009-143305-00000000-2' && readPath(root, (r.backupPaths || {})['X.csv']) === 'v1 original', 'the new copy goes into a new folder (' + r.backupFolder + ')');
  }

  console.log('· A backup that cannot be made: the file is not replaced (review test 4)');
  {
    const root = folder('lib', { failDirs: ['_backups'] }); root.files.set('X.csv', 'v1 original');
    const st = newStorage();
    const r = await save(st, root, 'X.csv', 'v1 original', 'v2');
    ok(live(root, 'X.csv') === 'v1 original', 'the library file is unchanged');
    ok(!r.saved['X.csv'] && r.failed.length === 1 && /backup copy could not be made \(disk full \(test\)\), so the file in the folder was not replaced/.test(r.failed[0].error), 'reported as not saved, saying why: ' + (r.failed[0] || {}).error);
    root.opts.failDirs = [];
    const again = await save(st, root, 'X.csv', 'v1 original', 'v2');
    ok(again.saved['X.csv'] && readPath(root, (again.backupPaths || {})['X.csv']) === 'v1 original' && live(root, 'X.csv') === 'v2', 'once the backup can be made, the save goes through with the original kept');
  }
  {
    const root = folder('lib', { corruptChildren: true }); root.files.set('X.csv', 'v1 original');
    const st = newStorage();
    const r = await save(st, root, 'X.csv', 'v1 original', 'v2');
    ok(live(root, 'X.csv') === 'v1 original' && r.failed.length === 1 && /did not read back the same/.test(r.failed[0].error), 'a copy that does not read back the same stops the save too: ' + (r.failed[0] || {}).error);
  }

  console.log('· Every copy holds the bytes it replaced (review test 5), over many saves');
  {
    const root = folder('lib'); root.files.set('X.csv', 'gen 0'); root.files.set('Y.csv', 'y 0');
    const seen = [];
    let st = newStorage(), x = 'gen 0', y = 'y 0';
    for (let k = 1; k <= 12; k++) {
      if (k % 4 === 0) st = newStorage();                       // a new session now and then
      if (k % 3 === 0) { root.files.set('X.csv', 'outside ' + k); x = 'outside ' + k; }
      const r = await st.writeFiles(root, [{ name: 'X.csv', text: 'gen ' + k, baseline: H(k % 3 === 0 ? 'gen ' + (k - 1) : x), mustExist: true }, { name: 'Y.csv', text: 'y ' + k, baseline: H(y), mustExist: true }], {});
      Object.keys(r.backupPaths || {}).forEach(n => seen.push({ path: (r.backupPaths || {})[n], want: n === 'X.csv' ? x : y }));
      x = 'gen ' + k; y = 'y ' + k;
    }
    ok(seen.length > 0 && seen.every(s => readPath(root, s.path) === s.want), seen.length + ' copies, each read back: the version it replaced', JSON.stringify(seen.filter(s => readPath(root, s.path) !== s.want).slice(0, 3)));
    ok(new Set(seen.map(s => s.path)).size === seen.length, 'no two copies share a path');
    ok(live(root, 'X.csv') === 'gen 12' && live(root, 'Y.csv') === 'y 12', 'the library files hold the last save');
  }

  console.log('· Nothing to back up when the file already holds the text');
  {
    const root = folder('lib'); root.files.set('X.csv', 'same');
    const r = await save(newStorage(), root, 'X.csv', 'same', 'same');
    ok(r.already.indexOf('X.csv') !== -1 && !root.dirs.has('_backups'), 'no write and no backup');
  }

  // ── Independent check after review 2: bytes, not decoded text ──────────
  console.log('· Copies are the file\'s bytes: a byte-order mark, a non-UTF-8 file, a doubled BOM');
  {
    const BOM = [0xEF, 0xBB, 0xBF];
    const cases = [
      ['B.csv', new Uint8Array(BOM.concat(Array.from(enc.encode('a,b\n1,2\n')))), 'with a BOM'],
      ['W.csv', new Uint8Array([0x43, 0x61, 0x66, 0xE9, 0x0A]), 'in Windows-1252 (Caf\u00e9, as Excel\'s plain "CSV")'],
      ['D.csv', new Uint8Array(BOM.concat(BOM, Array.from(enc.encode('a\n')))), 'starting with two BOMs']];
    const root = folder('lib');
    cases.forEach(([n, b]) => root.files.set(n, b));
    const st = newStorage();
    const read = await st.readFolder(root);
    const byName = Object.fromEntries(read.map(f => [f.name, f]));
    ok(byName['B.csv'].text.charCodeAt(0) === 0xFEFF && !byName['B.csv'].encodingError, 'a file with a BOM is read with its BOM, so saving keeps it');
    ok(/not UTF-8/.test(byName['W.csv'].encodingError || ''), 'a Windows-1252 file is flagged as not UTF-8 instead of being decoded with \uFFFD');
    const rf = SC.records.readFile('W.csv', byName['W.csv'].text, { encodingError: byName['W.csv'].encodingError });
    ok(!rf.ok && /not UTF-8/.test(rf.error) && rf.hash !== SC.records.hashText(''), 'and is refused (not loaded), with a fingerprint of its bytes: ' + rf.error.slice(0, 60));
    for (const [n, b, what] of cases) {
      const r = await st.writeFiles(root, [{ name: n, text: 'replaced\n', baseline: 'changed-elsewhere', mustExist: true }], {});
      const copy = rawPath(root, (r.backupPaths || {})[n]);
      ok(r.saved[n] && copy && hex(copy) === hex(b), 'the copy of the file ' + what + ' is byte for byte the original (' + hex(copy || '') + ')');
    }
  }

  console.log('· The backup folder deleted while the app is open; another library folder; a reset during a save');
  {
    const root = folder('lib'); root.files.set('X.csv', 'x0'); root.files.set('Y.csv', 'y0');
    const st = newStorage();
    await save(st, root, 'X.csv', 'x0', 'x1');
    root.dirs.delete('_backups');                                // the user tidies up the folder
    const r = await save(st, root, 'Y.csv', 'y0', 'y1');
    ok(r.saved['Y.csv'] && readPath(root, (r.backupPaths || {})['Y.csv']) === 'y0', 'a save after _backups was deleted makes a new backup folder and goes through');
    const r2 = await save(st, root, 'X.csv', 'x1', 'x2');
    ok(r2.saved['X.csv'] && readPath(root, (r2.backupPaths || {})['X.csv']) === 'x1', 'and files are copied afresh into it before their next replacement');
    const other = folder('other'); other.files.set('Z.csv', 'z0');
    const r3 = await save(st, other, 'Z.csv', 'z0', 'z1');
    ok(other.dirs.has('_backups') && readPath(other, (r3.backupPaths || {})['Z.csv']) === 'z0', 'saving into another library folder puts its copies in that folder\'s _backups');
    const root4 = folder('lib4'); root4.files.set('A.csv', 'a0'); root4.files.set('B.csv', 'b0');
    const st4 = newStorage();
    const r4 = await st4.writeFiles(root4, [{ name: 'A.csv', text: 'a1', baseline: H('a0'), mustExist: true }, { name: 'B.csv', text: 'b1', baseline: H('b0'), mustExist: true }],
      { stillOwner: async () => { st4.resetSessionBackups(); return true; } });       // the session resets in the middle of the save
    ok(!r4.failed.length && r4.saved['A.csv'] && r4.saved['B.csv'] && r4.backupFolder && readPath(root4, r4.backupPaths['A.csv']) === 'a0' && readPath(root4, r4.backupPaths['B.csv']) === 'b0',
      'a reset in the middle of a save does not break it: ' + JSON.stringify(r4.failed));
  }

  console.log('· A copy that fails is not left behind under the plain name');
  {
    const root = folder('lib', { corruptChildren: true }); root.files.set('X.csv', 'v1 original');
    const st = newStorage();
    await save(st, root, 'X.csv', 'v1 original', 'v2');
    const names = [];
    root.dirs.get('_backups').dirs.forEach(d => d.files.forEach((v, n) => { if (n !== 'BACKUPS.txt') names.push(n); }));
    ok(names.length === 0, 'the copy that did not read back the same is removed (' + names.join(', ') + ')');
    const root2 = folder('lib2', { failCloseChildren: true }); root2.files.set('X.csv', 'v1 original');
    const r = await save(newStorage(), root2, 'X.csv', 'v1 original', 'v2');
    const names2 = [];
    root2.dirs.get('_backups').dirs.forEach(d => d.files.forEach((v, n) => names2.push(n)));
    ok(live(root2, 'X.csv') === 'v1 original' && /Cannot close/.test((r.failed[0] || {}).error || '') && names2.indexOf('X.csv') === -1, 'a copy whose write fails at the end: the file is not replaced, the reason is given, nothing is left under its name');
  }

  console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' backup checks' : 'PASSED ' + count + ' backup checks');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
