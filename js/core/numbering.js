/* Slaughter Cataloger 3 — numbering and dates from one issue to the next.
   Pure functions, no DOM, testable in Node:
     numbers   incrementing volume and issue numbers (arabic, zero-padded, double issues "5/6", Roman)
     periods   reading and writing month and season labels ("Mar–Apr", "March–April", "Dec–Jan", "Autumn")
     dates     how the date moves to the next issue (by its own span, by n months, by a week or two, by a year)
     cadence   that movement, inferred from the last two issues
     names     the next Short Name, following the pattern of the previous one */
(function (SC) {
  'use strict';

  // ── Numbers ───────────────────────────────────────────────────────────
  const ROMAN_RE = /^(?=[MDCLXVI])M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
  const ROMAN_VALUES = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  const isRoman = s => !!s && ROMAN_RE.test(s);
  function romanToInt(s) {
    const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const up = String(s).toUpperCase();
    let total = 0;
    for (let i = 0; i < up.length; i++) { const cur = map[up[i]], next = map[up[i + 1]]; total += next > cur ? -cur : cur; }
    return total;
  }
  function intToRoman(n) {
    let res = '';
    for (const [v, r] of ROMAN_VALUES) while (n >= v) { res += r; n -= v; }
    return res;
  }
  const pad = (n, width) => String(n).padStart(width, '0');

  // "7" -> "8", "07" -> "08", "No. 5/6" -> "No. 7", "Vol. IV" -> "Vol. V", "iv" -> "v". Anything else is returned as it is.
  function incrementString(s, by) {
    s = s == null ? '' : String(s);
    by = by || 1;
    if (!s) return s;
    let m = /^(.*?)(\d+)\s*[\/\-–]\s*(\d+)(\D*)$/.exec(s);            // double issue: continue after the last number
    if (m) return m[1] + pad(parseInt(m[3], 10) + by, m[3].length) + m[4];
    m = /^(.*?)(\d+)(\D*)$/.exec(s);
    if (m) return m[1] + pad(parseInt(m[2], 10) + by, m[2].length) + m[3];
    m = /(^|[\s.,;:()\/-])([IVXLCDMivxlcdm]+)([\s.,;:()\/-]*)$/.exec(s);
    if (m && isRoman(m[2])) {
      let r = intToRoman(romanToInt(m[2]) + by);
      if (m[2] === m[2].toLowerCase()) r = r.toLowerCase();
      return s.slice(0, s.length - m[0].length) + m[1] + r + m[3];
    }
    return s;
  }

  // The first number in the same style: "26" -> "1", "07" -> "01", "XII" -> "I", "No. 5/6" -> "No. 1".
  function firstOf(s) {
    s = s == null ? '' : String(s);
    if (!s) return s;
    let m = /^(.*?)(\d+)\s*[\/\-–]\s*(\d+)(\D*)$/.exec(s);
    const one = digits => pad(1, /^0/.test(digits) ? digits.length : 1);   // "07" -> "01", "26" -> "1"
    if (m) return m[1] + one(m[3]) + m[4];
    m = /^(.*?)(\d+)(\D*)$/.exec(s);
    if (m) return m[1] + one(m[2]) + m[3];
    m = /(^|[\s.,;:()\/-])([IVXLCDMivxlcdm]+)([\s.,;:()\/-]*)$/.exec(s);
    if (m && isRoman(m[2])) return s.slice(0, s.length - m[0].length) + m[1] + (m[2] === m[2].toLowerCase() ? 'i' : 'I') + m[3];
    return s;
  }

  // The numeric value of a volume or issue number: "12" -> 12, "XII" -> 12, "5/6" -> 6. NaN otherwise.
  function numberOf(s) {
    const t = String(s == null ? '' : s).trim();
    let m = /^(\d+)\s*[\/\-–]\s*(\d+)$/.exec(t);
    if (m) return parseInt(m[2], 10);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (isRoman(t)) return romanToInt(t);
    return NaN;
  }

  // The first number a value covers: "5/6" -> 5, "XII" -> 12. NaN otherwise.
  function firstNumberOf(s) {
    const t = String(s == null ? '' : s).trim();
    const m = /^(\d+)\s*[\/\-–]\s*(\d+)$/.exec(t);
    return m ? parseInt(m[1], 10) : numberOf(t);
  }

  /* Numbers missing between two consecutive regular issues a and b, judged first by
     whole numbers, then by issue numbers within one volume, then at the start of a
     new volume. has(kind, volume, n) says whether the run holds that number anywhere
     (kind 'whole' or 'issue'), so a run entered out of order shows only what is absent.
     Returns { count, label } ("no. 5", "nos. 5–7, 9", "whole no. 12") or null. */
  function gapBetween(a, b, has) {
    if (!a || !b) return null;
    function result(kind, vol, from, to, word) {
      if (to < from || to - from > 500) return null;
      const miss = [];
      for (let n = from; n <= to; n++) if (!has || !has(kind, vol, n)) miss.push(n);
      if (!miss.length) return null;
      const runs = [];
      miss.forEach(n => { const r = runs[runs.length - 1]; if (r && r[1] === n - 1) r[1] = n; else runs.push([n, n]); });
      const list = runs.map(r => (r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1])).join(', ');
      return { count: miss.length, label: (miss.length > 1 ? word.replace(/no\.$/, 'nos.') : word) + ' ' + list, kind, volume: vol, numbers: miss };
    }
    const wa = numberOf(a.number), wb = firstNumberOf(b.number);
    if (!isNaN(wa) && !isNaN(wb)) return result('whole', '', wa + 1, wb - 1, 'whole no.');
    const ia = numberOf(a.issue), ib = firstNumberOf(b.issue);
    const va = String(a.volume == null ? '' : a.volume).trim(), vb = String(b.volume == null ? '' : b.volume).trim();
    if (va === vb && !isNaN(ia) && !isNaN(ib)) return result('issue', vb, ia + 1, ib - 1, (vb ? 'vol. ' + vb + ', ' : '') + 'no.');
    if (va !== vb && numberOf(vb) === numberOf(va) + 1 && !isNaN(ib)) return result('issue', vb, 1, ib - 1, 'vol. ' + vb + ', no.');
    return null;
  }
  // has() for gapBetween: every whole number and (volume, issue number) a run holds; "5/6" holds 5 and 6.
  function numbersHeld(issues) {
    const held = new Set();
    const span = v => { const f = firstNumberOf(v), l = numberOf(v); return isNaN(f) || isNaN(l) || l < f || l - f > 50 ? [] : Array.from({ length: l - f + 1 }, (_, k) => f + k); };
    (issues || []).forEach(i => {
      span(i.number).forEach(n => held.add('whole||' + n));
      const v = String(i.volume == null ? '' : i.volume).trim();
      span(i.issue).forEach(n => held.add('issue|' + v + '|' + n));
    });
    const key = (kind, vol, n) => kind + '|' + (kind === 'whole' ? '' : vol) + '|' + n;
    const has = (kind, vol, n) => held.has(key(kind, vol, n));
    // Count a reported gap as held, so the same missing number is not reported twice.
    has.add = g => g.numbers.forEach(n => held.add(key(g.kind, g.volume, n)));
    return has;
  }

  /* The gaps in a run (issues in run order): the numbers missing before each regular issue
     (not a supplement or special issue), each missing number reported once.
     Returns Map<issueID, { count, label, numbers, ... }>. */
  function runGaps(issues) {
    const gaps = new Map();
    const has = numbersHeld(issues);
    let prev = null;
    (issues || []).forEach(i => {
      if (i.specialIssue || i.supplement) return;
      const g = gapBetween(prev, i, has);
      if (g) { gaps.set(i.issueID, g); has.add(g); }
      prev = i;
    });
    return gaps;
  }

  // ── Periods: months and seasons ───────────────────────────────────────
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON3 = MONTHS.map(m => m.slice(0, 3));
  const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
  const SEASONS_AUTUMN = ['Spring', 'Summer', 'Autumn', 'Winter'];

  function wordOf(w) {
    const t = String(w || '').trim().replace(/\.$/, '').toLowerCase();
    if (t.length < 3) return null;
    for (let i = 0; i < 12; i++) {
      const full = MONTHS[i].toLowerCase();
      if (t === full) return { kind: 'months', i, full: t.length > 3 ? true : null };
      if (full.indexOf(t) === 0 || (i === 8 && t === 'sept')) return { kind: 'months', i, full: false };
    }
    const s = ['spring', 'summer', 'fall', 'winter'].indexOf(t);
    if (s !== -1) return { kind: 'seasons', i: s, autumn: false };
    if (t === 'autumn') return { kind: 'seasons', i: 2, autumn: true };
    return null;
  }

  // A contiguous run around the cycle (Dec–Jan wraps), or null.
  function circularRun(idx, cycle) {
    if (!idx.length || idx.length >= cycle) return null;
    const inSet = new Set(idx);
    const ends = [];
    for (let i = 0; i < cycle; i++) if (inSet.has(i) && !inSet.has((i + 1) % cycle)) ends.push(i);
    if (ends.length !== 1) return null;
    const end = ends[0];
    let start = end;
    while (inSet.has((start - 1 + cycle) % cycle)) start = (start - 1 + cycle) % cycle;
    return { start, end, len: idx.length };
  }

  // "Mar–Apr", "March-April", "Dec–Jan", "Jul/Aug", "Jan, Mar", "Autumn", "Fall–Winter".
  // Returns { kind, cycle, idx (sorted), run, full (true/false/null if it can't tell), autumn } or null.
  function parsePeriod(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return null;
    let kind = null, sawFull = false, sawAbbr = false, autumn = false;
    const idx = new Set();
    const parts = t.split(/\s*,\s*|\s+and\s+|\s*&\s*/i);
    for (const part of parts) {
      const ends = part.split(/\s*[–—\-\/]\s*|\s+to\s+/i);
      if (ends.length > 2) return null;
      const ws = ends.map(wordOf);
      if (ws.some(w => !w)) return null;
      for (const w of ws) {
        if (kind && w.kind !== kind) return null;
        kind = w.kind;
        if (w.full === true) sawFull = true; else if (w.full === false) sawAbbr = true;
        if (w.autumn) autumn = true;
      }
      const cycle = kind === 'months' ? 12 : 4;
      if (ws.length === 1) idx.add(ws[0].i);
      else for (let i = ws[0].i, n = 0; n <= cycle; i = (i + 1) % cycle, n++) { idx.add(i); if (i === ws[1].i) break; }
    }
    const cycle = kind === 'months' ? 12 : 4;
    const list = Array.from(idx).sort((a, b) => a - b);
    return { kind, cycle, idx: list, run: circularRun(list, cycle), full: sawFull ? true : sawAbbr ? false : null, autumn };
  }

  const namesFor = (kind, style) => kind === 'seasons' ? (style && style.autumn ? SEASONS_AUTUMN : SEASONS) : (style && style.full ? MONTHS : MON3);

  function periodLabel(idx, kind, style) {
    if (!idx || !idx.length) return '';
    const names = namesFor(kind, style);
    const sorted = idx.slice().sort((a, b) => a - b);
    if (sorted.length === 1) return names[sorted[0]];
    const run = circularRun(sorted, names.length);
    if (run) return names[run.start] + '–' + names[run.end];
    return sorted.map(i => names[i]).join(', ');
  }

  // Which spelling a title uses: full month names or three letters; Fall or Autumn.
  function periodStyle(values) {
    let full = 0, abbr = 0, autumn = 0, fall = 0;
    (values || []).forEach(v => {
      const p = parsePeriod(v);
      if (!p) return;
      if (p.kind === 'months') { if (p.full === true) full++; else if (p.full === false) abbr++; }
      else if (p.idx.indexOf(2) !== -1) { if (p.autumn) autumn++; else fall++; }
    });
    return { full: full > abbr, autumn: autumn > fall };
  }

  // ── Dates ─────────────────────────────────────────────────────────────
  const DATE_MODES = [
    ['run', 'by its own span'], ['m1', 'one month'], ['m2', 'two months'], ['m3', 'three months'], ['m4', 'four months'], ['m6', 'six months'],
    ['d7', 'one week'], ['d14', 'two weeks'], ['y1', 'one year'], ['none', 'not at all']
  ];
  const isYear = y => /^\d{4}$/.test(String(y || '').trim());
  // Move the four-digit year inside a value ("1889", "c. 1889") by n; leave anything else alone ("189X").
  function bumpYear(y, n) {
    const s = String(y == null ? '' : y);
    if (!n) return s;
    return /\d{4}/.test(s) ? s.replace(/\d{4}/, d => String(parseInt(d, 10) + n)) : s;
  }
  function fullDate(d, p) {
    p = p === undefined ? parsePeriod(d.months) : p;
    if (!p || p.kind !== 'months' || p.idx.length !== 1 || !/^\d{1,2}$/.test(String(d.day || '').trim()) || !isYear(d.year)) return null;
    return { y: parseInt(d.year, 10), m: p.idx[0], d: parseInt(d.day, 10) };
  }
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const padLike = (v, like) => /^0\d$/.test(String(like || '').trim()) ? pad(v, 2) : String(v);

  /* The date of the next issue. d = { months, day, year, yearEnd }; mode from DATE_MODES.
     pref = { full, autumn } spelling to use when the value itself doesn't say.
     Returns { months, day, year, yearEnd }. */
  function advanceDate(d, mode, pref) {
    const out = { months: d.months || '', day: d.day || '', year: d.year || '', yearEnd: d.yearEnd || '' };
    if (!mode || mode === 'none') return out;
    const p = parsePeriod(d.months);
    const style = { full: p && p.full != null ? p.full : !!(pref && pref.full), autumn: p && p.kind === 'seasons' && p.idx.indexOf(2) !== -1 ? p.autumn : !!(pref && pref.autumn) };
    if (mode === 'y1') {
      out.year = bumpYear(d.year, 1);
      out.yearEnd = d.yearEnd ? bumpYear(d.yearEnd, 1) : '';
      return out;
    }
    if (mode === 'd7' || mode === 'd14') {
      const fd = fullDate(d, p);
      if (fd) {
        const nd = new Date(Date.UTC(fd.y, fd.m, fd.d + (mode === 'd7' ? 7 : 14)));
        out.months = periodLabel([nd.getUTCMonth()], 'months', style);
        out.day = padLike(nd.getUTCDate(), d.day);
        out.year = String(nd.getUTCFullYear());
        out.yearEnd = '';
        return out;
      }
      mode = 'run';                                  // no full date to count days from
    }
    if (!p) return out;                              // months not understood: leave the date as it is
    const span = p.run ? p.run.len : p.idx[p.idx.length - 1] - p.idx[0] + 1;
    let step = span;
    if (mode !== 'run') {
      const k = parseInt(mode.slice(1), 10);
      const s = p.kind === 'seasons' ? k / 3 : k;
      if (s >= 1 && s === Math.floor(s)) step = s;
    }
    const start = p.run ? p.run.start : p.idx[0];
    const ns = start + step;
    const years = Math.floor(ns / p.cycle);
    const nidx = p.run ? Array.from({ length: p.run.len }, (_, i) => (ns + i) % p.cycle) : p.idx.map(i => (i + step) % p.cycle);
    out.months = periodLabel(nidx, p.kind, style);
    out.year = years ? bumpYear(d.year, years) : out.year;
    const spans = !!p.run && (ns % p.cycle) + p.run.len > p.cycle;
    out.yearEnd = spans ? (isYear(out.year) ? bumpYear(out.year, 1) : '') : '';
    // A day of the month stays, but not past the end of the new month.
    if (/^\d{1,2}$/.test(String(d.day || '').trim()) && p.kind === 'months' && nidx.length === 1 && isYear(out.year)) {
      out.day = padLike(Math.min(parseInt(d.day, 10), daysInMonth(parseInt(out.year, 10), nidx[0])), d.day);
    }
    return out;
  }

  // How the date moved from issue a to issue b (b follows a), as a DATE_MODES key.
  function inferCadence(a, b) {
    if (!b) return 'run';
    const pb = parsePeriod(b.months);
    if (!a) return pb ? 'run' : 'none';
    const pa = parsePeriod(a.months);
    const fa = fullDate(a, pa), fb = fullDate(b, pb);
    if (fa && fb) {
      const days = Math.round((Date.UTC(fb.y, fb.m, fb.d) - Date.UTC(fa.y, fa.m, fa.d)) / 864e5);
      if (days === 7 || days === 14) return 'd' + days;
      if (fa.d === fb.d) {
        const m = (fb.y - fa.y) * 12 + fb.m - fa.m;
        if ([1, 2, 3, 4, 6].indexOf(m) !== -1) return 'm' + m;
        if (m === 12) return 'y1';
      }
    }
    if (pa && pb && pa.kind === pb.kind && isYear(a.year) && isYear(b.year)) {
      const startOf = p => p.run ? p.run.start : p.idx[0];
      const diff = (parseInt(b.year, 10) - parseInt(a.year, 10)) * pb.cycle + startOf(pb) - startOf(pa);
      const lenB = pb.run ? pb.run.len : pb.idx[pb.idx.length - 1] - pb.idx[0] + 1;
      if (diff === lenB) return 'run';
      const months = pb.kind === 'seasons' ? diff * 3 : diff;
      if ([1, 2, 3, 4, 6].indexOf(months) !== -1) return 'm' + months;
      if (months === 12) return 'y1';
    }
    if (!pb && !b.months && isYear(a.year) && isYear(b.year) && parseInt(b.year, 10) - parseInt(a.year, 10) === 1) return 'y1';
    return pb ? 'run' : 'none';
  }

  /* Numbering and date for the issue after base.
     opts = { volume, issue, number: advance these?; date: DATE_MODES key; newVolume: start the next volume }
     Returns { volume, issue, number, seriesNumber, months, day, year, yearEnd }. */
  function nextIssue(base, opts, pref) {
    opts = opts || {};
    const v = k => base[k] == null ? '' : String(base[k]);
    const out = { volume: v('volume'), issue: v('issue'), number: v('number'), seriesNumber: v('seriesNumber') };
    if (opts.newVolume) {
      out.volume = incrementString(out.volume);
      out.issue = firstOf(out.issue);
    } else {
      if (opts.volume) out.volume = incrementString(out.volume);
      if (opts.issue) { out.issue = incrementString(out.issue); out.seriesNumber = incrementString(out.seriesNumber); }
    }
    if (opts.number) out.number = incrementString(out.number);
    return Object.assign(out, advanceDate({ months: v('months'), day: v('day'), year: v('year'), yearEnd: v('yearEnd') }, opts.date || 'none', pref));
  }

  // ── Short names ───────────────────────────────────────────────────────
  const NAME_FIELDS = ['volume', 'issue', 'number', 'months', 'year'];
  const HINT = {
    volume: /(?:^|[^a-z])(v|vol|volume|bd|band|t|tome|jahrg|jg|année|anno|año)\.?\s*$/i,
    issue: /(?:^|[^a-z])(i|n|no|nos|nr|num|number|iss|issue|heft|h|cahier|fasc)\.?\s*$|#\s*$/i,
    number: /(?:^|[^a-z])(whole\s+no|whole\s+number|w\.?\s*n|n|no|nr|num|number)\.?\s*$|#\s*$/i
  };
  const isDigit = c => c >= '0' && c <= '9';
  const isLetter = c => !!c && c.toLowerCase() !== c.toUpperCase();
  function bounded(s, i, len, bound) {
    const a = s[i - 1] || '', b = s[i + len] || '';
    if (bound === 'digit') return !isDigit(a) && !isDigit(b);
    if (bound === 'alnum') return !isDigit(a) && !isDigit(b) && !isLetter(a) && !isLetter(b);
    if (bound === 'alpha') return !isLetter(a) && !isLetter(b);
    if (bound === 'roman') {
      // A Roman numeral may sit right after a "V" for volume ("VIIN4" is V + II + N4) but must not run into more numerals or digits.
      const romanLetter = c => /[ivxlcdm]/i.test(c);
      const okBefore = !isDigit(a) && (!isLetter(a) || (/v/i.test(a) && !isLetter(s[i - 2] || '')));
      return okBefore && !isDigit(b) && !romanLetter(b);
    }
    return true;
  }
  // The ways a value may be written inside a short name.
  function variants(field, value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return [];
    const bound = /^\d.*\d$|^\d$/.test(v) ? 'digit' : isRoman(v) ? 'roman' : /^[A-Za-z]/.test(v) ? 'alpha' : 'none';
    const out = [{ text: v, form: 'asis', bound }];
    if (field === 'months') {
      const p = parsePeriod(v);
      if (p) {
        [{ full: true, autumn: p.autumn }, { full: false, autumn: p.autumn }, { full: p.full, autumn: !p.autumn }].forEach(st => {
          const t = periodLabel(p.idx, p.kind, st);
          if (t && !out.some(o => o.text === t)) out.push({ text: t, form: p.kind === 'seasons' ? (st.autumn ? 'autumn' : 'fall') : (st.full ? 'full' : 'abbr'), bound: 'alpha' });
        });
      }
    } else if (field !== 'year') {
      if (/^\d+$/.test(v) && parseInt(v, 10) > 0 && parseInt(v, 10) < 4000) out.push({ text: intToRoman(parseInt(v, 10)), form: 'roman', bound: 'roman' });
      if (isRoman(v)) out.push({ text: String(romanToInt(v)), form: 'arabic', bound: 'digit' });
    }
    return out;
  }
  function findFrom(s, pos, vars, field) {
    let best = null;
    vars.forEach(o => {
      for (let i = s.indexOf(o.text, pos); i !== -1; i = s.indexOf(o.text, i + 1)) {
        if (bounded(s, i, o.text.length, o.bound)) {
          // Remember how the number is written here, so the next one is written the same way.
          const form = o.form !== 'asis' ? o.form : /^\d+$/.test(o.text) ? 'arabic' : isRoman(o.text) && field !== 'months' ? 'roman' : 'asis';
          if (!best || i < best.i) best = { i, len: o.text.length, form };
          break;
        }
      }
    });
    return best;
  }
  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(p => out.push([x].concat(p))));
    return out;
  }
  // The pattern of a short name: the literal text around the places where its numbers and date appear.
  function nameTemplate(name, vals) {
    const s = String(name || '');
    const present = NAME_FIELDS.filter(f => String(vals[f] == null ? '' : vals[f]).trim());
    // Each field's ways of being written, once, not again for every order tried (up to 120).
    const vars = {};
    present.forEach(f => { vars[f] = variants(f, vals[f]); });
    let best = { parts: [s], fields: [], score: 0 };
    permutations(present).forEach(perm => {
      let pos = 0, score = 0;
      const parts = [], fields = [];
      perm.forEach(f => {
        const hit = findFrom(s, pos, vars[f], f);
        if (!hit) return;
        const before = s.slice(pos, hit.i);
        const hinted = HINT[f] && HINT[f].test(s.slice(Math.max(0, hit.i - 14), hit.i));
        parts.push(before, { field: f, form: hit.form });
        fields.push(f);
        score += 10 + (hinted ? 1 : 0);
        pos = hit.i + hit.len;
      });
      parts.push(s.slice(pos));
      if (score > best.score) best = { parts, fields, score };
    });
    return best;
  }
  function render(field, form, value) {
    const v = String(value == null ? '' : value).trim();
    if (field === 'months') {
      const p = parsePeriod(v);
      if (!p || form === 'asis') return v;
      return periodLabel(p.idx, p.kind, { full: form === 'full', autumn: form === 'autumn' });
    }
    if (form === 'roman' && /^\d+$/.test(v) && parseInt(v, 10) > 0) return intToRoman(parseInt(v, 10));
    if (form === 'arabic' && isRoman(v)) return String(romanToInt(v));
    return v;
  }
  function fillTemplate(tpl, vals) {
    return tpl.parts.map(p => typeof p === 'string' ? p : render(p.field, p.form, vals[p.field])).join('');
  }
  // "Example Gazette V1 I2 N2"; a Roman volume gets a point so it can't run into the letter: "Sample Newsletter V.II I.IV".
  function defaultShortName(title, vals) {
    const n = (letter, v) => { v = String(v == null ? '' : v).trim(); return v ? letter + (isRoman(v) ? '.' : '') + v : ''; };
    const numbering = [n('V', vals.volume), n('I', vals.issue), n('N', vals.number)].filter(Boolean);
    const rest = numbering.length ? numbering : [vals.months, vals.year].map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    return [String(title || '').trim()].concat(rest).filter(Boolean).join(' ');
  }
  // A Roman numeral written against a letter can't be read back ("VXIIIN2": XIII or XII?).
  // Give it a point before and a space after: "V.XIII N2".
  function separateRoman(tpl) {
    const parts = tpl.parts.slice();
    parts.forEach((p, k) => {
      if (typeof p === 'string' || p.form !== 'roman') return;
      const before = parts[k - 1], after = parts[k + 1];
      if (typeof before === 'string' && isLetter(before.slice(-1))) parts[k - 1] = before + '.';
      if (typeof after === 'string' && isLetter(after.charAt(0))) parts[k + 1] = ' ' + after;
    });
    return Object.assign({}, tpl, { parts });
  }
  // The same short name with its Roman numerals separated, or null when it needs no change.
  function fixShortName(name, vals) {
    if (!name) return null;
    const tpl = nameTemplate(name, vals);
    if (!tpl.fields.length || fillTemplate(tpl, vals) !== name) return null;
    const out = fillTemplate(separateRoman(tpl), vals);
    return out !== name ? out : null;
  }
  /* Short name of the next issue: the previous issue's short name with its numbers and date
     replaced, when they can be found in it; otherwise the default pattern. */
  function nextShortName(prevName, prevVals, newVals, title) {
    if (prevName) {
      const tpl = separateRoman(nameTemplate(prevName, prevVals));
      if (tpl.fields.length && tpl.fields.every(f => String(newVals[f] == null ? '' : newVals[f]).trim())) {
        const out = fillTemplate(tpl, newVals);
        const same = NAME_FIELDS.every(f => String(prevVals[f] || '').trim() === String(newVals[f] || '').trim());
        if (out !== prevName || same) return out;
      }
    }
    return defaultShortName(title, newVals);
  }

  SC.numbering = {
    isRoman, romanToInt, intToRoman, incrementString, firstOf, numberOf, firstNumberOf, gapBetween, numbersHeld, runGaps,
    MONTHS, MON3, SEASONS, parsePeriod, periodLabel, periodStyle, circularRun,
    DATE_MODES, advanceDate, inferCadence, nextIssue, bumpYear,
    nameTemplate, fillTemplate, defaultShortName, nextShortName, fixShortName
  };
})(globalThis.SC = globalThis.SC || {});
