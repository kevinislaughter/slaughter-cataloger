#!/usr/bin/env node
/* Slaughter Cataloger 3 — convert a staging package from the ingestion process into a native
   issue package (docs/ISSUE-PACKAGE.md §12).

   node tools/convert-staging.js <staging .zip or folder> --out <new folder>

   The staging package is only read; it is never changed, moved or written into. The native
   package is written to a folder that must not exist yet (and may not be inside the staging
   folder): it is assembled in a temporary sibling folder and renamed into place only when it is
   complete. Before anything is written the result is validated, and the three files it
   re-expresses (full text, candidate rows, deep index) are rebuilt from it and compared with the
   originals; any difference stops the conversion with nothing written.

   Exit status: 0 = converted; 1 = refused (each problem listed); 2 = usage or unreadable input. */
'use strict';
const fs = require('fs'), path = require('path');
const io = require('./lib/package-io');
const staging = require('./lib/staging');

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const input = args.find((a, i) => !a.startsWith('--') && i !== oi + 1);
if (!input || oi === -1 || !args[oi + 1] || args.length !== 3) {
  console.error('usage: node tools/convert-staging.js <staging .zip or folder> --out <new folder>');
  process.exit(2);
}
const out = path.resolve(args[oi + 1]);
const inPath = path.resolve(input);
if (fs.existsSync(inPath) && fs.statSync(inPath).isDirectory() && io.isInside(out, inPath)) {
  console.error('The output folder is inside the staging package. Write it somewhere else: the staging package is never written into.');
  process.exit(2);
}

let files, archive = null;
try {
  if (fs.statSync(inPath).isFile()) {
    const b = fs.readFileSync(inPath);            // read once: the hash recorded is of the bytes converted
    archive = { name: path.basename(inPath), bytes: b.length, sha256: io.sha256(b) };
    files = io.readZip(b);
  } else files = io.readFolder(inPath);
} catch (e) {
  console.log('REFUSED: ' + path.basename(inPath) + ' cannot be opened safely.\n  [' + (e.code || 'read') + '] ' + e.message);
  process.exit(/^E[A-Z]+$/.test(e.code || 'E') ? 2 : 1);
}

let r;
try { r = staging.convert(files, { sha256: io.sha256, archive }); } catch (e) {
  if (e.code !== 'staging') throw e;
  console.log('REFUSED: ' + e.message);
  process.exit(1);
}
try { io.writeNewFolder(out, r.files); } catch (e) { console.log('NOT WRITTEN: ' + e.message); process.exit(e.code === 'exists' ? 2 : 1); }

const s = r.summary;
console.log('Converted ' + path.basename(inPath) + ' → ' + out);
console.log('  ' + s.title_id + ' / ' + s.issue_id + ': ' + s.pages + ' pages, ' + s.items + ' items (' + s.parent_links + ' with a parent), ' + s.segments + ' segments, ' +
  s.unassigned + ' unassigned spans, ' + s.entities + ' entities, ' + s.subjects + ' subjects; ' + s.files + ' files.');
const failed = r.report.checks.filter(c => c.result !== 'pass');
console.log('  ' + r.report.checks.length + ' cross-checks passed' + (failed.length ? ', ' + failed.length + ' failed' : '') + '; the full text, candidate rows and deep index rebuild exactly from the native files.');
r.warnings.forEach(w => console.log('  warning: ' + (w.file ? w.file + ': ' : '') + w.message));
console.log('  The staging package was not changed. Report: provenance/CONVERSION.json');
