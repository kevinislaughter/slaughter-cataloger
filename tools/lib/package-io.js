/* Slaughter Cataloger 3 — reading and writing packages from Node (issue packages and staging packages).

   readPackage(p)       a folder or a .zip → Map(path → Buffer), with the same path rules either way
   readZip(bytes)       the same, for an archive already read into memory
                        (js/core/zipread.js): no links, no special files, no unsafe or colliding names
   writeNewFolder(dir, files)
                        writes a Map into a folder that must not exist yet; the files go into a
                        temporary sibling folder first, which is renamed into place only when complete
   sha256(bytes), inflate(bytes, expectedSize), isInside(child, parent), loadCore()
   Nothing here writes into a package it reads. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');

function loadCore() {
  globalThis.SC = globalThis.SC || {};
  ['csv', 'ids', 'schema', 'zipread', 'issuepkg'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
  return globalThis.SC;
}
const SC = loadCore();

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
// Raw deflate, refusing to produce more than the stated size (+1, so a short count is still noticed).
const inflate = (b, n) => zlib.inflateRawSync(b, { maxOutputLength: Math.max(1, n + 1) });
const isInside = (child, parent) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function fail(code, message, p) { const e = new Error(message); e.code = code; if (p) e.path = p; throw e; }

function readFolder(dir, limits) {
  const L = Object.assign({}, SC.zipread.LIMITS, limits || {});
  const out = new Map();
  let total = 0, count = 0;
  (function walk(d, rel) {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name), r = rel ? rel + '/' + name : name;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) fail('symlink', 'Symbolic links are not accepted ("' + r + '").', r);
      if (st.isDirectory()) { walk(full, r); continue; }
      if (!st.isFile()) fail('special', 'Special files are not accepted ("' + r + '").', r);
      if (++count > L.maxEntries) fail('limit', 'The folder has more than ' + L.maxEntries + ' files.');
      if (st.size > L.maxFileBytes) fail('limit', '"' + r + '" is larger than ' + L.maxFileBytes + ' bytes.', r);
      total += st.size;
      if (total > L.maxTotalBytes) fail('limit', 'The files add up to more than ' + L.maxTotalBytes + ' bytes.');
      out.set(r, fs.readFileSync(full));
    }
  })(path.resolve(dir), '');
  SC.zipread.checkNames(Array.from(out.keys()), L);
  return out;
}

function readZip(bytes, limits) {
  const r = SC.zipread.read(bytes, { inflate, limits });
  return new Map(Array.from(r.files, ([k, v]) => [k, Buffer.from(v.buffer, v.byteOffset, v.byteLength)]));
}

function readPackage(p, limits) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return readFolder(p, limits);
  return readZip(fs.readFileSync(p), limits);
}

function writeNewFolder(dir, files) {
  const target = path.resolve(dir);
  if (fs.existsSync(target)) fail('exists', target + ' already exists; give a folder that does not exist yet (nothing is ever written over).');
  const tmp = target + '.partial-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const [rel, bytes] of files) {
      const why = SC.zipread.checkPath(rel);
      if (why) fail('path', 'Refusing to write "' + rel + '": ' + why + '.', rel);
      const out = path.join(tmp, ...rel.split('/'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, bytes, { flag: 'wx' });
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return target;
}

module.exports = { ROOT, SC, loadCore, sha256, inflate, isInside, readFolder, readZip, readPackage, writeNewFolder };
