/* Slaughter Cataloger 3 — safe output for the tools that rewrite a library
   (tools/change-titleid.js and tools/convert-to-3.js).

   checkOutput(out, inputs)
       The output must be a folder that does not exist yet (nothing is ever written into an existing
       folder or over a file), and it must not lie inside any input folder. Paths are compared after
       resolving symbolic links. Returns the absolute output path; throws a SafeOutputError otherwise.
   readText(file)
       A file's text, decoded strictly as UTF-8, as the app decodes it (js/platform/storage.js): a
       byte-order mark is kept as the first character (csv.js notes it and writes it back), and a file
       that is not valid UTF-8 is never guessed at. Returns { text, bytes, encodingError }; with an
       encodingError, records.readFile refuses the file with that reason.
   writeVerified(out, files, verify)
       Writes files (a Map of relative path → text or bytes) into a temporary folder beside out,
       <out>.partial-<pid>-<random>, which holds INCOMPLETE.txt while it is being written. Every file
       is read back and compared byte for byte, then verify(tmp) is called (it throws if anything is
       wrong). Only then is INCOMPLETE.txt removed and the folder renamed to out. If anything fails,
       the temporary folder (and any parent folders made for it) is removed and the error passed on:
       nothing appears at out. A run killed outright can leave only the temporary folder, named
       .partial- and holding INCOMPLETE.txt; never anything at out.
   leftovers(out)
       Temporary folders that interrupted runs left beside out.

   SC_TEST_FAULT (for tools/test-rewriting-tools.js only) makes a run fail on purpose:
     throw-after-write:N   an error after the Nth file is written
     kill-after-write:N    the process killed (SIGKILL) after the Nth file is written
     verify                the verification fails
     before-rename         an error just before the rename */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

class SafeOutputError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'SafeOutputError'; }
}
const refuse = (code, message) => { throw new SafeOutputError(code, message); };

const isInside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
// ENOTDIR: a folder above p is a file, so nothing is at p (and nothing can be made there).
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; } };

// The real path of p; for a path that does not exist yet, the real path of its nearest existing
// folder with the rest of the path added, so a link anywhere above it is resolved.
function realPath(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.slice().reverse()); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(p);
    rest.push(path.basename(cur));
    cur = up;
  }
}

function checkOutput(out, inputs) {
  if (!out) refuse('usage', 'No output folder given.');
  const abs = path.resolve(out);
  if (exists(abs)) refuse('exists', abs + ' already exists. Give a folder that does not exist yet: nothing is ever written into an existing folder or over a file.');
  let real;
  try { real = realPath(abs); } catch (e) { refuse('path', abs + ' cannot be made there (' + (e.code || e.message) + ').'); }
  for (const input of inputs) {
    const inReal = realPath(input);
    if (isInside(real, inReal)) refuse('inside', 'The output folder ' + abs + ' would be inside ' + path.resolve(input) + ', which is being read. Give a folder outside it.');
    if (isInside(inReal, real)) refuse('contains', 'The output folder ' + abs + ' would contain ' + path.resolve(input) + ', which is being read. Give a folder outside it.');
  }
  return abs;
}

const NOT_UTF8 = 'is not UTF-8 text (it may have been saved by a spreadsheet as "CSV" in a Windows code page rather than as "CSV UTF-8"), so letters such as é would be damaged if it were read. Save it again as CSV UTF-8, then run this again';
function readText(file) {
  const bytes = fs.readFileSync(file);
  try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), bytes, encodingError: '' }; }
  catch (e) { return { text: bytes.toString('latin1'), bytes, encodingError: NOT_UTF8 }; }
}

const MARKER = 'INCOMPLETE.txt';
const MARKER_TEXT = 'This folder was being written by a Slaughter Cataloger tool and was never finished.\n' +
  'It is not a library. Nothing in it has been checked. It can be deleted.\n';

function fault() {
  const m = /^(throw-after-write|kill-after-write):(\d+)$|^(verify|before-rename)$/.exec(process.env.SC_TEST_FAULT || '');
  return m ? { kind: m[1] || m[3], n: m[2] ? Number(m[2]) : 0 } : { kind: '', n: 0 };
}
function writeNew(file, data) {
  const fd = fs.openSync(file, 'wx');
  try { fs.writeSync(fd, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncFolder(dir) { try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (e) { /* not possible on every system */ } }
function safeRel(rel) {
  const parts = String(rel).split('/');
  return rel && !path.isAbsolute(rel) && rel.indexOf('\\') === -1 && parts.every(p => p && p !== '.' && p !== '..');
}

function writeVerified(out, files, verify) {
  const target = path.resolve(out);
  const f = fault();
  if (exists(target)) refuse('exists', target + ' already exists; nothing was written.');
  // Parent folders that do not exist yet are made, and removed again if the output is not finished.
  const made = [];
  for (let p = path.dirname(target); !exists(p); p = path.dirname(p)) { made.unshift(p); if (path.dirname(p) === p) break; }
  const tmp = target + '.partial-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  try {
    made.forEach(d => fs.mkdirSync(d));
    fs.mkdirSync(tmp);
    writeNew(path.join(tmp, MARKER), MARKER_TEXT);
    let n = 0;
    for (const [rel, data] of files) {
      if (!safeRel(rel) || rel === MARKER) refuse('path', 'Refusing to write "' + rel + '".');
      const dest = path.join(tmp, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      writeNew(dest, data);
      n++;
      if (f.kind === 'throw-after-write' && n === f.n) throw new Error('test fault: stopped after writing ' + n + ' file(s).');
      if (f.kind === 'kill-after-write' && n === f.n) process.kill(process.pid, 'SIGKILL');
    }
    // What is on disk is exactly what was meant, file for file.
    for (const [rel, data] of files) {
      const want = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      if (!fs.readFileSync(path.join(tmp, ...rel.split('/'))).equals(want)) refuse('verify', rel + ' did not read back as it was written.');
    }
    if (f.kind === 'verify') refuse('verify', 'test fault: the verification was made to fail.');
    verify(tmp);
    fs.unlinkSync(path.join(tmp, MARKER));
    syncFolder(tmp);
    if (f.kind === 'before-rename') throw new Error('test fault: stopped before the rename.');
    if (exists(target)) refuse('exists', target + ' appeared while the output was being written; nothing was written over it.');
    fs.renameSync(tmp, target);
    syncFolder(path.dirname(target));
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) { /* reported below by the caller's message */ }
    made.slice().reverse().forEach(d => { try { fs.rmdirSync(d); } catch (x) { /* not empty or already gone */ } });
    throw e;
  }
  return target;
}

function leftovers(out) {
  const abs = path.resolve(out), dir = path.dirname(abs), base = path.basename(abs) + '.partial-';
  try { return fs.readdirSync(dir).filter(n => n.startsWith(base)).map(n => path.join(dir, n)); } catch (e) { return []; }
}

module.exports = { SafeOutputError, checkOutput, readText, writeVerified, leftovers, realPath, isInside, MARKER, NOT_UTF8 };
