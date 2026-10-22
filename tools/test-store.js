#!/usr/bin/env node
/* Unit tests for js/core/store.js: undo/redo and which files show as changed.
   usage: node tools/test-store.js */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records;

let fails = 0, count = 0;
const eq = (got, want, what) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL ' + what + '\n   got  ' + g + '\n   want ' + w); }
};

function library() {
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: 'TEST', name: 'Test', note: '' });
  const T = 'T.csv', I = 'I.csv', C = 'C.csv';
  st.titles.set('TESTTITX-1900', R.freezeRec({ titleID: 'TESTTITX-1900', titleCode: 'TESTTITX', firstYear: '1900', canonicalTitle: 'Test', publisher: 'P', spec: [], na: [], _src: T, entryOrder: 1 }));
  st.issues.set('TESTTITX-1900-K222222', R.freezeRec({ issueID: 'TESTTITX-1900-K222222', titleID: 'TESTTITX-1900', shortname: 'Test 1', volume: '1', spec: [], na: [], overrides: [], _src: I, entryOrder: 1 }));
  st.contents.set('TESTTITX-1900-C222222', R.freezeRec({ contentID: 'TESTTITX-1900-C222222', issueID: 'TESTTITX-1900-K222222', titleID: 'TESTTITX-1900', itemTitle: 'A', sequence: '1', spec: [], na: [], _src: C, entryOrder: 1 }));
  [T, I, C].forEach((n, k) => st.files.set(n, { name: n, kind: ['title', 'issue', 'content'][k], style: SCx.csv.DEFAULT_STYLE, extraHeaders: [], hash: 'x' }));
  return st;
}
const dirty = s => Array.from(s.dirty).sort();
const iss = s => s.state.issues.get('TESTTITX-1900-K222222');

const s = SCx.createStore();
s.load(library());
eq(dirty(s), [], 'nothing changed after loading');
s.put('issue', Object.assign({}, iss(s), { volume: '2' }), 'Edit volume');
eq(dirty(s), ['I.csv'], 'an issue edit changes the issues file');
s.undo();
eq(dirty(s), [], 'undoing it leaves nothing changed');
s.redo();
eq(dirty(s), ['I.csv'], 'redo changes it again');
s.put('issue', Object.assign({}, iss(s), { shortname: 'Test one' }), 'Edit short name');
eq(dirty(s), ['C.csv', 'I.csv'], 'a short name change also reaches the contents file (Issue Reference)');
s.undo();
eq(dirty(s), ['I.csv'], 'undoing the short name leaves only the volume change');

// A save, with an edit made while it writes.
const base = s.revisions();
s.put('issue', Object.assign({}, iss(s), { volume: '3' }), 'Edit volume during save');
s.markSaved(['I.csv'], null, base);
eq(dirty(s), ['I.csv'], 'an edit made during a save still shows as changed');
s.markSaved(['I.csv'], null, s.revisions());
eq(dirty(s), [], 'saved');
s.undo();
eq(dirty(s), ['I.csv'], 'undoing past a save changes the file again (it now differs from disk)');
s.redo();
eq(dirty(s), [], 'redo brings it back to what was saved');

// Title edits reach issues files only through inherited fields, Title Code or First Year.
const t = () => s.state.titles.get('TESTTITX-1900');
s.put('title', Object.assign({}, t(), { notes: 'x' }));
eq(dirty(s), ['T.csv'], 'a title field issues do not carry changes only the Titles file');
s.put('title', Object.assign({}, t(), { publisher: 'Q' }));
eq(dirty(s), ['I.csv', 'T.csv'], 'an inherited field reaches the issues file');
s.undo(); s.undo();
eq(dirty(s), [], 'both undone');

// Files marked changed on load stay changed until saved, whatever is undone.
const s2 = SCx.createStore();
s2.load(library(), { dirty: ['C.csv'] });
s2.put('issue', Object.assign({}, iss(s2), { volume: '9' }));
s2.undo();
eq(dirty(s2), ['C.csv'], 'a file changed on load (new ContentIDs) stays changed');
s2.batch('Two changes', () => {
  s2.put('issue', Object.assign({}, iss(s2), { volume: '8' }));
  s2.put('content', Object.assign({}, s2.state.contents.get('TESTTITX-1900-C222222'), { itemTitle: 'B' }));
});
s2.markSaved(['C.csv', 'I.csv']);
eq(dirty(s2), [], 'saved');
s2.undo();
eq(dirty(s2), ['C.csv', 'I.csv'], 'one undo step reverses a whole batch');

// ── Review B-01: a file is clean only when it is exactly what was last saved ──
// Byte check: the file as it would be written now, against the text written at the last save.
const written = new Map();
const save = (st, names) => { const base = st.revisions(); names.forEach(n => written.set(n, R.writeFile(st.state, n))); st.markSaved(names, null, base); };
const differs = (st, n) => R.writeFile(st.state, n) !== written.get(n);
// Never: a file that differs from what was saved shown as saved.
const honest = (st, what) => ['T.csv', 'I.csv', 'C.csv'].forEach(n => { if (written.has(n) && differs(st, n) && !st.dirty.has(n)) { fails++; console.log('FAIL ' + what + ': ' + n + ' differs from the saved file but shows as saved'); } count++; });
const s3 = SCx.createStore();
s3.load(library());
const ti = () => s3.state.titles.get('TESTTITX-1900');
s3.put('title', Object.assign({}, ti(), { notes: 'B' }));
save(s3, ['T.csv']);
eq(dirty(s3), [], 'B saved');
s3.undo();
eq([ti().notes || '', dirty(s3)], ['', ['T.csv']], 'undo past the save: back to the old notes, file changed');
s3.put('title', Object.assign({}, ti(), { notes: 'D' }));
eq([ti().notes, dirty(s3)], ['D', ['T.csv']], 'a different edit after undoing past a save stays changed (B-01)');
honest(s3, 'branch after undo past save');
s3.undo();
s3.put('title', Object.assign({}, ti(), { notes: 'E' }));
s3.undo(); s3.undo();
honest(s3, 'several undos and branches');
eq(s3.canRedo, true, 'redo is available after undo');
s3.redo();
eq(dirty(s3), ['T.csv'], 'redo of the branch edit E is not what was saved');
// Several saves between undos.
s3.put('title', Object.assign({}, ti(), { notes: 'F' })); save(s3, ['T.csv']);
s3.put('title', Object.assign({}, ti(), { notes: 'G' })); save(s3, ['T.csv']);
s3.undo();
eq([ti().notes, dirty(s3)], ['F', ['T.csv']], 'undo to F after saving G: changed');
s3.undo();
honest(s3, 'two undos past two saves');
s3.redo(); s3.redo();
eq([ti().notes, dirty(s3)], ['G', []], 'redo all the way back to the saved G: saved');
// A batch touching the Titles file and an inherited field in the Issues file.
s3.batch('Publisher', () => { s3.put('title', Object.assign({}, ti(), { publisher: 'New P' })); });
eq(dirty(s3), ['I.csv', 'T.csv'], 'inherited field reaches both files');
save(s3, ['I.csv', 'T.csv']);
s3.undo();
eq(dirty(s3), ['I.csv', 'T.csv'], 'undo past that save changes both again');
s3.put('title', Object.assign({}, ti(), { publisher: 'Other P' }));
eq(dirty(s3), ['I.csv', 'T.csv'], 'a different publisher after the undo: both still changed');
honest(s3, 'batch across files');
// An edit made while a save is writing, then the save finishing.
save(s3, ['I.csv', 'T.csv']);
const during = s3.revisions();
s3.put('title', Object.assign({}, ti(), { notes: 'typed while saving' }));
s3.markSaved(['T.csv'], null, during);
eq(dirty(s3), ['T.csv'], 'an edit made during a save stays changed after the save finishes');
// An edit that changes nothing in the file still counts as a change (safe side), until saved.
save(s3, ['T.csv']);
s3.put('title', Object.assign({}, ti()));
eq(dirty(s3), ['T.csv'], 'a no-change edit shows as changed (never the other way round)');
save(s3, ['T.csv']);
honest(s3, 'after the last save');

// Independent check: a title edit right after an undo brings issues back (no lookup in between)
// still reaches the issues file.
{
  const s4 = SCx.createStore();
  s4.load(library());
  const issueIDs = s4.issuesOfTitle('TESTTITX-1900').map(i => i.issueID);
  s4.batch('delete issues', () => issueIDs.forEach(id => { s4.contentsOfIssue(id).forEach(c => s4.remove('content', c.contentID)); s4.remove('issue', id); }));
  s4.issuesOfTitle('TESTTITX-1900');           // the cached index now says "no issues"
  s4.undo();                                   // issues back, no lookup since
  s4.markSaved(Array.from(s4.dirty), null, s4.revisions());
  s4.put('title', Object.assign({}, s4.state.titles.get('TESTTITX-1900'), { publisher: 'New Publisher' }));
  eq(dirty(s4), ['I.csv', 'T.csv'], 'inherited title edit after undo reaches the issues file');
}

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' store checks' : 'PASSED ' + count + ' store checks');
process.exit(fails ? 1 : 0);
