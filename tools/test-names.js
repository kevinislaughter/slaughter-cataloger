#!/usr/bin/env node
/* Unit tests for js/core/names.js (credits, headings, matching, suggestions) and for
   name authorities in records.js / store.js (the Authorities CSV and undo).
   usage: node tools/test-names.js */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'records', 'store', 'names'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const { names: NM, records: R } = globalThis.SC;
const SCx = globalThis.SC;

let fails = 0, count = 0;
const eq = (got, want, what) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL ' + what + '\n   got  ' + g + '\n   want ' + w); }
};
const head = n => NM.suggestHeading(n).name;

// ── Keys and headings ───────────────────────────────────────────────────
eq(NM.nameKey('J. Q. Public'), NM.nameKey('J.Q. Public'), 'spacing and points do not matter');
eq(NM.nameKey('Doe, J.-P.') === NM.nameKey('Doe J P'), true, 'hyphens and commas do not matter');
eq(NM.nameKey('Françoise'), 'francoise', 'accents do not matter');
eq(NM.nameKey('Παπαδόπουλος').length > 0, true, 'Greek names keep their letters');
eq(NM.splitCredits('J. Q. Public; Richard Roe ;'), ['J. Q. Public', 'Richard Roe'], 'credits split on semicolons');
eq(NM.splitCredits('A.N.R. Other/Public'), ['A.N.R. Other', 'Public'], 'a letter and its reply, split on the slash');
eq(NM.splitCredits('Jane W. Doe / Public'), ['Jane W. Doe', 'Public'], 'a slash with spaces');
eq(NM.splitCredits('Mary Ann Smith & J.Q. Public'), ['Mary Ann Smith', 'J.Q. Public'], 'joint authors split on &');
eq(NM.splitCredits('Report for 1881/82'), ['Report for 1881/82'], 'no split between numbers');
eq(NM.suggestHeading('John Q. Public, editor'), { name: 'Public, John Q.', nameType: 'Person', honorifics: '', roles: 'editor' }, 'a trailing role is set aside');
eq(head('John Q. Public'), 'Public, John Q.', 'surname first');
eq(head('Max von Mustermann'), 'Mustermann, Max von', 'lower-case particle after the forenames');
eq(head('Marie de La Croix'), 'La Croix, Marie de', 'capitalized particle stays with the surname');
eq(head('John Henry Doe, Jr.'), 'Doe, John Henry, Jr.', 'suffix at the end');
eq(NM.suggestHeading('Rev. John Smith'), { name: 'Smith, John', nameType: 'Person', honorifics: 'Rev.', roles: '' }, 'honorific set aside');
// Every kind of honorific on the list is set aside, the less common ones too (a regression check: none may be dropped).
eq(['Rev.', 'Dr.', 'Prof.', 'Magister', 'Magistra', 'IrRev.', 'Comrade', 'Citizen', 'Herr', 'Sgt.'].map(h => NM.suggestHeading(h + ' Jane Doe')).map(x => x.name + ' / ' + x.honorifics),
  ['Rev.', 'Dr.', 'Prof.', 'Magister', 'Magistra', 'IrRev.', 'Comrade', 'Citizen', 'Herr', 'Sgt.'].map(h => 'Doe, Jane / ' + h), 'honorifics, including less common ones, are set aside');
eq(NM.suggestHeading('translated by Jane Roe'), { name: 'Roe, Jane', nameType: 'Person', honorifics: '', roles: 'translated by' }, 'role set aside');
eq(head('Mary Ann Smith [signed Mary Ann]'), 'Smith, Mary Ann', 'bracketed note set aside');
eq(NM.suggestHeading('Example Society of America').nameType, 'Corporate body', 'a body is not inverted');
eq(head('The Townsman’s Friend'), 'The Townsman’s Friend', '"The ..." is not inverted');
eq(head('Anytown Evening Post'), 'Anytown Evening Post', 'a periodical is not inverted');
eq(NM.suggestHeading('J.Q.P.'), { name: 'J.Q.P.', nameType: 'Unknown', honorifics: '', roles: '' }, 'an initialism stays as it is');
eq(head('Public, John Q.'), 'Public, John Q.', 'already surname first');
eq(NM.directOrder('La Croix, Marie de'), 'Marie de La Croix', 'direct order of a heading');
eq(NM.directOrder('Doe, John Henry, Jr.'), 'John Henry Doe, Jr.', 'direct order keeps the suffix');
eq(NM.splitForms('J.Q.P. | Jno. Q. Public;J. Q. Public'), ['J.Q.P.', 'Jno. Q. Public', 'J. Q. Public'], 'forms split on | (and ;)');
eq(NM.joinForms(['a', 'b', 'a', ' ']), 'a | b', 'forms joined with |, once each');

// ── Probably the same person ────────────────────────────────────────────
const P = n => NM.parse(n);
eq(NM.compatible(P('J. Q. Public'), P('John Q. Public')), true, 'initials agree with a full name');
eq(NM.compatible(P('Jno. Q. Public'), P('John Public')), true, 'an abbreviated forename agrees');
eq(NM.compatible(P('Wm. Smith'), P('William Smith')), true, 'Wm. is William');
eq(NM.compatible(P('John Public'), P('Joan Public')), false, 'different forenames');
eq(NM.compatible(P('J. Q. Public'), P('J. S. Public')), false, 'different initials');
eq(NM.compatible(P('John Q. Public'), P('John Q. Publico')), false, 'different surnames');

// ── A small library ─────────────────────────────────────────────────────
function lib() {
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: 'TEST', name: 'Test', note: '' });
  const credits = ['John Q. Public', 'J. Q. Public', 'J.Q.P.', 'Jno. Q. Public; Richard Roe', 'Joan Public', 'J. Public', 'Public, John Q.', 'translated by Jane Roe', 'Jane Roe', ''];
  credits.forEach((a, k) => st.contents.set('TESTTITX-1900-C2222' + (k + 22), R.freezeRec({ contentID: 'TESTTITX-1900-C2222' + (k + 22), issueID: 'TESTTITX-1900-K222222', itemTitle: 'Item ' + k, author: a, sequence: String(k + 1), spec: [], na: [], _src: 'C.csv', entryOrder: k + 1 })));
  st.files.set('C.csv', { name: 'C.csv', kind: 'content', style: SCx.csv.DEFAULT_STYLE, extraHeaders: [], hash: 'x' });
  return st;
}
let st = lib();
let ix = NM.index(st);
eq(ix.forms.size, 10, 'one form per distinct credit');
eq(NM.index({ contents: new Map([['a', { contentID: 'a', author: 'J. Q. Public' }], ['b', { contentID: 'b', author: 'J.Q. Public' }]]), authorities: new Map() }).forms.size, 1, 'J. Q. Public and J.Q. Public are one form');
eq(ix.forms.get(NM.nameKey('j q public')).count, 1, 'counts per form');
const groups = NM.suggestGroups(ix);
eq(groups.map(g => g.suggestion), ['Public, John Q.', 'Roe, Jane'], 'suggested groups, largest first');
eq(groups[0].forms.map(f => f.raw).sort(), ['J. Q. Public', 'J.Q.P.', 'Jno. Q. Public', 'John Q. Public', 'Public, John Q.'].sort(), 'J.Q.P. joins; "J. Public" could be John or Joan and is left out');

// A heading gathers its forms, its own form and that form in direct order.
const auth = { authorityID: 'AU-222222', name: 'Public, John Q.', nameType: 'Person', variants: 'J.Q.P. | Jno. Q. Public', dates: '1840–1910', seeAlso: '', roles: '', honorifics: '', sources: '', notes: '', status: 'Confirmed', spec: [], na: [], _src: 'SCAT_TEST_AUTHORITIES.csv', entryOrder: 1 };
const store = SCx.createStore();
store.load(st);
store.put('authority', auth, 'Add heading');
eq(Array.from(store.dirty), ['SCAT_TEST_AUTHORITIES.csv'], 'a new heading goes to the library\'s Authorities file');
ix = NM.index(store.state);
const e = ix.entries.find(x => x.kind === 'heading');
eq(e.forms.map(f => f.raw).sort(), ['J.Q.P.', 'Jno. Q. Public', 'John Q. Public', 'Public, John Q.'].sort(), 'heading matches its forms, its own form and the direct order');
eq(e.count, 4, 'credits under the heading');
eq(NM.headingFor(store.state, ix, 'J. Q. P.').name, 'Public, John Q.', 'a credit finds its heading by key');
eq(NM.headingFor(store.state, ix, 'J. Q. Public'), null, 'a form not listed stays unheaded');
eq(ix.entries.map(x => x.label), ['J. Public', 'J. Q. Public', 'Joan Public', 'Public, John Q.', 'Jane Roe', 'translated by Jane Roe', 'Richard Roe'],
  'entries in filing order, word by word (by heading, or the heading a name would have)');
store.undo();
eq(store.state.authorities.size, 0, 'undo removes the heading');
store.redo();

// The Authorities file round trip.
const text = R.writeFile(store.state, 'SCAT_TEST_AUTHORITIES.csv');
const back = R.readFile('SCAT_TEST_AUTHORITIES.csv', text, {});
eq(back.ok && back.kind, 'authority', 'the Authorities file reads back');
const r0 = back.records[0];
eq([r0.authorityID, r0.name, r0.variants, r0.dates, r0.status], ['AU-222222', 'Public, John Q.', 'J.Q.P. | Jno. Q. Public', '1840–1910', 'Confirmed'], 'with its values');
eq(R.writeFile(store.state, 'SCAT_TEST_AUTHORITIES.csv'), text, 'writing again gives the same file');
const built = R.buildLibrary([back], {});
eq(built.state.authorities.size, 1, 'buildLibrary loads headings');
const noID = R.readFile('SCAT_TEST_AUTHORITIES.csv', text.replace('AU-222222', ''), {});
const built2 = R.buildLibrary([noID], {});
eq(SCx.ids.RE.authorityID.test(Array.from(built2.state.authorities.keys())[0]) && built2.changed.length === 1, true, 'a heading without an AuthorityID is given one, and the file marked changed');
eq(SCx.ids.RE.authorityID.test(SCx.ids.newAuthorityID(() => false)), true, 'AuthorityID pattern AU-xxxxxx');
const snap = SCx.stateFromSnapshot(JSON.parse(JSON.stringify(store.snapshot())));
eq(snap.authorities.get('AU-222222').name, 'Public, John Q.', 'headings survive the browser working copy');

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' name checks' : 'PASSED ' + count + ' name checks');
process.exit(fails ? 1 : 0);
