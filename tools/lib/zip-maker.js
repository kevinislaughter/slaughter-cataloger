/* Slaughter Cataloger 3 — a ZIP builder for the tests only, including deliberately broken
   archives (unsafe names, links, lying sizes, overlapping entries …). It is not the app's ZIP
   writer and nothing outside tools/test-*.js uses it.

   makeZip(entries, opts) → Buffer
     entries: [{ name, data, method (0 stored | 8 deflate, default 8), and any override:
                 crc, usize, csize, flags, madeBy, extAttr, localName, extra, localOffset, rawName }]
     opts:    { prepend: Buffer, trailing: Buffer, zip64Locator: true, comment: Buffer } */
'use strict';
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function localHeader(e) {
  const name = e.localName !== undefined ? Buffer.from(e.localName, 'utf8') : e.nameBytes;
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(e.flags, 6); h.writeUInt16LE(e.method, 8);
  h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);                  // a fixed time and date
  h.writeUInt32LE(e.crc, 14); h.writeUInt32LE(e.csize, 18); h.writeUInt32LE(e.usize, 22);
  h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  return Buffer.concat([h, name]);
}

function prepare(x) {
  const data = Buffer.isBuffer(x.data) ? x.data : Buffer.from(x.data || '', 'utf8');
  const method = x.method === undefined ? (x.name.endsWith('/') ? 0 : 8) : x.method;
  const comp = method === 8 ? zlib.deflateRawSync(data) : data;
  return {
    name: x.name, nameBytes: x.rawName || Buffer.from(x.name, 'utf8'), localName: x.localName, method, comp,
    flags: x.flags === undefined ? 0x0800 : x.flags,
    crc: x.crc === undefined ? crc32(data) : x.crc,
    usize: x.usize === undefined ? data.length : x.usize,
    csize: x.csize === undefined ? comp.length : x.csize,
    madeBy: x.madeBy === undefined ? (3 << 8) | 20 : x.madeBy,
    extAttr: x.extAttr === undefined ? ((x.name.endsWith('/') ? 0o040755 : 0o100644) << 16) >>> 0 : x.extAttr,
    extra: x.extra || Buffer.alloc(0), localOffset: x.localOffset, payload: x.payload
  };
}

function makeZip(list, opts) {
  const o = opts || {};
  const entries = list.map(prepare);
  const parts = [];
  let at = o.prepend ? o.prepend.length : 0;
  if (o.prepend) parts.push(o.prepend);
  entries.forEach(e => {
    if (e.localOffset !== undefined) return;          // points into another entry (an overlap test)
    e.offset = at;
    const lh = localHeader(e);
    parts.push(lh, e.comp);
    at += lh.length + e.comp.length;
  });
  entries.forEach(e => { if (e.localOffset !== undefined) e.offset = e.localOffset; });
  const cdStart = at;
  entries.forEach(e => {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(e.madeBy, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.flags, 8);
    c.writeUInt16LE(e.method, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.usize, 24);
    c.writeUInt16LE(e.nameBytes.length, 28); c.writeUInt16LE(e.extra.length, 30); c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(e.extAttr, 38); c.writeUInt32LE(e.offset, 42);
    parts.push(c, e.nameBytes, e.extra);
    at += 46 + e.nameBytes.length + e.extra.length;
  });
  const cdSize = at - cdStart;
  if (o.zip64Locator) {
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    parts.push(loc);
  }
  const comment = o.comment || Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16); end.writeUInt16LE(comment.length, 20);
  parts.push(end, comment);
  if (o.trailing) parts.push(o.trailing);
  return Buffer.concat(parts);
}

// A whole package Map as a ZIP, optionally under one top-level folder.
const zipOfMap = (files, folder) => makeZip(Array.from(files.keys()).sort().map(p => ({ name: (folder ? folder + '/' : '') + p, data: files.get(p) })));

module.exports = { makeZip, zipOfMap, localHeader: e => localHeader(prepare(e)), crc32 };
