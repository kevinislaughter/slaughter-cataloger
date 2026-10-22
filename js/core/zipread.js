/* Slaughter Cataloger 3 — a strict ZIP reader for issue packages (docs/ISSUE-PACKAGE.md §13).

   SC.zipread.read(bytes, { inflate, limits }) → { files: Map(path → Uint8Array), directories: [path] }

   It reads the archive's central directory, checks every entry, and returns each file's bytes. It
   refuses, with a reason, anything it cannot be sure of rather than guessing: an unsafe or
   ambiguous path, a symbolic link or other special file, two names for one file, encryption, a
   compression method other than stored or deflate, ZIP64, prepended or overlapping data, a size
   or compression ratio over the limits, a CRC or size that doesn't match.

   Decompression is supplied by the caller, so this file stays free of browser and Node APIs:
     inflate(compressed Uint8Array, expectedSize) → Uint8Array (raw deflate; it must not produce
     more than expectedSize + 1 bytes, so a lying size can't be used to fill memory).
   Errors are thrown as Error objects with .code (a short identifier, listed in the spec) and
   .path (the entry concerned, when there is one). checkPath() is also used for folder packages. */
(function (SC) {
  'use strict';

  const LIMITS = Object.freeze({
    maxEntries: 2000,                    // files and folders in one archive
    maxFileBytes: 512 * 1024 * 1024,     // one file, uncompressed
    maxTotalBytes: 2 * 1024 * 1024 * 1024, // all files, uncompressed
    maxRatio: 200,                       // uncompressed ÷ compressed, for files of ratioFloor bytes or more
    ratioFloor: 1024 * 1024,
    maxPathLength: 240,                  // characters
    maxDepth: 16                         // folders deep
  });

  function fail(code, message, path) {
    const e = new Error(message);
    e.code = code;
    if (path !== undefined) e.path = path;
    throw e;
  }

  // ── Paths ───────────────────────────────────────────────────────────────
  // One rule for archives and folders: relative, forward slashes, no '.' or '..', nothing a
  // file system could read two ways. Returns null if the path is acceptable, else the reason.
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  function checkPath(p, limits) {
    const L = Object.assign({}, LIMITS, limits || {});
    if (typeof p !== 'string' || p === '') return 'an empty name';
    if (LONE_SURROGATE.test(p)) return 'a name that is not valid Unicode';
    if (/[\u0000-\u001f\u007f]/.test(p)) return 'a control character in the name';
    if (p.indexOf('\\') !== -1) return 'a backslash in the name (only / separates folders)';
    if (p[0] === '/') return 'an absolute path';
    if (/^[A-Za-z]:/.test(p)) return 'a drive letter';
    if (Array.from(p).length > L.maxPathLength) return 'a name longer than ' + L.maxPathLength + ' characters';
    const parts = p.split('/');
    if (parts.length > L.maxDepth + 1) return 'more than ' + L.maxDepth + ' folders deep';
    for (const s of parts) {
      if (s === '') return 'an empty folder name (// or a trailing /)';
      if (s === '.' || s === '..') return 'a "' + s + '" segment';
      if (/[<>:"|?*]/.test(s)) return 'a character not allowed in file names (< > : " | ? *)';
      if (/[. ]$/.test(s)) return 'a name ending in a dot or a space';
      if (RESERVED.test(s)) return 'a reserved device name (' + s + ')';
    }
    return null;
  }
  // Two names a file system could treat as one: compared after Unicode composition and case folding.
  const collisionKey = p => p.normalize('NFC').toLowerCase();

  // Checks a whole set of names: each path, duplicates, case/Unicode collisions, and a file
  // that is also used as a folder. Throws on the first problem. dirNames: explicit folder entries.
  function checkNames(names, limits, dirNames) {
    const seen = new Map(), files = new Set();
    for (const n of names.concat(dirNames || [])) {
      const why = checkPath(n, limits);
      if (why) fail('path', 'Unsafe name "' + n + '": ' + why + '.', n);
      const k = collisionKey(n);
      if (seen.has(k)) {
        if (seen.get(k) === n) fail('duplicate', 'The name "' + n + '" occurs twice.', n);
        fail('collision', '"' + seen.get(k) + '" and "' + n + '" would be the same file on many systems (they differ only in letter case or Unicode form).', n);
      }
      seen.set(k, n);
    }
    names.forEach(n => files.add(collisionKey(n)));
    for (const n of names.concat(dirNames || [])) {
      const parts = n.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = collisionKey(parts.slice(0, i).join('/'));
        if (files.has(dir)) fail('collision', '"' + parts.slice(0, i).join('/') + '" is both a file and a folder.', n);
      }
    }
  }

  // ── CRC-32 ──────────────────────────────────────────────────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ── Reading ─────────────────────────────────────────────────────────────
  const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50 };
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  function read(input, opts) {
    const o = opts || {};
    const L = Object.assign({}, LIMITS, o.limits || {});
    if (typeof o.inflate !== 'function') throw new Error('zipread.read needs an inflate function');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = bytes.length;
    const u16 = at => dv.getUint16(at, true), u32 = at => dv.getUint32(at, true);

    // The end record: the last 22 bytes, plus a comment of up to 65,535 bytes.
    if (size < 22) fail('zip', 'Not a ZIP archive (too short).');
    let end = -1;
    for (let i = size - 22; i >= Math.max(0, size - 22 - 65535); i--) {
      if (u32(i) === SIG.end && i + 22 + u16(i + 20) === size) { end = i; break; }
    }
    if (end === -1) fail('zip', 'Not a ZIP archive (no end-of-archive record), or it has data after the end.');
    if (end >= 20 && u32(end - 20) === SIG.locator64) fail('zip64', 'ZIP64 archives are not accepted (packages must be under 4 GB and 65,535 entries).');
    const disk = u16(end + 4), cdDisk = u16(end + 6), onDisk = u16(end + 8), total = u16(end + 10);
    const cdSize = u32(end + 12), cdOffset = u32(end + 16);
    if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) fail('zip64', 'ZIP64 archives are not accepted.');
    if (disk !== 0 || cdDisk !== 0 || onDisk !== total) fail('zip', 'Split (multi-disk) archives are not accepted.');
    if (total > L.maxEntries) fail('limit', 'The archive has ' + total + ' entries; the limit is ' + L.maxEntries + '.');
    if (cdOffset + cdSize !== end) fail('layout', 'The archive\'s directory is not where its end record says (extra or missing bytes before the end).');

    // The central directory.
    const entries = [];
    let p = cdOffset;
    for (let k = 0; k < total; k++) {
      if (p + 46 > end || u32(p) !== SIG.central) fail('zip', 'The archive\'s directory is damaged (entry ' + (k + 1) + ').');
      const madeBy = u16(p + 4), flags = u16(p + 8), method = u16(p + 10);
      const crc = u32(p + 16), csize = u32(p + 20), usize = u32(p + 24);
      const nlen = u16(p + 28), xlen = u16(p + 30), clen = u16(p + 32), diskStart = u16(p + 34);
      const ext = u32(p + 38), local = u32(p + 42);
      if (p + 46 + nlen + xlen + clen > end) fail('zip', 'The archive\'s directory is damaged (entry ' + (k + 1) + ').');
      const nameBytes = bytes.subarray(p + 46, p + 46 + nlen);
      let name;
      try { name = utf8.decode(nameBytes); } catch (e) { fail('path', 'An entry name is not UTF-8 (entry ' + (k + 1) + ').'); }
      const extra = bytes.subarray(p + 46 + nlen, p + 46 + nlen + xlen);
      entries.push({ name, nameBytes, madeBy, flags, method, crc, csize, usize, diskStart, ext, local, extra });
      p += 46 + nlen + xlen + clen;
    }
    if (p !== end) fail('layout', 'The archive\'s directory has bytes its entries don\'t account for.');

    const files = [], dirs = [];
    let totalBytes = 0;
    for (const e of entries) {
      const n = e.name;
      if (e.flags & 0x0001 || e.flags & 0x0040 || e.flags & 0x2000) fail('encrypted', 'Encrypted entries are not accepted.', n);
      if (e.diskStart !== 0) fail('zip', 'Split archives are not accepted.', n);
      if (e.csize === 0xFFFFFFFF || e.usize === 0xFFFFFFFF || e.local === 0xFFFFFFFF) fail('zip64', 'ZIP64 entries are not accepted.', n);
      // Extra fields: refuse ZIP64 data and a second (Unicode) name that disagrees with the first.
      for (let q = 0; q + 4 <= e.extra.length;) {
        const id = e.extra[q] | (e.extra[q + 1] << 8), len = e.extra[q + 2] | (e.extra[q + 3] << 8);
        if (q + 4 + len > e.extra.length) fail('zip', 'An entry\'s extra data is damaged.', n);
        if (id === 0x0001) fail('zip64', 'ZIP64 entries are not accepted.', n);
        if (id === 0x7075 && len >= 5) {
          let alt = null;
          try { alt = utf8.decode(e.extra.subarray(q + 9, q + 4 + len)); } catch (err) { alt = null; }
          if (alt !== n) fail('path', 'An entry carries two different names ("' + n + '" and another).', n);
        }
        q += 4 + len;
      }
      const host = e.madeBy >> 8, mode = (e.ext >>> 16) & 0xF000;
      const isDir = n.endsWith('/');
      if (host === 3 && mode === 0xA000) fail('symlink', 'Symbolic links are not accepted ("' + n + '").', n);
      if (host === 3 && mode && mode !== 0x8000 && mode !== 0x4000) fail('special', 'Special files (devices, pipes, sockets) are not accepted ("' + n + '").', n);
      if (isDir) {
        if (e.usize !== 0) fail('zip', 'A folder entry has contents ("' + n + '").', n);
        dirs.push(Object.assign(e, { path: n.slice(0, -1) }));
        continue;
      }
      if (host === 3 && mode === 0x4000) fail('zip', 'A folder entry has a file name ("' + n + '").', n);
      if (e.method !== 0 && e.method !== 8) fail('method', 'Compression method ' + e.method + ' is not accepted (only stored and deflate).', n);
      if (e.method === 0 && e.csize !== e.usize) fail('size', 'A stored entry\'s sizes disagree ("' + n + '").', n);
      if (e.usize > L.maxFileBytes) fail('limit', '"' + n + '" is ' + e.usize + ' bytes; the limit for one file is ' + L.maxFileBytes + '.', n);
      totalBytes += e.usize;
      if (totalBytes > L.maxTotalBytes) fail('limit', 'The files add up to more than ' + L.maxTotalBytes + ' bytes.', n);
      if (e.usize >= L.ratioFloor && e.usize > e.csize * L.maxRatio) fail('ratio', '"' + n + '" expands ' + Math.round(e.usize / Math.max(1, e.csize)) + ' times; the limit is ' + L.maxRatio + '.', n);
      files.push(Object.assign(e, { path: n }));
    }
    checkNames(files.map(f => f.path), L, dirs.map(d => d.path));

    // Each entry's local header must match its directory entry, and no two entries may share bytes.
    const spans = [];
    for (const e of files.concat(dirs)) {
      const at = e.local;
      if (at + 30 > cdOffset || u32(at) !== SIG.local) fail('zip', 'An entry\'s local header is missing or damaged ("' + e.name + '").', e.name);
      const lflags = u16(at + 6), lmethod = u16(at + 8), lnlen = u16(at + 26), lxlen = u16(at + 28);
      const lname = bytes.subarray(at + 30, at + 30 + lnlen);
      if (lname.length !== e.nameBytes.length || lname.some((b, i) => b !== e.nameBytes[i])) fail('mismatch', 'An entry\'s two names disagree ("' + e.name + '").', e.name);
      if (lmethod !== e.method || (lflags & 1) !== (e.flags & 1)) fail('mismatch', 'An entry\'s local header disagrees with the directory ("' + e.name + '").', e.name);
      const dataStart = at + 30 + lnlen + lxlen;
      const dataEnd = dataStart + e.csize;
      if (dataEnd > cdOffset) fail('layout', 'An entry runs into the archive\'s directory ("' + e.name + '").', e.name);
      e.dataStart = dataStart;
      spans.push({ from: at, to: dataEnd, name: e.name });
    }
    spans.sort((a, b) => a.from - b.from);
    if (spans.length && spans[0].from !== 0) fail('layout', 'The archive has data before its first entry (a self-extracting or altered archive).');
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].from < spans[i - 1].to) fail('overlap', 'Two entries share bytes ("' + spans[i - 1].name + '" and "' + spans[i].name + '").', spans[i].name);
    }

    // Contents: inflate, then check the size and the CRC.
    const out = new Map();
    for (const e of files) {
      const raw = bytes.subarray(e.dataStart, e.dataStart + e.csize);
      let data;
      if (e.method === 0) data = raw;
      else {
        try { data = o.inflate(raw, e.usize); } catch (err) { fail('size', '"' + e.path + '" could not be decompressed within its stated size (' + (err && err.message || err) + ').', e.path); }
        if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
      }
      if (data.length !== e.usize) fail('size', '"' + e.path + '" is ' + data.length + ' bytes, not the ' + e.usize + ' the archive states.', e.path);
      if (crc32(data) !== e.crc) fail('crc', '"' + e.path + '" fails its CRC check (the archive is damaged or was altered).', e.path);
      out.set(e.path, data);
    }
    return { files: out, directories: dirs.map(d => d.path) };
  }

  SC.zipread = Object.freeze({ read, checkPath, checkNames, collisionKey, crc32, LIMITS });
})(globalThis.SC = globalThis.SC || {});
