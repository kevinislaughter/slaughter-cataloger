#!/usr/bin/env node
/* Slaughter Cataloger 3 — write the invented issue-package twin (sample-data/issue-package/).

   node tools/make-issue-fixture.js                 rewrite sample-data/issue-package/staging, native and booklet
   node tools/make-issue-fixture.js --out <folder>  write <folder>/staging, native and booklet instead
                                                    (the folder must not exist; run-tests.sh compares)

   booklet/ is a second, separate invented package, written natively (tools/lib/booklet-fixture.js): a
   leaflet scanned as two-up spreads whose PDF order is not its reading order, with page locations,
   every folio status and an unresolved catalog identity. The two forms below are unchanged by it.

   The twin is one invented eight-page issue of The Example Gazette (vol. IV, no. 1, 1875: an
   issue of the sample library with no contents yet), in two forms:
     staging/  as the ingestion process hands packages over today (the provisional "draft-0.1"
               layout: MANIFEST.json, fulltext.json, transcription.md, candidate rows, deep index…)
     native/   what tools/convert-staging.js makes of it (format slaughter-cataloger-issue 1.0)
   Every name, place and word is made up. The twin has the structural traps that real packages
   have, so the tests can exercise them without any real material:
     - page 1 has no printed folio (its catalog page number is inferred) and page 8 is blank;
     - an article continues from page 2 to page 6, with pages 3–5 in between (not part of it);
     - a department whose children are not next to each other: item 3 has children 4, 6 and 7,
       with item 5 (top level) between them, and its own text comes in three pieces;
     - an item split into four segments by layout material, and one split around an engraving;
     - supplied titles, supplied descriptions, [illegible] and [unclear: …], printed square
       brackets that are not editorial marks, a fenced block, list items, a backslash escape;
     - characters outside the Basic Multilingual Plane (a blackletter masthead in 𝔉𝔯𝔞𝔨𝔱𝔲𝔯) and a
       combining accent, so code-point offsets differ from JavaScript string indexes;
     - a mention index with no offsets; rights all private or under review, nothing approved;
     - a superseded working IssueID in the identity history; an open review queue;
     - a field and a file no converter knows about (both must survive conversion);
     - canary strings in item text, page text, a contact line, a mention, the cover and the
       source PDF, for later leak tests ("canary-…").
   Output is the same bytes on every run. */
'use strict';
const fs = require('fs'), path = require('path');
const io = require('./lib/package-io');
const staging = require('./lib/staging');
const booklet = require('./lib/booklet-fixture');
const SC = io.SC, P = SC.issuepkg;

// ── Identity (an issue of the sample library: EXAGAZEX-1872, volume 4 number 1, 8 pages) ──
const SLUG = 'EXAMPLE-LIBRARY', TITLE = 'EXAGAZEX-1872', ISSUE = 'EXAGAZEX-1872-KRNYWA2';
const SUPERSEDED = 'EXAGAZEX-1872-KQ7RW4M';
const ISSUE_REF = 'Example Gazette V4 I1 N157';
const PKG = 'example-gazette-v4n1-1875-provisional-import-candidate';
const DESIGNATION = 'The Example Gazette, Vol. IV, No. 1, May 1, 1875';
const PREPARED = '2026-10-01';
const PDF_NAME = 'example-gazette-v4n1.pdf';
const ACUTE = '́';   // a combining accent: "Cafe" + U+0301 is five code points, four letters

// ── The items (candidate Contents rows) ──
// [sequence, title, credit, type, parent sequence, start, end, title origin, notes]
const ITEMS = [
  [1, 'To Our Readers', 'The Editor', 'editorial', 0, '1', '2', 'PRINTED', 'Continued on page 2.'],
  [2, 'A Correction', '', 'notice', 0, '1', '', 'PRINTED', ''],
  [3, 'Around the County', '', 'department', 0, '1', '2', 'PRINTED', 'Department; its notes are separate items.'],
  [4, 'Eastfield', 'Jane Doe', 'report', 3, '1', '', 'PRINTED', ''],
  [5, '[A Thought for the Week]', '', 'quotation', 0, '1', '', 'EDITORIAL_SUPPLIED', 'Supplied title.'],
  [6, 'Riverton', 'R. R.', 'report', 3, '2', '', 'PRINTED', ''],
  [7, 'Lakeside', 'A Correspondent', 'report', 3, '2', '', 'PRINTED', ''],
  [8, 'The New Bridge', 'Richard Roe', 'report', 0, '2', '6', 'PRINTED', 'Continued on page 6.'],
  [9, 'The Spring Exhibition', '', 'report', 0, '3', '', 'PRINTED', 'With an engraving.'],
  [10, 'Correspondence', '', 'department', 0, '4', '', 'PRINTED', ''],
  [11, 'A Word for the Old Road', 'A Subscriber', 'letter', 10, '4', '', 'PRINTED', ''],
  [12, '[On Street Lamps]', 'J.Q.P.', 'letter', 10, '4', '', 'EDITORIAL_SUPPLIED', 'Supplied title.'],
  [13, 'Notice of a Meeting', '', 'notice', 0, '5', '', 'PRINTED', ''],
  [14, 'Market Prices', 'Public & Doe', 'report', 0, '5', '', 'PRINTED', ''],
  [15, 'Wants and Offers', '', 'department', 0, '6', '', 'PRINTED', ''],
  [16, '[For Sale: A Velocipede]', '', 'advertisement', 15, '6', '', 'EDITORIAL_SUPPLIED', 'Supplied title.'],
  [17, '[Wanted: A Clerk]', '', 'advertisement', 15, '6', '', 'EDITORIAL_SUPPLIED', 'Supplied title.'],
  [18, 'Subscribe to the Gazette', '', 'form', 0, '7', '', 'PRINTED', '']
];
const KEY = n => 'gazette-v4n1-item-' + String(n).padStart(4, '0');

// ── The pages: each a list of blocks, in reading order. A block belongs to an item (it becomes
//    a segment) or to no item (an unassigned span, with a reason). ──
const S = (item, t, basis) => ({ item, t, basis });
const U = (t, reason) => ({ item: 0, t, reason });
const anchor = (n, folio) => U('<!-- PDF_PAGE: ' + n + ' -->\n## PDF page ' + n + ' — ' + (folio ? 'printed page ' + folio : 'no printed page number') + '\n\n', 'page_anchor_and_layout_apparatus');
const SEP = U('---\n\n', 'formatting_separator');
const PAGES = [
  { folio: null, status: 'NO_PRINTED_FOLIO__CATALOG_PAGE_1_INFERRED', blocks: [
    anchor(1, null),
    U('[supplied: Masthead across the full width; three columns below. Reading order: masthead, left column, middle column, right column.]\n\n', 'supplied_layout_description'),
    U('# 𝔗𝔥𝔢 𝔈𝔵𝔞𝔪𝔭𝔩𝔢 𝔊𝔞𝔷𝔢𝔱𝔱𝔢\n\n*A Weekly Record of Town and Country*\n\nVOL. IV. — NO. 1. — WHOLE NO. 157. — ANYTOWN, SATURDAY, MAY 1, 1875. — PRICE TEN CENTS.\n\n', 'masthead_and_page_apparatus'),
    S(1, '### TO OUR READERS\n\nWith this number the *Gazette* enters upon its fourth volume, and upon a new plan: it will appear once a fortnight instead of once a week, in eight pages instead of four. Our motto, 𝔉𝔦𝔡𝔢𝔩𝔦𝔱𝔞𝔰, stands where it stood.\n\nWe thank the many readers who wrote to us during the winter. Their letters are printed, as space allows, on page 4.\n\n*(continued on page 2)*\n\n', 'editorial opening; continuation on page 2 explicit'),
    S(2, '### A CORRECTION\n\nIn our last number the meeting of the Improvement Society was given as Tuesday. It is to be held on Thursday, at the Town Hall, at eight o’clock.\n\n', 'unsigned notice, heading and body'),
    SEP,
    S(3, '### AROUND THE COUNTY\n\nNotes from our correspondents in the townships. Contributions should reach the office by the Monday before publication.\n\n', 'department heading and lead-in, without its children'),
    S(4, '#### Eastfield\n\nThe Reading Circle met on the 20th at the schoolhouse. Officers were chosen for the year, and the library committee reported forty-two volumes on the shelves. — JANE DOE.\n\n', 'child report with printed signature'),
    S(3, '*(Around the County continued on page 2.)*\n\n', 'department continuation cue'),
    SEP,
    S(5, '“Let every man be swift to hear.”\n\n— *From an old almanac.*\n\n', 'standalone quotation with printed attribution; title supplied')
  ] },
  { folio: '2', status: 'PRINTED_FOLIO_CONFIRMED', blocks: [
    anchor(2, '2'),
    U('THE EXAMPLE GAZETTE. 2\n\n', 'running_head'),
    S(1, '### TO OUR READERS (continued from page 1)\n\nThe new plan will allow room for longer reports from the townships, and for the market prices, which many have asked for. The subscription remains two dollars a year. — THE EDITOR.\n\n', 'editorial continuation and printed signature'),
    S(3, '### AROUND THE COUNTY (continued)\n\n', 'department continuation heading, not a new item'),
    S(6, '#### Riverton\n\nThe ferry resumed its crossings on the 12th, the river having fallen. A new landing is talked of. — R. R.\n\n', 'child report with printed initials'),
    S(7, '#### Lakeside\n\nThe ice went out of the lake on April 9, nine days later than last year. — A CORRESPONDENT.\n\n', 'child report with printed signature'),
    SEP,
    S(8, '### THE NEW BRIDGE\n\nThe county commissioners met on Wednesday to open the bids for the iron bridge over the Mill River. Four bids were received, the lowest from a firm in Springfield.\n\n*(continued on page 6)*\n\n', 'report opening; continuation on page 6 explicit')
  ] },
  { folio: '3', status: 'PRINTED_FOLIO_CONFIRMED', blocks: [
    anchor(3, '3'),
    U('THE EXAMPLE GAZETTE. 3\n\n', 'running_head'),
    S(9, '### THE SPRING EXHIBITION\n\nThe exhibition of the Anytown Improvement Society opened on Thursday in the Town Hall, and will remain open through Saturday.\n\n', 'report heading and opening'),
    U('[supplied: An engraving of the Town Hall, about a third of the column wide, with its caption below. canary-page-text-02]\n\n', 'supplied_visual_description'),
    S(9, '*The Town Hall, from Main Street.* A notice on the door reads [illegible].\n\nThe prize for the best garden plan went to Mrs. Jane Doe of Eastfield; the judges also commended a model of the new bridge. [unclear: Admission] ten cents.\n\n', 'printed caption and the report after the engraving')
  ] },
  { folio: '4', status: 'PRINTED_FOLIO_CONFIRMED', blocks: [
    anchor(4, '4'),
    U('4 THE EXAMPLE GAZETTE.\n\n', 'running_head'),
    S(10, '### CORRESPONDENCE\n\n*The Gazette is not responsible for the opinions of its correspondents.*\n\n', 'department heading and policy line only'),
    S(11, '#### A Word for the Old Road\n\nSir, — I have travelled the old road to Riverton for thirty years and see no need of a new one. Mend the old one, and spare us the \\*improvements\\*.\n\n[Communicated.]\n\n— A SUBSCRIBER.\n\n', 'letter with printed bracketed note and signature'),
    S(12, 'Sir, — When are we to have lamps on Elm Street? The darkness there is a public danger. — J.Q.P.\n\n', 'untitled letter; title supplied')
  ] },
  { folio: '5', status: 'PRINTED_FOLIO_CONFIRMED', blocks: [
    anchor(5, '5'),
    U('THE EXAMPLE GAZETTE. 5\n\n', 'running_head'),
    S(13, '### NOTICE OF A MEETING\n\nThe Anytown Improvement Society will meet on Thursday, May 13, at eight o’clock, at the Cafe' + ACUTE + ' Anytown, Main Street. Members and friends are invited. Particulars from the secretary, Mrs. Jane Doe, 12 Elm Street, Anytown; telephone 555-0142. canary-contact-03\n\n', 'notice heading, body and contact line'),
    SEP,
    S(14, '### MARKET PRICES\n\n*Corrected weekly by Public & Doe.*\n\n```text\nWheat, per bushel ....... $1.10\nOats, per bushel ........  0.45\nButter, per pound .......  0.28\nEggs, per dozen .........  0.18\n```\n\n', 'price table kept as a fenced block')
  ] },
  { folio: '6', status: 'PRINTED_FOLIO_CONFIRMED', blocks: [
    anchor(6, '6'),
    U('THE EXAMPLE GAZETTE. 6\n\n', 'running_head'),
    S(15, '### WANTS AND OFFERS\n\n*Notices of ten words or fewer are printed free for subscribers.*\n\n', 'department heading and policy line only'),
    S(16, '- FOR SALE. A velocipede, little used. Apply at this office.\n', 'advertisement 1'),
    S(17, '- WANTED. A clerk who writes a good hand. Address Box 47, Anytown.\n\n', 'advertisement 2'),
    SEP,
    S(8, '### THE NEW BRIDGE (continued from page 2)\n\nIt is understood that the commissioners favour an iron bridge of two spans, with a footway on the upstream side. canary-item-text-01\n\n— RICHARD ROE.\n\n', 'report continuation and printed signature')
  ] },
  { folio: '7', status: 'PRINTED_FOLIO_CONFIRMED', blocks: [
    anchor(7, '7'),
    U('THE EXAMPLE GAZETTE. 7\n\n', 'running_head'),
    S(18, '### SUBSCRIBE TO THE GAZETTE\n\n', 'form heading'),
    SEP,
    S(18, 'One year, two dollars. Six months, one dollar.\n\n', 'form rates'),
    SEP,
    S(18, 'Name: ______________________\n\nTown: ______________________\n\n', 'form fields'),
    SEP,
    S(18, 'Send to: THE EXAMPLE GAZETTE, Box 1, Anytown.\n\n', 'form address')
  ] },
  { folio: null, status: 'NO_PRINTED_FOLIO__BLANK_SHOW_THROUGH', blocks: [
    U('<!-- PDF_PAGE: 8 -->\n## PDF page 8 — no printed page number\n\n[supplied: A blank page. Faint show-through from page 7 is visible; there is no printed text.]\n', 'BLANK_PAGE__EDITORIAL_DESCRIPTION_ONLY')
  ] }
];

const APPARATUS = '# Transcription — ' + DESIGNATION + '\n\n## Transcription apparatus (not source text)\n\n' +
  'Source: `source/' + PDF_NAME + '` (an invented specimen). Each page begins with a page anchor; headings of the form “PDF page N” and text in [supplied: …] are editorial, not source text.\n\n';

// ── Assemble pages, segments and spans (offsets in code points) ──
const cp = s => P.cpLength(s);
const lineAt = (text, cpOffset) => P.cpSlice(text, 0, cpOffset).split('\n').length;
const pages = [], segsOf = new Map(), unassignedOf = new Map();
PAGES.forEach((pg, i) => {
  const n = i + 1;
  let text = '', at = 0, u = 0;
  const parts = new Map();
  pg.blocks.forEach(b => {
    const start = at, end = at + cp(b.t);
    text += b.t; at = end;
    if (b.item) {
      if (!segsOf.has(b.item)) segsOf.set(b.item, []);
      parts.set(b.item, (parts.get(b.item) || 0) + 1);
      segsOf.get(b.item).push({ page: n, start, end, t: b.t, basis: b.basis });
    } else {
      if (!unassignedOf.has(n)) unassignedOf.set(n, []);
      unassignedOf.get(n).push({ id: 'p' + String(n).padStart(3, '0') + '-u' + String(++u).padStart(2, '0'), page: n, start, end, t: b.t, reason: b.reason });
    }
  });
  pages.push({ n, folio: pg.folio, status: pg.status, text });
});
// Segment ids: page, item sequence, and the part number within the item.
segsOf.forEach((list, item) => list.forEach((s, k) => { s.id = 'p' + String(s.page).padStart(3, '0') + '-s' + String(item).padStart(4, '0') + '-' + String(k + 1).padStart(2, '0'); }));
const transcription = APPARATUS + pages.map(p => p.text).join('');
const enc = s => Buffer.from(s, 'utf8');
const sha = b => io.sha256(typeof b === 'string' ? enc(b) : b);
const TR_SHA = sha(transcription);
const json = v => JSON.stringify(v, null, 2) + '\n';

// ── The source PDF: eight blank specimen pages (built by hand, so it is the same bytes every run) ──
function makePDF(n) {
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ');
  objs.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < n; i++) {
    const stream = 'BT /F1 14 Tf 72 720 Td (Specimen page ' + (i + 1) + ' of an invented issue) Tj ET' + (i === 0 ? ' BT /F1 8 Tf 72 60 Td (canary-source-06) Tj ET' : '');
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + i * 2) + ' 0 R >>');
    objs.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  }
  let out = '%PDF-1.4\n', offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
// The cover: a small grey specimen (a band for the masthead, ruled columns, a block for the
// engraving), with "canary-cover-05" in a JPEG comment segment.
const COVER = Buffer.from('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', 'base64');
const PDF = makePDF(8);

// ── Candidate rows ──
const itemBySeq = new Map(ITEMS.map(r => [r[0], r]));
const headers = SC.schema.entities.content.headers;
const rowOf = r => {
  const [seq, title, credit, type, parent, start, end, , notes] = r;
  const specFields = [];
  if (start === '1') specFields.push('Start Page');
  if (r[7] !== 'PRINTED') specFields.unshift('Item Title');
  const na = [];
  if (!credit) na.push('Author / Credit');
  if (!parent) na.push('Parent Item');
  if (!end) na.push('End Page');
  return {
    'Slaughter Cataloger Tool': 'Contents', 'Schema Version': '3.0', 'Title Library Slug': SLUG, 'TitleID': TITLE, 'Entry Order': String(seq),
    'ContentID': null, 'IssueID': ISSUE, 'Issue Reference': ISSUE_REF, 'Sequence': String(seq), 'Item Title': title, 'Author / Credit': credit,
    'Content Type': type, 'Parent Item': parent ? itemBySeq.get(parent)[1] : '', 'Parent ContentID': null, 'Start Page': start, 'End Page': end,
    'Notes': notes, 'Speculative': specFields.length ? 'Yes' : 'No', 'Speculative Fields': specFields.join('; '), 'N/A Fields': na.join('; ')
  };
};
const pagesOfItem = seq => Array.from(new Set(segsOf.get(seq).map(s => s.page)));
const candidateFile = 'candidate_contents_seq001-018.provisional.json';
const crosswalkFile = 'content_id_relationship_crosswalk_seq001-018.csv';
const candidates = {
  file_kind: 'PROVISIONAL_CANDIDATE_CONTENTS_ROWS__NOT_CANONICAL',
  contract_status: 'PROVISIONAL_STAGING_ONLY',
  package_id: 'example-gazette-v4n1-1875-candidates-s001-s018',
  target_schema: 'Slaughter Cataloger 3.0 Contents (headers from schema.js)',
  scope: { only_source_sequences: ITEMS.map(r => r[0]), other_sequences_excluded_from_this_checkpoint: false },
  working_identity: { title_id: TITLE, issue_id: ISSUE, issue_id_status: 'working identity; live catalog reconciliation pending' },
  permanent_content_ids: 'NULL pending importer review',
  cataloger_3_0_header_order: headers.slice(),
  candidate_records: ITEMS.map(r => {
    const row = rowOf(r);
    const legacy = Object.assign({}, row); delete legacy.ContentID; delete legacy['Parent ContentID'];
    if (r[0] === 8) legacy.Notes = '';            // an older value, different from today's
    return {
      local_item_key: KEY(r[0]), parent_local_item_key: r[4] ? KEY(r[4]) : null, source_sequence: r[0],
      source_pdf_pages: pagesOfItem(r[0]), source_printed_start_page_uncertain: r[5] === '1',
      item_title_origin: r[7], content_id_resolution_status: 'PENDING_IMPORTER_CATALOG_RECONCILIATION',
      parent_content_id_resolution_status: r[4] ? 'PENDING_PARENT_RECONCILIATION' : 'NOT_APPLICABLE_NO_PARENT',
      cataloger_3_0_fields: row, legacy_source_fields: legacy
    };
  })
};
const csvCell = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
const crosswalk = [['local_item_key', 'source_sequence', 'source_entry_order', 'working_issue_id', 'item_title_as_recorded', 'parent_item_as_recorded', 'parent_local_item_key', 'content_id', 'parent_content_id', 'content_id_status', 'parent_content_id_status', 'item_title_origin', 'source_pdf_pages', 'start_page_uncertain']]
  .concat(ITEMS.map(r => [KEY(r[0]), String(r[0]), String(r[0]), ISSUE, r[1], r[4] ? itemBySeq.get(r[4])[1] : '', r[4] ? KEY(r[4]) : '', '', '', 'PENDING_IMPORTER_CATALOG_RECONCILIATION',
    r[4] ? 'PENDING_PARENT_RECONCILIATION' : 'NOT_APPLICABLE_NO_PARENT', r[7], pagesOfItem(r[0]).join(';'), r[5] === '1' ? 'true' : 'false']))
  .map(r => r.map(csvCell).join(',')).join('\n') + '\n';

// ── The full-text file ──
const segJSON = (seq, s) => ({
  segment_id: s.id, local_item_key: KEY(seq), source_sequence: seq, source_page: s.page, printed_page: pages[s.page - 1].folio,
  page_char_start: s.start, page_char_end: s.end, page_line_start: lineAt(pages[s.page - 1].text, s.start), page_line_end: lineAt(pages[s.page - 1].text, s.end - 1),
  text: s.t, boundary_basis: s.basis, source_transcription_sha256: TR_SHA, text_status: 'COPIED_EXACTLY_FROM_REVIEWED_TRANSCRIPTION'
});
const fulltext = {
  file_kind: 'PROVISIONAL_PRIVATE_FULLTEXT_SIDECAR_PAGES001-008',
  sidecar_spec_version: 'draft-0.1',
  contract_status: 'PROPOSED_NOT_IMPLEMENTED_OR_APPROVED',
  package_id: 'example-gazette-v4n1-1875-sidecar-p001-p008',
  issue_id: null, working_issue_id: ISSUE, title_id: TITLE,
  contents_crosswalk_package_id: 'example-gazette-v4n1-1875-crosswalk-s001-s018',
  source_transcription_file: 'transcription.md',
  transcription_apparatus: APPARATUS,
  source_transcription_sha256: TR_SHA,
  source_scope: { segmented_pdf_pages: pages.map(p => p.n), unprocessed_pdf_pages: [], known_partial_items: [], source_page_8_interpretation: 'Blank page; its whole text block is kept as unassigned apparatus.', pagination_span_warning: 'Sequence 8 has segments on pages 2 and 6. Nothing from pages 3–5 belongs to it.' },
  rights: { access: 'PRIVATE', rights_status: 'UNDETERMINED', public_release_authorized: false },
  page_text_authority: 'REVIEWED_TRANSCRIPTION__EXACT_SLICES',
  producer_extension: { note: 'A field no converter knows about. It must survive conversion unchanged.', values: [1, 'two', null, true] },
  pages: pages.map(p => ({
    source_page: p.n, printed_page: p.folio, printed_page_status: p.status, text: p.text, review_status: 'REVIEWED_ONCE',
    page_char_length: cp(p.text), page_text_sha256: sha(p.text), original_source_anchor: '<!-- PDF_PAGE: ' + p.n + ' -->',
    ...(p.n === 8 ? { source_content_status: 'NO_LEGIBLE_PRINTED_TEXT__SUPPLIED_DESCRIPTION_RETAINED' } : {})
  })),
  items: ITEMS.map(r => {
    const seq = r[0], segs = segsOf.get(seq);
    const it = {
      local_item_key: KEY(seq), source_sequence: seq, content_id: null, parent_local_item_key: r[4] ? KEY(r[4]) : null,
      source_pages: pagesOfItem(seq), historical_contents_source_pdf_pages: seq === 8 ? [2, 3, 4, 5, 6] : pagesOfItem(seq),
      item_title_from_existing_crosswalk: r[1],
      text: segs.length === 1 ? segs[0].t : null,
      segments: segs.map(s => segJSON(seq, s)),
      segmentation_status: 'SEGMENTED_FROM_REVIEWED_TEXT',
      text_field_policy: segs.length === 1 ? 'VERBATIM_SINGLE_SEGMENT' : 'NULL_MULTIPLE_SEGMENTS__USE_SEGMENTS_ARRAY',
      item_complete_within_pilot: true,
      editorial_notes: r[7] !== 'PRINTED' ? ['Title supplied by the cataloger; not printed.'] : [],
      uncertainty: { cataloger_speculative_fields: rowOf(r)['Speculative Fields'], title_origin: r[7], page_one_printed_folio_unknown: r[5] === '1', boundaries_review_required: seq === 3 },
      provenance: { crosswalk_local_key: KEY(seq), source_transcription_member: 'transcription.md', source_transcription_sha256: TR_SHA }
    };
    if (seq === 8) it.continuation_resolution = { earlier_segment_id: segs[0].id, continuation_segment_id: segs[1].id, intervening_pages_not_item_text: [3, 4, 5] };
    return it;
  }),
  unassigned_page_spans: Array.from(unassignedOf.keys()).sort((a, b) => a - b).map(n => ({
    source_page: n,
    spans: unassignedOf.get(n).map(s => ({ unassigned_span_id: s.id, source_page: n, page_char_start: s.start, page_char_end: s.end, text: s.t, reason: s.reason }))
  })),
  boundary_notes: [
    { issue: 'B01', source_page: 1, source_sequence: 3, status: 'HIERARCHICAL_TEXT_BOUNDARY', note: 'The department’s own text is in three pieces; its children’s notes are separate items and are not repeated in it.' },
    { issue: 'B02', source_page: 6, source_sequence: 8, status: 'SEPARATE_CONTINUATION_SEGMENTED', note: 'The report continues on page 6; pages 3–5 are not part of it.' },
    { issue: 'B03', source_page: 8, source_sequence: null, status: 'RETAINED_BLANK_PAGE', note: 'Page 8 is blank and is kept as unassigned apparatus.' }
  ]
};
const mapping = {
  file_kind: 'ITEM_TO_PAGE_MAPPING_PAGES001-008',
  package_id: fulltext.package_id,
  source_pages_processed: pages.map(p => p.n),
  mapped_items: ITEMS.map(r => ({
    local_item_key: KEY(r[0]), source_sequence: r[0], parent_local_item_key: r[4] ? KEY(r[4]) : null, pdf_pages: pagesOfItem(r[0]),
    segment_ids: segsOf.get(r[0]).map(s => s.id), segment_page_char_ranges: segsOf.get(r[0]).map(s => ({ source_page: s.page, page_char_start: s.start, page_char_end: s.end })),
    item_complete_within_pilot: true, segmentation_status: 'SEGMENTED_FROM_REVIEWED_TEXT'
  })),
  unassigned_page_spans: Array.from(unassignedOf.keys()).sort((a, b) => a - b).map(n => ({ source_page: n, span_count: unassignedOf.get(n).length, span_ids: unassignedOf.get(n).map(s => s.id) })),
  not_segmented_contents_sequences: []
};

// ── The deep index: mentions without offsets ──
const E = (type, form, seq, pages_, context) => ({ type, source_form: form, normalized_form: null, pages: pages_, content_item_sequence: seq, context, status: 'Verified', evidence_note: 'Read from the transcription.', external_evidence: [] });
const deepIndex = {
  schema_version: '1.0', title_library_slug: SLUG, title_id: TITLE, issue_id: ISSUE, source_sha256: sha(PDF),
  entities: [
    E('periodical', 'Gazette', 1, [1], 'the paper names itself'),
    E('person', 'THE EDITOR', 1, [2], 'signature'),
    E('organization', 'Improvement Society', 2, [1], 'meeting date corrected'),
    E('place', 'Town Hall', 2, [1], 'meeting place'),
    E('place', 'Eastfield', 4, [1], 'department heading'),
    E('organization', 'Reading Circle', 4, [1], 'meeting reported'),
    E('person', 'JANE DOE', 4, [1], 'signature'),
    E('place', 'Riverton', 6, [2], 'department heading'),
    E('place', 'Lakeside', 7, [2], 'department heading'),
    E('place', 'Mill River', 8, [2], 'site of the bridge'),
    E('place', 'Springfield', 8, [2], 'home of the lowest bidder'),
    E('person', 'RICHARD ROE', 8, [6], 'signature; canary-mention-04'),
    E('organization', 'Anytown Improvement Society', 9, [3], 'organizer of the exhibition'),
    E('person', 'Mrs. Jane Doe', 9, [3], 'prize winner'),
    E('place', 'Riverton', 11, [4], 'the old road'),
    E('place', 'Elm Street', 12, [4], 'street without lamps'),
    E('person', 'J.Q.P.', 12, [4], 'signature'),
    E('person', 'Mrs. Jane Doe', 13, [5], 'secretary'),
    E('place', 'Cafe' + ACUTE + ' Anytown', 13, [5], 'meeting place'),
    E('organization', 'Public & Doe', 14, [5], 'prices corrected by'),
    E('place', 'Anytown', null, [1, 5, 6, 7], 'place of publication and of several notices')
  ],
  subjects: [
    { term: 'Bridges', pages: [2, 6], content_item_sequence: 8, status: 'Verified', note: 'The bids for a new bridge.' },
    { term: 'Street lighting', pages: [4], content_item_sequence: 12, status: 'Verified', note: 'A request for lamps.' },
    { term: 'Exhibitions', pages: [3], content_item_sequence: 9, status: 'Verified', note: 'The spring exhibition.' },
    { term: 'Prices', pages: [5], content_item_sequence: 14, status: 'Verified', note: 'Weekly market prices.' },
    { term: 'Local news', pages: [1, 2], content_item_sequence: null, status: 'Verified', note: 'Issue-level subject.' }
  ],
  research_log: []
};

// ── Rights and review (nothing is approved) ──
const rightsFile = {
  file_kind: 'PROVISIONAL_PRIVATE_ASSET_RIGHTS_POLICY__NOT_PUBLIC_AUTHORIZATION',
  rights_assessment: 'UNKNOWN_OR_UNDETERMINED; this is not a copyright determination',
  access_defaults: {
    bibliographic_metadata: { status: 'PRIVATE_STAGING', public_release_authorized: false },
    fulltext: { status: 'PRIVATE', public_release_authorized: false, includes: ['fulltext.json', 'transcription.md', 'item_to_page_mapping.json'] },
    cover: { status: 'REVIEW_REQUIRED', public_release_authorized: false, file: 'cover.jpg' },
    deep_index: { status: 'PRIVATE', public_release_authorized: false, file: 'private_index/deep_index.json' },
    source_pdf: { status: 'PRIVATE', public_release_authorized: false, file: 'source/' + PDF_NAME }
  },
  export_policy: 'No public outputs authorized.',
  approvals: { catalog_merge: false, local_import: false, public_release: false, fulltext_public_release: false, cover_public_release: false, index_public_release: false }
};
const Q = (id, label, need, status, category, blocked) => ({
  label, issue_or_decision_required: need, status, category,
  blocked_workflows: Object.assign({ metadata_conversion: false, local_import: false, full_text_preparation: false, public_release: false, private_archival_storage: false }, blocked),
  responsible_party: 'importer', conservative_treatment: 'Leave unresolved in staging.', notes: [], existing_identifier: id
});
const reviewQueue = {
  file_kind: 'PROVISIONAL_REVIEW_QUEUE', queue_spec_version: 'draft-0.1', package_id: PKG, issue_designation: DESIGNATION,
  title_id: TITLE, issue_id: null, working_issue_id: ISSUE, created_at: PREPARED, status: 'NEEDS_REVIEW',
  issues: [
    Q('Q-01', 'Permanent ContentIDs absent by design', 'Give each of the 18 items a ContentID after comparing with the live catalog.', 'blocking', 'expected_importer_identifier_resolution', { local_import: true }),
    Q('Q-02', 'Live catalog not checked', 'Confirm the TitleID and IssueID against the live catalog files.', 'blocking', 'identity_reconciliation', { local_import: true, metadata_conversion: true }),
    Q('Q-03', 'Publication rights undetermined', 'Decide publication per resource before any public output.', 'deferred', 'rights_publication_gate', { public_release: true })
  ],
  summary: { open: 3, blocking_local_import: 2 }
};

// ── The rest of the staging package ──
const qa = { file_kind: 'QA_FULLTEXT_PAGES001-008', checks: [{ check: 'every page character covered exactly once', result: 'PASS' }, { check: 'every segment equals its page slice', result: 'PASS' }], result: 'PASS' };
const notesMD = '# Segmentation notes, pages 1–8\n\n- The department on page 1 is split around its children; its own text is in three pieces.\n- The report on page 2 continues on page 6.\n- Page 8 is blank.\n';
const handoff = '# Hand-off report (invented specimen)\n\nThis staging package is an invented twin used to test the converter. Nothing in it describes a real publication.\n';
const unknownFile = 'A file the manifest does not name. The converter must keep it, byte for byte.\n';
const files = new Map();
const put = (p, v) => files.set(p, Buffer.isBuffer(v) ? v : enc(typeof v === 'string' ? v : json(v)));
put('fulltext.json', fulltext);
put('transcription.md', transcription);
put('item_to_page_mapping.json', mapping);
put(candidateFile, candidates);
put(crosswalkFile, crosswalk);
put('private_index/deep_index.json', deepIndex);
put('RIGHTS_AND_ACCESS.json', rightsFile);
put('REVIEW_QUEUE.json', reviewQueue);
put('cover.jpg', COVER);
put('source/' + PDF_NAME, PDF);
put('validation/QA_FULLTEXT_PAGES001-008.json', qa);
put('evidence/segmentation/SEGMENTATION_NOTES.md', notesMD);
put('evidence/extra/UNREFERENCED.txt', unknownFile);
put('candidate_records.json', {
  file_kind: 'PROVISIONAL_CANDIDATE_INDEX', contract_status: 'PROVISIONAL_STAGING_ONLY', package_id: PKG,
  canonical_title_id_reported: TITLE, working_issue_id: ISSUE, verified_in_live_catalog: false,
  contents_candidates: { file: candidateFile, count: ITEMS.length, permanent_ids: 'NULL' },
  contents_relations: { file: crosswalkFile, parent_links: ITEMS.filter(r => r[4]).length },
  item_and_page_text: { file: 'fulltext.json', mapping_file: 'item_to_page_mapping.json', source_text_file: 'transcription.md', access: 'PRIVATE' },
  deep_index: { file: 'private_index/deep_index.json', entities: deepIndex.entities.length, subjects: deepIndex.subjects.length, access: 'PRIVATE' },
  rights: 'RIGHTS_AND_ACCESS.json', review_queue: 'REVIEW_QUEUE.json'
});
put('HANDOFF_REPORT.md', handoff);
const activeAssets = {};
Array.from(files.keys()).filter(p => p !== 'HANDOFF_REPORT.md').sort().forEach(p => { activeAssets[p] = { sha256: sha(files.get(p)), size_bytes: files.get(p).length }; });
const manifest = {
  file_kind: 'PROVISIONAL_IMPORT_CANDIDATE_MANIFEST__NOT_NATIVE_IMPORT_APPROVAL',
  package_spec_version: 'draft-0.1/provisional-consolidation',
  package_id: PKG, issue_designation: DESIGNATION, prepared_at: PREPARED, state: 'PROVISIONAL_IMPORT_CANDIDATE',
  title_id: TITLE, title_id_evidence_status: 'from the sample library', issue_id: null, working_issue_id: ISSUE,
  working_issue_id_status: 'working identity; live catalog reconciliation pending',
  identity_history: [{ id: SUPERSEDED, status: 'superseded staging-only reference, not active' }],
  content_id_policy: 'All 18 ContentIDs remain NULL for importer reconciliation.',
  source_files: [{ file: 'source/' + PDF_NAME, original_name: PDF_NAME, sha256: sha(PDF), size_bytes: PDF.length, ordered_pdf_pages: 8, provenance: 'invented specimen' }],
  pages: pages.map(p => ({ source_pdf_page: p.n, printed_page: p.folio, review_status: 'REVIEWED_ONCE', transcribed: true, segmented: true, text_sha256: sha(p.text), status_note: p.n === 1 ? 'no printed folio; catalog page 1 inferred' : p.n === 8 ? 'blank page' : 'printed folio' })),
  bibliographic_candidates: { file: candidateFile, count: ITEMS.length, mapping_file: crosswalkFile, parent_links: ITEMS.filter(r => r[4]).length, unresolved_permanent_content_ids: ITEMS.length },
  sidecar: { fulltext: 'fulltext.json', source_transcription: 'transcription.md', item_to_page_mapping: 'item_to_page_mapping.json', pages: 8, linked_contents_items: ITEMS.length, item_segments: Array.from(segsOf.values()).reduce((a, l) => a + l.length, 0), unassigned_spans: Array.from(unassignedOf.values()).reduce((a, l) => a + l.length, 0), access: 'PRIVATE' },
  cover: { file: 'cover.jpg', source_page: 1, sha256: sha(COVER), access: 'REVIEW_REQUIRED', public_release_authorized: false },
  deep_index: { file: 'private_index/deep_index.json', entities: deepIndex.entities.length, subjects: deepIndex.subjects.length, access: 'PRIVATE', public_release_authorized: false },
  rights_file: 'RIGHTS_AND_ACCESS.json',
  review_queue: { file: 'REVIEW_QUEUE.json', open_gates: 3 },
  qa: { fulltext: 'validation/QA_FULLTEXT_PAGES001-008.json' },
  active_assets: activeAssets,
  outstanding_issues: ['Q-01', 'Q-02', 'Q-03'],
  public_release_authorized: false, canonical_catalog_modified: false, permanent_content_ids_assigned: 0
};
put('MANIFEST.json', manifest);
put('CHECKSUMS.sha256', Array.from(files.keys()).sort().map(p => sha(files.get(p)) + '  ' + p).join('\n') + '\n');

// ── Write: the staging twin, and what the converter makes of it ──
const native = staging.convert(files, { sha256: io.sha256, archive: null });
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
if (args.length && !(oi === 0 && args.length === 2)) { console.error('usage: node tools/make-issue-fixture.js [--out <new folder>]'); process.exit(2); }
const base = oi === 0 ? path.resolve(args[1]) : path.join(io.ROOT, 'sample-data', 'issue-package');
if (oi === 0 && fs.existsSync(base)) { console.error(base + ' already exists; give a new folder.'); process.exit(2); }
fs.mkdirSync(base, { recursive: true });
const leaflet = booklet.makeBooklet({ cover: COVER, sha256: io.sha256 });
['staging', 'native', 'booklet'].forEach(d => fs.rmSync(path.join(base, d), { recursive: true, force: true }));
io.writeNewFolder(path.join(base, 'staging'), files);
io.writeNewFolder(path.join(base, 'native'), native.files);
io.writeNewFolder(path.join(base, 'booklet'), leaflet.files);
const s = native.summary;
console.log('wrote ' + path.relative(process.cwd(), base) + '/staging (' + files.size + ' files) and native (' + native.files.size + ' files): ' +
  s.pages + ' pages, ' + s.items + ' items, ' + s.parent_links + ' parent links, ' + s.segments + ' segments, ' + s.unassigned + ' unassigned spans, ' + s.entities + ' entities, ' + s.subjects + ' subjects');
const b = leaflet.summary;
console.log('wrote ' + path.relative(process.cwd(), base) + '/booklet (' + leaflet.files.size + ' files): ' + b.pages + ' logical pages on ' + booklet.IMPOSITION.length + ' PDF pages, ' + b.items + ' items, ' + b.segments + ' segments; identity ' + b.identity_status);
