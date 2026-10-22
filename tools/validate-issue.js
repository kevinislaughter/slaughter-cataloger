#!/usr/bin/env node
/* Slaughter Cataloger 3 — check an issue package (docs/ISSUE-PACKAGE.md).

   node tools/validate-issue.js <package folder or .zip> [--json]

   Read-only: it opens the package, applies every rule of format slaughter-cataloger-issue 1.x,
   and reports. The archive is read with the strict ZIP reader (no unsafe paths, links, special
   files, colliding names, encryption, ZIP64, overlapping or prepended data, size or ratio over
   the limits, bad CRCs); a folder is read with the same path rules and no symbolic links.

   Exit status: 0 = valid (warnings may be listed), 1 = refused (each reason listed), 2 = usage
   or unreadable input. --json prints the full result as JSON instead of text. */
'use strict';
const path = require('path');
const io = require('./lib/package-io');
const staging = require('./lib/staging');
const SC = io.SC;

const args = process.argv.slice(2);
const asJSON = args.includes('--json');
const target = args.find(a => !a.startsWith('--'));
if (!target || args.some(a => a.startsWith('--') && a !== '--json')) {
  console.error('usage: node tools/validate-issue.js <package folder or .zip> [--json]');
  process.exit(2);
}

let files;
try { files = io.readPackage(target); } catch (e) {
  const out = { ok: false, errors: [{ code: e.code || 'read', file: e.path || '', where: '', message: e.message }], warnings: [], summary: null };
  if (asJSON) console.log(JSON.stringify(out, null, 2));
  else console.log('REFUSED: ' + path.basename(target) + ' cannot be opened safely.\n  [' + (e.code || 'read') + '] ' + e.message);
  process.exit(/^E[A-Z]+$/.test(e.code || 'E') ? 2 : 1);
}
const fmt = staging.stagingFormat(files);
if (fmt) {
  const msg = 'This is a staging package (MANIFEST.json, no issue.json; ' + fmt.field + ' "' + fmt.value + '"), not a native issue package. ' +
    (fmt.convertible ? 'Convert it first: node tools/convert-staging.js ' + target + ' --out <new folder>' : 'No converter exists for this staging format yet.');
  if (asJSON) console.log(JSON.stringify({ ok: false, errors: [{ code: 'staging', file: '', where: '', message: msg }], warnings: [], summary: null }, null, 2));
  else console.log('REFUSED: ' + msg);
  process.exit(1);
}

const r = SC.issuepkg.validate(files, { sha256: io.sha256 });
if (asJSON) {
  console.log(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings, summary: r.summary }, null, 2));
} else {
  const s = r.summary;
  const who = s ? (s.identity_status === 'unresolved' ? 'identity unresolved (provisional key ' + s.provisional_key + ')'
    : s.identity_status === 'title-resolved' ? s.title_id + ' / issue unresolved (provisional key ' + s.provisional_key + ')' : s.title_id + ' / ' + s.issue_id) : '';
  const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  if (s) console.log(path.basename(target) + ': ' + who + ' (' + s.state + '): ' + n(s.pages, 'page', 'pages') + ', ' + n(s.items, 'item', 'items') + ' (' + s.parent_links + ' with a parent), ' +
    n(s.segments, 'segment', 'segments') + ', ' + n(s.unassigned, 'unassigned span', 'unassigned spans') + ', ' + n(s.entities, 'entity', 'entities') + ', ' + n(s.subjects, 'subject', 'subjects') + ', ' + n(s.files, 'file', 'files') + '.');
  r.errors.forEach(e => console.log('  ERROR [' + e.code + '] ' + (e.file ? e.file + (e.where ? ' › ' + e.where : '') + ': ' : '') + e.message));
  const shown = r.warnings.slice(0, 50);
  shown.forEach(w => console.log('  warning [' + w.code + '] ' + (w.file ? w.file + (w.where ? ' › ' + w.where : '') + ': ' : '') + w.message));
  if (r.warnings.length > shown.length) console.log('  … and ' + (r.warnings.length - shown.length) + ' more warnings (--json lists them all)');
  console.log(r.ok ? 'VALID' + (r.warnings.length ? ' (' + r.warnings.length + ' warning' + (r.warnings.length === 1 ? '' : 's') + ')' : '') : 'REFUSED: ' + r.errors.length + ' error' + (r.errors.length === 1 ? '' : 's') + '.');
}
process.exit(r.ok ? 0 : 1);
