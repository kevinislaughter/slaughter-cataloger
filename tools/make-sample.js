#!/usr/bin/env node
/* Slaughter Cataloger 3 — writes the sample library (invented titles, invented names).

   usage: node tools/make-sample.js [--out sample-data] [--check]

   Writes <out>/3.0/example-library/ (schema 3.0) and <out>/beta2/example-library/ (the same
   titles in the Beta 2 format, including dated copies for the converter). Everything is made
   up and generated from a fixed seed, so running it again gives the same files. The titles,
   people and places are placeholders ("The Example Gazette", "John Q. Public", "Anytown").

   The five titles are built to exercise what the app and its tests need:
     The Example Gazette        a long run: 11 volumes, weekly → fortnightly → monthly → irregular,
                                supplements and a special issue, inherited and overridden fields,
                                contents for volumes 1–3, many forms of one name (John Q. Public)
     The Placeholder Bulletin   numbered without volumes; 8 numbers missing from the run
     Sample Review              complete: nested contents three levels deep, speculative values
     The Demonstration Quarterly   two issues, fully cataloged, nested contents
     The Specimen Monthly       a title record only (24 issues known)
   --check also converts the Beta 2 copy with tools/convert-to-3.js and compares the result
   with the 3.0 copy record by record. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const { csv: CSV, ids: IDS, schema: S, records: R } = globalThis.SC;

const args = process.argv.slice(2);
const OUT = path.resolve(args.indexOf('--out') !== -1 ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'sample-data'));
const CHECK = args.includes('--check');

// ── Deterministic randomness ────────────────────────────────────────────
let seed = 20261014;
const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = arr => arr[Math.floor(rand() * arr.length)];
const chance = p => rand() < p;
const weighted = list => { const total = list.reduce((n, x) => n + x[1], 0); let r = rand() * total; for (const [v, w] of list) { if ((r -= w) < 0) return v; } return list[list.length - 1][0]; };
const usedIDs = new Set();
const token = () => { let s = ''; for (let i = 0; i < 6; i++) s += IDS.ALPHABET[Math.floor(rand() * IDS.ALPHABET.length)]; return s; };
const newID = (prefix) => { let id; do { id = prefix + token(); } while (usedIDs.has(id)); usedIDs.add(id); return id; };

// ── Calendar ────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

// ── Library and titles ──────────────────────────────────────────────────
const LIB = { slug: 'EXAMPLE-LIBRARY', name: 'Example Library', note: 'Invented titles for trying the app and for its tests.' };
const blankTitle = () => { const r = { spec: [], na: [] }; S.entities.title.fields.forEach(c => { r[c.key] = ''; }); return r; };
const code = t => IDS.suggestTitleCode(t, new Set());
function title(o) {
  const t = Object.assign(blankTitle(), o);
  t.titleCode = code(t.canonicalTitle); t.titleID = t.titleCode + '-' + t.firstYear;
  return t;
}
const TITLES = [
  title({ canonicalTitle: 'The Example Gazette', firstYear: '1872', subtitle: 'A Weekly Record of Town and Country',
    publisher: 'John Q. Public', editors: 'John Q. Public', city: 'Anytown', country: 'United States', language: 'English',
    frequency: 'weekly; fortnightly from volume 4; monthly from volume 9; irregular at the end',
    pubHistory: 'Weekly from May 1872, fortnightly from May 1875, monthly from May 1880. One issue of volume 11 appeared in April 1882, after a pause of four months; no later issue is known.',
    mission: 'To record the affairs of Anytown and the county around it, plainly and without favour.',
    biblioNote: 'An invented title: the sample library of Slaughter Cataloger.',
    catalogingStatus: 'Contents in progress', generalNotes: 'Contents are recorded for volumes 1–3.' }),
  title({ canonicalTitle: 'The Placeholder Bulletin', firstYear: '1961', subtitle: 'Newsletter of the Example Society',
    publisher: 'The Example Society', editors: 'Erika Mustermann', city: 'Springfield', country: 'United States', language: 'English',
    frequency: 'bimonthly, irregular', firstYearNote: 'Inferred from the earliest surviving number.', spec: ['First Year of Publication (CE)'],
    pubHistory: 'Numbered 1–44 without volumes, 1961–1973. Eight numbers are not in the run held.',
    catalogingStatus: 'Contents in progress', knownIssues: '44' }),
  title({ canonicalTitle: 'Sample Review', firstYear: '1990', subtitle: 'A Quarterly of Letters and Reviews',
    publisher: 'Acme Publishing Company', editors: 'Jan Kowalski; Anne De Smet', city: 'Riverton', country: 'United States', language: 'English',
    frequency: 'quarterly', issn: '0000-0000', pubHistory: 'Six volumes of four numbers, 1990–1995.',
    catalogingStatus: 'Contents complete', knownIssues: '24' }),
  title({ canonicalTitle: 'The Demonstration Quarterly', firstYear: '1995', subtitle: 'Notes and Translations',
    publisher: 'A. N. Other', editors: 'A. N. Other', city: 'Lakeside', country: 'United Kingdom', language: 'English',
    frequency: 'irregular', pubHistory: 'Two numbers, 1995 and 1996, despite the title.',
    catalogingStatus: 'Fully cataloged', knownIssues: '2' }),
  title({ canonicalTitle: 'The Specimen Monthly', firstYear: '2011', subtitle: '', publisher: 'Specimen Press', editors: 'Mario Rossi',
    city: 'Oakdale', country: 'United States', language: 'English', frequency: 'monthly', pubHistory: 'Two years of monthly numbers.',
    catalogingStatus: 'Not started', knownIssues: '24', na: ['ISSN'] })
];
const [GAZ, BUL, REV, QUA] = TITLES;

// ── Issues ──────────────────────────────────────────────────────────────
const blankIssue = () => { const r = { spec: [], na: [], overrides: [] }; S.entities.issue.fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; }); return r; };
const issues = [];
function issue(t, o) {
  const i = Object.assign(blankIssue(), { titleID: t.titleID, yearCalendar: 'CE', sizeUnit: 'in' }, o);
  i.issueID = o.issueID || newID(t.titleID + '-K');
  issues.push(i);
  return i;
}
// Override a title-level field for one issue (the 3.0 file lists it in Overridden Fields).
const own = (i, key, v) => { i[key] = v; if (i.overrides.indexOf(key) === -1) i.overrides.push(key); };

// The Example Gazette: weekly vols 1–3, fortnightly 4–8, monthly 9–10, one issue of vol. 11.
{
  let whole = 0, dt = utc(1872, 4, 4);       // Saturday, May 4, 1872
  const add = (vol, no, kind) => {
    whole++;
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate();
    const monthly = kind === 'monthly';
    const i = issue(GAZ, {
      shortname: 'Example Gazette V' + vol + ' I' + no + ' N' + whole, volume: String(vol), issue: String(no), number: String(whole),
      months: MON3[m], dateType: 'Months', day: monthly ? '' : String(d), year: String(y),
      datePrinted: monthly ? MONTHS[m] + ', ' + y : DAYS[dt.getUTCDay()] + ', ' + MONTHS[m] + ' ' + d + ', ' + y,
      pages: vol === 1 && no === 1 ? '4' : kind === 'weekly' ? '4' : kind === 'fortnightly' ? '8' : '16',
      price: kind === 'weekly' ? '5 cents' : '10 cents', size: kind === 'weekly' ? '11 × 16' : '9 × 12',
      evidence: vol <= 3 ? 'Examined' : 'Reported', evidenceNote: vol <= 3 ? 'Bound volume, complete.' : 'Listed in a dealer’s catalogue.',
      na: ['Series', 'Series Number', 'Edition'].concat(monthly ? ['Day'] : [])
    });
    if (vol >= 7) own(i, 'city', 'Springfield');
    if (vol >= 9) own(i, 'publisher', 'Public & Doe');
    if (vol === 5 && no % 9 === 4) { i.spec.push('Day'); i.notes = 'Day of issue inferred from the fortnightly sequence.'; }
    if (whole === 100) { i.specialIssue = true; i.issueDesignation = 'Hundredth Number'; i.pages = '12'; }
    if (vol === 6 && no === 13) { i.na.push('Pages'); i.notes = 'Known only from a mention in a later number.'; }
    return i;
  };
  for (let vol = 1; vol <= 3; vol++) for (let no = 1; no <= 52; no++) {
    const i = add(vol, no, 'weekly');
    if (vol === 2 && (no === 10 || no === 36)) {      // two supplements
      issue(GAZ, { shortname: 'Example Gazette V2 Supplement to N' + i.number, volume: '2', supplement: true, supplementLabel: 'Supplement to No. ' + i.number,
        months: i.months, dateType: 'Months', day: i.day, year: i.year, datePrinted: i.datePrinted, pages: '2', evidence: 'Examined',
        evidenceNote: 'Bound in after the number it supplements.', na: ['Series', 'Series Number', 'Edition', 'Issue', 'Whole No.', 'Price'] });
    }
    dt = addDays(dt, 7);
  }
  for (let vol = 4; vol <= 8; vol++) for (let no = 1; no <= 26; no++) { add(vol, no, 'fortnightly'); dt = addDays(dt, 14); }
  dt = utc(1880, 4, 1);
  for (let vol = 9; vol <= 10; vol++) for (let no = 1; no <= (vol === 9 ? 12 : 8); no++) { add(vol, no, 'monthly'); dt = utc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1); }
  dt = utc(1882, 3, 1);                          // April 1882, four months after December 1881
  const last = add(11, 1, 'monthly');
  last.pages = '12'; last.notes = 'The last number known.';
}

// The Placeholder Bulletin: nos. 1–44, eight missing, no volumes.
{
  const missing = new Set([5, 12, 13, 20, 27, 31, 32, 40]);
  const PERIODS = ['Jan–Feb', 'Mar–Apr', 'May–Jun', 'Jul–Aug', 'Sep–Oct', 'Nov–Dec'];
  const PRINTED = ['JANUARY–FEBRUARY', 'MARCH–APRIL', 'MAY–JUNE', 'JULY–AUGUST', 'SEPTEMBER–OCTOBER', 'NOVEMBER–DECEMBER'];
  let y = 1961, p = 0;
  for (let no = 1; no <= 44; no++) {
    if (!missing.has(no)) {
      const i = issue(BUL, {
        issueID: no === 1 ? undefined : newID(BUL.titleID + '-R'),       // most carry an older code pattern, kept as it is
        shortname: 'Placeholder Bulletin No. ' + no, issue: String(no), months: PERIODS[p], dateType: 'Months', year: String(y),
        datePrinted: PRINTED[p] + ' ' + y, pages: String(pick([6, 8, 8, 10, 12])), size: '8.5 × 11', price: no < 20 ? 'Free to members' : '25 cents',
        evidence: 'Examined', evidenceNote: 'Duplicated typescript.', na: ['Volume', 'Whole No.', 'Series', 'Series Number']
      });
      if (no >= 16) own(i, 'editors', 'Erika Mustermann; Max Mustermann');
      if (no >= 30) own(i, 'publisher', 'The Example Society, Springfield Branch');
      if (no >= 38) own(i, 'subtitle', 'Journal of the Example Society');
      if (no === 22) { i.spec.push('Year'); i.notes = 'Undated; year from the numbering.'; }
    }
    p += no % 7 === 0 ? 2 : no % 3 === 0 ? 1 : 2;
    while (p >= 6) { p -= 6; y++; }
  }
}

// Sample Review: six volumes of four seasonal numbers, 1990–1995.
{
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  for (let vol = 1; vol <= 6; vol++) for (let no = 1; no <= 4; no++) {
    const y = 1989 + vol;
    const i = issue(REV, {
      issueID: vol === 1 && no === 1 ? undefined : newID(REV.titleID + '-H'),
      shortname: 'Sample Review V' + vol + ' I' + no, volume: String(vol), issue: String(no), months: SEASONS[no - 1], dateType: 'Season',
      year: String(y), datePrinted: SEASONS[no - 1] + ' ' + y, pages: String(48 + 8 * (no % 2)), price: '$4.00', size: '6 × 9',
      evidence: 'Examined', evidenceNote: 'Complete run on the shelf.', na: ['Whole No.', 'Series', 'Series Number', 'Day']
    });
    if (vol === 3 && no === 2) { own(i, 'language', 'English; German'); i.issueDesignation = 'Bilingual Number'; }
    if (vol >= 5) own(i, 'city', 'Fairview');
    if (vol === 4 && no === 4) { i.spec.push('Pages'); i.notes = 'Pagination irregular; count approximate.'; }
  }
}

// The Demonstration Quarterly: two numbers.
{
  const a = issue(QUA, { shortname: 'Demonstration Quarterly No. 1 (August 1995)', issue: '1', months: 'Aug', dateType: 'Months', year: '1995',
    datePrinted: 'August 1995', pages: '2', size: '8.27 × 11.69', evidence: 'Examined', evidenceNote: 'Folded sheet.', na: ['Volume', 'Whole No.', 'Series', 'Series Number', 'Day', 'Price'] });
  const b = issue(QUA, { issueID: newID(QUA.titleID + '-T'), shortname: 'Demonstration Quarterly No. 2 (September 1996)', issue: '2', months: 'Sep', dateType: 'Months', year: '1996',
    datePrinted: 'September 1996', pages: '4', size: '8.27 × 11.69', evidence: 'Examined', evidenceNote: 'Folded sheet.', na: ['Volume', 'Whole No.', 'Series', 'Series Number', 'Day', 'Price'] });
  [a, b].forEach(i => { own(i, 'subtitle', 'Occasional Notes'); own(i, 'publisher', 'A. N. Other, at his own expense'); own(i, 'editors', 'A. N. Other; Jane Roe'); });
}

// ── Contents ────────────────────────────────────────────────────────────
const contents = [];
const TOPICS = ['the New Bridge', 'the Post Office', 'the Town Clock', 'the Public Library', 'the School Board', 'the Fire Company', 'the Harvest Fair',
  'the Railway Station', 'Street Lamps', 'the Reservoir', 'the Market Square', 'Tree Planting', 'the County Fair', 'the Courthouse', 'the Spelling Match',
  'the Ice Harvest', 'Maple Sugar', 'Sidewalks', 'the Telegraph Office', 'the Ferry Landing', 'the Mill Pond', 'Beekeeping', 'the Orchards',
  'the Chess Club', 'the Rowing Club', 'Road Repairs', 'the Water Works', 'the Village Green', 'the Night School', 'the Skating Pond', 'the Flower Show',
  'the Census', 'the New Schoolhouse', 'Gas Lighting', 'the Toll Road', 'the Coal Supply', 'the Weather Signals', 'the Town Survey', 'the Bandstand Roof', 'the Fair Grounds'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const TEMPLATES = [t => 'A Word on ' + t, t => cap(t) + ' Again', t => 'Concerning ' + t, t => 'The Matter of ' + t, t => 'More About ' + t,
  t => 'A Plan for ' + t, t => 'Remarks on ' + t, t => 'What Became of ' + t + '?', t => 'In Favour of ' + t, t => cap(t) + ': A Reply', t => 'Figures on ' + t];
const articleTitle = () => pick(TEMPLATES)(pick(TOPICS));
const POEMS = ['Autumn Leaves', 'The Mill Wheel', 'Evening on the River', 'A Winter Morning', 'The Orchard Gate', 'Spring Rain', 'The Lamplighter',
  'By the Shore', 'The Country Road', 'Harvest Moon', 'First Snow', 'At the Window', 'The Little Brook', 'Twilight on the Hill', 'The Garden Wall', 'The Ferryman'];
const BOOKS = ['A History of Anytown', 'The Practical Gardener', 'Bridges and Their Builders', 'The Complete Beekeeper', 'Maps of the Old County',
  'A Guide to Common Birds', 'Letters from the Coast', 'The Clockmaker’s Craft', 'Weather Lore', 'Rivers of the North', 'The Printer’s Handbook',
  'Stamps and Their Stories', 'A Year in the Orchard', 'The Art of the Letter', 'Lighthouses of the Coast', 'Railways of the Valley', 'The Kitchen Garden',
  'Old Roads and New', 'A Field Guide to Ferns', 'The Story of Paper', 'Knots and Splices', 'The Small Workshop', 'A Walk Along the Canal', 'Tides and Harbours'];
const BOOK_AUTHORS = ['Jan van Dijk', 'Anne De Smet', 'Mario Rossi', 'Juan Pérez', 'Hélène Durand', 'Alan Smithee', 'Joe Bloggs', 'Mary Roe'];

// Who wrote what: the Gazette's editor is credited in many ways (the Names tab's main example).
const GAZ_AUTHORS = [['John Q. Public', 30], ['J. Q. Public', 12], ['J.Q.P.', 8], ['Jno. Q. Public', 5], ['Public', 2], ['Jane Doe', 6], ['Mrs. Jane Doe', 2],
  ['J. Doe', 1], ['John Doe', 4], ['Richard Roe', 5], ['Richd. Roe', 2], ['R. Roe', 2], ['William Smith', 4], ['Wm. Smith', 3], ['W. Smith', 1],
  ['John Q. Public & Jane Doe', 2], ['', 10]];
const LETTER_WRITERS = [['A Subscriber', 4], ['Fred Bloggs', 3], ['F. Bloggs', 2], ['Frederick Bloggs', 1], ['Joe Bloggs', 2], ['Jos. Bloggs', 1],
  ['Veritas', 2], ['Rev. John Smith', 2], ['John Smith', 2], ['J. Smith', 1], ['Fred Bloggs/J.Q.P.', 2], ['Mary Roe', 1]];
const BUL_AUTHORS = [['Erika Mustermann', 8], ['E. Mustermann', 4], ['Max Mustermann', 5], ['M. Mustermann', 2], ['Juan Pérez', 3], ['J. Pérez', 2],
  ['Mario Rossi', 3], ['M. Rossi', 2], ['Jan Kowalski', 3], ['J. Kowalski', 2], ['A. N. Other', 3], ['A.N.O.', 2], ['Alan Smithee', 2], ['A. Smithee', 1],
  ['translated by Jane Roe', 2], ['Jane Roe', 2], ['Dr. Mary Roe', 2], ['M. Roe', 1], ['William Smith', 2], ['Wm. Smith', 1], ['', 6]];
const REV_AUTHORS = [['Jan Kowalski', 6], ['J. Kowalski', 2], ['Anne De Smet', 6], ['A. De Smet', 2], ['Jan van Dijk', 4], ['J. van Dijk', 2],
  ['Hélène Durand', 3], ['H. Durand', 1], ['Juan Pérez', 3], ['Juan Perez', 1], ['Mario Rossi', 3], ['Alan Smithee', 2], ['Joe Bloggs', 2],
  ['Joseph Bloggs', 1], ['Richard Roe', 2], ['Mary Roe', 2], ['Jane Doe', 2], ['A. N. Other', 1]];

function addContents(t, iss, list) {
  // list: [{ itemTitle, author, contentType, pages: [start, end], notes, parent (index into list), spec, na, supplied }]
  const made = [];
  list.forEach((x, k) => {
    const c = {
      contentID: newID(t.titleID + '-C'), issueID: iss.issueID, titleID: t.titleID, issueRef: iss.shortname, sequence: String(k + 1),
      itemTitle: x.itemTitle, author: x.author || '', contentType: x.contentType || '', parentItem: '', parentID: '',
      startPage: x.pages ? String(x.pages[0]) : '', endPage: x.pages && x.pages[1] ? String(x.pages[1]) : '', notes: x.notes || '',
      spec: (x.spec || []).slice(), na: (x.na || []).slice()
    };
    if (x.parent != null) { const p = made[x.parent]; c.parentID = p.contentID; c.parentItem = p.itemTitle; }
    else c.na.push('Parent Item');
    if (!c.author && c.na.indexOf('Author / Credit') === -1) c.na.push('Author / Credit');
    if (!c.endPage && c.na.indexOf('End Page') === -1) c.na.push('End Page');
    made.push(c); contents.push(c);
  });
  return made;
}

// The Example Gazette, volumes 1–3.
{
  let serial = 0;
  issues.filter(i => i.titleID === GAZ.titleID && Number(i.volume) <= 3).forEach(iss => {
    const items = [];
    if (iss.supplement) {
      items.push({ itemTitle: 'Report of the ' + cap(pick(TOPICS).replace(/^the /, '')) + ' Committee', author: '', contentType: 'report', pages: [1, 2] });
      items.push({ itemTitle: '[Advertisements]', contentType: 'advertisement', pages: [2], spec: ['Item Title'], notes: 'Supplied title.' });
      addContents(GAZ, iss, items); return;
    }
    const pages = Number(iss.pages) || 4;
    items.push({ itemTitle: 'Town Talk', author: weighted(GAZ_AUTHORS.slice(0, 5)), contentType: 'editorial', pages: [1] });
    const talk = 0;
    for (let k = 0, n = int(0, 3); k < n; k++) items.push({ itemTitle: cap(pick(TOPICS)), contentType: 'paragraph', pages: [1], parent: talk });
    for (let k = 0, n = int(2, 4); k < n; k++) {
      const a = weighted(GAZ_AUTHORS);
      const it = { itemTitle: articleTitle(), author: a, contentType: 'article', pages: [k < 2 ? 1 : 2, chance(0.3) ? (k < 2 ? 2 : 3) : ''] };
      if (a === 'J.Q.P.' && chance(0.3)) it.notes = 'Signed with initials only.';
      if (chance(0.04)) { it.spec = ['Author / Credit']; it.notes = 'Unsigned; the attribution comes from a later index.'; }
      items.push(it);
    }
    if (chance(0.55)) items.push({ itemTitle: pick(POEMS), author: weighted([['Mary Ann Smith', 3], ['Jane Doe', 2], ['Richard Roe', 1], ['', 1]]), contentType: 'poem', pages: [2] });
    if (Number(iss.volume) === 2 && serial < 30) {
      serial++;
      items.push({ itemTitle: 'The Lighthouse Keeper’s Daughter, Chapter ' + serialChapter(serial), author: 'Mary Ann Smith', contentType: 'serial', pages: [3],
        notes: serial > 1 ? 'Continued from the previous number.' : 'First chapter of a serial story.' });
    }
    if (chance(0.6)) {
      const head = items.length;
      items.push({ itemTitle: 'Correspondence', contentType: 'department', pages: [3] });
      for (let k = 0, n = int(1, 3); k < n; k++) items.push({ itemTitle: pick(['A Letter on ' + pick(TOPICS), 'From a Reader in ' + pick(['Springfield', 'Riverton', 'Lakeside', 'Oakdale', 'Fairview', 'Hillcrest']), cap(pick(TOPICS)) + ' Once More']),
        author: weighted(LETTER_WRITERS), contentType: 'letter', pages: [3], parent: head });
    }
    items.push({ itemTitle: 'Market Report', contentType: 'report', pages: [pages] });
    items.push({ itemTitle: '[Advertisements]', contentType: 'advertisement', pages: [pages], spec: ['Item Title'], notes: 'Supplied title.' });
    // The last number with contents has a loose errata slip (missing from the earlier Beta 2 copy).
    if (iss.volume === '3' && iss.issue === '52') items.push({ itemTitle: '[Errata slip]', contentType: 'notice', spec: ['Item Title'], notes: 'Loose slip, found later.' });
    addContents(GAZ, iss, items);
  });
}
function serialChapter(n) { return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
  'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX'][n - 1]; }

// The Placeholder Bulletin.
{
  const BTOPICS = ['the Annual Meeting', 'the Summer Outing', 'the Reading Room', 'the Membership List', 'the Library Fund', 'Postage Rates',
    'the Duplicating Machine', 'the Correspondence Course', 'the Photography Contest', 'the Garden Tour', 'the Bird Count', 'the Lecture Series',
    'Old Maps', 'the Archive Project', 'Typewriters', 'the Exchange List', 'Filing Systems', 'the Society’s Seal'];
  issues.filter(i => i.titleID === BUL.titleID).forEach(iss => {
    const items = [{ itemTitle: 'From the Editor', author: iss.editors.split(';')[0].trim(), contentType: 'editorial', pages: [1] },
      { itemTitle: 'Members’ Notes', contentType: 'notice', pages: [1, 2] }];
    for (let k = 0, n = int(3, 6); k < n; k++) items.push({ itemTitle: pick([t => 'On ' + t, t => 'Report on ' + t, t => cap(t) + ': Some Suggestions', t => 'Thoughts on ' + t])(pick(BTOPICS)),
      author: weighted(BUL_AUTHORS), contentType: 'article', pages: [2 + k, chance(0.4) ? 3 + k : ''] });
    const bn = items.length;
    items.push({ itemTitle: 'Book Notes', contentType: 'department', pages: [Number(iss.pages) - 1] });
    for (let k = 0, n = int(1, 3); k < n; k++) items.push({ itemTitle: pick(BOOKS), author: weighted(BUL_AUTHORS), contentType: 'review', pages: [Number(iss.pages) - 1], parent: bn });
    const ln = items.length;
    items.push({ itemTitle: 'Letters', contentType: 'department', pages: [Number(iss.pages)] });
    for (let k = 0, n = int(1, 3); k < n; k++) items.push({ itemTitle: 'Letter from ' + pick(['Springfield', 'Riverton', 'Lakeside', 'Oakdale', 'Fairview', 'Hillcrest', 'Centerville']),
      author: weighted(BUL_AUTHORS), contentType: 'letter', pages: [Number(iss.pages)], parent: ln });
    addContents(BUL, iss, items);
  });
}

// Sample Review: complete, nested three levels (Symposium › its question › the replies).
{
  const QUESTIONS = ['What Is a Good Index?', 'Should Libraries Lend Maps?', 'The Future of the Printed Page', 'How Long Should a Review Be?',
    'Is the Footnote Necessary?', 'Translation and Its Limits', 'The Uses of a Catalogue', 'Small Presses and Large Ideas'];
  issues.filter(i => i.titleID === REV.titleID).forEach((iss, n) => {
    const items = [{ itemTitle: 'Editorial', author: 'The Editors', contentType: 'editorial', pages: [1, 2] }];
    const art = items.length;
    items.push({ itemTitle: 'Articles', contentType: 'department', pages: [3] });
    let pg = 3;
    for (let k = 0, m = int(4, 6); k < m; k++) {
      const it = { itemTitle: articleTitle(), author: weighted(REV_AUTHORS), contentType: 'article', pages: [pg, pg + int(3, 6)], parent: art };
      pg = it.pages[1] + 1;
      if (chance(0.08)) { it.spec = ['Start Page']; it.notes = 'Page numbers missing from this sheet; start page counted.'; }
      if (chance(0.05)) { it.spec = (it.spec || []).concat('Author / Credit'); }
      items.push(it);
    }
    if (n % 4 === 1) {                                     // a symposium in every second number of a volume
      const sym = items.length;
      items.push({ itemTitle: 'Symposium', contentType: 'department', pages: [pg] });
      const q = items.length;
      items.push({ itemTitle: 'Symposium: ' + QUESTIONS[n % QUESTIONS.length], author: 'The Editors', contentType: 'question', pages: [pg], parent: sym });
      for (let k = 0; k < 3; k++) items.push({ itemTitle: 'Reply ' + (k + 1), author: weighted(REV_AUTHORS), contentType: 'reply', pages: [pg + k], parent: q,
        spec: k === 2 && n === 9 ? ['Item Title', 'Complete text'] : undefined });
      pg += 3;
    }
    const rv = items.length;
    items.push({ itemTitle: 'Reviews', contentType: 'department', pages: [pg] });
    for (let k = 0, m = int(5, 8); k < m; k++) {
      const b = BOOKS[(n * 3 + k) % BOOKS.length];
      items.push({ itemTitle: b + ', by ' + BOOK_AUTHORS[(n + k) % BOOK_AUTHORS.length], author: weighted(REV_AUTHORS), contentType: 'review', pages: [pg + Math.floor(k / 2)], parent: rv });
    }
    pg += 4;
    const co = items.length;
    items.push({ itemTitle: 'Correspondence', contentType: 'department', pages: [pg] });
    for (let k = 0, m = int(2, 4); k < m; k++) items.push({ itemTitle: pick(['Letter on Indexes', 'Letter on Maps in Libraries', 'Letter on the Printed Page', 'Letter on Short Reviews', 'Letter on Footnotes',
      'Letter on Translation', 'Letter on Catalogues', 'Letter on Small Presses']),
      author: weighted(REV_AUTHORS), contentType: 'letter', pages: [pg], parent: co, spec: n === 13 && k === 0 ? ['Complete text'] : undefined });
    items.push({ itemTitle: 'Contributors', contentType: 'notice', pages: [Number(iss.pages) - 1] });
    items.push({ itemTitle: '[Advertisements]', contentType: 'advertisement', pages: [Number(iss.pages)], spec: ['Item Title'], notes: 'Supplied title.' });
    addContents(REV, iss, items);
  });
}

// The Demonstration Quarterly: 13 items in each number.
{
  const [a, b] = issues.filter(i => i.titleID === QUA.titleID);
  const number = (iss, n) => {
    const items = [{ itemTitle: '[Masthead]', contentType: 'masthead', pages: [1], spec: ['Item Title'], notes: 'Supplied title.' },
      { itemTitle: 'Introduction', author: 'A. N. Other', contentType: 'editorial', pages: [1] }];
    const tr = items.length;
    items.push({ itemTitle: 'Translations', contentType: 'department', pages: [1] });
    [['From the French: On Keeping a Diary', 'translated by Jane Roe'], ['From the German: The Village School', 'translated by Jane Roe'], ['From the Spanish: A Market Morning', 'Juan Pérez']]
      .forEach(([t, by], k) => items.push({ itemTitle: n === 2 ? t.replace(/: .*/, ': ' + ['Letters Home', 'The Old Bridge', 'An Afternoon Walk'][k]) : t, author: by, contentType: 'translation',
        pages: [1 + Math.floor(k / 2), n === 2 ? 2 + Math.floor(k / 2) : ''], parent: tr, spec: k === 2 && n === 1 ? ['Author / Credit', 'Translator'] : undefined,
        notes: k === 2 && n === 1 ? 'Translator not named; the credit may be the author of the original.' : '' }));
    const nt = items.length;
    items.push({ itemTitle: 'Notes', contentType: 'department', pages: [n] });
    ['On Indexes', 'On Margins', 'On Errata', 'On Colophons'].forEach(t => items.push({ itemTitle: t, author: 'A. N. Other', contentType: 'note', pages: [n], parent: nt }));
    items.push({ itemTitle: 'Books Received', contentType: 'list', pages: [n * 2] });
    items.push({ itemTitle: 'Subscriptions', contentType: 'notice', pages: [n * 2] });
    items.push({ itemTitle: 'Errata', contentType: 'notice', pages: [n * 2] });
    return addContents(QUA, iss, items);
  };
  number(a, 1); number(b, 2);
}

// ── Writing the 3.0 copy ────────────────────────────────────────────────
const entOf = k => S.entities[k];
const yn = b => b ? 'Yes' : 'No';
const orderList = (k, list) => R.orderStates(entOf(k), list).join('; ');
function titleRows() {
  const ent = entOf('title');
  return [ent.headers].concat(TITLES.map((t, k) => ent.columns.map(c => {
    if (c.key) return t[c.key] == null ? '' : String(t[c.key]);
    switch (c.meta) {
      case 'tool': return 'Titles'; case 'schema': return '3.0'; case 'librarySlug': return LIB.slug; case 'libraryName': return LIB.name; case 'libraryNote': return LIB.note;
      case 'firstYearSpeculative': return yn(t.spec.indexOf('First Year of Publication (CE)') !== -1);
      case 'expectedIssuesFile': return R.defaultFileName('issue', LIB.slug, t.titleID);
      case 'expectedContentsFile': return R.defaultFileName('content', LIB.slug, t.titleID);
      case 'speculative': return yn(t.spec.length > 0); case 'spec': return orderList('title', t.spec); case 'na': return orderList('title', t.na);
      case 'entryOrder': return String(k + 1); default: return '';
    }
  })));
}
const titleOf = id => TITLES.find(t => t.titleID === id);
function issueRows(t) {
  const ent = entOf('issue');
  const list = issues.filter(i => i.titleID === t.titleID);
  return [ent.headers].concat(list.map((i, k) => ent.columns.map(c => {
    if (c.key) {
      const inh = S.INHERIT[c.key];
      const v = inh && i.overrides.indexOf(c.key) === -1 ? t[inh] : i[c.key];
      return c.type === 'bool' ? yn(v) : (v == null ? '' : String(v));
    }
    switch (c.meta) {
      case 'tool': return 'Issues'; case 'schema': return '3.0'; case 'librarySlug': return LIB.slug; case 'libraryName': return LIB.name;
      case 'entryOrder': return String(k + 1); case 'titleCode': return t.titleCode; case 'firstYear': return t.firstYear;
      case 'speculative': return yn(i.spec.length > 0); case 'spec': return orderList('issue', i.spec); case 'na': return orderList('issue', i.na);
      case 'overrides': return i.overrides.map(key => ent.byKey.get(key)).sort((a, b) => a.order - b.order).map(c2 => c2.header).join('; ');
      default: return '';
    }
  })));
}
function contentRows(t) {
  const ent = entOf('content');
  const list = contents.filter(c => c.titleID === t.titleID);
  return [ent.headers].concat(list.map((c, k) => ent.columns.map(col => {
    if (col.key) return c[col.key] == null ? '' : String(c[col.key]);
    switch (col.meta) {
      case 'tool': return 'Contents'; case 'schema': return '3.0'; case 'librarySlug': return LIB.slug; case 'titleID': return t.titleID;
      case 'entryOrder': return String(k + 1); case 'issueRef': return c.issueRef; case 'parentID': return c.parentID;
      case 'speculative': return yn(c.spec.length > 0); case 'spec': return orderList('content', c.spec); case 'na': return orderList('content', c.na);
      default: return '';
    }
  })));
}
const files30 = {};
files30[R.defaultFileName('title', LIB.slug)] = CSV.serialize(titleRows());
TITLES.forEach(t => {
  if (issues.some(i => i.titleID === t.titleID)) files30[R.defaultFileName('issue', LIB.slug, t.titleID)] = CSV.serialize(issueRows(t));
  if (contents.some(c => c.titleID === t.titleID)) files30[R.defaultFileName('content', LIB.slug, t.titleID)] = CSV.serialize(contentRows(t));
});
// The files as the app itself writes them (and a check that reading and writing changes nothing).
{
  const built = R.buildLibrary(Object.keys(files30).map(n => R.readFile(n, files30[n], { lastModified: 1 })), {});
  const problems = built.report.filter(r => r.level !== 'info');
  if (problems.length) { console.error('The generated 3.0 files do not load cleanly:\n' + problems.map(p => '  ' + p.file + ': ' + p.msg).join('\n')); process.exit(1); }
  Object.keys(files30).forEach(n => {
    const again = R.writeFile(built.state, n);
    if (again !== files30[n]) { console.error('Not written back unchanged by the app: ' + n); process.exit(1); }
  });
}

// ── Writing the Beta 2 copy ─────────────────────────────────────────────
// Beta 2 had no ContentID, Parent ContentID or Overridden Fields; issues carried every value;
// Speculative / N/A lists could use older names ("Series No.", "firstYear"); a Parent Item could
// be a sequence number. Its folders also held dated copies of the same list.
const drop = (rows, headers) => { const idx = headers.map(h => rows[0].indexOf(h)); return rows.map(r => r.filter((_, i) => idx.indexOf(i) === -1)); };
const setCol = (rows, h, fn) => { const i = rows[0].indexOf(h); rows.slice(1).forEach((r, k) => { r[i] = fn(r[i], r, k); }); return rows; };
const col = (rows, h) => rows[0].indexOf(h);
function beta2Titles() {
  const rows = titleRows();
  setCol(rows, 'Schema Version', () => '2');                                  // a spreadsheet dropped the ".0"
  setCol(rows, 'Speculative Fields', v => v.replace('First Year of Publication (CE)', 'firstYear'));
  return rows;
}
function beta2Issues(t) {
  const rows = drop(issueRows(t), ['Overridden Fields']);
  setCol(rows, 'Schema Version', () => '2.0');
  if (t === GAZ) setCol(rows, 'N/A Fields', v => v.replace('Series Number', 'Series No.'));
  return rows;
}
function beta2Contents(t) {
  const rows = drop(contentRows(t), ['ContentID', 'Parent ContentID']);
  setCol(rows, 'Schema Version', () => '2.0');
  if (t === REV) {      // some Parent Item values written as the parent's sequence number, or in capitals
    const pi = col(rows, 'Parent Item'), iss = col(rows, 'IssueID'), seq = col(rows, 'Sequence'), ti = col(rows, 'Item Title');
    rows.slice(1).forEach((r, k) => {
      if (!r[pi]) return;
      if (k % 11 === 3) { const p = rows.slice(1).find(x => x[iss] === r[iss] && x[ti] === r[pi]); if (p) r[pi] = p[seq]; }
      else if (k % 13 === 5) r[pi] = r[pi].toUpperCase();
    });
  }
  return rows;
}
const B2 = {};
const B = n => 'SCAT_' + LIB.slug + '_' + n + '.csv';
B2[B('TITLES')] = { text: CSV.serialize(beta2Titles(), { bom: false, eol: '\n', quoteAll: false }), time: '2024-03-01T10:15:00Z' };
// The Gazette: an early copy holding its first issue (different values), then the full list.
{
  const full = beta2Issues(GAZ);
  const early = [full[0], full[1].slice()];
  const set = (h, v) => { early[1][col(early, h)] = v; };
  set('City', 'Anytown Centre'); set('Short Name', 'Gazette 1'); set('Evidence Note', 'Microfilm copy.'); set('N/A Fields', 'Series; Edition');
  B2[B('DRAFT_ISSUES_v2-0_20240110')] = { text: CSV.serialize(early, { bom: false, eol: '\r\n', quoteAll: true }), time: '2024-01-10T09:12:00Z' };
  B2[B('GAZETTE_ISSUES_v2-0_20240115')] = { text: CSV.serialize(full), time: '2024-01-15T16:40:00Z' };
  // Contents: an earlier copy, then a revised one (spelling corrected, notes added, and the errata slip found later).
  const revised = beta2Contents(GAZ);
  const ti = col(revised, 'Item Title'), nt = col(revised, 'Notes'), iss = col(revised, 'IssueID');
  const older = revised.filter(r => r[ti] !== '[Errata slip]').map(r => r.slice());
  const changedIssues = new Set(Array.from(new Set(older.slice(1).map(r => r[iss]))).filter((_, k) => k % 7 === 2));
  older.slice(1).forEach(r => { if (changedIssues.has(r[iss])) { r[ti] = r[ti].replace(/The /, 'Tbe ').replace(/ the /, ' tbe '); r[nt] = ''; } });
  B2[B('GAZETTE_CONTENTS_v2-0_20240115')] = { text: CSV.serialize(older), time: '2024-01-15T16:05:00Z' };
  B2[B('GAZETTE_CONTENTS_v2-0_REVISED_20240120')] = { text: CSV.serialize(revised), time: '2024-01-20T11:30:00Z' };
}
[[BUL, '2024-02-02T14:00:00Z', { bom: false, eol: '\n', quoteAll: true }], [REV, '2024-02-09T18:20:00Z', { bom: false, eol: '\n', quoteAll: true }],
  [QUA, '2024-02-12T08:45:00Z', { bom: true, eol: '\n', quoteAll: true }]].forEach(([t, time, style]) => {
  B2[B(t.titleID + '_ISSUES')] = { text: CSV.serialize(beta2Issues(t), style), time };
  B2[B(t.titleID + '_CONTENTS')] = { text: CSV.serialize(beta2Contents(t), style), time };
});

// ── Write ───────────────────────────────────────────────────────────────
const d30 = path.join(OUT, '3.0', 'example-library'), d2 = path.join(OUT, 'beta2', 'example-library');
[d30, d2].forEach(d => { fs.mkdirSync(d, { recursive: true }); fs.readdirSync(d).filter(n => /\.csv$/i.test(n)).forEach(n => fs.unlinkSync(path.join(d, n))); });
Object.keys(files30).forEach(n => fs.writeFileSync(path.join(d30, n), files30[n]));
// The Beta 2 files carry their dates (the converter takes the newest copy). A few seconds derived from
// the content are added, so a file regenerated with new content never keeps the old date (version
// control would otherwise take an unchanged date and size to mean an unchanged file).
Object.keys(B2).forEach(n => {
  const p = path.join(d2, n); fs.writeFileSync(p, B2[n].text);
  const t = new Date(Date.parse(B2[n].time) + require('crypto').createHash('sha256').update(B2[n].text).digest().readUInt32BE(0) % 60000);
  fs.utimesSync(p, t, t);
});
const count = k => k === 'issues' ? issues.length : contents.length;
console.log('3.0:   ' + path.relative(process.cwd(), d30) + ' — ' + TITLES.length + ' titles, ' + count('issues') + ' issues, ' + count('contents') + ' contents items, ' + Object.keys(files30).length + ' files');
console.log('Beta 2: ' + path.relative(process.cwd(), d2) + ' — ' + Object.keys(B2).length + ' files (with dated copies)');
TITLES.forEach(t => console.log('  ' + t.titleID + '  ' + t.canonicalTitle + ': ' + issues.filter(i => i.titleID === t.titleID).length + ' issues, ' + contents.filter(c => c.titleID === t.titleID).length + ' items'));

// ── --check: converting the Beta 2 copy gives the 3.0 copy ─────────────
if (CHECK) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc3-sample-'));
  try {
    // convert-to-3.js writes only into a folder that does not exist yet: a new one inside the temporary folder.
    cp.execFileSync(process.execPath, [path.join(ROOT, 'tools', 'convert-to-3.js'), path.join(OUT, 'beta2'), '--out', path.join(tmp, 'converted')], { stdio: 'pipe' });
    const load = d => R.buildLibrary(fs.readdirSync(d).filter(n => /\.csv$/i.test(n)).map(n => R.readFile(n, fs.readFileSync(path.join(d, n), 'utf8'), { lastModified: 1 })), {}).state;
    const a = load(d30), b = load(path.join(tmp, 'converted', LIB.slug));
    const strip = (r, map) => { const o = Object.assign({}, r); delete o._src; delete o.entryOrder; delete o.contentID; delete o.parentKept; if (o.parentID) o.parentID = map(o.parentID); return o; };
    let diffs = 0;
    const show = (what, x, y) => { if (diffs++ < 8) console.log('  differs: ' + what + '\n    3.0:       ' + JSON.stringify(x).slice(0, 300) + '\n    converted: ' + JSON.stringify(y).slice(0, 300)); };
    a.titles.forEach((t, id) => { const u = b.titles.get(id); if (JSON.stringify(strip(t)) !== JSON.stringify(u && strip(u))) show('title ' + id, strip(t), u && strip(u)); });
    a.issues.forEach((i, id) => { const u = b.issues.get(id); if (JSON.stringify(strip(i)) !== JSON.stringify(u && strip(u))) show('issue ' + id, strip(i), u && strip(u)); });
    const key = (st, c) => c.issueID + '#' + c.sequence;
    const bByKey = new Map(Array.from(b.contents.values()).map(c => [key(b, c), c]));
    const aKeyOf = new Map(Array.from(a.contents.values()).map(c => [c.contentID, key(a, c)]));
    const bKeyOf = new Map(Array.from(b.contents.values()).map(c => [c.contentID, key(b, c)]));
    a.contents.forEach(c => { const u = bByKey.get(key(a, c)); if (JSON.stringify(strip(c, x => aKeyOf.get(x))) !== JSON.stringify(u && strip(u, x => bKeyOf.get(x)))) show('item ' + key(a, c), strip(c, x => aKeyOf.get(x)), u && strip(u, x => bKeyOf.get(x))); });
    const extra = b.contents.size - a.contents.size;
    console.log('--check: converted Beta 2 copy vs 3.0 copy: ' + (diffs ? diffs + ' record(s) differ' : 'every record the same') + (extra ? ' (the Beta 2 copy has ' + extra + ' item(s) more: the revised copy’s errata slip)' : ''));
    if (diffs) process.exitCode = 1;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
