/* Slaughter Cataloger 3 — issue packages, format "slaughter-cataloger-issue" 1.x
   (specification: docs/ISSUE-PACKAGE.md).

   An issue package holds what the CSV catalog does not: the page-by-page transcription of one
   issue, how its text divides into the issue's contents items, a private index of mentions, the
   cover, the source file, provenance, and publication decisions. It never replaces the catalog:
   candidate Contents rows travel in it only until they are imported into the Contents CSV.

     SC.issuepkg.validate(files, { sha256 }) → { ok, errors, warnings, pkg, summary }
        files: Map(path → Uint8Array), as read from a folder or by SC.zipread
        sha256: bytes → lowercase hex (supplied by the caller: Node's crypto, or a browser digest)
     SC.issuepkg.segmentText(pkg, id), itemParts(pkg, key), itemText(pkg, key), transcription(pkg)
     SC.issuepkg.serialize(value) → the package's JSON layout (2-space indent, final newline)
     SC.issuepkg.inventoryHash(entries, sha256) → the hash over a file inventory

   Everything here is pure: no DOM, no Node APIs, no network. Offsets are in Unicode code points,
   never JavaScript string indexes (cpIndex() converts). Unknown fields are kept by every reader
   and reported as warnings, never dropped. Needs SC.ids and SC.schema at call time. */
(function (SC) {
  'use strict';

  const FORMAT = 'slaughter-cataloger-issue';
  const VERSION = '1.0';
  const ROLES = ['text', 'items', 'mentions', 'rights', 'cover', 'source', 'provenance'];
  const ROLE_FILE = { text: 'text.json', items: 'items.json', mentions: 'mentions.json', rights: 'rights.json' };
  const STATES = ['candidate', 'installed'];
  const FOLIO_STATUS = ['printed', 'absent', 'illegible', 'unverified'];
  const TITLE_ORIGIN = ['printed', 'supplied'];
  const PRECISION = ['issue', 'page', 'item', 'paragraph', 'exact', 'exact-derived'];
  const RIGHTS_STATUS = ['undetermined', 'in-copyright', 'public-domain', 'licensed', 'own-work'];
  const RESOURCES = ['metadata', 'cover', 'page_text', 'item_text', 'mentions', 'source'];
  const PURPOSES = ['local_view', 'private_epub', 'public_web', 'public_search', 'public_download', 'public_epub'];
  const DECISIONS = ['undecided', 'deny', 'allow'];
  const REVIEW_STATUS = ['open', 'blocking', 'deferred', 'resolved'];
  const HISTORY_STATUS = { issue_id: 'superseded', provisional_key: 'retired' };   // typed history entries: kind → its one status
  const IDENTITY_STATUS = ['resolved', 'title-resolved', 'unresolved'];
  const REGIONS = ['full', 'left', 'right', 'top', 'bottom'];
  const ROTATIONS = [0, 90, 180, 270];
  // Each region as a rectangle of the upright page, normalized to 0–1: [x0, y0, x1, y1], origin top left, y down.
  const REGION_RECT = { full: [0, 0, 1, 1], left: [0, 0, 0.5, 1], right: [0.5, 0, 1, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 1] };
  const NATIVE_FILES = ['issue.json', 'text.json', 'items.json', 'mentions.json', 'rights.json'];
  const MEDIA = { 'image/jpeg': 'cover', 'image/png': 'cover', 'application/pdf': 'source' };

  // The fields each object may have in 1.0. Anything else is kept and reported as unknown.
  const KNOWN = {
    issue: ['format', 'format_version', 'package_id', 'state', 'identity', 'content_map', 'cover', 'sources', 'review', 'provenance', 'files', 'inventory_sha256', 'origin'],
    identity: ['status', 'library_slug', 'title_id', 'issue_id', 'working_issue_id', 'provisional_key', 'designation', 'identity_history'],
    history: ['kind', 'id', 'key', 'status', 'note', 'origin'],
    location: ['source', 'pdf_page', 'region', 'rotation', 'box', 'size'],
    review: ['id', 'label', 'status', 'summary', 'blocks', 'origin'],
    provenance: ['converted_from', 'converter', 'report', 'files'],
    provFile: ['path', 'bytes', 'sha256', 'kept_as', 're_expressed_in', 'mapped_into'],
    file: ['path', 'role', 'bytes', 'sha256'],
    cover: ['path', 'media_type', 'width', 'height', 'source_page', 'location', 'derivation', 'origin'],
    source: ['path', 'media_type', 'original_name', 'pages', 'origin'],
    text: ['format_version', 'offset_unit', 'apparatus', 'pages', 'segments', 'unassigned', 'notes', 'origin'],
    page: ['page', 'folio', 'folio_status', 'inferred_folio', 'locations', 'text', 'length', 'sha256', 'review_status', 'segmented', 'origin'],
    segment: ['id', 'item', 'page', 'start', 'end', 'order', 'basis', 'origin'],
    span: ['id', 'page', 'start', 'end', 'reason', 'origin'],
    note: ['id', 'page', 'item', 'status', 'note', 'origin'],
    items: ['format_version', 'schema', 'headers', 'items', 'origin'],
    item: ['key', 'sequence', 'parent', 'title_origin', 'row', 'notes', 'origin'],
    mentions: ['format_version', 'entities', 'subjects', 'research_log', 'origin'],
    entity: ['id', 'type', 'form', 'normalized', 'item', 'pages', 'context', 'status', 'note', 'precision', 'anchors', 'external_evidence', 'origin'],
    subject: ['id', 'term', 'item', 'pages', 'status', 'note', 'precision', 'anchors', 'origin'],
    anchor: ['page', 'start', 'end', 'precision'],
    rights: ['format_version', 'rights_status', 'decisions', 'withheld', 'origin'],
    rightsStatus: ['value', 'statement'],
    decision: ['id', 'resource', 'purpose', 'value', 'by', 'at', 'basis', 'review_by', 'origin'],
    resource: ['kind', 'item', 'page'],
    withheld: ['id', 'page', 'start', 'end', 'reason', 'by', 'at', 'origin']
  };

  const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;          // package-local keys and IDs
  // Shaped like a catalog ID (TitleID, IssueID, ContentID, AuthorityID), in any letter case. A
  // package-local key must never look like one: a lookalike can be pasted into a CSV and taken for real.
  const CATALOG_SHAPED = /^([A-Z0-9]{8}-(\d{4}|\d{3}X|\d{2}XX|XXXX)(-[A-Z0-9]{2,16})?|AU-[A-Z0-9]{6})$/i;
  const isCatalogShaped = v => typeof v === 'string' && CATALOG_SHAPED.test(v);
  // Files an operating system leaves behind when a folder is browsed or zipped (Finder, Explorer).
  // They are not part of any package: readers skip them and say so, rather than refuse the package.
  const OS_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|^__MACOSX\//i;
  const isOSFile = p => OS_FILE.test(p);
  const HEX64 = /^[0-9a-f]{64}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isInt = v => Number.isInteger(v);
  const isStr = v => typeof v === 'string';

  // ── Unicode code points ─────────────────────────────────────────────────
  // cpIndex(s)[k] is the JavaScript string index where code point k starts; its last entry is
  // s.length. A character outside the Basic Multilingual Plane (𝔄, 😀) is one code point but two
  // JavaScript units, so offsets from Python or any code-point-based tool line up only through this.
  function cpIndex(s) {
    const idx = [0];
    for (let i = 0; i < s.length;) {
      const c = s.charCodeAt(i);
      i += (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) ? 2 : 1;
      idx.push(i);
    }
    return idx;
  }
  const cpLength = s => cpIndex(s).length - 1;
  const cpSlice = (s, start, end, idx) => { const x = idx || cpIndex(s); return s.slice(x[start], x[end]); };
  const isWellFormed = s => !LONE_SURROGATE.test(s);

  // ── Strict JSON ─────────────────────────────────────────────────────────
  // UTF-8 without a byte-order mark; valid syntax; no key twice in one object (two parsers could
  // read different values); no unpaired surrogates in any string; at most 100 levels deep.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  function decodeUTF8(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { error: 'starts with a byte-order mark (packages use UTF-8 without one)' };
    try { return { text: decoder.decode(bytes) }; } catch (e) { return { error: 'is not valid UTF-8' }; }
  }
  function duplicateKey(text) {
    const stack = [];
    for (let i = 0, n = text.length; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        let j = i + 1;
        while (j < n) { const d = text.charCodeAt(j); if (d === 0x5C) j += 2; else if (d === 0x22) break; else j++; }
        const top = stack[stack.length - 1];
        if (top && top.obj && top.expectKey) {
          const key = JSON.parse(text.slice(i, j + 1));
          if (top.keys.has(key)) return 'the key "' + key + '" appears twice in one object';
          top.keys.add(key); top.expectKey = false;
        }
        i = j;
      } else if (c === 0x7B || c === 0x5B) {
        stack.push(c === 0x7B ? { obj: true, keys: new Set(), expectKey: true } : { obj: false });
        if (stack.length > 100) return 'it is nested more than 100 levels deep';
      } else if (c === 0x7D || c === 0x5D) stack.pop();
      else if (c === 0x2C) { const top = stack[stack.length - 1]; if (top && top.obj) top.expectKey = true; }
    }
    return null;
  }
  function badString(v) {
    const todo = [v];
    while (todo.length) {
      const x = todo.pop();
      if (isStr(x)) { if (!isWellFormed(x)) return x; }
      else if (Array.isArray(x)) x.forEach(y => todo.push(y));
      else if (isObj(x)) Object.keys(x).forEach(k => { todo.push(k); todo.push(x[k]); });
    }
    return null;
  }
  function parseJSON(bytes) {
    const d = decodeUTF8(bytes);
    if (d.error) return { error: d.error, code: 'encoding' };
    let value;
    try { value = JSON.parse(d.text); } catch (e) { return { error: 'is not valid JSON (' + e.message + ')', code: 'json' }; }
    const dup = duplicateKey(d.text);
    if (dup) return { error: 'is ambiguous: ' + dup, code: 'json' };
    if (badString(value) !== null) return { error: 'contains a string with an unpaired surrogate (not valid Unicode)', code: 'encoding' };
    return { value, text: d.text };
  }
  const serialize = v => JSON.stringify(v, null, 2) + '\n';
  const utf8 = s => new TextEncoder().encode(s);

  // ── Transcription markup (docs/ISSUE-PACKAGE.md §6) ─────────────────────
  // A closed set. Recognized: one page anchor line, Markdown headings, list items, fenced blocks,
  // horizontal rules, *emphasis*, **strong**, backslash escapes, and the editorial marks
  // [supplied: …], [unclear: …], [illegible]. Everything else is literal text: readers show it as
  // typed and never interpret it as HTML. This scanner counts what it finds and notes what looks
  // like markup outside the set, so a person can see it will be shown literally.
  // Page anchors: "<!-- PDF_PAGE: N -->" marks where the text from PDF page N begins (N is a PDF page
  // of this page's locations); "<!-- LOGICAL_PAGE_N_START -->" … "<!-- LOGICAL_PAGE_N_END -->" enclose
  // logical page N. Each is a whole line.
  const ANCHOR_RE = /^<!-- PDF_PAGE: (\d+) -->$/;
  const LOGICAL_ANCHOR_RE = /^<!-- LOGICAL_PAGE_(\d+)_(START|END) -->$/;
  // A bracket that reads like editorial matter but is not one of the three marks. It would be shown as
  // printed text, so it is always reported (never passed silently): a label followed by a colon
  // ("[Note: …", "[Editorial description: …"), or a bracket that opens with a word transcribers use
  // for their own notes. A printed bracket that happens to match is written \[ … \] (escaped).
  const EDITORIAL_WORDS = /^(editorial|editor|editors|editor's|ed\.|note|notes|footnote|endnote|sic|illustration|illustrations|image|photo|photograph|picture|figure|fig\.|caption|description|decorative|decoration|ornament|vignette|transcriber|transcriber's|transcription|printed|separate|supplied|unclear|illegible|blank|missing|torn|damaged)(?![A-Za-z])/i;
  const LABEL_COLON = /^[^\]\n]{1,80}?:(\s|$)/;
  function scanMarkup(text) {
    const counts = { anchor: 0, logical_anchor: 0, heading: 0, list_item: 0, fence: 0, rule: 0, emphasis: 0, strong: 0, supplied: 0, unclear: 0, illegible: 0, escape: 0, editorial_unrecognized: 0 };
    const anchors = [], logical = [], notes = [];
    const note = (unitAt, message) => notes.push({ offset: cpLength(text.slice(0, unitAt)), message });
    let inFence = false, fenceAt = 0, at = 0;
    for (const line of text.split('\n')) {
      const lineAt = at;
      at += line.length + 1;
      if (/^```/.test(line)) {
        if (!inFence) { inFence = true; fenceAt = lineAt; counts.fence++; } else inFence = false;
        continue;
      }
      if (inFence) continue;
      const a = ANCHOR_RE.exec(line);
      if (a) { counts.anchor++; anchors.push({ page: Number(a[1]), offset: cpLength(text.slice(0, lineAt)) }); continue; }
      const la = LOGICAL_ANCHOR_RE.exec(line);
      if (la) { counts.logical_anchor++; logical.push({ page: Number(la[1]), edge: la[2].toLowerCase(), offset: cpLength(text.slice(0, lineAt)) }); continue; }
      if (/<!--/.test(line)) note(lineAt + line.indexOf('<!--'), 'an HTML comment that is not a page anchor; shown as text');
      if (/^#{1,6} \S/.test(line)) counts.heading++;
      if (/^\s*[-*+] \S/.test(line)) counts.list_item++;
      if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { counts.rule++; continue; }
      // Inline: escapes first, so an escaped character never opens anything.
      const plain = line.replace(/\\[\\*[\]#\-+`_]/g, m => { counts.escape++; return '\u0000\u0000'; });
      // Every "[" on the line: one of the three marks, or printed text — unless it reads like editorial matter.
      for (let i = plain.indexOf('['); i !== -1; i = plain.indexOf('[', i + 1)) {
        const rest = plain.slice(i);
        const known = /^\[(supplied|unclear): [^\]\n]*\]/.exec(rest) || /^\[illegible\]/.exec(rest);
        if (known) { counts[known[1] || 'illegible']++; i += known[0].length - 1; continue; }
        if (/^\[(supplied|unclear): /.test(rest)) { note(lineAt + i, 'an editorial mark that is not closed on its line; shown as text'); continue; }
        const close = rest.indexOf(']');
        const body = rest.slice(1, close === -1 ? Math.min(rest.length, 200) : close);
        if (EDITORIAL_WORDS.test(body.trimStart()) || LABEL_COLON.test(body)) {
          counts.editorial_unrecognized++;
          note(lineAt + i, 'a bracket that reads like an editorial note ("[' + body.slice(0, 30) + (body.length > 30 ? '…' : '') + '") but is not [supplied: …], [unclear: …] or [illegible]: it would be shown as printed text. Write editorial matter as [supplied: …], or escape a printed bracket as \\[ … \\]');
        }
      }
      const noStrong = plain.replace(/\*\*[^*\n]+\*\*/g, () => { counts.strong++; return ''; });
      noStrong.replace(/\*[^*\s][^*\n]*\*/g, () => { counts.emphasis++; return ''; });
      const tag = /<\/?[A-Za-z][^>\n]*>/.exec(plain);
      if (tag) note(lineAt + tag.index, 'something that looks like an HTML tag; shown as text');
      const link = /!?\[[^\]\n]*\]\([^)\n]*\)/.exec(plain);
      if (link) note(lineAt + link.index, 'something that looks like a Markdown link or image; shown as text');
    }
    if (inFence) note(fenceAt, 'a fenced block that is never closed; the rest of the page is shown as typed');
    return { counts, anchors, logical, notes };
  }

  // ── Physical locations: coordinates and rotation (docs/ISSUE-PACKAGE.md §5.3) ──
  // A location's region and box are measured on the PDF page *as read upright*: the page's visible box
  // (its CropBox, else its MediaBox) turned `rotation` degrees clockwise. Upright coordinates are in PDF
  // points, origin at the top left, x to the right, y downward. These convert to and from PDF user
  // space (origin bottom left, y up), given the visible box [bx, by, bx + w, by + h] as stored.
  const uprightSize = (rotation, w, h) => (rotation % 180 === 0 ? [w, h] : [h, w]);
  function uprightToPDF(X, Y, rotation, box) {
    const bx = box[0], by = box[1], w = box[2] - box[0], h = box[3] - box[1];
    switch (rotation) {
      case 0: return [bx + X, by + h - Y];
      case 90: return [bx + Y, by + X];
      case 180: return [bx + w - X, by + Y];
      case 270: return [bx + w - Y, by + h - X];
      default: throw new Error('rotation must be 0, 90, 180 or 270');
    }
  }
  function pdfToUpright(x, y, rotation, box) {
    const u = x - box[0], v = y - box[1], w = box[2] - box[0], h = box[3] - box[1];
    switch (rotation) {
      case 0: return [u, h - v];
      case 90: return [v, u];
      case 180: return [w - u, v];
      case 270: return [h - v, w - u];
      default: throw new Error('rotation must be 0, 90, 180 or 270');
    }
  }
  // A rectangle of the upright page, normalized 0–1, as the part of the *stored* page it covers
  // (normalized 0–1 of the visible box, origin bottom left). Two locations on one PDF page are compared
  // this way, so pages read at different rotations (a head-to-head imposition) are still compared truly.
  function storedRect(r, rotation) {
    const pts = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].map(p => uprightToPDF(p[0], p[1], rotation, [0, 0, 1, 1]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }
  const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

  // ── Images ──────────────────────────────────────────────────────────────
  function imageSize(bytes, mediaType) {
    if (mediaType === 'image/png') {
      const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mediaType === 'image/jpeg') {
      if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) return null;
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xFF) return null;
        const marker = bytes[i + 1];
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
        }
        if (marker === 0xD9 || marker === 0xDA) return null;
        i += 2 + len;
      }
      return null;
    }
    return null;
  }

  // ── Inventory ───────────────────────────────────────────────────────────
  // The hash over a package's file list: one line per file, "<sha256>  <path>\n", sorted by path
  // (by UTF-16 code unit, as JavaScript sorts), then SHA-256 of those lines in UTF-8.
  function inventoryHash(entries, sha256) {
    const lines = entries.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(e => e.sha256 + '  ' + e.path + '\n').join('');
    return sha256(utf8(lines));
  }

  // ── Validation ──────────────────────────────────────────────────────────
  function validate(filesIn, opts) {
    const o = opts || {};
    if (typeof o.sha256 !== 'function') throw new Error('issuepkg.validate needs a sha256 function');
    const IDS = SC.ids, SCHEMA = SC.schema;
    const errors = [], warnings = [];
    const err = (code, file, where, message) => errors.push({ code, file, where: where || '', message });
    const warn = (code, file, where, message) => warnings.push({ code, file, where: where || '', message });
    const done = pkg => ({ ok: errors.length === 0, errors, warnings, pkg: errors.length ? pkg || null : pkg, summary: pkg ? summarize(pkg) : null });
    const unknown = (obj, kind, file, where) => {
      if (!isObj(obj)) return;
      Object.keys(obj).forEach(k => { if (KNOWN[kind].indexOf(k) === -1) warn('unknown-field', file, where, 'Unknown field "' + k + '" (kept as it is; a newer 1.x writer may have added it).'); });
      // origin: data carried over from the package this one was converted from, keyed by that
      // package's file name. Readers keep it and otherwise leave it alone.
      if (obj.origin !== undefined && !(isObj(obj.origin) && Object.keys(obj.origin).every(k => isObj(obj.origin[k])))) err('origin', file, (where ? where + '.' : '') + 'origin', 'origin must be an object of objects, keyed by the file the data came from.');
    };

    // Operating-system leftovers are set aside first (with a warning), so they never decide the layout.
    const clutter = Array.from(filesIn.keys()).filter(isOSFile);
    if (clutter.length) warn('os-file', '', '', 'Skipped ' + clutter.length + ' operating-system file' + (clutter.length === 1 ? '' : 's') + ' (' + clutter.slice(0, 3).join(', ') + (clutter.length > 3 ? ' …' : '') + '); they are not part of the package.');
    // Layout: issue.json at the root, or inside one top-level folder that holds everything.
    let names = Array.from(filesIn.keys()).filter(n => !isOSFile(n));
    try { SC.zipread.checkNames(names); } catch (e) { err(e.code || 'path', e.path || '', '', e.message); return done(null); }
    let root = '';
    if (!filesIn.has('issue.json')) {
      const tops = new Set(names.map(n => n.split('/')[0]));
      const only = tops.size === 1 ? Array.from(tops)[0] : null;
      if (only && names.every(n => n.startsWith(only + '/')) && filesIn.has(only + '/issue.json')) root = only + '/';
      else { err('layout', 'issue.json', '', 'There is no issue.json at the top of the package (or inside a single top-level folder), so this is not an issue package.'); return done(null); }
    }
    const files = new Map();
    names.forEach(n => files.set(n.slice(root.length), filesIn.get(n)));
    names = Array.from(files.keys());

    // issue.json: format and version first; nothing else is read if they are wrong.
    const pi = parseJSON(files.get('issue.json'));
    if (pi.error) { err(pi.code, 'issue.json', '', 'issue.json ' + pi.error + '.'); return done(null); }
    const issue = pi.value;
    if (!isObj(issue)) { err('json', 'issue.json', '', 'issue.json must hold an object.'); return done(null); }
    if (issue.format !== FORMAT) { err('format', 'issue.json', 'format', 'The format is "' + issue.format + '", not "' + FORMAT + '".'); return done(null); }
    const vm = /^(\d+)\.(\d+)$/.exec(isStr(issue.format_version) ? issue.format_version : '');
    if (!vm) { err('version', 'issue.json', 'format_version', 'format_version must look like "1.0"; it is ' + JSON.stringify(issue.format_version) + '.'); return done(null); }
    if (Number(vm[1]) !== 1) { err('version', 'issue.json', 'format_version', 'Version ' + issue.format_version + ' is not understood: this reader knows 1.x.'); return done(null); }
    unknown(issue, 'issue', 'issue.json', '');
    const pkg = { root, issue, text: null, items: null, mentions: null, rights: null, files, _cp: new Map() };

    if (!isStr(issue.package_id) || !KEY_RE.test(issue.package_id)) err('id', 'issue.json', 'package_id', 'package_id must be 1–128 letters, digits, dots, hyphens or underscores.');
    else if (isCatalogShaped(issue.package_id)) err('id', 'issue.json', 'package_id', 'package_id "' + issue.package_id + '" is shaped like a catalog ID; a package-local id must never look like one.');
    if (STATES.indexOf(issue.state) === -1) err('state', 'issue.json', 'state', 'state must be one of ' + STATES.join(', ') + '.');

    // Identity. Its status says which catalog IDs are settled: "resolved" (the default: TitleID and an
    // IssueID), "title-resolved" (a known title, its issue not yet matched) or "unresolved" (neither).
    // Nothing unresolved is ever filled in with a made-up ID; a package-local provisional_key stands in.
    const id = isObj(issue.identity) ? issue.identity : null;
    let titleID = '', activeID = '', idStatus = 'resolved', provisional = null;
    const issueShaped = v => isStr(v) && /^[A-Z0-9]{8}-(\d{4}|\d{3}X|\d{2}XX|XXXX)-[A-Z0-9]{2,16}$/.test(v);
    if (!id) err('id', 'issue.json', 'identity', 'identity is missing.');
    else {
      unknown(id, 'identity', 'issue.json', 'identity');
      if (id.status !== undefined) {
        if (IDENTITY_STATUS.indexOf(id.status) === -1) err('vocabulary', 'issue.json', 'identity.status', 'identity.status must be one of ' + IDENTITY_STATUS.join(', ') + '.');
        else idStatus = id.status;
      }
      const absent = k => id[k] === null || id[k] === undefined;
      // The provisional key: required while anything is unresolved, and never in a resolved package
      // (there it has done its job and lives on in identity_history as a "provisional_key" entry).
      if (idStatus === 'resolved') {
        if (!absent('provisional_key')) err('id', 'issue.json', 'identity.provisional_key', 'A resolved package has no provisional_key; record the retired key in identity_history (kind "provisional_key").');
      } else if (!isStr(id.provisional_key) || !KEY_RE.test(id.provisional_key)) {
        err('id', 'issue.json', 'identity.provisional_key', 'An ' + idStatus + ' package needs a provisional_key: 1–128 letters, digits, dots, hyphens or underscores.');
      } else if (isCatalogShaped(id.provisional_key)) {
        err('id', 'issue.json', 'identity.provisional_key', 'provisional_key "' + id.provisional_key + '" is shaped like a catalog ID. A provisional key must never look like a TitleID, IssueID or ContentID.');
      } else provisional = id.provisional_key;
      // TitleID.
      if (idStatus === 'unresolved') {
        if (!absent('title_id')) err('id', 'issue.json', 'identity.title_id', 'An unresolved package carries no TitleID (title_id must be null): nothing is filled in before the catalog is checked.');
      } else {
        titleID = id.title_id;
        if (!isStr(titleID) || !IDS.RE.titleID.test(titleID)) { err('id', 'issue.json', 'identity.title_id', 'title_id is not a TitleID (TITLECOD-YYYY).'); titleID = ''; }
      }
      // IssueID.
      if (idStatus !== 'resolved') {
        ['issue_id', 'working_issue_id'].forEach(k => { if (!absent(k)) err('id', 'issue.json', 'identity.' + k, 'An ' + idStatus + ' package carries no IssueID (' + k + ' must be null).'); });
      } else {
        ['issue_id', 'working_issue_id'].forEach(k => {
          const v = id[k];
          if (v === null || v === undefined) return;
          if (!issueShaped(v)) err('id', 'issue.json', 'identity.' + k, k + ' "' + v + '" is not an IssueID.');
          else if (titleID && IDS.titleIDFromChild(v) !== titleID) err('wrong-title', 'issue.json', 'identity.' + k, k + ' "' + v + '" belongs to another title than ' + titleID + '.');
          else if (!IDS.RE.issueID.test(v)) warn('id', 'issue.json', 'identity.' + k, k + ' "' + v + '" uses an older IssueID pattern (accepted).');
        });
        if (id.issue_id && id.working_issue_id && id.issue_id !== id.working_issue_id) err('wrong-issue', 'issue.json', 'identity', 'issue_id and working_issue_id differ; once an IssueID is settled, the other belongs in identity_history.');
        activeID = id.issue_id || id.working_issue_id || '';
        if (!activeID) err('id', 'issue.json', 'identity', 'Neither issue_id nor working_issue_id is given.');
      }
      if (id.library_slug !== null && id.library_slug !== undefined && !(isStr(id.library_slug) && IDS.RE.slug.test(id.library_slug))) err('id', 'issue.json', 'identity.library_slug', 'library_slug is not a library slug.');
      // History: typed entries. kind "issue_id" (the default, as in every earlier package) holds an
      // IssueID in "id"; kind "provisional_key" holds a retired provisional key in "key". A provisional
      // key is never put in "id", the IssueID field.
      const hist = id.identity_history === undefined ? [] : id.identity_history;
      if (!Array.isArray(hist)) err('id', 'issue.json', 'identity.identity_history', 'identity_history must be a list.');
      else {
        const seen = new Set(), seenKeys = new Set();
        hist.forEach((h, i) => {
          const w = 'identity.identity_history[' + i + ']';
          if (!isObj(h)) { err('id', 'issue.json', w, 'Each history entry must be an object.'); return; }
          unknown(h, 'history', 'issue.json', w);
          const kind = h.kind === undefined ? 'issue_id' : h.kind;
          if (!HISTORY_STATUS[kind]) { err('vocabulary', 'issue.json', w + '.kind', 'A history entry\'s kind must be issue_id or provisional_key.'); return; }
          if (h.status !== HISTORY_STATUS[kind]) err('vocabulary', 'issue.json', w + '.status', 'A ' + kind + ' history entry\'s status must be "' + HISTORY_STATUS[kind] + '".');
          if (kind === 'issue_id') {
            if (h.key !== undefined) err('history', 'issue.json', w, 'An issue_id history entry has no "key" (provisional keys are entries of kind "provisional_key").');
            if (!isStr(h.id) || !h.id) { err('id', 'issue.json', w, 'An issue_id history entry needs an id.'); return; }
            if (!IDS.RE.issueID.test(h.id) && !issueShaped(h.id)) err('id', 'issue.json', w, h.id + ' is not an IssueID' + (KEY_RE.test(h.id) ? ' (a provisional key belongs in an entry of kind "provisional_key", under "key")' : '') + '.');
            else if (titleID && IDS.titleIDFromChild(h.id) !== titleID) err('wrong-title', 'issue.json', w, h.id + ' belongs to another title than ' + titleID + '.');
            if (h.id === activeID) err('history', 'issue.json', w, 'The superseded ID ' + h.id + ' is also the active IssueID.');
            if (seen.has(h.id)) err('duplicate-id', 'issue.json', w, h.id + ' is listed twice in identity_history.');
            seen.add(h.id);
          } else {
            if (h.id !== undefined) err('history', 'issue.json', w, 'A provisional_key history entry keeps the key in "key", never in "id" (the IssueID field).');
            if (!isStr(h.key) || !KEY_RE.test(h.key)) { err('id', 'issue.json', w, 'A provisional_key history entry needs a key (1–128 letters, digits, dots, hyphens or underscores).'); return; }
            if (isCatalogShaped(h.key)) err('id', 'issue.json', w, 'The retired provisional key "' + h.key + '" is shaped like a catalog ID.');
            if (h.key === provisional) err('history', 'issue.json', w, 'The retired provisional key ' + h.key + ' is also the current provisional_key.');
            if (seenKeys.has(h.key)) err('duplicate-id', 'issue.json', w, h.key + ' is listed twice in identity_history.');
            seenKeys.add(h.key);
          }
        });
        pkg.historyIDs = seen;
      }
    }
    pkg.titleID = titleID; pkg.activeID = activeID; pkg.identityStatus = idStatus; pkg.provisionalKey = provisional;

    // The content map: every package-local item key, with its ContentID once imported.
    const cmap = issue.content_map;
    const mapKeys = new Set();
    if (!isObj(cmap)) err('content-map', 'issue.json', 'content_map', 'content_map must be an object (item key → ContentID or null).');
    else {
      const seenIDs = new Map();
      Object.keys(cmap).forEach(k => {
        mapKeys.add(k);
        if (!KEY_RE.test(k)) err('id', 'issue.json', 'content_map', 'The item key "' + k + '" is not a valid key.');
        const v = cmap[k];
        if (v === null) { if (issue.state === 'installed') err('state', 'issue.json', 'content_map.' + k, 'An installed package needs a ContentID for every item; ' + k + ' has none.'); return; }
        if (!isStr(v) || !IDS.RE.contentID.test(v)) err('id', 'issue.json', 'content_map.' + k, '"' + v + '" is not a ContentID.');
        else if (titleID && IDS.titleIDFromChild(v) !== titleID) err('wrong-title', 'issue.json', 'content_map.' + k, v + ' belongs to another title.');
        if (seenIDs.has(v)) err('duplicate-id', 'issue.json', 'content_map.' + k, v + ' is given to both ' + seenIDs.get(v) + ' and ' + k + '.');
        seenIDs.set(v, k);
      });
    }
    if (issue.state === 'installed' && idStatus !== 'resolved') err('state', 'issue.json', 'state', 'An ' + idStatus + ' package can only be a candidate: it cannot be installed until its catalog identity is resolved.');
    else if (issue.state === 'installed' && !(id && id.issue_id)) err('state', 'issue.json', 'identity.issue_id', 'An installed package needs a settled issue_id.');
    if (idStatus !== 'resolved' && isObj(cmap) && Object.keys(cmap).some(k => cmap[k] !== null)) err('content-map', 'issue.json', 'content_map', 'An ' + idStatus + ' package has no ContentIDs yet: every content_map value must be null.');

    // The file inventory: every file but issue.json, each with its size and SHA-256.
    const inv = Array.isArray(issue.files) ? issue.files : null;
    const listed = new Map();
    if (!inv) err('inventory', 'issue.json', 'files', 'files must list every file in the package.');
    else {
      inv.forEach((f, i) => {
        const w = 'files[' + i + ']';
        if (!isObj(f) || !isStr(f.path)) { err('inventory', 'issue.json', w, 'Each entry needs a path.'); return; }
        unknown(f, 'file', 'issue.json', w);
        if (f.path === 'issue.json') { err('inventory', 'issue.json', w, 'issue.json cannot list itself.'); return; }
        const why = SC.zipread.checkPath(f.path);
        if (why) { err('path', 'issue.json', w, 'Unsafe path "' + f.path + '": ' + why + '.'); return; }
        if (listed.has(f.path)) { err('inventory', 'issue.json', w, f.path + ' is listed twice.'); return; }
        listed.set(f.path, f);
        if (ROLES.indexOf(f.role) === -1) err('role', 'issue.json', w, 'Unknown role "' + f.role + '" for ' + f.path + '.');
        else if (ROLE_FILE[f.role] && f.path !== ROLE_FILE[f.role]) err('role', 'issue.json', w, 'The ' + f.role + ' file must be ' + ROLE_FILE[f.role] + '.');
        else if (f.role === 'source' && !f.path.startsWith('source/')) err('role', 'issue.json', w, 'Source files live under source/.');
        else if (f.role === 'provenance' && !f.path.startsWith('provenance/')) err('role', 'issue.json', w, 'Provenance files live under provenance/.');
        const bytes = files.get(f.path);
        if (!bytes) { err('missing-file', f.path, '', f.path + ' is listed but not in the package.'); return; }
        if (f.bytes !== bytes.length) err('size', f.path, '', f.path + ' is ' + bytes.length + ' bytes, not ' + f.bytes + '.');
        if (!isStr(f.sha256) || !HEX64.test(f.sha256)) err('hash', 'issue.json', w, 'sha256 must be 64 lowercase hex digits.');
        else if (o.sha256(bytes) !== f.sha256) err('hash', f.path, '', f.path + ' does not match its SHA-256 (changed or damaged).');
      });
      names.forEach(n => { if (n !== 'issue.json' && !listed.has(n)) err('unlisted-file', n, '', n + ' is in the package but not in its file list.'); });
      if (!isStr(issue.inventory_sha256) || inventoryHash(inv.filter(f => isObj(f) && isStr(f.path) && isStr(f.sha256)), o.sha256) !== issue.inventory_sha256) {
        err('hash', 'issue.json', 'inventory_sha256', 'inventory_sha256 does not match the file list.');
      }
    }
    const roleOf = p => (listed.get(p) || {}).role;
    if (!listed.has('rights.json')) err('missing-file', 'rights.json', '', 'rights.json is required: publication decisions must be explicit, even when they are all "undecided".');

    // The JSON parts.
    const part = (name, kind) => {
      if (!files.has(name)) return null;
      const r = parseJSON(files.get(name));
      if (r.error) { err(r.code, name, '', name + ' ' + r.error + '.'); return null; }
      if (!isObj(r.value)) { err('json', name, '', name + ' must hold an object.'); return null; }
      const v = r.value.format_version;
      const m = /^(\d+)\.(\d+)$/.exec(isStr(v) ? v : '');
      if (!m || Number(m[1]) !== 1) { err('version', name, 'format_version', name + ': format_version ' + JSON.stringify(v) + ' is not understood (this reader knows 1.x).'); return null; }
      unknown(r.value, kind, name, '');
      return r.value;
    };
    pkg.text = part('text.json', 'text');
    pkg.items = part('items.json', 'items');
    pkg.mentions = part('mentions.json', 'mentions');
    pkg.rights = part('rights.json', 'rights');

    // ── items.json: candidate Contents rows, in the exact 3.0 headers ──
    const itemByKey = new Map();
    const unresolved = Array.from(mapKeys).filter(k => cmap[k] === null);
    if (!files.has('items.json') && unresolved.length) err('missing-file', 'items.json', '', 'items.json is required while any item has no ContentID (' + unresolved.length + ' here): those items exist only as candidate rows.');
    if (pkg.items) {
      const IT = pkg.items, F = 'items.json';
      const headers = SCHEMA.entities.content.headers;
      if (IT.schema !== SCHEMA.VERSION) err('schema', F, 'schema', 'Rows are for schema ' + JSON.stringify(IT.schema) + '; this reader writes ' + SCHEMA.VERSION + '.');
      if (!Array.isArray(IT.headers) || IT.headers.join('\u0000') !== headers.join('\u0000')) err('headers', F, 'headers', 'headers must be exactly the ' + SCHEMA.VERSION + ' Contents headers, in order.');
      if (!Array.isArray(IT.items)) err('items', F, 'items', 'items must be a list.');
      else {
        const seqs = new Map();
        IT.items.forEach((it, i) => {
          const w = 'items[' + i + ']';
          if (!isObj(it) || !isStr(it.key) || !KEY_RE.test(it.key)) { err('id', F, w, 'Each item needs a valid key.'); return; }
          unknown(it, 'item', F, w);
          if (itemByKey.has(it.key)) { err('duplicate-id', F, w, 'The item key ' + it.key + ' is used twice.'); return; }
          itemByKey.set(it.key, it);
          if (!isInt(it.sequence) || it.sequence < 1) err('sequence', F, w, it.key + ': sequence must be a whole number from 1.');
          else if (seqs.has(it.sequence)) err('sequence', F, w, it.key + ' and ' + seqs.get(it.sequence) + ' have the same sequence ' + it.sequence + '.');
          else seqs.set(it.sequence, it.key);
          if (TITLE_ORIGIN.indexOf(it.title_origin) === -1) err('vocabulary', F, w + '.title_origin', it.key + ': title_origin must be ' + TITLE_ORIGIN.join(' or ') + '.');
          if (it.notes !== undefined && !(Array.isArray(it.notes) && it.notes.every(isStr))) err('items', F, w + '.notes', it.key + ': notes must be a list of strings.');
        });
        // Parents: an earlier item of the same issue; never itself; no cycles.
        IT.items.forEach((it, i) => {
          if (!isObj(it) || itemByKey.get(it.key) !== it) return;
          const w = 'items[' + i + '].parent';
          if (it.parent === null || it.parent === undefined) return;
          if (!isStr(it.parent) || !itemByKey.has(it.parent)) { err('parent', F, w, it.key + ': its parent ' + JSON.stringify(it.parent) + ' is not an item in this package.'); return; }
          if (it.parent === it.key) { err('cycle', F, w, it.key + ' is its own parent.'); return; }
          const chain = new Set([it.key]);
          let p = it.parent;
          while (p) { if (chain.has(p)) { err('cycle', F, w, it.key + ': its parents loop back to it (' + Array.from(chain).join(' → ') + ').'); return; } chain.add(p); const pi2 = itemByKey.get(p); p = pi2 ? pi2.parent : null; }
          const par = itemByKey.get(it.parent);
          if (isInt(par.sequence) && isInt(it.sequence) && par.sequence >= it.sequence) err('parent-order', F, w, it.key + ' (sequence ' + it.sequence + ') has a parent that does not come before it (sequence ' + par.sequence + ').');
        });
        // Rows.
        IT.items.forEach((it, i) => {
          if (!isObj(it) || itemByKey.get(it.key) !== it) return;
          const w = 'items[' + i + '].row';
          const row = it.row;
          if (!isObj(row)) { err('row', F, w, it.key + ': row must be an object of Contents values.'); return; }
          const missing = headers.filter(h => !(h in row));
          if (missing.length) err('row', F, w, it.key + ': the row lacks ' + missing.join(', ') + '.');
          const extra = Object.keys(row).filter(h => headers.indexOf(h) === -1);
          if (extra.length) warn('row-extra', F, w, it.key + ': the row has columns the ' + SCHEMA.VERSION + ' schema doesn\'t define (' + extra.join(', ') + '); they would be kept as extra CSV columns.');
          Object.keys(row).forEach(h => { if (!isStr(row[h])) err('row', F, w + '.' + h, it.key + ': "' + h + '" must be text (an empty cell is "").'); });
          const cell = h => isStr(row[h]) ? row[h] : '';
          if (cell('Slaughter Cataloger Tool') !== SCHEMA.entities.content.tool) err('row', F, w, it.key + ': "Slaughter Cataloger Tool" must be "' + SCHEMA.entities.content.tool + '".');
          if (cell('Schema Version') !== SCHEMA.VERSION) err('row', F, w, it.key + ': "Schema Version" must be "' + SCHEMA.VERSION + '".');
          if (titleID && cell('TitleID') !== titleID) err('wrong-title', F, w, it.key + ': TitleID is ' + JSON.stringify(cell('TitleID')) + ', not ' + titleID + '.');
          if (activeID && cell('IssueID') !== activeID) err('wrong-issue', F, w, it.key + ': IssueID is ' + JSON.stringify(cell('IssueID')) + ', not ' + activeID + '.');
          // While the catalog identity is unresolved, the rows say so: the unresolved IDs are empty, never guessed.
          if (pkg.identityStatus === 'unresolved' && cell('TitleID') !== '') err('wrong-title', F, w, it.key + ': TitleID must be empty while the title is unresolved (it is ' + JSON.stringify(cell('TitleID')) + ').');
          if (pkg.identityStatus !== 'resolved' && cell('IssueID') !== '') err('wrong-issue', F, w, it.key + ': IssueID must be empty while the issue is unresolved (it is ' + JSON.stringify(cell('IssueID')) + ').');
          if (pkg.historyIDs && pkg.historyIDs.has(cell('IssueID'))) err('history', F, w, it.key + ': uses the superseded IssueID ' + cell('IssueID') + '.');
          if (id && id.library_slug && cell('Title Library Slug') !== id.library_slug) err('row', F, w, it.key + ': "Title Library Slug" is not ' + id.library_slug + '.');
          if (isInt(it.sequence) && cell('Sequence') !== String(it.sequence)) err('sequence', F, w, it.key + ': "Sequence" is ' + JSON.stringify(cell('Sequence')) + ' but the item\'s sequence is ' + it.sequence + '.');
          const cid = isObj(cmap) ? cmap[it.key] : undefined;
          if (cell('ContentID') !== '' && cell('ContentID') !== cid) err('content-map', F, w, it.key + ': ContentID ' + cell('ContentID') + ' disagrees with content_map.');
          const par = it.parent ? itemByKey.get(it.parent) : null;
          if (par && isObj(par.row)) {
            if (cell('Parent Item') !== (isStr(par.row['Item Title']) ? par.row['Item Title'] : '')) err('parent-text', F, w, it.key + ': "Parent Item" does not match its parent\'s "Item Title" (the 3.0 reader links a parent by that text when no Parent ContentID is set).');
            const pcid = isObj(cmap) ? cmap[it.parent] : null;
            if (cell('Parent ContentID') !== '' && cell('Parent ContentID') !== pcid) err('content-map', F, w, it.key + ': "Parent ContentID" is not its parent\'s ContentID.');
          } else if (!it.parent) {
            if (cell('Parent Item') !== '') err('parent-text', F, w, it.key + ' has "Parent Item" text but no parent key.');
            if (cell('Parent ContentID') !== '') err('parent-text', F, w, it.key + ' has a Parent ContentID but no parent key.');
          }
        });
        const keys = new Set(itemByKey.keys());
        if (isObj(cmap) && (keys.size !== mapKeys.size || Array.from(keys).some(k => !mapKeys.has(k)))) err('content-map', 'issue.json', 'content_map', 'content_map must have exactly the item keys of items.json.');
      }
    }
    const itemKnown = k => isStr(k) && (itemByKey.size ? itemByKey.has(k) : mapKeys.has(k));

    // ── Physical locations (pages, and the cover): which source file, which PDF page, which part ──
    const srcList = Array.isArray(issue.sources) ? issue.sources.filter(x => isObj(x) && isStr(x.path)) : [];
    const srcBy = new Map(srcList.map(x => [x.path, x]));
    const num = v => typeof v === 'number' && isFinite(v);
    // Checks one location; returns where it lies on its PDF page (normalized, in the stored page's own
    // space) or null if it is unusable. code: the error code to report under.
    function checkLocation(L, file, where, code, label) {
      if (!isObj(L)) { err(code, file, where, label + ': a location must be an object.'); return null; }
      unknown(L, 'location', file, where);
      let source = L.source;
      if (source === undefined) {
        if (srcList.length === 1) source = srcList[0].path;
        else { err(code, file, where + '.source', label + ': the location must name its source file (' + (srcList.length ? 'the package has ' + srcList.length + ' sources' : 'and the package lists no sources in issue.json › sources') + ').'); return null; }
      }
      const src = srcBy.get(source);
      if (!src) { err(code, file, where + '.source', label + ': the source ' + JSON.stringify(source) + ' is not in issue.json › sources.'); return null; }
      let ok = true;
      if (!isInt(L.pdf_page) || L.pdf_page < 1) { err(code, file, where + '.pdf_page', label + ': pdf_page must be a whole number from 1.'); ok = false; }
      else if (isInt(src.pages) && L.pdf_page > src.pages) { err(code, file, where + '.pdf_page', label + ': PDF page ' + L.pdf_page + ' does not exist (' + source + ' has ' + src.pages + ' pages).'); ok = false; }
      if (REGIONS.indexOf(L.region) === -1) { err(code, file, where + '.region', label + ': region must be one of ' + REGIONS.join(', ') + '.'); ok = false; }
      if (ROTATIONS.indexOf(L.rotation) === -1) { err(code, file, where + '.rotation', label + ': rotation must be 0, 90, 180 or 270 (degrees clockwise to read upright).'); ok = false; }
      let size = null;
      if (L.size !== undefined) {
        if (!(Array.isArray(L.size) && L.size.length === 2 && L.size.every(n => num(n) && n > 0))) { err(code, file, where + '.size', label + ': size must be [width, height] of the upright page, in points.'); ok = false; }
        else size = L.size;
      }
      let rect = ok ? REGION_RECT[L.region] : null;
      if (L.box !== undefined) {
        const b = L.box;
        if (!(Array.isArray(b) && b.length === 4 && b.every(num) && b[0] >= 0 && b[1] >= 0 && b[0] < b[2] && b[1] < b[3])) { err(code, file, where + '.box', label + ': box must be [x0, y0, x1, y1] with 0 ≤ x0 < x1 and 0 ≤ y0 < y1 (points, upright page, origin top left).'); return null; }
        if (!size) { err(code, file, where + '.box', label + ': a box needs the upright page size ("size": [width, height]) to be measured against.'); return null; }
        const eps = 0.01;
        if (b[2] > size[0] + eps || b[3] > size[1] + eps) { err(code, file, where + '.box', label + ': the box runs outside the page (' + size[0] + ' × ' + size[1] + ' points).'); return null; }
        const nb = [b[0] / size[0], b[1] / size[1], b[2] / size[0], b[3] / size[1]];
        if (rect && (nb[0] < rect[0] - 1e-6 || nb[1] < rect[1] - 1e-6 || nb[2] > rect[2] + 1e-6 || nb[3] > rect[3] + 1e-6)) { err(code, file, where + '.box', label + ': the box lies outside its region "' + L.region + '".'); return null; }
        rect = nb;
      }
      if (!ok) return null;
      return { source, pdf_page: L.pdf_page, rotation: L.rotation, phys: storedRect(rect, L.rotation), stored: size ? uprightSize(L.rotation, size[0], size[1]) : null };
    }

    // ── text.json: pages, segments, unassigned spans ──
    const pageBy = new Map();
    const placed = [];                 // every page location, with where it lies
    let pagesWithLocations = 0;
    if (pkg.text) {
      const T = pkg.text, F = 'text.json';
      if (T.offset_unit !== 'codepoint') err('offset-unit', F, 'offset_unit', 'offset_unit must be "codepoint" (offsets count Unicode code points, not bytes or UTF-16 units).');
      if (T.apparatus !== undefined && T.apparatus !== null && !isStr(T.apparatus)) err('text', F, 'apparatus', 'apparatus must be text or null.');
      if (isStr(T.apparatus) && T.apparatus.indexOf('\r') !== -1) err('text', F, 'apparatus', 'apparatus contains a carriage return; line breaks are \\n only.');
      if (!Array.isArray(T.pages) || !T.pages.length) err('page', F, 'pages', 'pages must list at least one page.');
      else T.pages.forEach((pg, i) => {
        const w = 'pages[' + i + ']';
        if (!isObj(pg)) { err('page', F, w, 'Each page must be an object.'); return; }
        unknown(pg, 'page', F, w);
        if (pg.page !== i + 1) err('page', F, w + '.page', 'Pages must be numbered 1, 2, 3 … in reading order; entry ' + (i + 1) + ' says ' + JSON.stringify(pg.page) + '.');
        if (!isStr(pg.text)) { err('text', F, w + '.text', 'Page ' + (i + 1) + ': text must be a string.'); return; }
        if (pg.text.indexOf('\r') !== -1) err('text', F, w + '.text', 'Page ' + (i + 1) + ': the text contains a carriage return; line breaks are \\n only (offsets would differ between systems).');
        const len = cpLength(pg.text);
        if (pg.length !== len) err('length', F, w + '.length', 'Page ' + (i + 1) + ': length is ' + JSON.stringify(pg.length) + ' but the text has ' + len + ' code points.');
        if (!isStr(pg.sha256) || o.sha256(utf8(pg.text)) !== pg.sha256) err('hash', F, w + '.sha256', 'Page ' + (i + 1) + ': the text does not match its SHA-256.');
        if (FOLIO_STATUS.indexOf(pg.folio_status) === -1) err('vocabulary', F, w + '.folio_status', 'Page ' + (i + 1) + ': folio_status must be ' + FOLIO_STATUS.join(', ') + '.');
        else if (pg.folio_status === 'printed' ? !(isStr(pg.folio) && pg.folio) : pg.folio !== null) err('page', F, w + '.folio', 'Page ' + (i + 1) + ': a printed folio needs folio text; absent, illegible or unverified needs folio null (a number used to cite the page goes in inferred_folio).');
        if (pg.inferred_folio !== undefined && pg.inferred_folio !== null && !isStr(pg.inferred_folio)) err('page', F, w + '.inferred_folio', 'Page ' + (i + 1) + ': inferred_folio must be text or null.');
        if (pg.segmented !== undefined && typeof pg.segmented !== 'boolean') err('page', F, w + '.segmented', 'Page ' + (i + 1) + ': segmented must be true or false.');
        if (pg.page === i + 1) pageBy.set(i + 1, pg);
        // Where the page is in the source. Without locations, logical page N is PDF page N of the only
        // source, whole and unrotated: what every package meant before locations existed.
        let pdfPages = [i + 1];
        if (pg.locations !== undefined) {
          pagesWithLocations++;
          if (!Array.isArray(pg.locations) || !pg.locations.length) err('location', F, w + '.locations', 'Page ' + (i + 1) + ': locations must be a list of at least one location.');
          else {
            pdfPages = [];
            pg.locations.forEach((L, j) => {
              const r = checkLocation(L, F, w + '.locations[' + j + ']', 'location', 'Page ' + (i + 1));
              if (r) { placed.push(Object.assign({ page: i + 1, j }, r)); pdfPages.push(r.pdf_page); }
              else if (isObj(L) && isInt(L.pdf_page)) pdfPages.push(L.pdf_page);
            });
          }
        }
        const scan = scanMarkup(pg.text);
        // PDF_PAGE anchors name the PDF page the text that follows comes from: one of this page's PDF pages, each at most once.
        const seenPDF = new Set();
        scan.anchors.forEach(a => {
          if (pdfPages.indexOf(a.page) === -1) err('anchor', F, w + '.text', 'Page ' + (i + 1) + ' has an anchor for PDF page ' + a.page + ' (at code point ' + a.offset + '), but its text is on PDF page ' + pdfPages.join(', ') + '.');
          else if (seenPDF.has(a.page)) err('anchor', F, w + '.text', 'Page ' + (i + 1) + ' has two anchors for PDF page ' + a.page + '.');
          seenPDF.add(a.page);
        });
        // LOGICAL_PAGE anchors enclose this page: its own number, one START, then one END.
        const starts = scan.logical.filter(a => a.edge === 'start'), ends = scan.logical.filter(a => a.edge === 'end');
        scan.logical.forEach(a => { if (a.page !== i + 1) err('anchor', F, w + '.text', 'Page ' + (i + 1) + ' has a LOGICAL_PAGE_' + a.page + '_' + a.edge.toUpperCase() + ' anchor (at code point ' + a.offset + '); a page\'s logical anchors carry its own number.'); });
        if (starts.length > 1 || ends.length > 1) err('anchor', F, w + '.text', 'Page ' + (i + 1) + ' has more than one LOGICAL_PAGE START or END anchor.');
        else if (starts.length !== ends.length) err('anchor', F, w + '.text', 'Page ' + (i + 1) + ' has a LOGICAL_PAGE ' + (starts.length ? 'START' : 'END') + ' anchor without its ' + (starts.length ? 'END' : 'START') + '.');
        else if (starts.length && starts[0].offset > ends[0].offset) err('anchor', F, w + '.text', 'Page ' + (i + 1) + ': its LOGICAL_PAGE END anchor comes before its START anchor.');
        scan.notes.forEach(n => warn('markup', F, w + '.text', 'Page ' + (i + 1) + ', code point ' + n.offset + ': ' + n.message + '.'));
      });
      // Locations are given for every page or for none, and no part of a PDF page belongs to two locations.
      if (pagesWithLocations && Array.isArray(T.pages) && pagesWithLocations !== T.pages.length) err('location', F, 'pages', 'Locations are given for ' + pagesWithLocations + ' of ' + T.pages.length + ' pages: give them for every page or for none.');
      const onPDF = new Map();
      placed.forEach(p => { const k = p.source + '\u0000' + p.pdf_page; if (!onPDF.has(k)) onPDF.set(k, []); onPDF.get(k).push(p); });
      onPDF.forEach(list => {
        for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
          const A = list[a], Bb = list[b];
          const who = (A.page === Bb.page ? 'page ' + A.page + ' (twice)' : 'pages ' + A.page + ' and ' + Bb.page);
          if (overlapArea(A.phys, Bb.phys) > 1e-9) err('location', F, 'pages[' + (Bb.page - 1) + '].locations[' + Bb.j + ']', 'Logical ' + who + ' claim the same part of PDF page ' + A.pdf_page + ' of ' + A.source + '.');
          if (A.stored && Bb.stored && (Math.abs(A.stored[0] - Bb.stored[0]) > 0.5 || Math.abs(A.stored[1] - Bb.stored[1]) > 0.5)) err('location', F, 'pages[' + (Bb.page - 1) + '].locations[' + Bb.j + ']', 'Logical ' + who + ' give different sizes for PDF page ' + A.pdf_page + ' of ' + A.source + ' (once its rotation is undone).');
        }
      });
      srcList.forEach(src => {
        if (!isInt(src.pages) || !placed.some(p => p.source === src.path)) return;
        const unused = [];
        for (let n = 1; n <= src.pages; n++) if (!onPDF.has(src.path + '\u0000' + n)) unused.push(n);
        if (unused.length) warn('location', F, 'pages', 'PDF page' + (unused.length === 1 ? ' ' : 's ') + unused.join(', ') + ' of ' + src.path + ' hold' + (unused.length === 1 ? 's' : '') + ' no logical page (a blank leaf? a page left out?).');
      });
      const ids = new Set();
      const spansOf = new Map();
      const checkSpan = (s, w, kind) => {
        if (!isObj(s)) { err(kind, F, w, 'Each entry must be an object.'); return false; }
        unknown(s, kind === 'segment' ? 'segment' : 'span', F, w);
        if (!isStr(s.id) || !KEY_RE.test(s.id)) { err('id', F, w, 'Each ' + kind + ' needs a valid id.'); return false; }
        if (ids.has(s.id)) { err('duplicate-id', F, w, 'The id ' + s.id + ' is used twice.'); return false; }
        ids.add(s.id);
        const pg = pageBy.get(s.page);
        if (!pg) { err('page', F, w, s.id + ': page ' + JSON.stringify(s.page) + ' does not exist.'); return false; }
        if (!isInt(s.start) || !isInt(s.end) || s.start < 0 || s.end > pg.length || s.start >= s.end) {
          err('offset', F, w, s.id + ': offsets ' + JSON.stringify(s.start) + '–' + JSON.stringify(s.end) + ' are not a non-empty range within page ' + s.page + ' (0–' + pg.length + ' code points).');
          return false;
        }
        if (!spansOf.has(s.page)) spansOf.set(s.page, []);
        spansOf.get(s.page).push(s);
        return true;
      };
      const ordersOf = new Map();
      if (!Array.isArray(T.segments)) err('segment', F, 'segments', 'segments must be a list (it may be empty).');
      else T.segments.forEach((s, i) => {
        const w = 'segments[' + i + ']';
        if (!checkSpan(s, w, 'segment')) return;
        if (!itemKnown(s.item)) err('unknown-item', F, w, s.id + ': the item ' + JSON.stringify(s.item) + ' is not in this package.');
        if (!isInt(s.order) || s.order < 1) err('order', F, w, s.id + ': order must be a whole number from 1 (reading order within its item).');
        else { if (!ordersOf.has(s.item)) ordersOf.set(s.item, []); ordersOf.get(s.item).push(s.order); }
      });
      ordersOf.forEach((list, k) => {
        const sorted = list.slice().sort((a, b) => a - b);
        if (sorted.some((v, i) => v !== i + 1)) err('order', F, 'segments', 'The segments of ' + k + ' must be in reading order 1, 2, 3 … without gaps or repeats (they are ' + sorted.join(', ') + ').');
      });
      if (!Array.isArray(T.unassigned)) err('span', F, 'unassigned', 'unassigned must be a list (it may be empty).');
      else T.unassigned.forEach((s, i) => {
        const w = 'unassigned[' + i + ']';
        if (!checkSpan(s, w, 'span')) return;
        if (!isStr(s.reason) || !s.reason) err('span', F, w, s.id + ': an unassigned span needs a reason.');
      });
      // Coverage: on a segmented page, segments and unassigned spans account for every code point exactly once.
      pageBy.forEach((pg, n) => {
        const list = (spansOf.get(n) || []).slice().sort((a, b) => a.start - b.start || a.end - b.end);
        if (pg.segmented === false) {
          if (list.length) err('coverage', F, 'pages[' + (n - 1) + ']', 'Page ' + n + ' is marked not segmented but has segments or spans.');
          return;
        }
        let at = 0;
        list.forEach(s => {
          if (s.start > at) err('gap', F, 'page ' + n, 'Page ' + n + ': code points ' + at + '–' + s.start + ' belong to no segment or span.');
          else if (s.start < at) err('overlap', F, 'page ' + n, 'Page ' + n + ': ' + s.id + ' starts at ' + s.start + ', inside text already covered up to ' + at + '.');
          at = Math.max(at, s.end);
        });
        if (at < pg.length) err('gap', F, 'page ' + n, 'Page ' + n + ': code points ' + at + '–' + pg.length + ' belong to no segment or span.');
      });
      if (T.notes !== undefined) {
        if (!Array.isArray(T.notes)) err('note', F, 'notes', 'notes must be a list.');
        else T.notes.forEach((nt, i) => {
          const w = 'notes[' + i + ']';
          if (!isObj(nt) || !isStr(nt.note)) { err('note', F, w, 'Each note needs note text.'); return; }
          unknown(nt, 'note', F, w);
          if (nt.page !== undefined && nt.page !== null && !pageBy.has(nt.page)) err('page', F, w, 'A note refers to page ' + JSON.stringify(nt.page) + ', which does not exist.');
          if (nt.item !== undefined && nt.item !== null && !itemKnown(nt.item)) err('unknown-item', F, w, 'A note refers to the item ' + JSON.stringify(nt.item) + ', which is not in this package.');
        });
      }
    }
    const pageOK = n => pkg.text ? pageBy.has(n) : (isInt(n) && n >= 1);

    // ── mentions.json: the private index, kept apart from credited names ──
    if (pkg.mentions) {
      const M = pkg.mentions, F = 'mentions.json';
      const ids = new Set();
      const checkAnchors = (m, w) => {
        if (m.anchors === undefined) return;
        if (!Array.isArray(m.anchors)) { err('anchor', F, w + '.anchors', 'anchors must be a list.'); return; }
        m.anchors.forEach((a, j) => {
          const aw = w + '.anchors[' + j + ']';
          unknown(a, 'anchor', F, aw);
          const pg = pageBy.get(a && a.page);
          if (!pg) { err('page', F, aw, 'An anchor refers to a page that does not exist.'); return; }
          if (!isInt(a.start) || !isInt(a.end) || a.start < 0 || a.end > pg.length || a.start >= a.end) { err('offset', F, aw, 'An anchor\'s offsets are not a non-empty range within page ' + a.page + '.'); return; }
          if (['exact', 'exact-derived', 'paragraph'].indexOf(a.precision) === -1) { err('vocabulary', F, aw + '.precision', 'An anchor\'s precision must be exact, exact-derived or paragraph.'); return; }
          // An exact anchor points at the words as printed. A derived one was found by searching for
          // them, so it must match exactly; one supplied by the ingestion process may differ (a
          // word broken across lines), which is worth a look but not a refusal.
          if (isStr(m.form) && a.precision !== 'paragraph') {
            const at = cpSlice(pg.text, a.start, a.end);
            if (at !== m.form) (a.precision === 'exact-derived' ? err : warn)('anchor', F, aw, m.id + ': the text at this ' + a.precision + ' anchor is not the form "' + m.form + '".');
          }
          if (isStr(m.item) && pkg.text && Array.isArray(pkg.text.segments)) {
            const inside = pkg.text.segments.some(s => s.item === m.item && s.page === a.page && s.start <= a.start && a.end <= s.end);
            if (!inside) warn('anchor', F, aw, m.id + ': this anchor is not inside the text of its item ' + m.item + '.');
          }
        });
      };
      [['entities', 'entity'], ['subjects', 'subject']].forEach(([list, kind]) => {
        if (M[list] === undefined) return;
        if (!Array.isArray(M[list])) { err('mention', F, list, list + ' must be a list.'); return; }
        M[list].forEach((m, i) => {
          const w = list + '[' + i + ']';
          if (!isObj(m) || !isStr(m.id) || !KEY_RE.test(m.id)) { err('id', F, w, 'Each entry needs a valid id.'); return; }
          unknown(m, kind, F, w);
          if (ids.has(m.id)) err('duplicate-id', F, w, 'The id ' + m.id + ' is used twice.');
          ids.add(m.id);
          if (kind === 'entity' && !(isStr(m.form) && m.form)) err('mention', F, w, m.id + ': form (the name as printed) is required.');
          if (kind === 'entity' && m.type !== undefined && !(isStr(m.type) && m.type)) err('mention', F, w, m.id + ': type must be text (the producer\'s own vocabulary).');
          if (kind === 'subject' && !(isStr(m.term) && m.term)) err('mention', F, w, m.id + ': term is required.');
          if (m.item !== null && m.item !== undefined && !itemKnown(m.item)) err('unknown-item', F, w, m.id + ': the item ' + JSON.stringify(m.item) + ' is not in this package.');
          if (m.pages !== undefined && !(Array.isArray(m.pages) && m.pages.every(pageOK))) err('page', F, w, m.id + ': pages must list pages of this issue.');
          if (PRECISION.indexOf(m.precision) === -1) err('vocabulary', F, w + '.precision', m.id + ': precision must be one of ' + PRECISION.join(', ') + '.');
          else if (m.precision === 'item' && !m.item) err('mention', F, w, m.id + ': precision "item" needs an item.');
          else if (m.precision === 'page' && !(Array.isArray(m.pages) && m.pages.length)) err('mention', F, w, m.id + ': precision "page" needs pages.');
          else if (['exact', 'exact-derived', 'paragraph'].indexOf(m.precision) !== -1 && !(Array.isArray(m.anchors) && m.anchors.length)) err('mention', F, w, m.id + ': precision "' + m.precision + '" needs anchors with offsets.');
          checkAnchors(m, w);
        });
      });
    }

    // ── rights.json: rights status and publication decisions (deny by default) ──
    if (pkg.rights) {
      const R = pkg.rights, F = 'rights.json';
      const rs = R.rights_status;
      if (!isObj(rs) || RIGHTS_STATUS.indexOf(rs.value) === -1) err('rights', F, 'rights_status', 'rights_status.value must be one of ' + RIGHTS_STATUS.join(', ') + '.');
      else unknown(rs, 'rightsStatus', F, 'rights_status');
      const ids = new Set(), pairs = new Map();
      const attributable = d => isStr(d.by) && d.by.trim() && isStr(d.at) && DATE_RE.test(d.at);
      if (!Array.isArray(R.decisions)) err('rights', F, 'decisions', 'decisions must be a list (it may be empty: then everything is undecided, which means denied).');
      else R.decisions.forEach((d, i) => {
        const w = 'decisions[' + i + ']';
        if (!isObj(d) || !isStr(d.id) || !KEY_RE.test(d.id)) { err('id', F, w, 'Each decision needs a valid id.'); return; }
        unknown(d, 'decision', F, w);
        if (ids.has(d.id)) err('duplicate-id', F, w, 'The id ' + d.id + ' is used twice.');
        ids.add(d.id);
        const r = d.resource;
        if (!isObj(r) || RESOURCES.indexOf(r.kind) === -1) { err('rights', F, w + '.resource', d.id + ': resource.kind must be one of ' + RESOURCES.join(', ') + '.'); return; }
        unknown(r, 'resource', F, w + '.resource');
        if (r.item !== undefined && r.item !== null) {
          if (['metadata', 'item_text', 'mentions'].indexOf(r.kind) === -1) err('rights', F, w + '.resource', d.id + ': a ' + r.kind + ' decision cannot name an item.');
          else if (!itemKnown(r.item)) err('unknown-item', F, w + '.resource', d.id + ': the item ' + JSON.stringify(r.item) + ' is not in this package.');
        }
        if (r.page !== undefined && r.page !== null) {
          if (r.kind !== 'page_text') err('rights', F, w + '.resource', d.id + ': only a page_text decision can name a page.');
          else if (!pageOK(r.page)) err('page', F, w + '.resource', d.id + ': page ' + JSON.stringify(r.page) + ' does not exist.');
        }
        if (PURPOSES.indexOf(d.purpose) === -1) err('rights', F, w + '.purpose', d.id + ': purpose must be one of ' + PURPOSES.join(', ') + '.');
        if (DECISIONS.indexOf(d.value) === -1) err('rights', F, w + '.value', d.id + ': value must be undecided, deny or allow.');
        if (d.value === 'allow' && !(attributable(d) && isStr(d.basis) && d.basis.trim())) err('rights', F, w, d.id + ': an "allow" must say who decided (by), when (at, a date) and on what basis.');
        if (d.at !== undefined && d.at !== null && !(isStr(d.at) && DATE_RE.test(d.at))) err('rights', F, w + '.at', d.id + ': at must be a date (YYYY-MM-DD, optionally with a time).');
        const pair = JSON.stringify([r.kind, r.item || null, r.page || null, d.purpose]);
        if (pairs.has(pair)) err('rights', F, w, d.id + ' and ' + pairs.get(pair) + ' decide the same resource for the same purpose; keep one.');
        pairs.set(pair, d.id);
      });
      if (R.withheld !== undefined) {
        if (!Array.isArray(R.withheld)) err('rights', F, 'withheld', 'withheld must be a list.');
        else R.withheld.forEach((s, i) => {
          const w = 'withheld[' + i + ']';
          if (!isObj(s) || !isStr(s.id) || !KEY_RE.test(s.id)) { err('id', F, w, 'Each withheld span needs a valid id.'); return; }
          unknown(s, 'withheld', F, w);
          if (ids.has(s.id)) err('duplicate-id', F, w, 'The id ' + s.id + ' is used twice.');
          ids.add(s.id);
          const pg = pageBy.get(s.page);
          if (!pg) { err('page', F, w, s.id + ': page ' + JSON.stringify(s.page) + ' does not exist (withheld spans need text.json).'); return; }
          if (!isInt(s.start) || !isInt(s.end) || s.start < 0 || s.end > pg.length || s.start >= s.end) err('offset', F, w, s.id + ': offsets are not a non-empty range within page ' + s.page + '.');
          if (!isStr(s.reason) || !s.reason.trim()) err('rights', F, w, s.id + ': a withheld span needs a reason.');
          if (!attributable(s)) err('rights', F, w, s.id + ': a withheld span must say who (by) and when (at).');
        });
      }
    }

    // ── Cover and source files ──
    if (issue.cover !== undefined && issue.cover !== null) {
      const c = issue.cover, w = 'cover';
      if (!isObj(c) || !isStr(c.path)) err('cover', 'issue.json', w, 'cover must give the cover file\'s path.');
      else {
        unknown(c, 'cover', 'issue.json', w);
        if (roleOf(c.path) !== 'cover') err('cover', 'issue.json', w, c.path + ' is not listed with the role "cover".');
        if (MEDIA[c.media_type] !== 'cover') err('cover', 'issue.json', w + '.media_type', 'The cover must be image/jpeg or image/png.');
        else if (files.has(c.path)) {
          const dim = imageSize(files.get(c.path), c.media_type);
          if (!dim) err('cover', c.path, '', c.path + ' is not a readable ' + c.media_type + ' file.');
          else if (dim.width !== c.width || dim.height !== c.height) err('cover', 'issue.json', w, 'The cover is ' + dim.width + '×' + dim.height + ', not ' + c.width + '×' + c.height + ' as stated.');
        }
        if (c.source_page !== undefined && c.source_page !== null && !pageOK(c.source_page)) err('page', 'issue.json', w + '.source_page', 'The cover\'s source page ' + JSON.stringify(c.source_page) + ' does not exist.');
        // Where the cover was cut from, in the same terms as a page location.
        if (c.location !== undefined) {
          const r = checkLocation(c.location, 'issue.json', w + '.location', 'cover', 'The cover');
          const sp = pageBy.get(c.source_page);
          if (r && sp && Array.isArray(sp.locations) && !sp.locations.some(L => isObj(L) && L.pdf_page === r.pdf_page && (L.source === undefined || L.source === r.source))) {
            warn('cover', 'issue.json', w + '.location', 'The cover is cut from PDF page ' + r.pdf_page + ', but its source page ' + c.source_page + ' is not on that PDF page.');
          }
        }
      }
    }
    listed.forEach((f, p) => {
      if (f.role === 'cover' && !(isObj(issue.cover) && issue.cover.path === p)) err('cover', 'issue.json', 'files', p + ' has the role "cover" but is not issue.cover.');
    });
    if (issue.sources !== undefined) {
      if (!Array.isArray(issue.sources)) err('source', 'issue.json', 'sources', 'sources must be a list.');
      else issue.sources.forEach((s, i) => {
        const w = 'sources[' + i + ']';
        if (!isObj(s) || !isStr(s.path)) { err('source', 'issue.json', w, 'Each source needs a path.'); return; }
        unknown(s, 'source', 'issue.json', w);
        if (roleOf(s.path) !== 'source') err('source', 'issue.json', w, s.path + ' is not listed with the role "source".');
        if (s.media_type === 'application/pdf' && files.has(s.path)) {
          const b = files.get(s.path);
          if (!(b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D)) err('source', s.path, '', s.path + ' is not a PDF file.');
        }
        // Without locations a logical page is a PDF page, so the counts should agree; with locations
        // they need not (two logical pages to a sheet), and unused PDF pages are reported instead.
        if (s.pages !== undefined && s.pages !== null && pkg.text && Array.isArray(pkg.text.pages) && !pagesWithLocations && s.pages !== pkg.text.pages.length) warn('source', 'issue.json', w, s.path + ' has ' + s.pages + ' pages; the transcription has ' + pkg.text.pages.length + ' (and gives no locations).');
      });
    }
    listed.forEach((f, p) => {
      if (f.role === 'source' && !(Array.isArray(issue.sources) && issue.sources.some(s => isObj(s) && s.path === p))) err('source', 'issue.json', 'files', p + ' has the role "source" but is not in issue.sources.');
    });

    // ── Review: questions the producer left open (an importer shows them as blockers) ──
    if (issue.review !== undefined) {
      if (!Array.isArray(issue.review)) err('review', 'issue.json', 'review', 'review must be a list.');
      else {
        const seen = new Set();
        issue.review.forEach((q, i) => {
          const w = 'review[' + i + ']';
          if (!isObj(q) || !isStr(q.id) || !KEY_RE.test(q.id)) { err('id', 'issue.json', w, 'Each review entry needs a valid id.'); return; }
          unknown(q, 'review', 'issue.json', w);
          if (seen.has(q.id)) err('duplicate-id', 'issue.json', w, 'The review id ' + q.id + ' is used twice.');
          seen.add(q.id);
          if (REVIEW_STATUS.indexOf(q.status) === -1) err('vocabulary', 'issue.json', w + '.status', q.id + ': status must be one of ' + REVIEW_STATUS.join(', ') + '.');
          if (!(Array.isArray(q.blocks) && q.blocks.every(b => isStr(b) && b))) err('review', 'issue.json', w + '.blocks', q.id + ': blocks must be a list of the steps it holds up (it may be empty).');
          ['label', 'summary'].forEach(k => { if (q[k] !== undefined && !isStr(q[k])) err('review', 'issue.json', w + '.' + k, q.id + ': ' + k + ' must be text.'); });
        });
      }
    }

    // ── Provenance: where the package came from, and every original file kept ──
    if (issue.provenance !== undefined) {
      const pv = issue.provenance, w = 'provenance';
      if (!isObj(pv)) err('provenance', 'issue.json', w, 'provenance must be an object.');
      else {
        unknown(pv, 'provenance', 'issue.json', w);
        if (pv.report !== undefined && roleOf(pv.report) !== 'provenance') err('provenance', 'issue.json', w + '.report', 'The conversion report ' + JSON.stringify(pv.report) + ' is not a listed provenance file.');
        if (pv.files !== undefined) {
          if (!Array.isArray(pv.files)) err('provenance', 'issue.json', w + '.files', 'provenance.files must be a list.');
          else {
            const seen = new Set();
            pv.files.forEach((f, i) => {
              const fw = w + '.files[' + i + ']';
              if (!isObj(f) || !isStr(f.path) || SC.zipread.checkPath(f.path)) { err('provenance', 'issue.json', fw, 'Each original file needs a safe path.'); return; }
              unknown(f, 'provFile', 'issue.json', fw);
              if (seen.has(f.path)) err('provenance', 'issue.json', fw, f.path + ' is listed twice.');
              seen.add(f.path);
              if (!isInt(f.bytes) || !isStr(f.sha256) || !HEX64.test(f.sha256)) { err('provenance', 'issue.json', fw, f.path + ': bytes and sha256 are required.'); return; }
              const k = listed.get(f.kept_as);
              if (!k) { err('provenance', 'issue.json', fw, f.path + ' is said to be kept as ' + JSON.stringify(f.kept_as) + ', which is not a file of this package.'); return; }
              if (k.sha256 !== f.sha256 || k.bytes !== f.bytes) err('provenance', 'issue.json', fw, f.path + ' is not kept byte for byte: ' + f.kept_as + ' differs from the original\'s size or SHA-256.');
              ['re_expressed_in', 'mapped_into'].forEach(x => { if (f[x] !== undefined && NATIVE_FILES.indexOf(f[x]) === -1) err('provenance', 'issue.json', fw + '.' + x, f.path + ': ' + x + ' must name one of ' + NATIVE_FILES.join(', ') + '.'); });
            });
          }
        }
      }
    }
    if (id && id.designation !== undefined && id.designation !== null && !isStr(id.designation)) err('id', 'issue.json', 'identity.designation', 'designation must be text or null.');

    return done(pkg);
  }

  function summarize(pkg) {
    const T = pkg.text, I = pkg.items, M = pkg.mentions;
    const items = I && Array.isArray(I.items) ? I.items : [];
    return {
      title_id: pkg.titleID || null, issue_id: pkg.activeID || null, identity_status: pkg.identityStatus, provisional_key: pkg.provisionalKey, state: pkg.issue.state,
      pages: T && Array.isArray(T.pages) ? T.pages.length : 0,
      items: items.length || (isObj(pkg.issue.content_map) ? Object.keys(pkg.issue.content_map).length : 0),
      parent_links: items.filter(it => isObj(it) && it.parent).length,
      segments: T && Array.isArray(T.segments) ? T.segments.length : 0,
      unassigned: T && Array.isArray(T.unassigned) ? T.unassigned.length : 0,
      entities: M && Array.isArray(M.entities) ? M.entities.length : 0,
      subjects: M && Array.isArray(M.subjects) ? M.subjects.length : 0,
      files: Array.isArray(pkg.issue.files) ? pkg.issue.files.length + 1 : 0
    };
  }

  // ── Reading the text back ───────────────────────────────────────────────
  function pageIndex(pkg, n) {
    if (!pkg._cp) pkg._cp = new Map();
    if (!pkg._cp.has(n)) pkg._cp.set(n, cpIndex(pkg.text.pages[n - 1].text));
    return pkg._cp.get(n);
  }
  function spanText(pkg, s) { return pkg.text.pages[s.page - 1].text.slice(pageIndex(pkg, s.page)[s.start], pageIndex(pkg, s.page)[s.end]); }
  function segmentText(pkg, id) {
    const s = pkg.text.segments.find(x => x.id === id) || pkg.text.unassigned.find(x => x.id === id);
    if (!s) throw new Error('No segment or span ' + id);
    return spanText(pkg, s);
  }
  // An item's text, part by part in reading order; parts on different pages are continuations.
  function itemParts(pkg, key) {
    return pkg.text.segments.filter(s => s.item === key).sort((a, b) => a.order - b.order)
      .map(s => ({ id: s.id, page: s.page, start: s.start, end: s.end, text: spanText(pkg, s) }));
  }
  const itemText = (pkg, key) => itemParts(pkg, key).map(p => p.text).join('');
  // The whole issue as one text: the apparatus, then every page in order.
  const transcription = pkg => (pkg.text.apparatus || '') + pkg.text.pages.map(p => p.text).join('');

  SC.issuepkg = Object.freeze({
    FORMAT, VERSION, ROLES, FOLIO_STATUS, TITLE_ORIGIN, PRECISION, RIGHTS_STATUS, RESOURCES, PURPOSES, DECISIONS, REVIEW_STATUS, KNOWN,
    IDENTITY_STATUS, REGIONS, ROTATIONS, REGION_RECT, isCatalogShaped, uprightSize, uprightToPDF, pdfToUpright, storedRect,
    validate, parseJSON, serialize, inventoryHash, scanMarkup, imageSize, isOSFile,
    cpIndex, cpLength, cpSlice, isWellFormed,
    segmentText, spanText, itemParts, itemText, transcription
  });
})(globalThis.SC = globalThis.SC || {});
