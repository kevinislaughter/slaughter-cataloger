/* Slaughter Cataloger 3 — the invented booklet package (sample-data/issue-package/booklet/), written by
   tools/make-issue-fixture.js. Everything in it is made up.

   One eight-page leaflet printed as a folded booklet and scanned as four two-up spreads, so its PDF
   order is not its reading order:
       PDF page 1: logical 8 | 1      PDF page 2: logical 2 | 7
       PDF page 3: logical 6 | 3      PDF page 4: logical 4 | 5   (the centre spread)
   Each PDF page is stored portrait (720 × 1080 points) with /Rotate 90, so it reads as a landscape
   spread (1080 × 720) and "left" and "right" are only meaningful once it is turned upright.
   It also has: every folio status (printed, absent, illegible, unverified, with inferred numbers);
   locations by region alone and by region plus an exact box; LOGICAL_PAGE START/END anchors on every
   page and a PDF_PAGE anchor on page 7 (which sits on PDF page 2); pages 1–4 divided into segments and
   pages 5–8 not yet; an article running across two PDF pages (2 → 3) and one across the centre spread
   (4 → 5); an escaped printed bracket; a catalog identity that is unresolved (no TitleID or IssueID,
   a provisional key, and a retired provisional key in the history); a cover cut from the right half
   of PDF page 1. It validates with no errors and no warnings.

   makeBooklet({ cover, sha256 }) → Map(path → Buffer) */
'use strict';
const io = require('./package-io');
const SC = io.SC, P = SC.issuepkg;

const PDF_NAME = 'specimen-leaflet.pdf';
const SIZE = [1080, 720];                 // the upright spread, in points
const IMPOSITION = [[8, 1], [2, 7], [6, 3], [4, 5]];   // PDF page n holds [left, right]

// The source: four portrait pages with /Rotate 90, each with a label on either half, written so that
// they read upright once the page is turned (text runs up the stored page).
function makeBookletPDF() {
  const objs = [];
  const n = IMPOSITION.length;
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [' + IMPOSITION.map((_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  IMPOSITION.forEach(([l, r]) => {
    // Upright (X, Y) → stored user space (Y, X) for /Rotate 90 (docs/ISSUE-PACKAGE.md §5.3).
    const label = (X, Y, s) => 'BT /F1 18 Tf 0 1 -1 0 ' + Y + ' ' + X + ' Tm (' + s + ') Tj ET';
    const stream = label(100, 120, 'Specimen leaflet, logical page ' + l) + ' ' + label(640, 120, 'Specimen leaflet, logical page ' + r);
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 1080] /Rotate 90 /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (objs.length + 2) + ' 0 R >>');
    objs.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

// Where each logical page is.
function locationOf(page) {
  const pdf = IMPOSITION.findIndex(pr => pr.indexOf(page) !== -1) + 1;
  const side = IMPOSITION[pdf - 1][0] === page ? 'left' : 'right';
  const loc = { pdf_page: pdf, region: side, rotation: 90 };
  if (page === 1) loc.source = 'source/' + PDF_NAME;
  if (page === 1 || page === 8 || page === 4 || page === 5) {        // some with an exact box, some by region alone
    loc.size = SIZE.slice();
    loc.box = side === 'left' ? [0, 0, 540, 720] : [540, 0, 1080, 720];
  }
  return [loc];
}

const KEY = n => 'leaflet-item-' + String(n).padStart(3, '0');
// [sequence, title, credit, type, parent, start, end, origin]
const ITEMS = [
  [1, 'Welcome', 'The Editors', 'editorial', 0, '1', '', 'printed'],
  [2, 'A Walk to the Lighthouse', 'Jane Doe', 'article', 0, '2', '3', 'printed'],
  [3, 'Notes and Queries', '', 'department', 0, '4', '', 'printed'],
  [4, 'A Query about Bells', 'Richard Roe', 'query', 3, '4', '', 'printed'],
  [5, 'Across the Centre', 'John Q. Public', 'article', 0, '4', '5', 'printed'],
  [6, 'Evening', 'A. N. Other', 'poem', 0, '6', '', 'printed'],
  [7, '[Letters]', '', 'letters', 0, '7', '', 'supplied'],
  [8, 'Back-Page Notices', '', 'notice', 0, '8', '', 'printed']
];

// Page texts, as blocks (item number, or 0 for a span that belongs to no item). Pages 5–8 are not
// divided yet (segmented: false), so their blocks are only joined.
const A = (n, edge) => '<!-- LOGICAL_PAGE_' + n + '_' + edge + ' -->\n';
const PAGES = [
  { folio: null, status: 'absent', inferred: '1', segmented: true, blocks: [
    [0, A(1, 'START') + '[supplied: The right half of the first spread: the front page. A masthead across the top.]\n\n# THE PLACEHOLDER LEAFLET\n\n*No. 3 — Spring*\n\n'],
    [1, '### WELCOME\n\nThis leaflet is folded from one sheet. Its pages are printed out of order and read in order once folded. — THE EDITORS.\n\n'],
    [0, A(1, 'END')]
  ] },
  { folio: '2', status: 'printed', inferred: null, segmented: true, blocks: [
    [0, A(2, 'START')],
    [2, '### A WALK TO THE LIGHTHOUSE\n\nThe path leaves the harbour wall and climbs past the old rope works. \\[Note: printed in the source, in brackets.\\] From the top the lighthouse is in view.\n\n*(continued on page 3)*\n\n'],
    [0, '2\n' + A(2, 'END')]
  ] },
  { folio: '3', status: 'printed', inferred: null, segmented: true, blocks: [
    [0, A(3, 'START')],
    [2, '### THE LIGHTHOUSE (continued from page 2)\n\nThe keeper shows visitors the lamp room on fine afternoons. — JANE DOE.\n\n'],
    [0, '3\n' + A(3, 'END')]
  ] },
  { folio: null, status: 'illegible', inferred: '4', segmented: true, blocks: [
    [0, A(4, 'START')],
    [3, '### NOTES AND QUERIES\n\n'],
    [4, '#### A Query about Bells\n\nWhen were the church bells last recast? — R. R.\n\n'],
    [5, '### ACROSS THE CENTRE\n\nThis article begins on the left half of the centre spread'],
    [0, ' [illegible]\n' + A(4, 'END')]
  ] },
  { folio: null, status: 'unverified', inferred: '5', segmented: false, blocks: [
    [0, A(5, 'START') + 'and ends on its right half, on the same sheet of paper. — JOHN Q. PUBLIC.\n\n' + A(5, 'END')]
  ] },
  { folio: null, status: 'unverified', inferred: '6', segmented: false, blocks: [
    [0, A(6, 'START') + '### EVENING\n\nThe lamps come on along the quay,\nThe boats come in from sea.\n\n— A. N. OTHER\n\n[supplied: A small engraving of a moored boat.]\n\n' + A(6, 'END')]
  ] },
  { folio: null, status: 'unverified', inferred: '7', segmented: false, blocks: [
    [0, A(7, 'START') + '<!-- PDF_PAGE: 2 -->\nSir, — The leaflet arrives folded and is a pleasure to unfold. — A READER.\n\n' + A(7, 'END')]
  ] },
  { folio: null, status: 'absent', inferred: '8', segmented: false, blocks: [
    [0, A(8, 'START') + '### NOTICES\n\nSubscriptions: four numbers, post free. Write to Box 9, Anytown.\n\n' + A(8, 'END')]
  ] }
];

function makeBooklet(opts) {
  const sha = opts.sha256 || io.sha256;
  const PDF = makeBookletPDF();
  const pages = [], segments = [], unassigned = [];
  const parts = new Map();
  PAGES.forEach((pg, i) => {
    const n = i + 1;
    let text = '', at = 0, u = 0;
    pg.blocks.forEach(([item, t]) => {
      const start = at, end = at + P.cpLength(t);
      text += t; at = end;
      if (!pg.segmented) return;
      if (item) {
        const k = (parts.get(item) || 0) + 1; parts.set(item, k);
        segments.push({ id: 'p' + String(n).padStart(3, '0') + '-s' + String(item).padStart(3, '0') + '-' + k, item: KEY(item), page: n, start, end, order: k });
      } else unassigned.push({ id: 'p' + String(n).padStart(3, '0') + '-u' + (++u), page: n, start, end, reason: 'page anchors, masthead and page numbers' });
    });
    const p = { page: n, folio: pg.folio, folio_status: pg.status };
    if (pg.inferred) p.inferred_folio = pg.inferred;
    p.locations = locationOf(n);
    p.segmented = pg.segmented;
    p.length = P.cpLength(text); p.sha256 = sha(Buffer.from(text, 'utf8')); p.text = text;
    pages.push(p);
  });
  const headers = SC.schema.entities.content.headers;
  const items = ITEMS.map(([seq, title, credit, type, parent, start, end, origin]) => {
    const spec = [];
    const pgNo = Number(start);
    if (PAGES[pgNo - 1].status !== 'printed') spec.push('Start Page');
    if (origin === 'supplied') spec.unshift('Item Title');
    const na = [];
    if (!credit) na.push('Author / Credit');
    if (!parent) na.push('Parent Item');
    if (!end) na.push('End Page');
    const row = {};
    headers.forEach(h => { row[h] = ''; });
    Object.assign(row, {
      'Slaughter Cataloger Tool': 'Contents', 'Schema Version': '3.0', 'Entry Order': String(seq), 'Issue Reference': 'Placeholder Leaflet No. 3',
      'Sequence': String(seq), 'Item Title': title, 'Author / Credit': credit, 'Content Type': type, 'Parent Item': parent ? ITEMS[parent - 1][1] : '',
      'Start Page': start, 'End Page': end, 'Speculative': spec.length ? 'Yes' : 'No', 'Speculative Fields': spec.join('; '), 'N/A Fields': na.join('; ')
    });
    // TitleID, IssueID, ContentID and Parent ContentID stay empty: the catalog identity is unresolved.
    const it = { key: KEY(seq), sequence: seq, title_origin: origin, row };
    if (parent) it.parent = KEY(parent);
    return it;
  });
  const files = new Map();
  const put = (p, v) => files.set(p, Buffer.isBuffer(v) ? v : Buffer.from(P.serialize(v), 'utf8'));
  put('text.json', { format_version: '1.0', offset_unit: 'codepoint', apparatus: null, pages, segments, unassigned });
  put('items.json', { format_version: '1.0', schema: SC.schema.VERSION, headers: headers.slice(), items });
  put('mentions.json', { format_version: '1.0', entities: [
    { id: 'e001', type: 'place', form: 'harbour wall', item: KEY(2), pages: [2], precision: 'item' },
    { id: 'e002', type: 'person', form: 'JANE DOE', item: KEY(2), pages: [3], precision: 'item' },
    { id: 'e003', type: 'place', form: 'Anytown', item: null, pages: [8], precision: 'page' }
  ], subjects: [{ id: 's001', term: 'Lighthouses', item: KEY(2), pages: [2, 3], precision: 'item' }] });
  put('rights.json', { format_version: '1.0', rights_status: { value: 'undetermined', statement: 'An invented specimen.' }, decisions: [], withheld: [] });
  put('cover.jpg', opts.cover);
  put('source/' + PDF_NAME, PDF);
  const dim = P.imageSize(opts.cover, 'image/jpeg');
  const issue = {
    format: P.FORMAT, format_version: P.VERSION, package_id: 'placeholder-leaflet-no3-specimen', state: 'candidate',
    identity: {
      status: 'unresolved', library_slug: null, title_id: null, issue_id: null, working_issue_id: null,
      provisional_key: 'leaflet-specimen-0003', designation: 'The Placeholder Leaflet, No. 3, Spring',
      identity_history: [{ kind: 'provisional_key', key: 'leaflet-specimen-draft', status: 'retired', note: 'An earlier staging key, replaced when the package was registered again.' }]
    },
    content_map: Object.fromEntries(items.map(it => [it.key, null])),
    cover: { path: 'cover.jpg', media_type: 'image/jpeg', width: dim.width, height: dim.height, source_page: 1,
      location: { source: 'source/' + PDF_NAME, pdf_page: 1, region: 'right', rotation: 90, size: SIZE.slice(), box: [540, 0, 1080, 720] },
      derivation: 'The right half of PDF page 1, turned upright.' },
    sources: [{ path: 'source/' + PDF_NAME, media_type: 'application/pdf', original_name: PDF_NAME, pages: IMPOSITION.length }],
    review: [{ id: 'Q-01', status: 'blocking', label: 'Catalog identity unresolved', summary: 'Match the leaflet against the live catalog, or approve new IDs, before import.', blocks: ['local_import'] }]
  };
  const roleOf = p => p === 'cover.jpg' ? 'cover' : p.startsWith('source/') ? 'source' : p.replace('.json', '');
  issue.files = Array.from(files.keys()).sort().map(p => ({ path: p, role: roleOf(p), bytes: files.get(p).length, sha256: sha(files.get(p)) }));
  issue.inventory_sha256 = P.inventoryHash(issue.files, b => sha(b));
  put('issue.json', issue);
  const v = P.validate(files, { sha256: sha });
  if (!v.ok || v.warnings.length) throw new Error('The booklet fixture does not validate cleanly: ' + v.errors.concat(v.warnings).map(e => '[' + e.code + '] ' + e.message).join(' | '));
  return { files, summary: v.summary };
}

module.exports = { makeBooklet, IMPOSITION, PDF_NAME };
