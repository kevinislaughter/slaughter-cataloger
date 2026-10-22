/* Slaughter Cataloger 3 — CSV text <-> rows.
   Keeps each file's own style (BOM, line endings, quoting) so a save does not
   rewrite every line of a file that was only lightly edited. */
(function (SC) {
  'use strict';

  // Spreadsheet formula guard. A cell whose value starts with = + - @ (or a tab or carriage
  // return) could run as a formula when the CSV is opened in a spreadsheet, so it is written
  // with one apostrophe in front: "-- END" is stored as "'-- END". To keep this exactly
  // reversible, a value that already starts with apostrophes before one of those characters
  // gets one more: "'-ism" is stored as "''-ism". Reading removes exactly one apostrophe from
  // any cell that starts with apostrophes followed by one of those characters, and leaves
  // every other cell alone ("'Twas" stays "'Twas"). Written and read, every value comes back
  // unchanged.
  const DANGER = /^'*[=+\-@\t\r]/;
  const GUARDED = /^'+[=+\-@\t\r]/;
  function guard(v) { return DANGER.test(v) ? "'" + v : v; }
  function unguard(v) { return GUARDED.test(v) ? v.slice(1) : v; }

  // Strict where a mistake would change data: a quoted value that is never closed, or text
  // straight after a closing quote, is an error (with its line), not something to guess at.
  function parse(text) {
    let bom = false;
    if (text.charCodeAt(0) === 0xFEFF) { bom = true; text = text.slice(1); }
    const crlf = text.indexOf('\r\n') !== -1;
    const rows = [];
    let row = [], field = '', inQuotes = false, sawQuote = false, closed = false, allQuoted = true, i = 0;
    let line = 1, quoteLine = 0;
    const n = text.length;
    const fail = msg => { const e = new Error(msg); e.line = line; throw e; };
    function endField() {
      if (!sawQuote) allQuoted = false;
      row.push(unguard(field)); field = ''; sawQuote = false; closed = false;
    }
    function endRow() { endField(); rows.push(row); row = []; }
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; closed = true; i++; continue;
        }
        if (c === '\n') line++;
        field += c; i++; continue;
      }
      if (closed && c !== ',' && c !== '\r' && c !== '\n') {
        if (c === ' ' || c === '\t') { i++; continue; }      // spaces after a closing quote are layout, not data
        fail('Line ' + line + ': text after the closing quote of a value (' + JSON.stringify(text.slice(i, i + 20)) + ').');
      }
      if (c === '"' && field === '' && !sawQuote) { inQuotes = true; sawQuote = true; quoteLine = line; i++; continue; }
      if (c === ',') { endField(); i++; continue; }
      if (c === '\r') { endRow(); line++; i += (text[i + 1] === '\n') ? 2 : 1; continue; }
      if (c === '\n') { endRow(); line++; i++; continue; }
      field += c; i++;
    }
    if (inQuotes) { line = quoteLine; fail('Line ' + quoteLine + ': a quoted value is never closed (a missing " ).'); }
    if (field !== '' || row.length || sawQuote) endRow();
    // drop fully blank trailing rows
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return { rows, style: { bom, eol: crlf ? '\r\n' : '\n', quoteAll: allQuoted && rows.length > 0 } };
  }

  function cell(v, quoteAll) {
    v = guard(v == null ? '' : String(v));
    if (quoteAll || /[",\r\n]/.test(v) || /^\s|\s$/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function serialize(rows, style) {
    style = style || DEFAULT_STYLE;
    const body = rows.map(r => r.map(v => cell(v, style.quoteAll)).join(',')).join(style.eol) + style.eol;
    return (style.bom ? '﻿' : '') + body;
  }

  const DEFAULT_STYLE = Object.freeze({ bom: false, eol: '\n', quoteAll: true });

  SC.csv = { parse, serialize, guard, unguard, DEFAULT_STYLE };
})(globalThis.SC = globalThis.SC || {});
