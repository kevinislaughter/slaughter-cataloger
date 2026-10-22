/* Slaughter Cataloger 3 — converting a staging package into a native issue package
   (docs/ISSUE-PACKAGE.md §12).

   A staging package is the provisional layout the ingestion process hands over today
   ("draft-0.1"): a MANIFEST.json pointing at the full text (fulltext.json + transcription.md),
   candidate Contents rows, a deep index, rights, a review queue, the cover, the source PDF and
   QA evidence. This converts it into format slaughter-cataloger-issue 1.0, without losing
   anything and without guessing:

   - every staging file is kept byte for byte: under provenance/staging/, or as the native cover
     or source file when it is that file (issue.json › provenance lists where each one went);
   - the three files whose content the native format re-expresses (the full text, the candidate
     rows and the deep index) can be rebuilt exactly from the native files alone — reconstruct()
     does it, and the tests compare the result with the originals;
   - a field the 1.0 format has no place for is carried, unchanged, in the record's "origin"
     (keyed by the staging file it came from); nothing is dropped except copies of text that the
     native package derives (a segment's text is its page text between its offsets), and those
     are checked equal first;
   - anything the converter can't vouch for (a hash, an offset, a cross-reference that disagrees,
     an unknown vocabulary value) stops the conversion with every problem listed. Nothing is written.

     convert(files, { sha256, archive }) → { files: Map(path → Uint8Array), report, summary }
     reconstruct(nativeFiles) → Map(staging path → JSON value) for the re-expressed files
     isStaging(files) → true when this looks like a staging package
   The staging package is only read. */
'use strict';
const io = require('./package-io');
const SC = io.SC, P = SC.issuepkg;

const CONVERTER = 'tools/convert-staging.js 1.0';
const STAGING_VERSION = /^draft-0\.1(\/[A-Za-z0-9._-]+)?$/;
const enc = s => new TextEncoder().encode(s);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const rest = (o, keys) => { const out = {}; Object.keys(o || {}).forEach(k => { if (keys.indexOf(k) === -1) out[k] = o[k]; }); return out; };
const nonEmpty = o => isObj(o) && Object.keys(o).length > 0;
function addOrigin(rec, file, extra) {
  if (nonEmpty(extra)) { rec.origin = rec.origin || {}; rec.origin[file] = extra; }
  return rec;
}
const canon = v => JSON.stringify(v, (k, x) => (isObj(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));

class StagingError extends Error {
  constructor(problems) {
    super('The staging package cannot be converted without loss or guesswork (' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + '):\n  - ' + problems.join('\n  - '));
    this.code = 'staging';
    this.problems = problems;
  }
}

// A staging package may sit at the archive's top or inside one top-level folder.
function unwrap(files) {
  if (files.has('MANIFEST.json')) return { root: '', files };
  const names = Array.from(files.keys());
  const tops = new Set(names.map(n => n.split('/')[0]));
  const only = tops.size === 1 ? Array.from(tops)[0] : null;
  if (only && names.every(n => n.startsWith(only + '/')) && files.has(only + '/MANIFEST.json')) {
    return { root: only + '/', files: new Map(names.map(n => [n.slice(only.length + 1), files.get(n)])) };
  }
  return null;
}
// The staging format a MANIFEST.json declares: draft-0.1 packages say package_spec_version; other
// ingestion layouts say manifest_schema. Returns { field, value, convertible } or null.
function declaredFormat(M) {
  if (!isObj(M)) return null;
  if (typeof M.package_spec_version === 'string') return { field: 'package_spec_version', value: M.package_spec_version, convertible: STAGING_VERSION.test(M.package_spec_version) };
  if (typeof M.manifest_schema === 'string') return { field: 'manifest_schema', value: M.manifest_schema, convertible: false };
  return null;
}
function stagingFormat(filesAll) {
  const u = unwrap(new Map(Array.from(filesAll).filter(([k]) => !P.isOSFile(k))));
  if (!u || u.files.has('issue.json')) return null;
  const m = P.parseJSON(u.files.get('MANIFEST.json'));
  return m.error ? null : declaredFormat(m.value);
}
const isStaging = filesAll => !!stagingFormat(filesAll);

// ── Vocabulary: staging values → 1.0 values. An unknown value stops the conversion. ──
function folioOf(status, printed) {
  if (status === undefined) return printed === null ? { folio_status: 'absent' } : { folio_status: 'printed' };
  if (/^PRINTED_FOLIO/.test(status)) return { folio_status: 'printed' };
  if (/ILLEGIBLE/.test(status)) return { folio_status: 'illegible' };
  if (/^NO_PRINTED_FOLIO/.test(status)) {
    const m = /PAGE_([A-Za-z0-9]+)_INFERRED/.exec(status);
    return m ? { folio_status: 'absent', inferred_folio: m[1] } : { folio_status: 'absent' };
  }
  return null;
}
function titleOriginOf(v) {
  if (v === 'PRINTED') return 'printed';
  if (/SUPPLIED/.test(v || '')) return 'supplied';
  return null;
}
function historyStatusOf(v) { return /supersed/i.test(v || '') ? 'superseded' : null; }
function reviewStatusOf(v) {
  const s = String(v || '').toLowerCase();
  return ['open', 'blocking', 'deferred', 'resolved'].indexOf(s) !== -1 ? s : null;
}
// The staging rights file's access statuses. PRIVATE becomes an explicit deny for every public
// purpose; anything still under review stays undecided (which is also a deny). Approvals are never
// carried over: an "allow" must be recorded natively, by a person.
const RIGHTS_RESOURCES = { bibliographic_metadata: ['metadata'], fulltext: ['page_text', 'item_text'], cover: ['cover'], deep_index: ['mentions'], source_pdf: ['source'] };
const PUBLIC_PURPOSES = ['public_web', 'public_search', 'public_download', 'public_epub'];

function convert(filesAll, opts) {
  const o = opts || {};
  const sha = o.sha256 || io.sha256;
  // Operating-system leftovers (.DS_Store, __MACOSX/ …) are not part of the package: left out, and said so.
  const clutter = Array.from(filesAll.keys()).filter(P.isOSFile);
  const filesIn = new Map(Array.from(filesAll).filter(([k]) => !P.isOSFile(k)));
  const u = unwrap(filesIn);
  const names = Array.from(filesIn.keys());
  if (!u && (filesIn.has('issue.json') || (names.length && names.every(n => n.split('/').length > 1 && filesIn.has(n.split('/')[0] + '/issue.json'))))) {
    throw new StagingError(['This is already a native issue package (it has an issue.json); validate it with tools/validate-issue.js.']);
  }
  if (!u) throw new StagingError(['There is no MANIFEST.json at the top of the package (or inside a single top-level folder).']);
  if (u.files.has('issue.json')) throw new StagingError(['This is already a native issue package (it has an issue.json); validate it with tools/validate-issue.js.']);
  const files = u.files;
  const problems = [], warnings = [], checks = [];
  if (clutter.length) warnings.push('Left out ' + clutter.length + ' operating-system file(s), not part of the package: ' + clutter.join(', ') + '.');
  const problem = msg => problems.push(msg);
  const verify = (name, ok, failMsg) => { checks.push({ check: name, result: ok ? 'pass' : 'FAIL' }); if (!ok) problem(failMsg || name); return ok; };
  const json = p => {
    if (!files.has(p)) { problem(p + ' is named by the manifest but is not in the package.'); return null; }
    const r = P.parseJSON(files.get(p));
    if (r.error) { problem(p + ' ' + r.error + '.'); return null; }
    if (!isObj(r.value)) { problem(p + ' must hold an object.'); return null; }
    return r.value;
  };
  const stop = () => { if (problems.length) throw new StagingError(problems); };

  // ── The manifest and the files it names ──
  const M = json('MANIFEST.json');
  stop();
  // Only the draft-0.1 layout is converted. Any other layout is refused by name, with nothing written.
  const fmt = declaredFormat(M);
  if (!fmt || !fmt.convertible) {
    throw new StagingError([fmt
      ? 'MANIFEST.json declares the staging format ' + fmt.field + ' "' + fmt.value + '". This converter reads only the draft-0.1 layout (package_spec_version "draft-0.1…"); no converter exists for "' + fmt.value + '" yet (writing one is a separate decision). Nothing was written.'
      : 'MANIFEST.json declares no staging format (neither package_spec_version nor manifest_schema), so this converter cannot tell what it is. Nothing was written.']);
  }
  const ptr = (obj, key) => (isObj(obj) && typeof obj[key] === 'string' && obj[key]) ? obj[key] : null;
  const Fp = ptr(M.sidecar, 'fulltext'), TRp = ptr(M.sidecar, 'source_transcription'), MAPp = ptr(M.sidecar, 'item_to_page_mapping');
  const Cp = ptr(M.bibliographic_candidates, 'file'), CWp = ptr(M.bibliographic_candidates, 'mapping_file');
  const Dp = ptr(M.deep_index, 'file'), COVp = ptr(M.cover, 'file'), Rp = typeof M.rights_file === 'string' ? M.rights_file : null;
  const RQp = ptr(M.review_queue, 'file');
  if (!Cp) problem('MANIFEST.json does not name the candidate Contents file (bibliographic_candidates.file).');
  if (!Rp) problem('MANIFEST.json does not name the rights file (rights_file).');
  if (Fp && !TRp) problem('MANIFEST.json names a full-text file but not its source transcription (sidecar.source_transcription).');
  stop();
  const F = Fp ? json(Fp) : null, C = json(Cp), D = Dp ? json(Dp) : null, R = json(Rp), RQ = RQp ? json(RQp) : null;
  stop();

  // ── Integrity of the staging package itself ──
  if (files.has('CHECKSUMS.sha256')) {
    const lines = new TextDecoder().decode(files.get('CHECKSUMS.sha256')).split('\n').filter(l => l.trim());
    const listed = new Set();
    let bad = [];
    lines.forEach(l => {
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l.replace(/\r$/, ''));
      if (!m) { bad.push('unreadable line "' + l.slice(0, 40) + '"'); return; }
      listed.add(m[2]);
      if (!files.has(m[2])) bad.push(m[2] + ' (listed, not in the package)');
      else if (sha(files.get(m[2])) !== m[1]) bad.push(m[2] + ' (SHA-256 differs)');
    });
    verify('CHECKSUMS.sha256: every entry matches', !bad.length, 'CHECKSUMS.sha256 does not match the package: ' + bad.join('; ') + '.');
    const unlisted = Array.from(files.keys()).filter(n => n !== 'CHECKSUMS.sha256' && !listed.has(n));
    if (unlisted.length) warnings.push('CHECKSUMS.sha256 does not list ' + unlisted.join(', ') + ' (kept and hashed in issue.json all the same).');
  } else warnings.push('The staging package has no CHECKSUMS.sha256; its files are hashed in issue.json from here on.');
  if (isObj(M.active_assets)) {
    const bad = Object.keys(M.active_assets).filter(k => { const a = M.active_assets[k]; return !files.has(k) || sha(files.get(k)) !== a.sha256 || (a.size_bytes !== undefined && files.get(k).length !== a.size_bytes); });
    verify('MANIFEST.json active_assets: every hash and size matches', !bad.length, 'MANIFEST.json active_assets do not match: ' + bad.join(', ') + '.');
  }

  // ── Identity ──
  const titleID = M.title_id, issueID = has(M, 'issue_id') ? M.issue_id : null, workingID = has(M, 'working_issue_id') ? M.working_issue_id : null;
  const activeID = issueID || workingID;
  if (!activeID) problem('MANIFEST.json gives neither issue_id nor working_issue_id.');
  const history = [];
  (Array.isArray(M.identity_history) ? M.identity_history : []).forEach((h, i) => {
    const st = historyStatusOf(h && h.status);
    if (!isObj(h) || typeof h.id !== 'string' || !st) { problem('MANIFEST.json identity_history[' + i + '] is not an id with a "superseded" status.'); return; }
    history.push(addOrigin({ id: h.id, status: st, note: h.status }, 'MANIFEST.json', rest(h, ['id', 'status'])));
  });
  const historyIDs = new Set(history.map(h => h.id));
  const sameIssue = v => v === null || v === undefined || v === activeID || v === workingID || v === issueID;
  const checkIdentity = (file, obj, keys) => keys.forEach(([k, kind]) => {
    if (!has(obj, k)) return;
    const v = obj[k];
    if (kind === 'title' && v !== titleID) problem(file + ': ' + k + ' is ' + JSON.stringify(v) + ', not the manifest\'s TitleID ' + titleID + '.');
    if (kind === 'issue' && (!sameIssue(v) || historyIDs.has(v))) problem(file + ': ' + k + ' is ' + JSON.stringify(v) + ', not this issue (' + activeID + ')' + (historyIDs.has(v) ? '; that ID is superseded' : '') + '.');
  });
  if (F) checkIdentity(Fp, F, [['title_id', 'title'], ['issue_id', 'issue'], ['working_issue_id', 'issue']]);
  if (D) checkIdentity(Dp, D, [['title_id', 'title'], ['issue_id', 'issue']]);
  if (isObj(C.working_identity)) checkIdentity(Cp, C.working_identity, [['title_id', 'title'], ['issue_id', 'issue']]);
  if (RQ) checkIdentity(RQp, RQ, [['title_id', 'title'], ['issue_id', 'issue'], ['working_issue_id', 'issue']]);
  stop();

  // ── Items: the candidate rows, joined to the full text's item records by local key ──
  const headers = SC.schema.entities.content.headers;
  const recs = Array.isArray(C.candidate_records) ? C.candidate_records : (problem(Cp + ' has no candidate_records list.'), []);
  verify(Cp + ': header order is the ' + SC.schema.VERSION + ' Contents header order', Array.isArray(C.cataloger_3_0_header_order) && C.cataloger_3_0_header_order.join('\u0000') === headers.join('\u0000'),
    Cp + ': cataloger_3_0_header_order is not exactly the ' + SC.schema.VERSION + ' Contents headers.');
  const items = [], itemBy = new Map(), keyOfSeq = new Map(), cmap = {};
  recs.forEach((r, i) => {
    const w = Cp + ' candidate_records[' + i + ']';
    if (!isObj(r) || typeof r.local_item_key !== 'string') { problem(w + ' has no local_item_key.'); return; }
    if (itemBy.has(r.local_item_key)) { problem(w + ': the key ' + r.local_item_key + ' is used twice.'); return; }
    const f = isObj(r.cataloger_3_0_fields) ? r.cataloger_3_0_fields : (problem(w + ' has no cataloger_3_0_fields.'), {});
    const row = {}, nulls = {};
    headers.forEach(h => {
      if (!has(f, h)) { problem(w + ': the field "' + h + '" is missing.'); return; }
      if (f[h] === null) { row[h] = ''; nulls[h] = null; } else if (typeof f[h] === 'string') row[h] = f[h];
      else problem(w + ': "' + h + '" must be text or null.');
    });
    Object.keys(f).forEach(h => { if (headers.indexOf(h) === -1) { if (typeof f[h] === 'string') row[h] = f[h]; else problem(w + ': the extra field "' + h + '" must be text.'); } });
    const to = titleOriginOf(r.item_title_origin);
    if (!to) problem(w + ': item_title_origin ' + JSON.stringify(r.item_title_origin) + ' is not PRINTED or a SUPPLIED value.');
    if (!Number.isInteger(r.source_sequence)) problem(w + ': source_sequence must be a whole number.');
    else if (keyOfSeq.has(r.source_sequence)) problem(w + ': source_sequence ' + r.source_sequence + ' is used twice.');
    else keyOfSeq.set(r.source_sequence, r.local_item_key);
    const it = { key: r.local_item_key, sequence: r.source_sequence, parent: has(r, 'parent_local_item_key') ? r.parent_local_item_key : null, title_origin: to, row };
    const extra = rest(r, ['local_item_key', 'parent_local_item_key', 'source_sequence', 'cataloger_3_0_fields']);
    if (nonEmpty(nulls)) extra.cataloger_3_0_fields = nulls;
    addOrigin(it, Cp, extra);
    const cid = f.ContentID;
    cmap[it.key] = cid === null || cid === '' || cid === undefined ? null : cid;
    items.push(it); itemBy.set(it.key, it);
  });
  stop();

  // ── The text ──
  let text = null;
  const segments = [], unassigned = [];
  if (F) {
    const anchors = ['file_kind', 'pages', 'items', 'unassigned_page_spans'].filter(k => !has(F, k));
    if (anchors.length) problem(Fp + ' lacks ' + anchors.join(', ') + '.');
    ['pages', 'items', 'unassigned_page_spans'].forEach(k => { if (has(F, k) && !Array.isArray(F[k])) problem(Fp + ': ' + k + ' must be a list.'); });
    if (F.sidecar_spec_version !== 'draft-0.1') problem(Fp + ': sidecar_spec_version ' + JSON.stringify(F.sidecar_spec_version) + ' is not draft-0.1.');
    if (!has(F, 'transcription_apparatus') || (F.transcription_apparatus !== null && typeof F.transcription_apparatus !== 'string')) problem(Fp + ': transcription_apparatus must be present (text or null).');
    stop();
    const mpages = new Map((Array.isArray(M.pages) ? M.pages : []).map(p => [p.source_pdf_page, p]));
    const pages = F.pages.map((pg, i) => {
      const w = Fp + ' pages[' + i + ']';
      if (!isObj(pg) || pg.source_page !== i + 1) { problem(w + ': pages must run 1, 2, 3 … in source order.'); return null; }
      if (typeof pg.text !== 'string') { problem(w + ': text must be a string.'); return null; }
      ['printed_page', 'page_char_length', 'page_text_sha256'].forEach(k => { if (!has(pg, k)) problem(w + ' lacks ' + k + '.'); });
      const fo = folioOf(pg.printed_page_status, pg.printed_page);
      if (!fo) problem(w + ': printed_page_status ' + JSON.stringify(pg.printed_page_status) + ' is not a value this converter knows.');
      const len = P.cpLength(pg.text), h = sha(enc(pg.text));
      verify('page ' + (i + 1) + ': length in code points', pg.page_char_length === len, w + ': page_char_length is ' + pg.page_char_length + ' but the text has ' + len + ' code points.');
      verify('page ' + (i + 1) + ': SHA-256 of the text', pg.page_text_sha256 === h, w + ': page_text_sha256 does not match the text.');
      const native = { page: i + 1, folio: pg.printed_page };
      Object.assign(native, fo || {});
      if (has(pg, 'review_status')) native.review_status = pg.review_status;
      const mp = mpages.get(i + 1);
      if (mp) {
        verify('page ' + (i + 1) + ': the manifest agrees (printed page, text hash)', mp.printed_page === pg.printed_page && (mp.text_sha256 === undefined || mp.text_sha256 === h),
          'MANIFEST.json pages: page ' + (i + 1) + ' disagrees with ' + Fp + ' (printed page or text hash).');
        if (typeof mp.segmented === 'boolean') native.segmented = mp.segmented;
      }
      native.length = len; native.sha256 = h; native.text = pg.text;
      addOrigin(native, Fp, rest(pg, ['source_page', 'printed_page', 'review_status', 'page_char_length', 'page_text_sha256', 'text']));
      if (mp) addOrigin(native, 'MANIFEST.json', rest(mp, ['source_pdf_page', 'printed_page', 'text_sha256', 'segmented']));
      return native;
    });
    if (mpages.size && mpages.size !== F.pages.length) problem('MANIFEST.json lists ' + mpages.size + ' pages; ' + Fp + ' has ' + F.pages.length + '.');
    stop();
    const idx = pages.map(p => P.cpIndex(p.text));
    const slice = (page, a, b) => pages[page - 1].text.slice(idx[page - 1][a], idx[page - 1][b]);
    const inRange = (s, w) => {
      if (!Number.isInteger(s.source_page) || !pages[s.source_page - 1]) { problem(w + ': source_page ' + JSON.stringify(s.source_page) + ' does not exist.'); return false; }
      const L = pages[s.source_page - 1].length;
      if (!Number.isInteger(s.page_char_start) || !Number.isInteger(s.page_char_end) || s.page_char_start < 0 || s.page_char_end > L || s.page_char_start >= s.page_char_end) {
        problem(w + ': offsets ' + s.page_char_start + '–' + s.page_char_end + ' are not a non-empty range within page ' + s.source_page + ' (0–' + L + ' code points).'); return false;
      }
      return true;
    };

    // Items in the full text: the same keys, in the same order, as the candidate rows.
    const fkeys = F.items.map(x => isObj(x) ? x.local_item_key : null);
    verify(Fp + ': the same items, in the same order, as ' + Cp, fkeys.join('\u0000') === items.map(x => x.key).join('\u0000'), Fp + ' items do not match the candidate rows of ' + Cp + ' (keys or order).');
    stop();
    F.items.forEach((fi, j) => {
      const it = itemBy.get(fi.local_item_key), w = Fp + ' items[' + j + ']';
      if (fi.source_sequence !== it.sequence) problem(w + ': source_sequence ' + fi.source_sequence + ' disagrees with the candidate row (' + it.sequence + ').');
      if ((fi.parent_local_item_key || null) !== (it.parent || null)) problem(w + ': its parent disagrees with the candidate row.');
      if (has(fi, 'content_id') && fi.content_id !== cmap[it.key] && !(fi.content_id === null && cmap[it.key] === null)) problem(w + ': content_id disagrees with the candidate row.');
      if (!has(fi, 'text')) problem(w + ' lacks text (null, or the item\'s text).');
      if (!Array.isArray(fi.segments)) { problem(w + ' has no segments list.'); return; }
      fi.segments.forEach((s, k) => {
        const sw = w + ' segments[' + k + ']';
        if (!isObj(s) || typeof s.segment_id !== 'string') { problem(sw + ' has no segment_id.'); return; }
        if (s.local_item_key !== it.key) problem(sw + ': local_item_key is not its item\'s.');
        if (!has(s, 'text')) { problem(sw + ' lacks text.'); return; }
        if (!inRange(s, sw)) return;
        verify('segment ' + s.segment_id + ': stored text equals the page text at its offsets', slice(s.source_page, s.page_char_start, s.page_char_end) === s.text,
          sw + ' (' + s.segment_id + '): its text is not the page text between its offsets.');
        if (has(s, 'source_sequence') && s.source_sequence !== it.sequence) warnings.push(s.segment_id + ': source_sequence ' + s.source_sequence + ' is not its item\'s (' + it.sequence + '); kept as given.');
        if (has(s, 'printed_page') && s.printed_page !== pages[s.source_page - 1].folio) warnings.push(s.segment_id + ': printed_page ' + JSON.stringify(s.printed_page) + ' is not its page\'s folio; kept as given.');
        const seg = { id: s.segment_id, item: it.key, page: s.source_page, start: s.page_char_start, end: s.page_char_end, order: k + 1 };
        if (has(s, 'boundary_basis')) seg.basis = s.boundary_basis;
        addOrigin(seg, Fp, rest(s, ['segment_id', 'local_item_key', 'source_page', 'page_char_start', 'page_char_end', 'boundary_basis', 'text']));
        segments.push(seg);
      });
      const joined = fi.segments.every(s => isObj(s) && has(s, 'text')) ? fi.segments.map(s => s.text).join('') : null;
      if (fi.text !== null && fi.text !== undefined && fi.text !== joined) problem(w + ': its text is not its segments joined in reading order.');
      if (has(fi, 'editorial_notes')) {
        if (Array.isArray(fi.editorial_notes) && fi.editorial_notes.every(n => typeof n === 'string')) it.notes = fi.editorial_notes;
        else problem(w + ': editorial_notes must be a list of strings.');
      }
      const extra = rest(fi, ['local_item_key', 'source_sequence', 'content_id', 'parent_local_item_key', 'segments', 'text', 'editorial_notes']);
      if (fi.text === null) extra.text = null;           // kept: "this item's text is in its segments"
      addOrigin(it, Fp, extra);
    });

    // Unassigned spans, grouped by page in the staging file.
    let lastPage = 0;
    F.unassigned_page_spans.forEach((g, gi) => {
      const w = Fp + ' unassigned_page_spans[' + gi + ']';
      if (!isObj(g) || !Array.isArray(g.spans) || !Number.isInteger(g.source_page)) { problem(w + ' must be a page with a spans list.'); return; }
      if (nonEmpty(rest(g, ['source_page', 'spans']))) problem(w + ' has fields this converter has no place for (' + Object.keys(rest(g, ['source_page', 'spans'])).join(', ') + ').');
      if (g.source_page <= lastPage || !g.spans.length) problem(w + ': groups must be pages in ascending order, each with at least one span.');
      lastPage = g.source_page;
      let lastStart = -1;
      g.spans.forEach((s, k) => {
        const sw = w + ' spans[' + k + ']';
        if (!isObj(s) || typeof s.unassigned_span_id !== 'string') { problem(sw + ' has no unassigned_span_id.'); return; }
        if (s.source_page !== g.source_page) problem(sw + ': source_page is not its group\'s.');
        if (!has(s, 'text')) { problem(sw + ' lacks text.'); return; }
        if (!inRange(s, sw)) return;
        if (s.page_char_start <= lastStart) problem(sw + ': spans must be in page order within their group.');
        lastStart = s.page_char_start;
        verify('span ' + s.unassigned_span_id + ': stored text equals the page text at its offsets', slice(s.source_page, s.page_char_start, s.page_char_end) === s.text,
          sw + ' (' + s.unassigned_span_id + '): its text is not the page text between its offsets.');
        const sp = { id: s.unassigned_span_id, page: s.source_page, start: s.page_char_start, end: s.page_char_end };
        if (has(s, 'reason')) sp.reason = s.reason;
        addOrigin(sp, Fp, rest(s, ['unassigned_span_id', 'source_page', 'page_char_start', 'page_char_end', 'reason', 'text']));
        unassigned.push(sp);
      });
    });
    const docOrder = (a, b) => a.page - b.page || a.start - b.start;
    segments.sort(docOrder); unassigned.sort(docOrder);

    // Notes on boundaries.
    const notes = [];
    if (has(F, 'boundary_notes')) {
      if (!Array.isArray(F.boundary_notes)) problem(Fp + ': boundary_notes must be a list.');
      else F.boundary_notes.forEach((n, i) => {
        const w = Fp + ' boundary_notes[' + i + ']';
        if (!isObj(n) || typeof n.note !== 'string') { problem(w + ' has no note text.'); return; }
        const nt = {};
        if (has(n, 'issue')) nt.id = n.issue;
        if (has(n, 'source_page')) nt.page = n.source_page;
        if (has(n, 'source_sequence')) {
          if (n.source_sequence === null) nt.item = null;
          else if (keyOfSeq.has(n.source_sequence)) nt.item = keyOfSeq.get(n.source_sequence);
          else problem(w + ': source_sequence ' + n.source_sequence + ' is not an item.');
        }
        if (has(n, 'status')) nt.status = n.status;
        nt.note = n.note;
        notes.push(addOrigin(nt, Fp, rest(n, ['issue', 'source_page', 'source_sequence', 'status', 'note'])));
      });
    }
    text = { format_version: '1.0', offset_unit: 'codepoint', apparatus: F.transcription_apparatus, pages, segments, unassigned };
    if (has(F, 'boundary_notes')) text.notes = notes;
    addOrigin(text, Fp, rest(F, ['transcription_apparatus', 'pages', 'items', 'unassigned_page_spans', 'boundary_notes']));

    // The transcription file is the apparatus followed by every page, exactly.
    if (files.has(TRp)) {
      const whole = (F.transcription_apparatus || '') + pages.map(p => p.text).join('');
      const tb = files.get(TRp);
      verify(TRp + ' is exactly the apparatus followed by every page text', sha(tb) === sha(enc(whole)), TRp + ' is not the apparatus followed by the page texts (so it is not derivable; this converter refuses rather than keep two authorities).');
      if (has(F, 'source_transcription_sha256')) verify(Fp + ': source_transcription_sha256 matches ' + TRp, F.source_transcription_sha256 === sha(tb), Fp + ': source_transcription_sha256 does not match ' + TRp + '.');
    } else problem(TRp + ' is named by the manifest but is not in the package.');

    // The item-to-page mapping, if there is one, must agree with the segments and spans.
    if (MAPp) {
      const MP = json(MAPp);
      if (MP) {
        const bad = [];
        (MP.mapped_items || []).forEach(mi => {
          const segs = segments.filter(s => s.item === mi.local_item_key).sort((a, b) => a.order - b.order);
          if (!itemBy.has(mi.local_item_key)) bad.push(mi.local_item_key + ' (not an item)');
          else if (JSON.stringify(mi.segment_ids || []) !== JSON.stringify(segs.map(s => s.id))) bad.push(mi.local_item_key + ' (segment ids)');
          else if (Array.isArray(mi.segment_page_char_ranges) && JSON.stringify(mi.segment_page_char_ranges.map(r => [r.source_page, r.page_char_start, r.page_char_end])) !== JSON.stringify(segs.map(s => [s.page, s.start, s.end]))) bad.push(mi.local_item_key + ' (ranges)');
        });
        if ((MP.mapped_items || []).length !== items.length) bad.push('it maps ' + (MP.mapped_items || []).length + ' items, not ' + items.length);
        (MP.unassigned_page_spans || []).forEach(g => {
          const ids = unassigned.filter(s => s.page === g.source_page).map(s => s.id);
          if (JSON.stringify(g.span_ids || []) !== JSON.stringify(ids)) bad.push('unassigned spans of page ' + g.source_page);
        });
        verify(MAPp + ' agrees with the segments and spans', !bad.length, MAPp + ' disagrees with ' + Fp + ': ' + bad.join('; ') + '.');
      }
    }
  }

  // ── The crosswalk CSV, if there is one, must agree with the candidate rows ──
  if (CWp) {
    if (!files.has(CWp)) problem(CWp + ' is named by the manifest but is not in the package.');
    else {
      let rows = null;
      try { rows = SC.csv.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get(CWp))).rows; } catch (e) { problem(CWp + ' cannot be read (' + e.message + ').'); }
      if (rows) {
        const hdr = rows[0], col = h => hdr.indexOf(h), bad = [];
        const body = rows.slice(1);
        if (body.length !== items.length) bad.push(body.length + ' rows for ' + items.length + ' items');
        body.forEach(r => {
          const get = h => col(h) === -1 ? undefined : r[col(h)];
          const it = itemBy.get(get('local_item_key'));
          if (!it) { bad.push('"' + get('local_item_key') + '" is not an item'); return; }
          const want = { source_sequence: String(it.sequence), parent_local_item_key: it.parent || '', working_issue_id: activeID, item_title_as_recorded: it.row['Item Title'], parent_item_as_recorded: it.row['Parent Item'] };
          Object.keys(want).forEach(h => { if (get(h) !== undefined && get(h) !== want[h]) bad.push(it.key + ' ' + h); });
        });
        verify(CWp + ' agrees with the candidate rows', !bad.length, CWp + ' disagrees with ' + Cp + ': ' + bad.slice(0, 10).join('; ') + '.');
      }
    }
  }

  // ── Mentions: the deep index ──
  let mentions = null;
  if (D) {
    const seqToKey = s => (s === null ? null : keyOfSeq.get(s));
    const ment = (list, kind) => (Array.isArray(list) ? list : []).map((e, i) => {
      const w = Dp + ' ' + kind + '[' + i + ']';
      if (!isObj(e)) { problem(w + ' must be an object.'); return null; }
      const m = { id: (kind === 'entities' ? 'e' : 's') + String(i + 1).padStart(3, '0') };
      if (kind === 'entities') {
        if (has(e, 'type')) m.type = e.type;
        if (typeof e.source_form !== 'string') problem(w + ' has no source_form.');
        m.form = e.source_form;
        if (has(e, 'normalized_form')) m.normalized = e.normalized_form;
      } else {
        if (typeof e.term !== 'string') problem(w + ' has no term.');
        m.term = e.term;
      }
      if (has(e, 'content_item_sequence')) {
        const k = seqToKey(e.content_item_sequence);
        if (k === undefined) problem(w + ': content_item_sequence ' + e.content_item_sequence + ' is not an item.');
        m.item = k === undefined ? null : k;
      }
      if (has(e, 'pages')) m.pages = e.pages;
      if (has(e, 'context')) m.context = e.context;
      if (has(e, 'status')) m.status = e.status;
      const noteKey = kind === 'entities' ? 'evidence_note' : 'note';
      if (has(e, noteKey)) m.note = e[noteKey];
      if (kind === 'entities' && has(e, 'external_evidence')) m.external_evidence = e.external_evidence;
      m.precision = m.item ? 'item' : (Array.isArray(m.pages) && m.pages.length ? 'page' : 'issue');
      return addOrigin(m, Dp, rest(e, ['type', 'source_form', 'normalized_form', 'term', 'content_item_sequence', 'pages', 'context', 'status', noteKey, 'external_evidence']));
    }).filter(Boolean);
    if (has(D, 'title_library_slug') && items.length && D.title_library_slug !== items[0].row['Title Library Slug']) problem(Dp + ': title_library_slug disagrees with the candidate rows.');
    mentions = { format_version: '1.0', entities: ment(D.entities, 'entities'), subjects: ment(D.subjects, 'subjects') };
    if (has(D, 'research_log')) mentions.research_log = D.research_log;
    addOrigin(mentions, Dp, rest(D, ['entities', 'subjects', 'research_log']));
  }

  // ── Rights ──
  const rightsStatus = /UNKNOWN|UNDETERMINED/i.test(String(R.rights_assessment || '')) ? 'undetermined' : null;
  if (!rightsStatus) problem(Rp + ': rights_assessment ' + JSON.stringify(R.rights_assessment) + ' is not a status this converter knows (only an undetermined status is carried over; anything else needs a person).');
  const anyApproval = o2 => JSON.stringify(o2 || {}).match(/"(public_release_authorized|[a-z_]*public_release|catalog_merge|local_import)":true/);
  if (anyApproval(R) || anyApproval(M.cover) || anyApproval(M.deep_index) || M.public_release_authorized === true) {
    problem('The staging package claims an approval (a "true" authorization). Approvals are never carried over automatically: record them natively, by a person, after conversion.');
  }
  const decisions = [];
  const decided = M.prepared_at && /^\d{4}-\d{2}-\d{2}/.test(M.prepared_at) ? M.prepared_at.slice(0, 10) : null;
  Object.keys(isObj(R.access_defaults) ? R.access_defaults : {}).forEach(k => {
    const a = R.access_defaults[k];
    const kinds = RIGHTS_RESOURCES[k];
    if (!kinds) { problem(Rp + ': access_defaults has a resource "' + k + '" this converter knows no native kind for.'); return; }
    const st = isObj(a) ? a.status : null;
    if (st === 'PRIVATE') kinds.forEach(kind => PUBLIC_PURPOSES.forEach(pp => decisions.push({
      id: 'd' + String(decisions.length + 1).padStart(3, '0'), resource: { kind }, purpose: pp, value: 'deny',
      by: 'staging package', at: decided, basis: Rp + ': access_defaults.' + k + '.status = PRIVATE'
    })));
    else if (!/^(PRIVATE_STAGING|REVIEW_REQUIRED|UNDECIDED|UNKNOWN)$/.test(String(st))) problem(Rp + ': access_defaults.' + k + '.status ' + JSON.stringify(st) + ' is not a status this converter knows.');
  });
  decisions.forEach(d => { if (d.at === null) delete d.at; });
  const rights = addOrigin({ format_version: '1.0', rights_status: { value: rightsStatus, statement: R.rights_assessment }, decisions, withheld: [] }, Rp, rest(R, ['rights_assessment']));

  // ── Review queue ──
  let review;
  if (RQ) {
    review = (Array.isArray(RQ.issues) ? RQ.issues : []).map((q, i) => {
      const w = RQp + ' issues[' + i + ']';
      const st = reviewStatusOf(q && q.status);
      const id = isObj(q) ? (q.existing_identifier || q.id) : null;
      if (!st || typeof id !== 'string') { problem(w + ' needs an identifier and a status of open, blocking, deferred or resolved.'); return null; }
      const bw = isObj(q.blocked_workflows) ? Object.keys(q.blocked_workflows).filter(x => q.blocked_workflows[x] === true) : [];
      const r = { id, status: st };
      if (has(q, 'label')) r.label = q.label;
      if (has(q, 'issue_or_decision_required')) r.summary = q.issue_or_decision_required;
      r.blocks = bw;
      return addOrigin(r, RQp, rest(q, ['existing_identifier', 'label', 'issue_or_decision_required']));
    }).filter(Boolean);
  }
  stop();

  // ── Assets: the cover and the source files, byte for byte ──
  const out = new Map();
  const kept = new Map();            // staging path → native path
  let cover = null;
  if (COVp) {
    if (!files.has(COVp)) problem(COVp + ' (the cover) is not in the package.');
    else {
      const b = files.get(COVp);
      const mt = b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : null;
      if (!mt) problem(COVp + ' is neither a JPEG nor a PNG image.');
      else {
        const dim = P.imageSize(b, mt);
        if (!dim) problem(COVp + ' is not a readable ' + mt + ' file.');
        if (M.cover.sha256 !== undefined) verify('cover: SHA-256 as stated in the manifest', M.cover.sha256 === sha(b), 'MANIFEST.json cover.sha256 does not match ' + COVp + '.');
        const np = mt === 'image/png' ? 'cover.png' : 'cover.jpg';
        cover = { path: np, media_type: mt, width: dim ? dim.width : 0, height: dim ? dim.height : 0 };
        if (has(M.cover, 'source_page')) cover.source_page = M.cover.source_page;
        addOrigin(cover, 'MANIFEST.json', rest(M.cover, ['file', 'source_page', 'sha256']));
        out.set(np, b); kept.set(COVp, np);
      }
    }
  }
  const sources = [];
  (Array.isArray(M.source_files) ? M.source_files : []).forEach((s, i) => {
    const w = 'MANIFEST.json source_files[' + i + ']';
    if (!isObj(s) || typeof s.file !== 'string' || !files.has(s.file)) { problem(w + ': the file ' + JSON.stringify(s && s.file) + ' is not in the package.'); return; }
    const b = files.get(s.file);
    verify('source file ' + s.file + ': SHA-256 and size as stated', (s.sha256 === undefined || s.sha256 === sha(b)) && (s.size_bytes === undefined || s.size_bytes === b.length), w + ': ' + s.file + ' does not match its stated SHA-256 or size.');
    const isPDF = b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    const np = s.file.startsWith('source/') ? s.file : 'source/' + s.file.split('/').pop();
    if (out.has(np)) { problem(w + ': two source files would both be ' + np + '.'); return; }
    const src = { path: np, media_type: isPDF ? 'application/pdf' : 'application/octet-stream' };
    if (has(s, 'original_name')) src.original_name = s.original_name;
    if (has(s, 'ordered_pdf_pages')) src.pages = s.ordered_pdf_pages;
    sources.push(addOrigin(src, 'MANIFEST.json', rest(s, ['file', 'original_name', 'ordered_pdf_pages', 'sha256', 'size_bytes'])));
    out.set(np, b); kept.set(s.file, np);
  });
  stop();

  // ── Provenance: every staging file, and where it went ──
  const reExpressed = {};
  if (Fp) reExpressed[Fp] = 'text.json';
  reExpressed[Cp] = 'items.json';
  if (Dp) reExpressed[Dp] = 'mentions.json';
  const mappedInto = { 'MANIFEST.json': 'issue.json', [Rp]: 'rights.json' };
  if (RQp) mappedInto[RQp] = 'issue.json';
  const verifiedFiles = [TRp, MAPp, CWp, 'CHECKSUMS.sha256'].filter(Boolean);
  const provFiles = [];
  Array.from(files.keys()).sort().forEach(p => {
    const b = files.get(p);
    let keptAs = kept.get(p);
    if (!keptAs) { keptAs = 'provenance/staging/' + p; out.set(keptAs, b); }
    const e = { path: p, bytes: b.length, sha256: sha(b), kept_as: keptAs };
    if (reExpressed[p]) e.re_expressed_in = reExpressed[p];
    else if (mappedInto[p]) e.mapped_into = mappedInto[p];
    provFiles.push(e);
  });

  // ── Native files ──
  const slug = items.length ? items[0].row['Title Library Slug'] : null;
  if (items.some(it => it.row['Title Library Slug'] !== slug)) problem(Cp + ': the candidate rows name more than one library.');
  const pkgID = String(M.package_id || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(pkgID)) problem('MANIFEST.json package_id ' + JSON.stringify(M.package_id) + ' cannot be a package id (1–128 letters, digits, dots, hyphens, underscores).');
  stop();
  const itemsFile = addOrigin({ format_version: '1.0', schema: SC.schema.VERSION, headers: headers.slice(), items }, Cp, rest(C, ['cataloger_3_0_header_order', 'candidate_records']));
  const report = {
    format: 'slaughter-cataloger-issue/conversion-report', format_version: '1.0', converter: CONVERTER,
    staging: { format: M.package_spec_version, package_id: pkgID, archive: o.archive || null },
    treatment: {
      re_expressed: Object.keys(reExpressed).map(p => p + ' → ' + reExpressed[p] + ' (rebuilt exactly from it by reconstruct(); fields with no place in 1.0 are kept in "origin")'),
      mapped: Object.keys(mappedInto).map(p => p + ' → ' + mappedInto[p] + ' (identity, cover, sources, rights or review; every other field kept in "origin")'),
      verified: verifiedFiles.map(p => p + ' (cross-checked against the re-expressed files)'),
      stored_natively: Array.from(kept.keys()).map(p => p + ' → ' + kept.get(p) + ' (byte for byte)'),
      not_stored_because_derived: [
        'each segment\'s and unassigned span\'s text: the page text between its offsets (each one checked equal first)',
        'each item\'s text: its segments joined in reading order (checked equal first)',
        TRp ? TRp + ': the apparatus followed by every page text (checked equal; the original is kept under provenance/staging/)' : null
      ].filter(Boolean),
      all_files_kept: 'every staging file is kept byte for byte under provenance/staging/ (or as the native cover or source file); issue.json › provenance.files lists each with its SHA-256'
    },
    checks, warnings
  };
  const issue = {
    format: P.FORMAT, format_version: P.VERSION, package_id: pkgID, state: 'candidate',
    identity: { library_slug: slug, title_id: titleID, issue_id: issueID, working_issue_id: workingID, designation: has(M, 'issue_designation') ? M.issue_designation : null, identity_history: history },
    content_map: cmap
  };
  if (cover) issue.cover = cover;
  if (sources.length) issue.sources = sources;
  if (review) issue.review = review;
  issue.provenance = { converted_from: { format: M.package_spec_version, package_id: pkgID, archive: o.archive || null }, converter: CONVERTER, report: 'provenance/CONVERSION.json', files: provFiles };
  const manifestRest = rest(M, ['package_id', 'title_id', 'issue_id', 'working_issue_id', 'identity_history', 'issue_designation', 'pages', 'cover', 'source_files', 'active_assets']);
  addOrigin(issue, 'MANIFEST.json', manifestRest);
  if (RQ) addOrigin(issue, RQp, rest(RQ, ['issues']));

  if (text) out.set('text.json', enc(P.serialize(text)));
  out.set('items.json', enc(P.serialize(itemsFile)));
  if (mentions) out.set('mentions.json', enc(P.serialize(mentions)));
  out.set('rights.json', enc(P.serialize(rights)));
  out.set('provenance/CONVERSION.json', enc(P.serialize(report)));
  const roleOf = p => p === 'text.json' ? 'text' : p === 'items.json' ? 'items' : p === 'mentions.json' ? 'mentions' : p === 'rights.json' ? 'rights'
    : p.startsWith('source/') ? 'source' : p.startsWith('provenance/') ? 'provenance' : (cover && p === cover.path) ? 'cover' : null;
  const inventory = Array.from(out.keys()).sort().map(p => ({ path: p, role: roleOf(p), bytes: out.get(p).length, sha256: sha(out.get(p)) }));
  issue.files = inventory;
  issue.inventory_sha256 = P.inventoryHash(inventory, b => sha(b));
  out.set('issue.json', enc(P.serialize(issue)));

  // The result must validate, and the re-expressed files must rebuild exactly; otherwise nothing is returned.
  const v = P.validate(out, { sha256: sha });
  v.errors.forEach(e => problem('The converted package does not validate: [' + e.code + '] ' + (e.file ? e.file + ' ' : '') + (e.where ? e.where + ': ' : '') + e.message));
  stop();
  const back = reconstruct(out);
  [[Fp, F], [Cp, C], [Dp, D]].forEach(([p, orig]) => {
    if (!p) return;
    verify(p + ' rebuilds exactly from the native files', back.has(p) && canon(back.get(p)) === canon(orig), p + ' does not rebuild exactly from the native files (a converter fault; nothing written).');
  });
  stop();
  // The report goes in last, now that every check has run; issue.json is recomputed to match.
  out.set('provenance/CONVERSION.json', enc(P.serialize(report)));
  inventory.forEach(f => { if (f.path === 'provenance/CONVERSION.json') { f.bytes = out.get(f.path).length; f.sha256 = sha(out.get(f.path)); } });
  issue.inventory_sha256 = P.inventoryHash(inventory, b => sha(b));
  out.set('issue.json', enc(P.serialize(issue)));
  const v2 = P.validate(out, { sha256: sha });
  if (!v2.ok) throw new StagingError(v2.errors.map(e => 'After writing the report: [' + e.code + '] ' + e.message));
  return { files: out, report, summary: v2.summary, warnings: v2.warnings.concat(warnings.map(w => ({ code: 'staging', message: w }))) };
}

// ── Rebuilding the re-expressed staging files from a native package ──
function reconstruct(nativeFiles) {
  const v = P.validate(nativeFiles, { sha256: io.sha256 });
  if (!v.pkg || !v.pkg.issue) throw new Error('Not a readable issue package: ' + v.errors.map(e => e.message).join('; '));
  const pkg = v.pkg, issue = pkg.issue, out = new Map();
  const prov = isObj(issue.provenance) && Array.isArray(issue.provenance.files) ? issue.provenance.files : [];
  const fileFor = target => { const f = prov.find(x => x.re_expressed_in === target); return f ? f.path : null; };
  const O = (rec, file) => (rec && isObj(rec.origin) && isObj(rec.origin[file])) ? rec.origin[file] : {};
  const items = pkg.items ? pkg.items.items : [];
  const seqOf = new Map(items.map(it => [it.key, it.sequence]));
  const put = (o, k, v2) => { if (v2 !== undefined) o[k] = v2; };

  const Fp = fileFor('text.json');
  if (Fp && pkg.text) {
    const T = pkg.text;
    const F = Object.assign({}, O(T, Fp));
    F.transcription_apparatus = T.apparatus;
    F.pages = T.pages.map(pg => {
      const p = { source_page: pg.page, printed_page: pg.folio };
      put(p, 'review_status', pg.review_status);
      p.page_char_length = pg.length; p.page_text_sha256 = pg.sha256; p.text = pg.text;
      return Object.assign(p, O(pg, Fp));
    });
    F.items = items.map(it => {
      const o = O(it, Fp);
      const segs = T.segments.filter(s => s.item === it.key).sort((a, b) => a.order - b.order).map(s => {
        const x = { segment_id: s.id, local_item_key: s.item, source_page: s.page, page_char_start: s.start, page_char_end: s.end, text: P.spanText(pkg, s) };
        put(x, 'boundary_basis', s.basis);
        return Object.assign(x, O(s, Fp));
      });
      const x = { local_item_key: it.key, source_sequence: it.sequence, content_id: issue.content_map[it.key], parent_local_item_key: it.parent, segments: segs, text: segs.map(s => s.text).join('') };
      put(x, 'editorial_notes', it.notes);
      return Object.assign(x, o);
    });
    const pagesWith = Array.from(new Set(T.unassigned.map(s => s.page))).sort((a, b) => a - b);
    F.unassigned_page_spans = pagesWith.map(n => ({
      source_page: n,
      spans: T.unassigned.filter(s => s.page === n).sort((a, b) => a.start - b.start).map(s => {
        const x = { unassigned_span_id: s.id, source_page: s.page, page_char_start: s.start, page_char_end: s.end, text: P.spanText(pkg, s) };
        put(x, 'reason', s.reason);
        return Object.assign(x, O(s, Fp));
      })
    }));
    if (T.notes !== undefined) F.boundary_notes = T.notes.map(n => {
      const x = {};
      put(x, 'issue', n.id); put(x, 'source_page', n.page);
      if (n.item !== undefined) x.source_sequence = n.item === null ? null : seqOf.get(n.item);
      put(x, 'status', n.status);
      x.note = n.note;
      return Object.assign(x, O(n, Fp));
    });
    out.set(Fp, F);
  }

  const Cp = fileFor('items.json');
  if (Cp && pkg.items) {
    const C = Object.assign({}, O(pkg.items, Cp));
    C.cataloger_3_0_header_order = pkg.items.headers;
    C.candidate_records = items.map(it => {
      const o = O(it, Cp);
      const x = { local_item_key: it.key, parent_local_item_key: it.parent, source_sequence: it.sequence };
      Object.assign(x, rest(o, ['cataloger_3_0_fields']));
      x.cataloger_3_0_fields = Object.assign({}, it.row, o.cataloger_3_0_fields || {});
      return x;
    });
    out.set(Cp, C);
  }

  const Dp = fileFor('mentions.json');
  if (Dp && pkg.mentions) {
    const Mn = pkg.mentions;
    const D = Object.assign({}, O(Mn, Dp));
    const back = (m, kind) => {
      const x = {};
      if (kind === 'entities') { put(x, 'type', m.type); x.source_form = m.form; put(x, 'normalized_form', m.normalized); } else x.term = m.term;
      if (m.item !== undefined) x.content_item_sequence = m.item === null ? null : seqOf.get(m.item);
      put(x, 'pages', m.pages); put(x, 'context', m.context); put(x, 'status', m.status);
      put(x, kind === 'entities' ? 'evidence_note' : 'note', m.note);
      if (kind === 'entities') put(x, 'external_evidence', m.external_evidence);
      return Object.assign(x, O(m, Dp));
    };
    D.entities = (Mn.entities || []).map(m => back(m, 'entities'));
    D.subjects = (Mn.subjects || []).map(m => back(m, 'subjects'));
    put(D, 'research_log', Mn.research_log);
    out.set(Dp, D);
  }
  return out;
}

module.exports = { convert, reconstruct, isStaging, stagingFormat, canon, StagingError, CONVERTER };
