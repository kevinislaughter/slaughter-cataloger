#!/usr/bin/env node
/* Tests for issue packages (docs/ISSUE-PACKAGE.md): the strict ZIP reader, the validator, the
   staging converter and the invented twin (sample-data/issue-package/).

   node tools/test-issuepkg.js
       the public suite. Uses only the invented twin and archives built here. With SC_LIST_CHECKS=1
       it lists every check it passes, not only failures.
   node tools/test-issuepkg.js --private <staging .zip or folder> [--keep <folder>]
       the private acceptance run on a real staging package: converts it into a temporary folder
       outside the repository, validates the result, rebuilds the full text, candidate rows and
       deep index from it and compares them with the originals, compares every offset with an
       independent Python reading, and checks the staging package was not changed. Prints counts
       and check results only, never text. --keep keeps the converted package (the folder must
       not exist and must be outside the repository). Used by run-tests.sh when SC_PRIVATE_FIXTURE
       is set. Needs Python 3 (tools/check-offsets.py). */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const io = require('./lib/package-io');
const staging = require('./lib/staging');
const zm = require('./lib/zip-maker');
const SC = io.SC, P = SC.issuepkg, Z = SC.zipread;
const ROOT = io.ROOT;
const TWIN = path.join(ROOT, 'sample-data', 'issue-package');

let fails = 0, count = 0;
const PRIVATE = process.argv[2] === '--private';      // the private run lists every check it makes (names and counts only)
const LIST = PRIVATE || process.env.SC_LIST_CHECKS === '1'; // SC_LIST_CHECKS=1 lists the public suite's checks too
const ok = (cond, what, detail) => {
  count++;
  if (!cond) { fails++; console.log('FAIL ' + what + (detail !== undefined ? '\n   ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
  else if (LIST) console.log('  ok   ' + what);
};
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), what, 'got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
const validate = files => P.validate(files, { sha256: io.sha256 });
const codes = r => Array.from(new Set(r.errors.map(e => e.code)));
const refused = (r, code, what) => ok(!r.ok && codes(r).includes(code), 'refused: ' + what + ' [' + code + ']', r.ok ? 'it was accepted' : 'codes ' + codes(r).join(', ') + ' — ' + r.errors.slice(0, 2).map(e => e.message).join(' | '));
const B = s => Buffer.from(s, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-issuepkg-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const hashTree = dir => { const m = io.readFolder(dir); return Array.from(m.keys()).sort().map(k => k + ' ' + io.sha256(m.get(k))).join('\n'); };

// Offsets compared with Python, which counts code points natively.
function pythonAgrees(folder, what) {
  const r = cp.spawnSync('python3', ['-I', path.join(ROOT, 'tools', 'check-offsets.py'), folder], { encoding: 'utf8' });
  if (r.status !== 0) { ok(false, what + ': python3 tools/check-offsets.py ran', r.stderr || r.error); return 0; }
  const py = JSON.parse(r.stdout);
  const v = validate(io.readPackage(folder)), pkg = v.pkg;
  let n = 0;
  const bad = [];
  pkg.text.pages.forEach((p, i) => { n++; const q = py.pages[i]; if (!q || q.length !== P.cpLength(p.text) || q.sha256 !== io.sha256(B(p.text))) bad.push('page ' + p.page); });
  const js = {};
  pkg.text.segments.forEach(s => { js['segment:' + s.id] = P.spanText(pkg, s); });
  pkg.text.unassigned.forEach(s => { js['unassigned:' + s.id] = P.spanText(pkg, s); });
  ((pkg.rights || {}).withheld || []).forEach(s => { js['withheld:' + s.id] = P.spanText(pkg, s); });
  const M = pkg.mentions || {};
  ['entities', 'subjects'].forEach(k => (M[k] || []).forEach(m => (m.anchors || []).forEach((a, i) => { js['anchor:' + m.id + ':' + i] = P.spanText(pkg, a); })));
  Object.keys(js).forEach(k => { n++; if (py.spans[k] !== io.sha256(B(js[k]))) bad.push(k); });
  if (Object.keys(py.spans).length !== Object.keys(js).length) bad.push('Python read ' + Object.keys(py.spans).length + ' spans, JavaScript ' + Object.keys(js).length);
  ok(!bad.length, what + ': JavaScript and Python agree on every page and offset (' + n + ' compared)', bad.slice(0, 10).join(', '));
  return n;
}

if (PRIVATE) { privateRun(); return; }

// ════════════════════════════════════════════════════════════════════════
// 1. Code points
// ════════════════════════════════════════════════════════════════════════
const frak = '𝔊𝔞𝔷𝔢𝔱𝔱𝔢';                                  // 7 code points, 14 UTF-16 units
eq([P.cpLength(frak), frak.length], [7, 14], 'a non-BMP word: code points vs UTF-16 units');
eq(P.cpSlice('a' + frak + 'b', 1, 8), frak, 'cpSlice counts code points');
eq(P.cpSlice('a' + frak + 'b', 8, 9), 'b', 'after a non-BMP word, offsets still line up');
eq(P.cpLength('Cafe\u0301'), 5, 'a combining accent is its own code point (offsets are not grapheme clusters)');
eq(P.cpIndex('x😀y'), [0, 1, 3, 4], 'cpIndex maps code points to string positions');
eq(P.cpLength(''), 0, 'empty text has length 0');
ok(!P.isWellFormed('a\uD800b') && P.isWellFormed('a😀b'), 'an unpaired surrogate is not well-formed Unicode');

// ════════════════════════════════════════════════════════════════════════
// 2. Strict JSON
// ════════════════════════════════════════════════════════════════════════
const pj = s => P.parseJSON(typeof s === 'string' ? B(s) : s);
eq(pj('{"a":1}').value, { a: 1 }, 'plain JSON parses');
eq(pj(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), B('{}')])).code, 'encoding', 'a byte-order mark is refused');
eq(pj(Buffer.from([0x7B, 0x22, 0xC3, 0x28, 0x22, 0x3A, 0x31, 0x7D])).code, 'encoding', 'invalid UTF-8 is refused');
eq(pj('{"a":1,"a":2}').code, 'json', 'a key twice in one object is refused (two parsers could disagree)');
eq(pj('{"a":{"b":1},"c":{"b":2}}').error, undefined, 'the same key in different objects is fine');
eq(pj('{"a":"x\\"y","a2":"\\\\","b":["a","a"]}').error, undefined, 'escaped quotes and repeated array values are not mistaken for keys');
eq(pj('{"a":"\\ud800"}').code, 'encoding', 'an escaped unpaired surrogate is refused');
eq(pj('{"a":').code, 'json', 'truncated JSON is refused');
eq(pj('['.repeat(101) + ']'.repeat(101)).code, 'json', 'nesting deeper than 100 levels is refused');
eq(P.serialize({ b: 1, a: [2, 'é𝔊'] }), '{\n  "b": 1,\n  "a": [\n    2,\n    "é𝔊"\n  ]\n}\n', 'the package JSON layout: 2-space indent, final newline, UTF-8 as is');

// ════════════════════════════════════════════════════════════════════════
// 3. Paths and names (the same rules for archives and folders)
// ════════════════════════════════════════════════════════════════════════
['text.json', 'provenance/staging/a b/c.md', 'source/x.pdf', 'é/ü.txt'].forEach(p => eq(Z.checkPath(p), null, 'a safe path: ' + p));
[['../x', '..'], ['a/../b', '..'], ['./a', '"."'], ['/etc/x', 'absolute'], ['a\\b', 'backslash'], ['C:x', 'drive'], ['a//b', 'empty'], ['a/', 'empty'],
 ['con.txt', 'reserved'], ['x/a:b', 'not allowed'], ['a:b', 'drive'], ['a.', 'dot'], ['a ', 'space'], ['a\u0001b', 'control'], ['', 'empty'], ['x'.repeat(241), 'longer'], [Array(18).fill('d').join('/'), 'deep']]
  .forEach(([p, why]) => ok((Z.checkPath(p) || '').indexOf(why) !== -1, 'an unsafe path is refused (' + JSON.stringify(p.slice(0, 20)) + ': ' + why + ')', Z.checkPath(p)));
const nameErr = (names, dirs) => { try { Z.checkNames(names, undefined, dirs); return null; } catch (e) { return e.code; } };
eq(nameErr(['a.txt', 'A.txt']), 'collision', 'names differing only in case collide');
eq(nameErr(['caf\u00e9.txt', 'cafe\u0301.txt']), 'collision', 'names differing only in Unicode form (NFC/NFD) collide');
eq(nameErr(['a', 'a/b']), 'collision', 'a name used as both a file and a folder');
eq(nameErr(['a.txt', 'b/a.txt']), null, 'the same name in different folders is fine');

// ════════════════════════════════════════════════════════════════════════
// 4. The strict ZIP reader
// ════════════════════════════════════════════════════════════════════════
eq(Z.crc32(B('123456789')), 0xCBF43926, 'CRC-32 check value');
const zread = (buf, limits) => { try { const r = Z.read(buf, { inflate: io.inflate, limits }); return { ok: true, r }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } };
const good = zread(zm.makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'd/', data: '' }, { name: 'd/b.txt', data: 'x'.repeat(5000) }, { name: 'c.bin', data: Buffer.from([0, 1, 2]), method: 0 }]));
ok(good.ok && good.r.files.get('a.txt').toString() === 'hello' && good.r.files.get('d/b.txt').length === 5000 && good.r.files.size === 3, 'a plain archive reads (stored and deflated entries, a folder entry)', good.message);
const zbad = (what, code, entries, opts, limits) => { const r = zread(zm.makeZip(entries, opts), limits); ok(!r.ok && r.code === code, 'archive refused: ' + what + ' [' + code + ']', r.ok ? 'accepted' : r.code + ': ' + r.message); };
zbad('a "../" path', 'path', [{ name: '../evil.txt', data: 'x' }]);
zbad('an absolute path', 'path', [{ name: '/etc/evil', data: 'x' }]);
zbad('a backslash path', 'path', [{ name: 'a\\..\\evil', data: 'x' }]);
zbad('a drive letter', 'path', [{ name: 'C:/evil', data: 'x' }]);
zbad('a name that is not UTF-8', 'path', [{ name: 'x', rawName: Buffer.from([0x61, 0xFF, 0x62]), data: 'x' }]);
zbad('a symbolic link', 'symlink', [{ name: 'link', data: '/etc/passwd', extAttr: (0o120777 << 16) >>> 0 }]);
zbad('a special file (a pipe)', 'special', [{ name: 'fifo', data: '', extAttr: (0o010644 << 16) >>> 0 }]);
zbad('the same name twice', 'duplicate', [{ name: 'a.txt', data: '1' }, { name: 'a.txt', data: '2' }]);
zbad('names differing only in case', 'collision', [{ name: 'issue.json', data: '1' }, { name: 'ISSUE.json', data: '2' }]);
zbad('a CRC that does not match', 'crc', [{ name: 'a.txt', data: 'hello', crc: 1234 }]);
zbad('a stated size smaller than the data (a lying size)', 'size', [{ name: 'a.txt', data: 'hello world, hello world', usize: 5 }]);
zbad('a stated size larger than the data', 'size', [{ name: 'a.txt', data: 'hello', usize: 50 }]);
zbad('a compression bomb (2 MB of zeros)', 'ratio', [{ name: 'zeros.bin', data: Buffer.alloc(2 * 1024 * 1024) }]);
zbad('more entries than the limit', 'limit', [{ name: 'a', data: '1' }, { name: 'b', data: '2' }, { name: 'c', data: '3' }], null, { maxEntries: 2 });
zbad('a file over the size limit', 'limit', [{ name: 'a', data: 'x'.repeat(100) }], null, { maxFileBytes: 50 });
zbad('an encrypted entry', 'encrypted', [{ name: 'a.txt', data: 'x', flags: 0x0801 }]);
zbad('an unsupported compression method', 'method', [{ name: 'a.txt', data: 'x', method: 12 }]);
zbad('a ZIP64 end record', 'zip64', [{ name: 'a.txt', data: 'x' }], { zip64Locator: true });
zbad('a ZIP64 extra field', 'zip64', [{ name: 'a.txt', data: 'x', extra: Buffer.from([1, 0, 0, 0]) }]);
zbad('a second (Unicode) name that disagrees', 'path', [{ name: 'a.txt', data: 'x', extra: Buffer.concat([Buffer.from([0x75, 0x70, 10, 0, 1, 0, 0, 0, 0]), B('b.txt')]) }]);
zbad('data before the first entry', 'layout', [{ name: 'a.txt', data: 'x' }], { prepend: B('MZ-self-extractor') });
zbad('local and directory names that disagree', 'mismatch', [{ name: 'a.txt', localName: 'b.txt', data: 'x' }]);
const trailing = zread(Buffer.concat([zm.makeZip([{ name: 'a.txt', data: 'x' }]), B('junk')]));
ok(!trailing.ok && trailing.code === 'zip', 'archive refused: data after the end record [zip]', trailing.code);
ok(!zread(B('not a zip at all, just text')).ok, 'archive refused: not a ZIP archive');
ok(!zread(Buffer.alloc(10)).ok, 'archive refused: too short to be a ZIP archive');
// Two entries sharing bytes: b's local header and data sit inside a's (stored) data.
{
  const inner = Buffer.concat([zm.localHeader({ name: 'b.txt', data: 'inner', method: 0 }), B('inner')]);
  const lhA = zm.localHeader({ name: 'a.txt', data: inner, method: 0 }).length;
  zbad('two entries that share bytes (an overlapping-file bomb)', 'overlap', [{ name: 'a.txt', data: inner, method: 0 }, { name: 'b.txt', data: 'inner', method: 0, localOffset: lhA }]);
}

// Folders: no symbolic links either.
{
  const d = path.join(tmp, 'folder-with-link');
  fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'issue.json'), '{}');
  let code = null;
  try { fs.symlinkSync('/etc/hostname', path.join(d, 'link.txt')); io.readFolder(d); } catch (e) { code = e.code; }
  ok(code === 'symlink' || code === 'EPERM', 'a folder package with a symbolic link is refused [symlink]', code);
}

// ════════════════════════════════════════════════════════════════════════
// 5. The twin, as committed
// ════════════════════════════════════════════════════════════════════════
const NATIVE = path.join(TWIN, 'native'), STAGING = path.join(TWIN, 'staging');
const twin = io.readPackage(NATIVE);
const tv = validate(twin);
ok(tv.ok, 'the native twin validates', tv.errors.slice(0, 3));
eq(tv.warnings.length, 0, 'the native twin validates without warnings');
eq(tv.summary, { title_id: 'EXAGAZEX-1872', issue_id: 'EXAGAZEX-1872-KRNYWA2', identity_status: 'resolved', provisional_key: null, state: 'candidate', pages: 8, items: 18, parent_links: 7, segments: 26, unassigned: 25, entities: 21, subjects: 5, files: 23 }, 'the twin\'s counts');
const pkg = tv.pkg;
const key = n => 'gazette-v4n1-item-' + String(n).padStart(4, '0');
const parts = n => P.itemParts(pkg, key(n));
// Pages: no folio on page 1 (inferred), blank page 8.
eq([pkg.text.pages[0].folio, pkg.text.pages[0].folio_status, pkg.text.pages[0].inferred_folio], [null, 'absent', '1'], 'page 1: no printed folio; catalog page 1 inferred');
eq([pkg.text.pages[7].folio_status, pkg.text.segments.filter(s => s.page === 8).length, pkg.text.unassigned.filter(s => s.page === 8).length], ['absent', 0, 1], 'page 8: blank, all of it one unassigned span');
eq(pkg.text.pages.slice(1, 7).map(p => p.folio), ['2', '3', '4', '5', '6', '7'], 'pages 2–7 have printed folios');
// The continuation across non-adjacent pages.
eq(parts(8).map(p => p.page), [2, 6], 'item 8 is on pages 2 and 6 only');
ok(P.itemText(pkg, key(8)) === parts(8)[0].text + parts(8)[1].text && /continued on page 6/.test(parts(8)[0].text) && /continued from page 2/.test(parts(8)[1].text), 'item 8 reads continuously, page 2 then page 6, with nothing from pages 3–5');
// The department whose children are not next to each other.
const items = pkg.items.items;
eq([4, 6, 7].map(n => items[n - 1].parent), [key(3), key(3), key(3)], 'item 3 has children 4, 6 and 7');
eq(items[4].parent === undefined || items[4].parent === null, true, 'item 5, between them, is top level');
eq(parts(3).length, 3, 'item 3\'s own text is in three pieces');
ok([4, 6, 7].every(n => P.itemText(pkg, key(3)).indexOf(P.itemText(pkg, key(n))) === -1), 'the parent\'s text does not repeat its children\'s');
eq(parts(18).length, 4, 'item 18 is split into four segments by layout material');
eq(parts(9).map(p => p.page), [3, 3], 'item 9 is split around an engraving on one page');
// Every single-segment item's text is its segment.
ok(items.every(it => { const ps = P.itemParts(pkg, it.key); return ps.length >= 1 && P.itemText(pkg, it.key) === ps.map(p => p.text).join(''); }), 'every item has text, and its text is its segments joined in reading order');
// The whole transcription is derivable.
eq(io.sha256(B(P.transcription(pkg))), io.sha256(fs.readFileSync(path.join(STAGING, 'transcription.md'))), 'apparatus + every page = the staging transcription.md, byte for byte');
// Code points, not UTF-16 units.
const p1 = pkg.text.pages[0];
ok(p1.length < p1.text.length, 'page 1 has characters outside the Basic Multilingual Plane (' + p1.length + ' code points, ' + p1.text.length + ' UTF-16 units)');
const s1 = pkg.text.segments.find(s => s.item === key(1));
ok(p1.text.slice(s1.start, s1.end) !== P.spanText(pkg, s1) && P.spanText(pkg, s1).startsWith('### TO OUR READERS'), 'reading offsets as UTF-16 units would cut item 1 in the wrong place; as code points it is exact');
ok(P.itemText(pkg, key(13)).indexOf('Cafe\u0301 Anytown') !== -1, 'item 13 keeps its combining accent as typed (no normalization)');
pythonAgrees(NATIVE, 'the native twin');
// Markup: the closed set, nothing outside it.
const marks = pkg.text.pages.map(p => P.scanMarkup(p.text));
const total = k => marks.reduce((a, m) => a + m.counts[k], 0);
eq(['anchor', 'supplied', 'illegible', 'unclear', 'fence', 'list_item', 'escape'].map(total), [8, 3, 1, 1, 1, 2, 2], 'the twin uses page anchors, supplied text, [illegible], [unclear: …], a fenced block, list items and escapes');
eq(marks.reduce((a, m) => a + m.notes.length, 0), 0, 'nothing in the twin looks like markup outside the set ("[Communicated.]" is printed text)');
eq(P.scanMarkup('<b>bold</b> and [note: x] and [link](http://x)').notes.length, 3, 'HTML tags, unknown editorial marks and links are noted, to be shown literally');
// Canaries for later leak tests.
const has = (p, s) => twin.get(p).indexOf(B(s)) !== -1;
eq(['canary-item-text-01', 'canary-page-text-02', 'canary-contact-03'].map(c => has('text.json', c)), [true, true, true], 'canaries in item text, page text and a contact line');
ok(P.itemText(pkg, key(8)).indexOf('canary-item-text-01') !== -1 && P.itemText(pkg, key(13)).indexOf('canary-contact-03') !== -1, 'canaries sit in the items they are meant for');
ok(has('mentions.json', 'canary-mention-04') && has('cover.jpg', 'canary-cover-05') && has('source/example-gazette-v4n1.pdf', 'canary-source-06'), 'canaries in a mention, the cover (a JPEG comment) and the source PDF');
// Rights and review.
eq([pkg.rights.rights_status.value, pkg.rights.decisions.filter(d => d.value === 'allow').length, pkg.rights.decisions.length], ['undetermined', 0, 16], 'rights: undetermined, nothing allowed, 16 explicit denials of public use');
eq(pkg.issue.review.map(q => [q.id, q.status, q.blocks.indexOf('local_import') !== -1]), [['Q-01', 'blocking', true], ['Q-02', 'blocking', true], ['Q-03', 'deferred', false]], 'the review queue: two items block import');
eq([pkg.mentions.entities.every(e => !e.anchors), pkg.mentions.entities[20].precision, pkg.mentions.entities[0].precision], [true, 'page', 'item'], 'mentions have no offsets; precision is item, or page for an issue-level mention');
eq(pkg.issue.identity.identity_history.map(h => [h.id, h.status]), [['EXAGAZEX-1872-KQ7RW4M', 'superseded']], 'the superseded working IssueID is in the history');

// Every native JSON file round-trips byte for byte through parse + serialize.
['issue.json', 'text.json', 'items.json', 'mentions.json', 'rights.json', 'provenance/CONVERSION.json'].forEach(f => {
  eq(io.sha256(B(P.serialize(P.parseJSON(twin.get(f)).value))), io.sha256(twin.get(f)), f + ' round-trips unchanged through parse and serialize');
});

// ════════════════════════════════════════════════════════════════════════
// 6. Conversion of the staging twin: lossless, and the original untouched
// ════════════════════════════════════════════════════════════════════════
const stagingFiles = io.readPackage(STAGING);
const before = hashTree(STAGING);
const conv = staging.convert(stagingFiles, { sha256: io.sha256, archive: null });
const same = Array.from(conv.files.keys()).sort().join('|') === Array.from(twin.keys()).sort().join('|') && Array.from(twin.keys()).every(k => Buffer.compare(Buffer.from(conv.files.get(k)), twin.get(k)) === 0);
ok(same, 'converting the staging twin gives the committed native twin, byte for byte');
eq(hashTree(STAGING), before, 'the staging twin is unchanged by conversion');
// The three re-expressed files rebuild exactly.
const back = staging.reconstruct(twin);
[['fulltext.json', 'text.json'], ['candidate_contents_seq001-018.provisional.json', 'items.json'], ['private_index/deep_index.json', 'mentions.json']].forEach(([f, n]) => {
  ok(back.has(f) && staging.canon(back.get(f)) === staging.canon(JSON.parse(stagingFiles.get(f))), f + ' rebuilds exactly from ' + n + ' (every field, every value)');
});
// Every article segment, exactly.
const F = JSON.parse(stagingFiles.get('fulltext.json'));
const segOK = F.items.every(it => it.segments.every(s => P.segmentText(pkg, s.segment_id) === s.text)) && F.unassigned_page_spans.every(g => g.spans.every(s => P.segmentText(pkg, s.unassigned_span_id) === s.text));
ok(segOK, 'every one of the ' + F.items.reduce((a, it) => a + it.segments.length, 0) + ' segments and every unassigned span reads back exactly from the native page text');
ok(F.items.every(it => it.text === null || it.text === P.itemText(pkg, it.local_item_key)), 'every item text given in the staging file equals the native item text');
// Unknown and extra things survive.
eq(pkg.text.origin['fulltext.json'].producer_extension, F.producer_extension, 'a field no converter knows survives conversion unchanged (in origin)');
ok(Buffer.compare(twin.get('provenance/staging/evidence/extra/UNREFERENCED.txt'), stagingFiles.get('evidence/extra/UNREFERENCED.txt')) === 0, 'a file the manifest does not name is kept byte for byte');
const provOK = Array.from(stagingFiles.keys()).every(p => { const e = pkg.issue.provenance.files.find(x => x.path === p); return e && e.sha256 === io.sha256(stagingFiles.get(p)) && Buffer.compare(twin.get(e.kept_as), stagingFiles.get(p)) === 0; });
ok(provOK && pkg.issue.provenance.files.length === stagingFiles.size, 'every staging file is kept byte for byte, and issue.json says where (' + stagingFiles.size + ' files)');
eq([twin.has('provenance/staging/cover.jpg'), pkg.issue.provenance.files.find(f => f.path === 'cover.jpg').kept_as], [false, 'cover.jpg'], 'the cover is stored once, as the native cover, not copied twice');
eq(pkg.issue.identity.working_issue_id + ' ' + items.map(it => it.key).join(','), 'EXAGAZEX-1872-KRNYWA2 ' + F.items.map(it => it.local_item_key).join(','), 'identifiers are kept: IssueID and every local item key');
// Through a ZIP, by the command-line tool, with the original never written to.
{
  const zipPath = path.join(tmp, 'staging-twin.zip');
  fs.writeFileSync(zipPath, zm.zipOfMap(stagingFiles, 'gazette-v4n1-staging'));
  const zipHash = io.sha256(fs.readFileSync(zipPath));
  const out = path.join(tmp, 'native-from-zip');
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'convert-staging.js'), zipPath, '--out', out], { encoding: 'utf8' });
  ok(r.status === 0, 'convert-staging.js converts the twin from a ZIP (inside one top-level folder)', r.stdout + r.stderr);
  eq(io.sha256(fs.readFileSync(zipPath)), zipHash, 'the staging ZIP is unchanged');
  if (r.status === 0) {
    const nz = io.readPackage(out), vz = validate(nz);
    ok(vz.ok, 'the package converted from the ZIP validates', vz.errors.slice(0, 2));
    eq(vz.pkg.issue.provenance.converted_from.archive, { name: 'staging-twin.zip', bytes: fs.statSync(zipPath).size, sha256: zipHash }, 'the staging ZIP\'s name, size and SHA-256 are recorded');
    ok(Array.from(nz.keys()).filter(k => k !== 'issue.json' && k !== 'provenance/CONVERSION.json').every(k => twin.has(k) && Buffer.compare(nz.get(k), twin.get(k)) === 0), 'apart from that record, the same package as from the folder');
    const again = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'convert-staging.js'), zipPath, '--out', out], { encoding: 'utf8' });
    ok(again.status === 2 && /already exists/.test(again.stdout + again.stderr), 'converting again into an existing folder is refused (nothing is written over)', again.stdout);
    const vcli = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'validate-issue.js'), out], { encoding: 'utf8' });
    ok(vcli.status === 0 && /VALID/.test(vcli.stdout), 'validate-issue.js accepts it', vcli.stdout);
  }
  const inside = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'convert-staging.js'), STAGING, '--out', path.join(STAGING, 'out')], { encoding: 'utf8' });
  ok(inside.status === 2 && !fs.existsSync(path.join(STAGING, 'out')), 'an output folder inside the staging package is refused', inside.stdout + inside.stderr);
  const vst = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'validate-issue.js'), STAGING], { encoding: 'utf8' });
  ok(vst.status === 1 && /staging package/.test(vst.stdout), 'validate-issue.js recognizes a staging package and says to convert it', vst.stdout);
  eq(hashTree(STAGING), before, 'the staging twin is still unchanged');
}
// The native package as a ZIP, at the top or inside one folder.
eq(validate(io.readPackage((() => { const p = path.join(tmp, 'n1.zip'); fs.writeFileSync(p, zm.zipOfMap(twin)); return p; })())).ok, true, 'the native twin validates as a ZIP');
eq(validate(io.readPackage((() => { const p = path.join(tmp, 'n2.zip'); fs.writeFileSync(p, zm.zipOfMap(twin, 'EXAGAZEX-1872-KRNYWA2')); return p; })())).ok, true, 'and as a ZIP with everything inside one top-level folder');

// ════════════════════════════════════════════════════════════════════════
// 7. Every defect refused, with its reason (each built from the twin, everything else intact)
// ════════════════════════════════════════════════════════════════════════
const copy = m => new Map(Array.from(m, ([k, v]) => [k, Buffer.from(v)]));
function restamp(files) {
  const issue = JSON.parse(files.get('issue.json'));
  const roleOf = p => (issue.files.find(f => f.path === p) || {}).role || (p.startsWith('provenance/') ? 'provenance' : 'text');
  issue.files = Array.from(files.keys()).filter(p => p !== 'issue.json').sort().map(p => ({ path: p, role: roleOf(p), bytes: files.get(p).length, sha256: io.sha256(files.get(p)) }));
  issue.inventory_sha256 = P.inventoryHash(issue.files, io.sha256);
  files.set('issue.json', B(P.serialize(issue)));
  return files;
}
// Change one JSON file of the twin, refresh the inventory, validate.
const edit = (file, fn) => { const m = copy(twin); const v = JSON.parse(m.get(file)); fn(v); m.set(file, B(P.serialize(v))); if (file !== 'issue.json') restamp(m); else { const i = JSON.parse(m.get('issue.json')); m.set('issue.json', B(P.serialize(i))); } return validate(m); };
const editRestamped = (file, fn) => { const m = copy(twin); const v = JSON.parse(m.get(file)); fn(v); m.set(file, B(P.serialize(v))); restamp(m); return validate(m); };
const page = (T, n) => T.pages[n - 1];
const setPageText = (T, n, text) => { const p = page(T, n); p.text = text; p.length = P.cpLength(text); p.sha256 = io.sha256(B(text)); };
const findSeg = (T, item, order) => T.segments.find(s => s.item === key(item) && s.order === (order || 1));
const itemOf = (I, n) => I.items[n - 1];

// Archive layout and inventory.
refused(validate(new Map([['text.json', B('{}')]])), 'layout', 'no issue.json');
refused(validate(new Map(Array.from(twin, ([k, v]) => ['a/' + k, v]).concat([['b/x.txt', B('x')]]))), 'layout', 'files in two top-level folders');
refused((() => { const m = copy(twin); m.set('extra.txt', B('x')); return validate(m); })(), 'unlisted-file', 'a file not in the inventory');
refused((() => { const m = copy(twin); m.delete('mentions.json'); return validate(m); })(), 'missing-file', 'a listed file that is missing');
refused((() => { const m = copy(twin); const t = Buffer.from(m.get('text.json')); t[t.length - 3] ^= 1; m.set('text.json', t); return validate(m); })(), 'hash', 'a file changed after it was listed (one bit)');
refused(edit('issue.json', i => { i.files.find(f => f.path === 'text.json').bytes += 1; }), 'size', 'a listed size that is wrong');
refused(edit('issue.json', i => { i.inventory_sha256 = '0'.repeat(64); }), 'hash', 'an inventory hash that is wrong');
refused(edit('issue.json', i => { i.files.push({ path: '../outside.txt', role: 'provenance', bytes: 1, sha256: '0'.repeat(64) }); }), 'path', 'an unsafe path in the inventory');
refused(edit('issue.json', i => { i.files.find(f => f.path === 'items.json').role = 'text'; }), 'role', 'a file given the wrong role');
// Format and version.
refused(edit('issue.json', i => { i.format = 'some-other-format'; }), 'format', 'another format');
refused(edit('issue.json', i => { i.format_version = '2.0'; }), 'version', 'an unknown major version');
refused(edit('issue.json', i => { i.format_version = '1'; }), 'version', 'a malformed version');
refused(editRestamped('text.json', T => { T.format_version = '2.0'; }), 'version', 'a part file with an unknown major version');
{
  const r = (() => { const m = copy(twin); const i = JSON.parse(m.get('issue.json')); i.format_version = '1.7'; i.added_in_1_7 = { anything: true }; m.set('issue.json', B(P.serialize(i))); return validate(m); })();
  ok(r.ok && r.warnings.some(w => w.code === 'unknown-field'), 'a newer 1.x package is accepted; its unknown field is reported, not refused', r.errors);
}
// JSON encoding.
refused((() => { const m = copy(twin); m.set('items.json', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), m.get('items.json')])); return validate(restamp(m)); })(), 'encoding', 'a byte-order mark');
refused((() => { const m = copy(twin); m.set('items.json', Buffer.concat([m.get('items.json').subarray(0, 20), Buffer.from([0xFF]), m.get('items.json').subarray(20)])); return validate(restamp(m)); })(), 'encoding', 'invalid UTF-8');
refused((() => { const m = copy(twin); m.set('text.json', B(m.get('text.json').toString().replace('"format_version": "1.0",', '"format_version": "1.0", "offset_unit": "utf16",'))); return validate(restamp(m)); })(), 'json', 'a key given twice (two readers could disagree)');
refused((() => { const m = copy(twin); m.set('mentions.json', B(m.get('mentions.json').toString().replace('"Gazette"', '"Gaz\\ud800ette"'))); return validate(restamp(m)); })(), 'encoding', 'an unpaired surrogate in a string');
refused((() => { const m = copy(twin); m.set('rights.json', m.get('rights.json').subarray(0, 50)); return validate(restamp(m)); })(), 'json', 'a truncated file');
// Identity.
refused(edit('issue.json', i => { i.identity.title_id = 'gazette'; }), 'id', 'a malformed TitleID');
refused(edit('issue.json', i => { i.identity.working_issue_id = 'PLABULLX-1961-KFTQPCQ'; }), 'wrong-title', 'an IssueID of another title');
refused(edit('issue.json', i => { i.identity.issue_id = 'EXAGAZEX-1872-K8Z27JP'; }), 'wrong-issue', 'issue_id and working_issue_id that differ');
refused(edit('issue.json', i => { i.identity.issue_id = null; i.identity.working_issue_id = null; }), 'id', 'no IssueID at all');
refused(edit('issue.json', i => { i.identity.identity_history[0].id = i.identity.working_issue_id; }), 'history', 'a superseded IssueID that is also the active one');
refused(edit('issue.json', i => { i.identity.identity_history[0].status = 'maybe'; }), 'vocabulary', 'a history status outside the vocabulary');
refused(edit('issue.json', i => { i.identity.identity_history[0].id = 'PLABULLX-1961-KFTQPCQ'; }), 'wrong-title', 'a superseded IssueID of another title');
refused(edit('issue.json', i => { i.state = 'draft'; }), 'state', 'an unknown state');
refused(edit('issue.json', i => { i.state = 'installed'; }), 'state', '"installed" without an issue_id or ContentIDs');
// Items and their identifier relationships.
refused(editRestamped('items.json', I => { itemOf(I, 4).parent = key(9999); }), 'parent', 'a parent key that is not an item');
refused(editRestamped('items.json', I => { itemOf(I, 3).parent = key(4); itemOf(I, 3).row['Parent Item'] = 'Eastfield'; }), 'cycle', 'parents that loop (3 → 4 → 3)');
refused(editRestamped('items.json', I => { itemOf(I, 2).parent = key(2); itemOf(I, 2).row['Parent Item'] = 'A Correction'; }), 'cycle', 'an item that is its own parent');
refused(editRestamped('items.json', I => { itemOf(I, 2).parent = key(3); itemOf(I, 2).row['Parent Item'] = 'Around the County'; }), 'parent-order', 'a parent that comes after its child');
refused(editRestamped('items.json', I => { itemOf(I, 4).row['Parent Item'] = 'Somewhere Else'; }), 'parent-text', 'Parent Item text that is not the parent\'s title');
refused(editRestamped('items.json', I => { itemOf(I, 1).row.IssueID = 'EXAGAZEX-1872-K8Z27JP'; }), 'wrong-issue', 'a row for another issue');
refused(editRestamped('items.json', I => { itemOf(I, 1).row.IssueID = 'EXAGAZEX-1872-KQ7RW4M'; }), 'history', 'a row using the superseded IssueID');
refused(editRestamped('items.json', I => { itemOf(I, 1).row.TitleID = 'PLABULLX-1961'; }), 'wrong-title', 'a row for another title');
refused(editRestamped('items.json', I => { itemOf(I, 2).key = key(1); }), 'duplicate-id', 'an item key used twice');
refused(editRestamped('items.json', I => { itemOf(I, 2).sequence = 1; itemOf(I, 2).row.Sequence = '1'; }), 'sequence', 'a sequence used twice');
refused(editRestamped('items.json', I => { itemOf(I, 2).row.Sequence = '7'; }), 'sequence', 'a row Sequence that disagrees with the item');
refused(editRestamped('items.json', I => { I.headers = I.headers.slice().reverse(); }), 'headers', 'headers that are not the 3.0 Contents headers');
refused(editRestamped('items.json', I => { delete itemOf(I, 2).row.Notes; }), 'row', 'a row without one of the 3.0 columns');
refused(editRestamped('items.json', I => { itemOf(I, 2).row['Start Page'] = 1; }), 'row', 'a value that is not text');
refused(editRestamped('items.json', I => { itemOf(I, 5).title_origin = 'guessed'; }), 'vocabulary', 'a title origin outside the vocabulary');
refused(editRestamped('items.json', I => { I.schema = '2.0'; }), 'schema', 'rows for another schema version');
refused(edit('issue.json', i => { delete i.content_map[key(18)]; }), 'content-map', 'a content_map without one of the items');
refused(edit('issue.json', i => { i.content_map[key(1)] = 'EXAGAZEX-1872-C2222AB'; i.content_map[key(2)] = 'EXAGAZEX-1872-C2222AB'; }), 'duplicate-id', 'one ContentID given to two items');
refused(edit('issue.json', i => { i.content_map[key(1)] = 'PLABULLX-1961-C2222AB'; }), 'wrong-title', 'a ContentID of another title');
refused(editRestamped('items.json', I => { itemOf(I, 1).row.ContentID = 'EXAGAZEX-1872-C2222AB'; }), 'content-map', 'a row ContentID that disagrees with content_map');
refused((() => { const m = copy(twin); m.delete('items.json'); return validate(restamp(m)); })(), 'missing-file', 'items.json missing while items have no ContentID');
// Page text, segments and offsets.
refused(editRestamped('text.json', T => { T.offset_unit = 'utf16'; }), 'offset-unit', 'an offset unit other than code points');
refused(editRestamped('text.json', T => { page(T, 2).page = 3; }), 'page', 'pages not numbered 1, 2, 3 …');
refused(editRestamped('text.json', T => { page(T, 1).length += 1; }), 'length', 'a page length that is not its code-point count');
refused(editRestamped('text.json', T => { page(T, 1).length = page(T, 1).text.length; }), 'length', 'a page length counted in UTF-16 units');
refused(editRestamped('text.json', T => { page(T, 1).sha256 = '0'.repeat(64); }), 'hash', 'a page hash that does not match its text');
refused(editRestamped('text.json', T => { setPageText(T, 8, page(T, 8).text.replace('\n', '\r\n')); T.unassigned.find(s => s.page === 8).end += 1; }), 'text', 'a carriage return in page text');
refused(editRestamped('text.json', T => { page(T, 1).folio_status = 'printed'; }), 'page', 'a printed folio status without folio text');
refused(editRestamped('text.json', T => { page(T, 1).folio_status = 'faded'; }), 'vocabulary', 'a folio status outside the vocabulary');
refused(editRestamped('text.json', T => { findSeg(T, 2).end = page(T, 1).length + 1; }), 'offset', 'a segment that runs past the end of its page');
refused(editRestamped('text.json', T => { const s = findSeg(T, 2); s.end = s.start; }), 'offset', 'an empty segment');
refused(editRestamped('text.json', T => { findSeg(T, 2).page = 9; }), 'page', 'a segment on a page that does not exist');
refused(editRestamped('text.json', T => { findSeg(T, 2).end -= 1; }), 'gap', 'a gap: a character that belongs to nothing');
refused(editRestamped('text.json', T => { findSeg(T, 2).end += 1; }), 'overlap', 'an overlap: a character that belongs to two spans');
refused(editRestamped('text.json', T => { T.segments = T.segments.filter(s => s !== findSeg(T, 5)); }), 'gap', 'a missing segment');
refused(editRestamped('text.json', T => { findSeg(T, 2).item = 'no-such-item'; }), 'unknown-item', 'a segment of an item that does not exist');
refused(editRestamped('text.json', T => { findSeg(T, 3, 2).order = 1; }), 'order', 'two segments of one item with the same reading order');
refused(editRestamped('text.json', T => { findSeg(T, 3, 3).order = 5; }), 'order', 'a gap in an item\'s reading order');
refused(editRestamped('text.json', T => { T.unassigned[1].id = T.unassigned[0].id; }), 'duplicate-id', 'a span id used twice');
refused(editRestamped('text.json', T => { T.unassigned[0].reason = ''; }), 'span', 'an unassigned span without a reason');
refused(editRestamped('text.json', T => { setPageText(T, 2, page(T, 2).text.replace('PDF_PAGE: 2', 'PDF_PAGE: 5')); }), 'anchor', 'a page anchor for another page');
refused(editRestamped('text.json', T => { page(T, 8).segmented = false; }), 'coverage', 'a page marked unsegmented that has spans');
// Mentions.
refused(editRestamped('mentions.json', M => { M.entities[0].item = 'no-such-item'; }), 'unknown-item', 'a mention of an item that does not exist');
refused(editRestamped('mentions.json', M => { M.entities[20].precision = 'item'; }), 'mention', 'precision "item" without an item');
refused(editRestamped('mentions.json', M => { M.entities[0].precision = 'exact'; }), 'mention', 'precision "exact" without anchors');
refused(editRestamped('mentions.json', M => { M.entities[0].anchors = [{ page: 1, start: 0, end: 7, precision: 'exact-derived' }]; M.entities[0].precision = 'exact-derived'; }), 'anchor', 'a derived anchor that does not point at the form');
refused(editRestamped('mentions.json', M => { M.entities[0].anchors = [{ page: 1, start: 5, end: 99999, precision: 'exact' }]; M.entities[0].precision = 'exact'; }), 'offset', 'an anchor past the end of its page');
refused(editRestamped('mentions.json', M => { M.subjects[0].pages = [9]; }), 'page', 'a mention on a page that does not exist');
refused(editRestamped('mentions.json', M => { M.entities[1].id = M.entities[0].id; }), 'duplicate-id', 'a mention id used twice');
// Rights.
refused((() => { const m = copy(twin); m.delete('rights.json'); return validate(restamp(m)); })(), 'missing-file', 'no rights.json');
refused(editRestamped('rights.json', R => { R.decisions.push({ id: 'd900', resource: { kind: 'cover' }, purpose: 'public_web', value: 'allow' }); }), 'rights', 'an "allow" without who, when and why');
refused(editRestamped('rights.json', R => { R.decisions[0].purpose = 'public_broadcast'; }), 'rights', 'a purpose outside the vocabulary');
refused(editRestamped('rights.json', R => { R.decisions[0].resource.kind = 'everything'; }), 'rights', 'a resource kind outside the vocabulary');
refused(editRestamped('rights.json', R => { R.decisions.push(Object.assign({}, R.decisions[0], { id: 'd901' })); }), 'rights', 'two decisions for the same resource and purpose');
refused(editRestamped('rights.json', R => { R.rights_status.value = 'probably fine'; }), 'rights', 'a rights status outside the vocabulary');
refused(editRestamped('rights.json', R => { R.withheld = [{ id: 'w1', page: 5, start: 0, end: 99999, reason: 'contact details', by: 'test', at: '2026-10-14' }]; }), 'offset', 'a withheld span past the end of its page');
refused(editRestamped('rights.json', R => { R.withheld = [{ id: 'w1', page: 5, start: 0, end: 10, reason: 'contact details' }]; }), 'rights', 'a withheld span without who and when');
// Cover, sources, provenance, review.
refused(edit('issue.json', i => { i.cover.width = 999; }), 'cover', 'cover dimensions that are not the image\'s');
refused(edit('issue.json', i => { i.cover.media_type = 'image/gif'; }), 'cover', 'a cover that is not JPEG or PNG');
refused((() => { const m = copy(twin); m.set('cover.jpg', B('not an image')); restamp(m); return validate(m); })(), 'cover', 'a cover file that is not an image');
refused((() => { const m = copy(twin); m.set('source/example-gazette-v4n1.pdf', B('not a pdf')); restamp(m); return validate(m); })(), 'source', 'a source file that is not a PDF');
refused(edit('issue.json', i => { i.provenance.files[0].sha256 = '0'.repeat(64); }), 'provenance', 'an original file not kept byte for byte');
refused(edit('issue.json', i => { i.provenance.files[0].kept_as = 'provenance/staging/nowhere.json'; }), 'provenance', 'an original file said to be kept where it is not');
refused(edit('issue.json', i => { i.review[0].status = 'pending'; }), 'vocabulary', 'a review status outside the vocabulary');
refused(edit('issue.json', i => { i.cover.origin = 'from somewhere'; }), 'origin', 'an origin that is not an object of objects');

// Operating-system leftovers are skipped with a warning, not mistaken for package files.
{
  const m = copy(twin); m.set('.DS_Store', B('x')); m.set('provenance/Thumbs.db', B('x'));
  const r = validate(m);
  ok(r.ok && r.warnings.some(w => w.code === 'os-file'), 'a .DS_Store or Thumbs.db file is skipped with a warning [os-file]', r.errors.slice(0, 2));
  const w = new Map(Array.from(twin, ([k, v]) => ['EXAGAZEX-1872-KRNYWA2/' + k, v]).concat([['__MACOSX/EXAGAZEX-1872-KRNYWA2/._issue.json', B('x')]]));
  const r2 = validate(w);
  ok(r2.ok && r2.warnings.some(x => x.code === 'os-file'), 'a __MACOSX folder beside the package folder (a Finder ZIP) does not break the layout', r2.errors.slice(0, 2));
  const st = copy(stagingFiles); st.set('.DS_Store', B('x'));
  const c = staging.convert(st, { sha256: io.sha256 });
  ok(!c.files.has('provenance/staging/.DS_Store') && c.report.warnings.some(x => /operating-system/.test(x)), 'conversion leaves an operating-system file out, and the report says so');
}

// Accepted variants: exact anchors that point at the form; withheld spans; unknown fields kept.
{
  const m = copy(twin);
  const T = JSON.parse(m.get('text.json')), M = JSON.parse(m.get('mentions.json')), R = JSON.parse(m.get('rights.json'));
  const p5 = page(T, 5).text, idx = P.cpIndex(p5);
  const cpOf = unit => idx.indexOf(unit);
  const at = p5.indexOf('Cafe\u0301 Anytown');
  const e = M.entities.find(x => x.form === 'Cafe\u0301 Anytown');
  e.precision = 'exact-derived';
  e.anchors = [{ page: 5, start: cpOf(at), end: cpOf(at) + P.cpLength('Cafe\u0301 Anytown'), precision: 'exact-derived' }];
  const c = p5.indexOf('telephone 555-0142');
  R.withheld = [{ id: 'w001', page: 5, start: cpOf(c), end: cpOf(c) + P.cpLength('telephone 555-0142'), reason: 'contact details of a private person', by: 'test', at: '2026-10-14' }];
  T.x_future_field = { kept: true };
  m.set('mentions.json', B(P.serialize(M))); m.set('rights.json', B(P.serialize(R))); m.set('text.json', B(P.serialize(T)));
  restamp(m);
  const r = validate(m);
  ok(r.ok && r.warnings.length === 1 && r.warnings[0].code === 'unknown-field', 'an exact-derived anchor at the form, a withheld span, and an unknown field: accepted (the field reported)', r.errors.concat(r.warnings).slice(0, 3));
  eq(io.sha256(B(P.serialize(P.parseJSON(m.get('text.json')).value))), io.sha256(m.get('text.json')), 'the unknown field round-trips through parse and serialize unchanged');
  const d = path.join(tmp, 'twin-with-anchors');
  io.writeNewFolder(d, m);
  pythonAgrees(d, 'the twin with an anchor and a withheld span');
}

// ════════════════════════════════════════════════════════════════════════
// 8. Staging packages the converter must refuse (nothing written)
// ════════════════════════════════════════════════════════════════════════
function restampStaging(files) {
  const M = JSON.parse(files.get('MANIFEST.json'));
  Object.keys(M.active_assets).forEach(p => { if (files.has(p)) M.active_assets[p] = { sha256: io.sha256(files.get(p)), size_bytes: files.get(p).length }; });
  files.set('MANIFEST.json', B(JSON.stringify(M, null, 2) + '\n'));
  files.set('CHECKSUMS.sha256', B(Array.from(files.keys()).filter(p => p !== 'CHECKSUMS.sha256').sort().map(p => io.sha256(files.get(p)) + '  ' + p).join('\n') + '\n'));
  return files;
}
const stEdit = (file, fn, raw) => { const m = copy(stagingFiles); if (raw) m.set(file, fn(m.get(file))); else { const v = JSON.parse(m.get(file)); fn(v); m.set(file, B(JSON.stringify(v, null, 2) + '\n')); } return restampStaging(m); };
const convRefused = (m, re, what) => {
  let err = null;
  try { staging.convert(m, { sha256: io.sha256 }); } catch (e) { err = e; }
  ok(err && err.code === 'staging' && err.problems.some(p => re.test(p)), 'conversion refused: ' + what, err ? err.problems.slice(0, 3).join(' | ') : 'it converted');
};
const FT = 'fulltext.json', CC = 'candidate_contents_seq001-018.provisional.json';
convRefused(stEdit(FT, F2 => { F2.items[0].segments[0].text += 'x'; }), /its text is not the page text/, 'a segment whose stored text is not its page slice');
convRefused(stEdit(FT, F2 => { F2.items[1].segments[0].page_char_end = 99999; }), /not a non-empty range/, 'a segment offset past the end of its page');
convRefused(stEdit(FT, F2 => { F2.unassigned_page_spans[0].spans[0].text = 'something else'; }), /its text is not the page text/, 'an unassigned span whose stored text is not its page slice');
convRefused(stEdit(FT, F2 => { F2.pages[0].page_char_length = F2.pages[0].text.length; }), /page_char_length/, 'a page length counted in UTF-16 units');
convRefused(stEdit(FT, F2 => { F2.pages[2].printed_page_status = 'SOMETHING_NEW'; }), /not a value this converter knows/, 'an unknown folio status');
convRefused(stEdit(FT, F2 => { F2.items.reverse(); }), /do not match the candidate rows/, 'full-text items that do not match the candidate rows');
convRefused(stEdit(FT, F2 => { F2.items[3].parent_local_item_key = null; }), /parent disagrees/, 'a parent that disagrees between the two files');
convRefused(stEdit('transcription.md', b => Buffer.concat([b, B('x')]), true), /not the apparatus followed by the page texts/, 'a transcription.md that is not derivable from the pages');
convRefused(stEdit(CC, C2 => { C2.candidate_records[4].item_title_origin = 'GUESSED'; }), /item_title_origin/, 'an unknown title origin');
convRefused(stEdit(CC, C2 => { C2.candidate_records[1].source_sequence = 1; }), /used twice/, 'a sequence used twice');
convRefused(stEdit(CC, C2 => { C2.candidate_records[2].cataloger_3_0_fields['Start Page'] = 1; }), /must be text or null/, 'a row value that is not text');
convRefused(stEdit('MANIFEST.json', M2 => { M2.package_spec_version = 'draft-0.2'; }), /declares the staging format package_spec_version "draft-0.2".*no converter exists/, 'an unknown staging version, named in the refusal');
convRefused(stEdit('RIGHTS_AND_ACCESS.json', R2 => { R2.approvals.public_release = true; }), /claims an approval/, 'a staging package that claims a publication approval');
convRefused(stEdit('RIGHTS_AND_ACCESS.json', R2 => { R2.access_defaults.cover.status = 'PUBLIC'; }), /not a status this converter knows/, 'an access status it cannot map');
convRefused(stEdit('private_index/deep_index.json', D2 => { D2.issue_id = 'EXAGAZEX-1872-KQ7RW4M'; }), /superseded/, 'a deep index for the superseded IssueID');
convRefused(stEdit('private_index/deep_index.json', D2 => { D2.entities[0].content_item_sequence = 99; }), /is not an item/, 'a mention of an item that does not exist');
convRefused(stEdit(CC.replace('candidate_contents', 'content_id_relationship_crosswalk').replace('.provisional.json', '.csv'), b => B(b.toString().replace('Eastfield', 'Westfield')), true), /disagrees with/, 'a crosswalk that disagrees with the candidate rows');
convRefused((() => { const m = copy(stagingFiles); m.set('HANDOFF_REPORT.md', B('changed')); return m; })(), /CHECKSUMS.sha256 does not match/, 'a file that no longer matches CHECKSUMS.sha256');
convRefused((() => { const m = copy(stagingFiles); m.set('cover.jpg', Buffer.concat([m.get('cover.jpg'), B('x')])); return m; })(), /active_assets|cover.sha256/, 'a cover that no longer matches the manifest');
convRefused(copy(twin), /already a native issue package/, 'a package that is already native');
convRefused(new Map([['readme.txt', B('x')]]), /no MANIFEST.json/, 'something that is not a staging package');

// ════════════════════════════════════════════════════════════════════════
// 9. The compatibility amendment: booklet sources, folios, identity, anchors, editorial marks
//    (T1–T17 of the compatibility assessment, and more). Built on the invented booklet package.
// ════════════════════════════════════════════════════════════════════════
const BOOKLET = path.join(TWIN, 'booklet');
const bk = io.readPackage(BOOKLET);
const roleFor = p => p.endsWith('.jpg') ? 'cover' : p.startsWith('source/') ? 'source' : p.startsWith('provenance/') ? 'provenance' : p.replace('.json', '');
function restampAny(files) {
  const issue = JSON.parse(files.get('issue.json'));
  issue.files = Array.from(files.keys()).filter(p => p !== 'issue.json').sort().map(p => ({ path: p, role: roleFor(p), bytes: files.get(p).length, sha256: io.sha256(files.get(p)) }));
  issue.inventory_sha256 = P.inventoryHash(issue.files, io.sha256);
  files.set('issue.json', B(P.serialize(issue)));
  return files;
}
// Change some of the booklet's JSON files ({ 'text.json': T => …, … }), refresh the inventory, validate.
const bEdit = (fns, extra) => { const m = copy(bk); if (extra) extra(m); Object.keys(fns).forEach(f => { const v = JSON.parse(m.get(f)); fns[f](v); m.set(f, B(P.serialize(v))); }); return validate(restampAny(m)); };
const accepted = (r, what, warnCode) => ok(r.ok && (warnCode ? r.warnings.some(w => w.code === warnCode) : r.warnings.length === 0), 'accepted: ' + what + (warnCode ? ' (with a ' + warnCode + ' warning)' : ' (no warnings)'), r.errors.concat(r.warnings).slice(0, 3).map(e => '[' + e.code + '] ' + e.message).join(' | '));
const loc = (T, n) => page(T, n).locations;

// Coordinates: the normative mapping between the upright page and PDF user space (spec §5.3).
eq([P.uprightSize(0, 720, 1080), P.uprightSize(90, 720, 1080), P.uprightSize(180, 720, 1080), P.uprightSize(270, 720, 1080)], [[720, 1080], [1080, 720], [720, 1080], [1080, 720]], 'the upright size swaps width and height at 90 and 270 degrees');
const MB = [0, 0, 720, 1080];
eq([0, 90, 180, 270].map(r => P.uprightToPDF(0, 0, r, MB)), [[0, 1080], [0, 0], [720, 0], [720, 1080]], 'the upright top-left corner, at each rotation, in PDF user space');
eq(P.uprightToPDF(640, 120, 90, MB), [120, 640], 'rotation 90: upright (X, Y) is stored (Y, X), so the right half of a spread is the upper half of the stored page');
eq(P.uprightToPDF(10, 20, 0, [36, 18, 756, 1098]), [46, 1078], 'a visible box that does not start at 0 offsets every point');
ok([0, 90, 180, 270].every(r => [[0, 0], [1, 2], [539.5, 700], [1079, 1], [300, 300]].every(([X, Y]) => {
  const [x, y] = P.uprightToPDF(X, Y, r, MB), back = P.pdfToUpright(x, y, r, MB);
  return Math.abs(back[0] - X) < 1e-9 && Math.abs(back[1] - Y) < 1e-9;
})), 'upright → PDF → upright returns every point exactly, at every rotation');
eq([P.storedRect(P.REGION_RECT.right, 90), P.storedRect(P.REGION_RECT.left, 90), P.storedRect(P.REGION_RECT.top, 0), P.storedRect(P.REGION_RECT.top, 180)], [[0, 0.5, 1, 1], [0, 0, 1, 0.5], [0, 0.5, 1, 1], [0, 0, 1, 0.5]],
  'regions as parts of the stored page: right at 90° is its upper half; top at 0° its upper half; top at 180° its lower half');

// T1 and T17: the Phase 1 twin and converter are unchanged (checked above: the twin validates with no
// warnings, and converting the staging twin gives the committed native twin byte for byte).
ok(tv.ok && tv.warnings.length === 0 && same, 'T1/T17: the Phase 1 twin still validates cleanly, and the draft-0.1 converter still writes it byte for byte');

// T2 / T11: the booklet: 8 logical pages on 4 PDF pages, an unresolved identity, no warnings.
const bv = validate(bk);
ok(bv.ok && bv.warnings.length === 0, 'T2: the booklet package validates with no warnings', bv.errors.concat(bv.warnings).slice(0, 3));
eq([bv.summary.identity_status, bv.summary.title_id, bv.summary.issue_id, bv.summary.provisional_key, bv.summary.pages], ['unresolved', null, null, 'leaflet-specimen-0003', 8], 'T11: unresolved, with no TitleID or IssueID and a provisional key');
const bp = bv.pkg;
ok(bp.items.items.every(it => it.row.TitleID === '' && it.row.IssueID === '' && it.row.ContentID === '') && Object.values(bp.issue.content_map).every(v => v === null), 'T11: its rows leave TitleID, IssueID and ContentID empty; no ContentID anywhere');
// T3: reading order is not PDF order.
const inPDFOrder = bp.text.pages.slice().sort((a, b) => a.locations[0].pdf_page - b.locations[0].pdf_page || (a.locations[0].region === 'left' ? -1 : 1)).map(p => p.page);
eq(inPDFOrder, [8, 1, 2, 7, 6, 3, 4, 5], 'T3: read in PDF order, the logical pages come 8, 1, 2, 7, 6, 3, 4, 5');
eq(bp.text.pages.map(p => p.page), [1, 2, 3, 4, 5, 6, 7, 8], 'T3: pages themselves are numbered in reading order');
eq(new Set(bp.text.pages.map(p => p.locations[0].pdf_page)).size, 4, 'each of the 4 PDF pages holds 2 logical pages');
eq(bp.text.pages.map(p => p.folio_status), ['absent', 'printed', 'printed', 'illegible', 'unverified', 'unverified', 'unverified', 'absent'], 'every folio status: printed, absent, illegible, unverified');
eq(bp.text.pages.map(p => p.folio || p.inferred_folio), ['1', '2', '3', '4', '5', '6', '7', '8'], 'a printed folio where there is one, else the inferred number');
eq(P.itemParts(bp, 'leaflet-item-002').map(p => [p.page, bp.text.pages[p.page - 1].locations[0].pdf_page]), [[2, 2], [3, 3]], 'an article continues from logical page 2 (PDF page 2) to logical page 3 (PDF page 3)');
pythonAgrees(BOOKLET, 'the booklet');
['issue.json', 'text.json', 'items.json', 'mentions.json', 'rights.json'].forEach(f => eq(io.sha256(B(P.serialize(P.parseJSON(bk.get(f)).value))), io.sha256(bk.get(f)), 'booklet ' + f + ' round-trips unchanged'));

// T4: a location that cannot be right.
refused(bEdit({ 'text.json': T => { loc(T, 2)[0].pdf_page = 0; } }), 'location', 'T4: PDF page 0');
refused(bEdit({ 'text.json': T => { loc(T, 2)[0].pdf_page = 5; } }), 'location', 'T4: PDF page 5 of a 4-page source');
refused(bEdit({ 'text.json': T => { loc(T, 2)[0].source = 'source/elsewhere.pdf'; } }), 'location', 'T4: a source not in issue.json › sources');
refused(bEdit({ 'text.json': T => { loc(T, 2)[0].region = 'middle'; } }), 'location', 'T4: a region outside the vocabulary');
refused(bEdit({ 'text.json': T => { loc(T, 2)[0].rotation = 45; } }), 'location', 'T4: a rotation of 45 degrees');
refused(bEdit({ 'text.json': T => { loc(T, 1)[0].box = [600, 0, 540, 720]; } }), 'location', 'T4: a box with x0 ≥ x1');
refused(bEdit({ 'text.json': T => { loc(T, 2)[0] = 'PDF page 2, left'; } }), 'location', 'a location that is not an object');
refused(bEdit({ 'text.json': T => { page(T, 2).locations = []; } }), 'location', 'an empty list of locations');
// T5: two logical pages on one part of one PDF page.
refused(bEdit({ 'text.json': T => { Object.assign(loc(T, 1)[0], { region: 'left', box: [0, 0, 540, 720] }); } }), 'location', 'T5: logical pages 1 and 8 both on the left half of PDF page 1');
refused(bEdit({ 'text.json': T => { loc(T, 1)[0].region = 'full'; delete loc(T, 1)[0].box; } }), 'location', 'T5: a whole PDF page claimed by one logical page while another has its left half');
// T6: a PDF_PAGE anchor follows the location, not the logical number.
ok(P.scanMarkup(bp.text.pages[6].text).anchors[0].page === 2 && bv.ok, 'T6: logical page 7 carries "PDF_PAGE: 2" (its PDF page), and that is accepted');
refused(bEdit({ 'text.json': T => { setPageText(T, 7, page(T, 7).text.replace('PDF_PAGE: 2', 'PDF_PAGE: 7')); } }), 'anchor', 'T6: "PDF_PAGE: 7" on logical page 7, which is on PDF page 2');
refused(bEdit({ 'text.json': T => { T.pages.forEach(pg => { delete pg.locations; }); } }), 'anchor', 'without locations (one logical page per PDF page), the same "PDF_PAGE: 2" on page 7 is refused');
// T7: LOGICAL_PAGE anchors.
refused(bEdit({ 'text.json': T => { setPageText(T, 6, page(T, 6).text.replace('LOGICAL_PAGE_6_START', 'LOGICAL_PAGE_3_START')); } }), 'anchor', 'T7: a LOGICAL_PAGE_3_START anchor on logical page 6');
refused(bEdit({ 'text.json': T => { setPageText(T, 6, page(T, 6).text.replace('<!-- LOGICAL_PAGE_6_END -->\n', '')); } }), 'anchor', 'T7: a START without its END');
refused(bEdit({ 'text.json': T => { setPageText(T, 6, '<!-- LOGICAL_PAGE_6_END -->\n' + page(T, 6).text.replace('<!-- LOGICAL_PAGE_6_END -->\n', '')); } }), 'anchor', 'T7: an END before its START');
refused(bEdit({ 'text.json': T => { setPageText(T, 6, page(T, 6).text + '<!-- LOGICAL_PAGE_6_START -->\n<!-- LOGICAL_PAGE_6_END -->\n'); } }), 'anchor', 'T7: two START and two END anchors on one page');
// T8: folio statuses.
refused(bEdit({ 'text.json': T => { page(T, 5).folio = '5'; } }), 'page', 'T8: "unverified" with a folio');
refused(bEdit({ 'text.json': T => { page(T, 1).folio = '1'; } }), 'page', 'an "absent" folio with a folio');
// T9: a PDF page that holds no logical page.
accepted(bEdit({ 'issue.json': I => { I.sources[0].pages = 5; } }), 'T9: a PDF page that no logical page uses', 'location');
// T10: where the cover was cut from.
refused(bEdit({ 'issue.json': I => { I.cover.location.pdf_page = 9; } }), 'cover', 'T10: a cover location on a PDF page that does not exist');
refused(bEdit({ 'issue.json': I => { I.cover.location.region = 'centre'; } }), 'cover', 'T10: a cover location with an unknown region');
refused(bEdit({ 'issue.json': I => { I.cover.location.box = [0, 0, 540, 720]; } }), 'cover', 'T10: a cover box outside its region');
accepted(bEdit({ 'issue.json': I => { I.cover.location.pdf_page = 2; } }), 'T10: a cover cut from PDF page 2 while its source page 1 is on PDF page 1', 'cover');
// T12–T15: identity.
refused(bEdit({ 'issue.json': I => { I.identity.provisional_key = 'LEAFLETX-1999'; } }), 'id', 'T12: a provisional key shaped like a TitleID');
refused(bEdit({ 'issue.json': I => { I.identity.provisional_key = 'leafletx-1999-k23456a'; } }), 'id', 'T12: a provisional key shaped like an IssueID (in lower case)');
refused(bEdit({ 'issue.json': I => { I.identity.provisional_key = 'AU-23456A'; } }), 'id', 'T12: a provisional key shaped like an AuthorityID');
refused(bEdit({ 'items.json': I => { I.items[0].row.TitleID = 'EXAGAZEX-1872'; } }), 'wrong-title', 'T13: an unresolved package with a TitleID in a row');
refused(bEdit({ 'items.json': I => { I.items[0].row.IssueID = 'EXAGAZEX-1872-KRNYWA2'; } }), 'wrong-issue', 'T13: an unresolved package with an IssueID in a row');
refused(bEdit({ 'issue.json': I => { I.state = 'installed'; } }), 'state', 'T14: an unresolved package marked installed');
const trIssue = I => { I.identity.status = 'title-resolved'; I.identity.title_id = 'EXAGAZEX-1872'; };
const trRows = It => { It.items.forEach(it => { it.row.TitleID = 'EXAGAZEX-1872'; }); };
accepted(bEdit({ 'items.json': trRows, 'issue.json': trIssue }), 'T15: title-resolved: a known TitleID in identity and rows, the IssueID still empty');
refused(bEdit({ 'items.json': It => { trRows(It); It.items[2].row.IssueID = 'EXAGAZEX-1872-KRNYWA2'; }, 'issue.json': trIssue }), 'wrong-issue', 'title-resolved with an IssueID in a row');
refused(bEdit({ 'items.json': trRows, 'issue.json': I => { trIssue(I); I.identity.working_issue_id = 'EXAGAZEX-1872-KRNYWA2'; } }), 'id', 'title-resolved with a working IssueID');
refused(bEdit({ 'issue.json': trIssue }), 'wrong-title', 'title-resolved, but the rows do not carry its TitleID');
refused(bEdit({ 'issue.json': I => { I.identity.title_id = 'EXAGAZEX-1872'; } }), 'id', 'unresolved, yet with a TitleID');
refused(bEdit({ 'issue.json': I => { I.identity.working_issue_id = 'EXAGAZEX-1872-KRNYWA2'; } }), 'id', 'unresolved, yet with a working IssueID');
refused(bEdit({ 'issue.json': I => { delete I.identity.provisional_key; } }), 'id', 'unresolved without a provisional key');
refused(bEdit({ 'issue.json': I => { I.identity.status = 'pending'; } }), 'vocabulary', 'an identity status outside the vocabulary');
refused(bEdit({ 'issue.json': I => { I.content_map['leaflet-item-001'] = 'EXAGAZEX-1872-C2222AB'; } }), 'content-map', 'unresolved, yet with a ContentID');
refused(bEdit({ 'issue.json': I => { I.package_id = 'LEAFLETX-1999-K23456A'; } }), 'id', 'a package id shaped like a catalog ID');
refused(edit('issue.json', i => { i.identity.provisional_key = 'gazette-staging-key'; }), 'id', 'a resolved package that still carries a provisional key');
// Identity history: typed entries; a provisional key never sits in the IssueID field.
ok(bp.issue.identity.identity_history[0].kind === 'provisional_key' && bv.ok, 'history: a retired provisional key is an entry of kind "provisional_key", under "key"');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history = [{ id: 'leaflet-specimen-draft', status: 'superseded' }]; } }), 'id', 'history: a provisional key put in an IssueID entry ("id", the default kind)');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history = [{ kind: 'provisional_key', id: 'leaflet-specimen-draft', status: 'retired' }]; } }), 'history', 'history: a provisional key entry that uses "id" instead of "key"');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history[0].kind = 'title_id'; } }), 'vocabulary', 'history: an unknown kind');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history[0].status = 'superseded'; } }), 'vocabulary', 'history: a provisional key entry whose status is not "retired"');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history[0].key = 'leaflet-specimen-0003'; } }), 'history', 'history: the retired key is the current provisional key');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history[0].key = 'LEAFLETX-1999'; } }), 'id', 'history: a retired key shaped like a catalog ID');
refused(bEdit({ 'issue.json': I => { I.identity.identity_history.push(Object.assign({}, I.identity.identity_history[0])); } }), 'duplicate-id', 'history: the same retired key twice');
refused(edit('issue.json', i => { i.identity.identity_history[0].key = 'gazette-staging-key'; }), 'history', 'history: an IssueID entry that also carries a "key"');
accepted((() => { const m = copy(twin); const i = JSON.parse(m.get('issue.json')); i.identity.identity_history[0].kind = 'issue_id'; i.identity.identity_history.push({ kind: 'provisional_key', key: 'gazette-staging-key', status: 'retired', note: 'used before the IssueID was confirmed' }); m.set('issue.json', B(P.serialize(i))); return validate(m); })(),
  'history: a resolved package with an explicit issue_id entry and its retired provisional key (the shape after resolution)');
// Source-location ambiguity, judged on the stored page whatever the rotation.
const twoOnPDF1 = (L8, L1) => bEdit({ 'text.json': T => { page(T, 8).locations = [L8]; page(T, 1).locations = [L1]; } });
accepted(twoOnPDF1({ pdf_page: 1, region: 'top', rotation: 0 }, { pdf_page: 1, region: 'top', rotation: 180 }), 'a head-to-head sheet: two logical pages both "top" when read upright, one turned 180°, so on different halves');
refused(twoOnPDF1({ pdf_page: 1, region: 'top', rotation: 0 }, { pdf_page: 1, region: 'top', rotation: 0 }), 'location', 'the same, without the turn: both on the same half');
refused(twoOnPDF1({ pdf_page: 1, region: 'top', rotation: 0 }, { pdf_page: 1, region: 'right', rotation: 90 }), 'location', '"top" at 0° and "right" at 90°: different names, the same half of the stored page');
accepted(twoOnPDF1({ pdf_page: 1, region: 'top', rotation: 0 }, { pdf_page: 1, region: 'left', rotation: 90 }), '"top" at 0° and "left" at 90°: different halves of the stored page');
refused(bEdit({ 'text.json': T => { loc(T, 1)[0].box = [0, 0, 540, 720]; } }), 'location', 'a box outside its region');
refused(bEdit({ 'text.json': T => { delete loc(T, 1)[0].size; } }), 'location', 'a box without the page size it is measured against');
refused(bEdit({ 'text.json': T => { loc(T, 1)[0].box = [540, 0, 1100, 720]; } }), 'location', 'a box running off the page');
refused(bEdit({ 'text.json': T => { loc(T, 5)[0].size = [1000, 720]; loc(T, 5)[0].box = [500, 0, 1000, 720]; } }), 'location', 'two logical pages giving different sizes for one PDF page');
refused(bEdit({ 'text.json': T => { delete page(T, 3).locations; } }), 'location', 'locations on some pages but not all');
refused(bEdit({ 'issue.json': I => { I.sources.push({ path: 'source/second.pdf', media_type: 'application/pdf', pages: 1 }); } }, m => { m.set('source/second.pdf', m.get('source/specimen-leaflet.pdf')); }), 'location', 'two sources, and a location that does not say which');
accepted(bEdit({ 'issue.json': I => { I.sources[0].pages = 5; }, 'text.json': T => { loc(T, 6).push({ pdf_page: 5, region: 'full', rotation: 0 }); setPageText(T, 6, page(T, 6).text.replace('<!-- LOGICAL_PAGE_6_START -->\n', '<!-- LOGICAL_PAGE_6_START -->\n<!-- PDF_PAGE: 3 -->\n') + '<!-- PDF_PAGE: 5 -->\n'); } }),
  'one logical page across two PDF pages (left half of PDF 3, then all of PDF 5), with a PDF_PAGE anchor for each');
refused(bEdit({ 'issue.json': I => { I.sources[0].pages = 5; }, 'text.json': T => { loc(T, 6).push({ pdf_page: 5, region: 'full', rotation: 0 }); setPageText(T, 6, page(T, 6).text + '<!-- PDF_PAGE: 5 -->\n<!-- PDF_PAGE: 5 -->\n'); } }), 'anchor', 'two anchors for the same PDF page');
refused(bEdit({ 'text.json': T => { loc(T, 6).push(Object.assign({}, loc(T, 6)[0])); } }), 'location', 'one logical page given the same place twice');
// T16 and more: editorial-looking brackets are never passed silently.
{
  const r = bEdit({ 'text.json': T => { setPageText(T, 8, page(T, 8).text + '[Editorial description: a drawing of a ship.] [Footnote 1]\n'); } });
  ok(r.ok && r.warnings.filter(w => w.code === 'markup').length === 2, 'T16: "[Editorial description: …]" and "[Footnote 1]" are each reported (the package is still valid)', r.warnings.map(w => w.message));
}
const flagged = s => P.scanMarkup(s).counts.editorial_unrecognized;
eq(['[Editorial note — added by the transcriber: a drawing of a tree.]', '[Printed caption beneath the drawing]', '[Separate column of figures]', '[Supplied: wrong case]', '[sic]', '[Note: added]', '[supplied: not closed'].map(s => flagged(s) + P.scanMarkup(s).notes.length > 0),
  [true, true, true, true, true, true, true], 'editorial-looking brackets outside the set are all reported');
eq(['[See also the notice on page 2]', '[by an old author]', '[Communicated.]', '[10:30]', '[1872?]', '\\[Footnote 1\\]', '\\[Note: printed\\]', '[supplied: fine] [unclear: fine] [illegible]'].map(s => P.scanMarkup(s).notes.length),
  [0, 0, 0, 0, 0, 0, 0, 0], 'printed brackets, escaped brackets and the three marks are not reported');
// The converter names a staging format it does not convert, and writes nothing.
convRefused(stEdit('MANIFEST.json', M2 => { delete M2.package_spec_version; M2.manifest_schema = 'example-other-staging/1.0'; }), /manifest_schema "example-other-staging\/1\.0".*no converter exists.*Nothing was written/, 'another staging layout (manifest_schema), named in the refusal');
convRefused(stEdit('MANIFEST.json', M2 => { delete M2.package_spec_version; }), /declares no staging format/, 'a manifest that declares no format');
{
  const d = path.join(tmp, 'other-dialect');
  const m = stEdit('MANIFEST.json', M2 => { delete M2.package_spec_version; M2.manifest_schema = 'example-other-staging/1.0'; });
  io.writeNewFolder(d, m);
  const before2 = hashTree(d);
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'validate-issue.js'), d], { encoding: 'utf8' });
  ok(r.status === 1 && /manifest_schema "example-other-staging\/1\.0"/.test(r.stdout) && /No converter exists/.test(r.stdout), 'validate-issue.js names the other staging layout and says it has no converter', r.stdout);
  const c = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'convert-staging.js'), d, '--out', path.join(tmp, 'other-out')], { encoding: 'utf8' });
  ok(c.status === 1 && !fs.existsSync(path.join(tmp, 'other-out')) && hashTree(d) === before2, 'convert-staging.js refuses it, writes nothing, and leaves it unchanged', c.stdout);
}

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' issue-package checks' : 'PASSED ' + count + ' issue-package checks');
process.exit(fails ? 1 : 0);

// ════════════════════════════════════════════════════════════════════════
// The private acceptance run (a real staging package; nothing printed but counts and results)
// ════════════════════════════════════════════════════════════════════════
function privateRun() {
  const args = process.argv.slice(3);
  const ki = args.indexOf('--keep');
  const input = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
  const keep = ki !== -1 ? path.resolve(args[ki + 1] || '') : null;
  if (!input || !fs.existsSync(input) || (ki !== -1 && !args[ki + 1])) { console.error('usage: node tools/test-issuepkg.js --private <staging .zip or folder> [--keep <new folder outside the repository>]'); process.exit(2); }
  if (io.isInside(input, ROOT)) { console.error('The real package is inside the repository. Keep it outside (it must never be committed).'); process.exit(2); }
  if (keep && (io.isInside(keep, ROOT) || fs.existsSync(keep))) { console.error('--keep must be a new folder outside the repository.'); process.exit(2); }
  const fingerprint = () => fs.statSync(input).isDirectory() ? io.sha256(B(hashTree(input))) : io.sha256(fs.readFileSync(input));
  const before = fingerprint();
  const out = keep || path.join(tmp, 'private-native');
  ok(!io.isInside(out, ROOT), 'the converted package is written outside the repository');
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'convert-staging.js'), input, '--out', out], { encoding: 'utf8' });
  const counts = (r.stdout.split('\n').find(l => / pages, /.test(l)) || '').trim();
  ok(r.status === 0, 'the real staging package converts', r.status === 0 ? '' : r.stdout.split('\n').filter(l => /REFUSED|problem|^\s+-/.test(l)).length + ' problem lines (run convert-staging.js by hand to read them)');
  ok(fingerprint() === before, 'the real staging package is unchanged (same SHA-256 before and after)');
  if (r.status !== 0) return finish();
  const files = io.readPackage(input);
  const native = io.readPackage(out);
  const v = validate(native);
  ok(v.ok, 'the converted package validates', v.errors.length + ' errors');
  console.log('  ' + counts.replace(/^\S+ \/ \S+: /, ''));
  console.log('  ' + v.warnings.length + ' validation warning(s)' + (v.warnings.length ? ': ' + v.warnings.map(w => w.code).filter((c, i, a) => a.indexOf(c) === i).join(', ') : ''));
  const u = files.has('MANIFEST.json') ? files : new Map(Array.from(files, ([k, b]) => [k.split('/').slice(1).join('/'), b]));
  const pkgR = v.pkg;
  const back = staging.reconstruct(native);
  pkgR.issue.provenance.files.filter(f => f.re_expressed_in).forEach(f => {
    ok(back.has(f.path) && staging.canon(back.get(f.path)) === staging.canon(JSON.parse(u.get(f.path))), 'rebuilt exactly from the native files: the staging file re-expressed in ' + f.re_expressed_in);
  });
  const ftPath = (pkgR.issue.provenance.files.find(f => f.re_expressed_in === 'text.json') || {}).path;
  if (ftPath) {
    const FT2 = JSON.parse(u.get(ftPath));
    const segs = FT2.items.reduce((a, it) => a.concat(it.segments), []);
    const spans = FT2.unassigned_page_spans.reduce((a, g) => a.concat(g.spans), []);
    ok(segs.every(s => P.segmentText(pkgR, s.segment_id) === s.text), 'every article segment reconstructs exactly (' + segs.length + ' segments)');
    ok(spans.every(s => P.segmentText(pkgR, s.unassigned_span_id) === s.text), 'every unassigned span reconstructs exactly (' + spans.length + ' spans)');
    ok(FT2.items.every(it => it.text === null || it.text === P.itemText(pkgR, it.local_item_key)), 'every item text given in the staging file equals the native item text (' + FT2.items.filter(it => it.text !== null).length + ' given)');
    const trp = (pkgR.issue.provenance.files.find(f => /transcription/.test(f.path) && /\.md$/.test(f.path)) || {}).path;
    if (trp) ok(io.sha256(B(P.transcription(pkgR))) === io.sha256(u.get(trp)), 'the whole transcription is derivable: apparatus + pages = the staging transcription, byte for byte');
  }
  ok(Array.from(u.keys()).every(p => { const e = pkgR.issue.provenance.files.find(x => x.path === p); return e && Buffer.compare(native.get(e.kept_as), u.get(p)) === 0; }), 'every staging file is kept byte for byte (' + u.size + ' files)');
  const Mf = JSON.parse(u.get('MANIFEST.json'));
  const idn = pkgR.issue.identity;
  ok(idn.title_id === Mf.title_id && idn.issue_id === (Mf.issue_id ?? null) && idn.working_issue_id === (Mf.working_issue_id ?? null) && pkgR.issue.package_id === Mf.package_id &&
    JSON.stringify(idn.identity_history.map(h => h.id)) === JSON.stringify((Mf.identity_history || []).map(h => h.id)), 'identity kept as given: TitleID, IssueID (settled and working), superseded IDs, package id');
  ok(pkgR.rights.decisions.every(d => d.value !== 'allow') && !pkgR.rights.withheld.length, 'nothing is approved for publication (' + pkgR.rights.decisions.length + ' explicit denials, everything else undecided)');
  ok(Object.values(pkgR.issue.content_map).every(x => x === null) && pkgR.items.items.every(it => u.get((pkgR.issue.provenance.files.find(f => f.re_expressed_in === 'items.json') || {}).path).indexOf(B('"' + it.key + '"')) !== -1), 'identifiers kept: every local item key as given; ContentIDs left unresolved');
  pythonAgrees(out, 'the real package');
  return finish();
  function finish() {
    console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' private acceptance checks' : 'PASSED ' + count + ' private acceptance checks' + (keep ? ' (converted package kept in ' + keep + ')' : ''));
    process.exit(fails ? 1 : 0);
  }
}
