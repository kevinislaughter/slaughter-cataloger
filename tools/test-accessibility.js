#!/usr/bin/env node
/* Slaughter Cataloger 3 — accessibility in the browser (Stage A6: the A1 audit's A11Y-02, A11Y-04 and
   A11Y-05, and defect DF-13).

   usage: SC_AXE=<axe.min.js> node tools/test-accessibility.js <app.html>

   Two invented libraries, each in a folder held by tools/lib/held-folder.js: the sample library
   (sample-data/3.0/example-library, read only; one of its titles has a run of 309 issues) and the
   library of tools/lib/integrity-library.js (headings, and a title taken out of its Titles file).
   What the app does was established from the code first; each section checks it:
   1  axe-core (SC_AXE; run-tests.sh installs 4.10.2) with every rule it runs by default: WCAG 2.0,
      2.1 and 2.2 at levels A and AA, and its best practices. No violation at all, on every stage and
      on the states within them (A11Y-02, DF-13). Without SC_AXE this section is not run, and the run
      says so;
   2  text inside fields (placeholders), which axe-core does not measure: at least 4.5:1 (A11Y-02);
   3  headings and names: one h1 on every view; the Library list's last column named; the stages that
      cannot be opened yet marked so; the grid toolbar's arrows named; no character reference such as
      "&lt;" shown as text, and the Guide's file-name patterns shown with < and > (A11Y-02);
   4  reflow: no page scrolls sideways at 320 or 640 px wide (a window zoomed to 400% or 200%), on any
      stage; in a window 320 × 256 the bars scroll with the page and leave room for it; where the top
      bar wraps (1024 px; 1280 px for a library with a long name) what stays in view below it is not
      under it: the context bar, the grid's tools, the Names list, the Compiler's preview (A11Y-05);
   5  focus: Tab and Shift+Tab through the views at 1280 × 800, 1024 × 768 and 320 × 640: every stop
      visibly marked, and none hidden beneath a bar that stays in view (A11Y-04);
   6  the keyboard in Library: Load CSV files reached with Tab and opening the file chooser, a new
      library's form opened and closed, a title opened from the list, the list sorted by a column with
      Enter and Space (A11Y-04, LIB-15);
   7  the keyboard in Issues: the run and the strip each one stop for Tab, the arrow keys, Home and
      End moving along them, Enter opening; an issue opened from the overview's list; a new issue
      started and recorded (A11Y-04);
   8  the keyboard in Contents: an issue opened from the list; an item typed, nested, deleted with
      Alt+Shift+Delete and brought back with Ctrl+Z (A11Y-04);
   9  the keyboard in Names: the list one stop for Tab, a name opened, a heading made; a suggested
      match combined (A11Y-04).
   Every section starts from a new browser profile. Fails on any page error or failed check. */
'use strict';
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
const AXE = process.env.SC_AXE ? path.resolve(process.env.SC_AXE) : '';
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, CSV = SCx.csv, S = SCx.schema;
const H = require('./lib/held-folder');
const L = require('./lib/integrity-library')(SCx);
const DIR = path.join(ROOT, 'sample-data', '3.0', 'example-library');
const readSample = () => Object.fromEntries(fs.readdirSync(DIR).filter(n => /\.csv$/.test(n)).sort().map(n => [n, fs.readFileSync(path.join(DIR, n), 'utf8')]));
const SAMPLE = readSample();
const G = 'EXAGAZEX-1872';                               // The Example Gazette: 309 issues
// The sample library under a long name, so that the top bar wraps onto a second line at 1280 px.
const LONG = (() => {
  const n = Object.keys(SAMPLE).find(k => /_TITLES\.csv$/.test(k)), p = CSV.parse(SAMPLE[n]), c = p.rows[0].indexOf('Title Library Name');
  p.rows.slice(1).forEach(r => { if (r.length > c) r[c] = 'Example Library of Invented Serials, Pamphlets, Almanacs and Broadsides'; });
  return Object.assign({}, SAMPLE, { [n]: CSV.serialize(p.rows, p.style) });
})();
// The integrity library without The Model Weekly in its Titles file: its issue and contents remain.
const ORPHAN = (() => {
  const p = CSV.parse(L.files[L.names.titles]), c = p.rows[0].indexOf(S.entities.title.byKey.get('titleID').header);
  return Object.assign({}, L.files, { [L.names.titles]: CSV.serialize(p.rows.filter((r, i) => i === 0 || r[c] !== L.ids.MODEL), p.style) });
})();

const log = [], errors = [];
let failures = 0, count = 0, axeRun = false;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900))); if (!cond) failures++; };

// ── In the page ─────────────────────────────────────────────────────────
// The focused element: a short description, whether its focus is marked (an outline, a shadow, or a
// border in the focus blue), and how much of it can be seen (points of it not covered by anything else).
function focusInfo() {
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const again = !!e.__a11ySeen; e.__a11ySeen = true;
  const text = (e.getAttribute('aria-label') || e.textContent || e.value || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const d = e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (text ? ' "' + text + '"' : '');
  const cs = getComputedStyle(e), BLUE = 'rgb(31, 95, 168)';
  const marked = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1 && !/, 0\)$/.test(cs.outlineColor)) || cs.boxShadow !== 'none' ||
    ['Top', 'Right', 'Bottom', 'Left'].some(s => cs['border' + s + 'Style'] !== 'none' && parseFloat(cs['border' + s + 'Width']) >= 1 && cs['border' + s + 'Color'] === BLUE);
  const b = e.getBoundingClientRect();
  const pts = [[.5, .5], [.15, .25], [.85, .25], [.15, .75], [.85, .75]].map(([x, y]) => [b.left + x * b.width, b.top + y * b.height]).filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
  let seen = 0, over = '';
  pts.forEach(([x, y]) => { const t = document.elementFromPoint(x, y); if (t && (t === e || e.contains(t) || t.contains(e))) seen++; else if (t) over = ((t.closest('.topbar, .context-bar, .grid-tools, .sticky-actions, .rail') || t).className || t.tagName).toString().split(' ')[0]; });
  return { d, marked, seen, over: pts.length ? over : 'off screen', again, end: e.id === '__a11y_end' };
}
// The lowest contrast of the placeholder text of the fields in view: [ratio, field].
function placeholderContrast() {
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const v = c.slice(0, 3).map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || c[3] > 0) return c; } return [255, 255, 255]; };
  let worst = [99, ''], n = 0;
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
    if (!el.placeholder || el.offsetParent === null || el.value) return;
    n++;
    const ps = getComputedStyle(el, '::placeholder'), bg = bgOf(el), fg0 = rgb(ps.color), a = (fg0[3] == null ? 1 : fg0[3]) * parseFloat(ps.opacity);
    const fg = fg0.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const L1 = lum(fg), L2 = lum(bg), r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (r < worst[0]) worst = [Math.round(r * 100) / 100, (el.getAttribute('aria-label') || el.placeholder) + ': ' + ps.color + ' on rgb(' + bg.join(', ') + ')'];
  });
  return { worst, n };
}

(async () => {
  const browser = await chromium.launch();
  const runs = [];
  async function open(files, opts) {
    opts = opts || {};
    const run = await H.open(browser, app, files, { viewport: opts.viewport, noOpen: opts.noOpen, onPage: p => {
      p.on('pageerror', e => errors.push('page error: ' + e.message));
      p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
      p.dialogs = [];
      p.on('dialog', d => { p.dialogs.push(d.message()); d.accept(); });
      p.setDefaultTimeout(8000);
    } });
    runs.push(run);
    if (!opts.noOpen) await run.page.waitForSelector('table.shelf tbody tr');
    return run.page;
  }
  const only = (process.env.SC_SECTIONS || '').split(',').filter(Boolean);
  const section = async (name, fn) => {
    if (only.length && only.indexOf(name.split('.')[0]) === -1) return;
    step(name);
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
    while (runs.length) await runs.pop().close().catch(() => {});
  };
  const go = async (page, hash, sel) => {
    await page.evaluate(x => { location.hash = x; }, hash);
    if (sel) await page.waitForSelector(sel);
    await page.waitForTimeout(250);
  };
  const hash = page => page.evaluate(() => decodeURIComponent(location.hash));
  const active = page => page.evaluate(() => { const e = document.activeElement; return { tag: e.tagName, cls: String(e.className || ''), text: (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 60), href: e.getAttribute('href') || '', inMain: !!e.closest('.issue-main'), inRun: !!e.closest('.run-list'), inStrip: !!e.closest('.strip'), inGrid: !!e.closest('table.grid-toc') }; });
  // Tab until the focused element matches (a CSS selector, and its text if given), at most n times: true if it was reached.
  const tabTo = async (page, sel, n, text) => {
    for (let k = 0; k < (n || 80); k++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(([s, t]) => { const e = document.activeElement; return !!e && e.matches(s) && (!t || e.textContent.trim() === t); }, [sel, text || ''])) return true;
    }
    return false;
  };
  const issuesOf = (page, tid) => page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => i.issueID), tid);
  const sample = () => open(SAMPLE);
  // The views of the sample library, by name: [hash, selector to wait for].
  const VIEWS = async page => {
    const iids = await issuesOf(page, G);
    return {
      'Library': ['#/library', 'table.shelf'], 'Title': ['#/library/' + G, '.entry-card'], 'New title': ['#/library/new', '.entry-card'],
      'Names': ['#/names', '.nm-list'], 'Issues': ['#/issues/' + G, 'table.list'], 'Issue': ['#/issues/' + G + '/' + iids[3], '.issue-main .field'],
      'New issue': ['#/issues/' + G + '/new', '.draft-card'], 'Contents list': ['#/contents/' + G, 'table.list'], 'Contents grid': ['#/contents/' + G + '/' + iids[3], 'table.grid-toc'],
      'Compiler': ['#/compiler', '.cmp-layout'], 'Search': ['#/search?q=public', '.search-group'], 'Guide': ['#/guide', '.guide']
    };
  };

  await section('1. axe-core on every stage and the states within them: no violations (A11Y-02, DF-13)', async () => {
    if (!AXE) { log.push('  (not run: SC_AXE is not set. run-tests.sh sets it, installing axe-core 4.10.2.)'); return; }
    axeRun = true;
    step('axe-core ' + JSON.parse(fs.readFileSync(path.join(path.dirname(AXE), 'package.json'), 'utf8')).version + ', every rule it runs by default');
    const scan = async (page, what) => {
      await page.waitForTimeout(250);
      if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: AXE });
      const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(x => x.id + ' (' + x.impact + ') ×' + x.nodes.length + ': ' + x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')));
      expect(v.length === 0, what + ': no violations', v);
    };
    let page = await open(SAMPLE, { noOpen: true });
    await scan(page, 'the welcome page');
    await page.click('text=Start a new library'); await page.waitForSelector('#nl-name');
    await scan(page, 'the welcome page, a new library\'s form');
    await runs.pop().close();
    page = await sample();
    const V = await VIEWS(page);
    await go(page, ...V['Library']); await scan(page, 'Library');
    await page.click('.lib-actions button:has-text("Library details")'); await page.waitForTimeout(200); await scan(page, 'Library, its details open');
    await go(page, ...V['Title']); await scan(page, 'a title');
    await go(page, ...V['New title']); await scan(page, 'a new title');
    await go(page, ...V['Names']); await scan(page, 'Names');
    await page.click('.nm-row >> nth=0'); await page.waitForSelector('.nm-make'); await scan(page, 'Names, a name');
    await page.click('.seg-btn:has-text("Suggested matches")'); await page.waitForTimeout(200); await scan(page, 'Names, Suggested matches');
    await go(page, ...V['Issues']); await scan(page, 'Issues, the run');
    await go(page, ...V['Issue']); await scan(page, 'an issue');
    await page.click('.issue-main details.collapsible > summary'); await page.waitForTimeout(150); await scan(page, 'an issue, its title-level fields open');
    await go(page, ...V['New issue']); await scan(page, 'a new issue');
    await go(page, ...V['Contents list']); await scan(page, 'Contents, the issues');
    await go(page, ...V['Contents grid']); await page.click('table.grid-toc tbody tr:nth-child(2) .cell >> nth=0'); await scan(page, 'Contents, an item\'s cell chosen');
    await page.click('button:has-text("Add several items")'); await page.waitForSelector('.bulk-text'); await scan(page, 'Contents, Add several items');
    await go(page, ...V['Compiler']); await scan(page, 'the Compiler, nothing chosen');
    await page.click('.cmp-title >> nth=0'); await page.waitForSelector('.cmp-bar'); await scan(page, 'the Compiler, a title chosen');
    await go(page, ...V['Search']); await scan(page, 'Search, results');
    await go(page, '#/search', '.search-help'); await scan(page, 'Search, nothing asked yet');
    await go(page, ...V['Guide']); await scan(page, 'the Guide');
    await runs.pop().close();
    page = await open(ORPHAN);
    await scan(page, 'Library, a title missing from the Titles file');
    await go(page, '#/names/' + L.ids.PUBLIC, '.nm-detail'); await scan(page, 'Names, a heading');
    await go(page, '#/issues/' + L.ids.MODEL + '/' + L.ids.M1, '.issue-main'); await scan(page, 'an issue that cannot be changed');
    await go(page, '#/contents/' + L.ids.MODEL + '/' + L.ids.M1, 'table.grid-toc'); await scan(page, 'its contents');
  });

  await section('2. Text inside fields, which axe-core does not measure: at least 4.5:1 (A11Y-02)', async () => {
    const page = await sample();
    const V = await VIEWS(page);
    for (const name of ['Library', 'Title', 'New title', 'Names', 'Issue', 'New issue', 'Contents grid', 'Compiler']) {
      await go(page, ...V[name]);
      const r = await page.evaluate(placeholderContrast);
      expect(r.n > 0 && r.worst[0] >= 4.5, name + ': ' + r.n + ' fields with placeholder text, the lowest contrast ' + r.worst[0] + ':1', r.worst[1]);
    }
  });

  await section('3. Headings, names, and text as it should read (A11Y-02)', async () => {
    let page = await open(SAMPLE, { noOpen: true });
    const h1s = () => page.evaluate(() => Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()));
    let h = await h1s();
    expect(h.length === 1 && h[0] === 'Slaughter Cataloger', 'the welcome page: one h1', h);
    const off = () => page.evaluate(() => Array.from(document.querySelectorAll('.stages a')).map(a => a.textContent.replace(/^\d/, '') + ':' + (a.getAttribute('aria-disabled') || '-')));
    let o = await off();
    expect(o.join(' ') === 'Library:- Issues:true Contents:true Compiler:true', 'before a library is open, Issues, Contents and Compiler are marked aria-disabled; Library is not', o);
    await page.click('text=Open library folder'); await page.waitForSelector('table.shelf tbody tr');
    o = await off();
    expect(o.every(x => /:-$/.test(x)), 'with a library open, no stage is marked disabled', o);
    const V = await VIEWS(page);
    const expected = { 'Library': 'Example Library', 'Title': 'Title: The Example Gazette', 'New title': 'New title', 'Names': 'Example Library', 'Issues': 'Issues of The Example Gazette',
      'Issue': 'Issue: Example Gazette V1 I4 N4', 'New issue': /^New issue of The Example Gazette$/, 'Contents list': 'Contents of The Example Gazette', 'Contents grid': 'Contents of Example Gazette V1 I4 N4',
      'Compiler': 'Compiler', 'Search': 'Search', 'Guide': 'Guide' };
    for (const name of Object.keys(expected)) {
      await go(page, ...V[name]);
      h = await h1s();
      const want = expected[name];
      expect(h.length === 1 && (want instanceof RegExp ? want.test(h[0]) : h[0] === want), name + ': one h1, "' + (want instanceof RegExp ? want.source.replace(/^\^|\$$/g, '') : want) + '"', h);
      const ent = await page.evaluate(() => (document.querySelector('.main-col').innerText.match(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi) || []).slice(0, 5));
      expect(ent.length === 0, name + ': no character reference shown as text', ent);
    }
    await go(page, ...V['Library']);
    const th = await page.evaluate(() => Array.from(document.querySelectorAll('table.shelf thead th')).map(t => t.textContent.trim()));
    expect(th.length === 8 && th.every(Boolean) && th[7] === 'Open', 'Library: every column of the list named, the last "Open" (for screen readers only)', th);
    expect(await page.evaluate(() => { const sp = document.querySelector('table.shelf thead th:last-child span'); return !!sp && getComputedStyle(sp).position === 'absolute'; }), 'the last column\'s name is not shown on screen');
    await go(page, ...V['Contents grid']);
    const tools = await page.evaluate(() => Array.from(document.querySelectorAll('.grid-tools button')).map(b => b.getAttribute('aria-label') || b.textContent.trim()));
    expect(tools.indexOf('Move up') !== -1 && tools.indexOf('Move down') !== -1 && tools.indexOf('↑') === -1, 'the grid toolbar\'s ↑ and ↓ are named Move up and Move down', tools);
    await go(page, ...V['Guide']);
    const guide = await page.evaluate(() => document.querySelector('.guide').innerText);
    ['_backups/<date-time>-<code>', 'SCAT_<library>_AUTHORITIES.csv', 'AUTHORITY_<TitleID>.csv', 'SCATOUT_<library>_<TitleID>_<output>_<date>', 'on semicolons, on “&”']
      .forEach(t => expect(guide.indexOf(t) !== -1, 'the Guide reads "' + t + '"'));
  });

  await section('4. Reflow: nothing scrolls sideways at 320 or 640 px; the bars in a short window and where the top bar wraps (A11Y-05)', async () => {
    for (const w of [320, 640]) {
      const page = await open(SAMPLE, { viewport: { width: w, height: 800 } });
      const V = await VIEWS(page);
      for (const name of Object.keys(V)) {
        await go(page, ...V[name]);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, wide: Array.from(document.querySelectorAll('.main-col *')).filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.table-wrap, .cmp-preview, .strip-rows, .run-list')).slice(0, 3).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) }));
        expect(m.sw <= m.iw, w + ' px, ' + name + ': the page is ' + m.sw + ' px wide', m.wide);
      }
      await runs.pop().close();
    }
    // A window 320 × 256: a page zoomed to 400% on a 1280 × 1024 screen.
    let page = await open(SAMPLE, { viewport: { width: 320, height: 256 } });
    let V = await VIEWS(page);
    for (const name of ['Issue', 'New issue', 'Contents grid', 'Names', 'Compiler']) {
      await go(page, ...V[name]);
      const st = await page.evaluate(() => Array.from(document.querySelectorAll('.topbar, .context-bar, .grid-tools, .sticky-actions, .run, .nm-list, .cmp-preview')).filter(e => getComputedStyle(e).position === 'sticky').map(e => e.className.split(' ')[0]));
      expect(st.length === 0, '320 × 256, ' + name + ': nothing stays in view as the page scrolls', st);
    }
    await go(page, ...V['Issue']);
    await page.focus('.issue-main input[type=text]');
    const seen = await page.evaluate(() => { const e = document.activeElement, b = e.getBoundingClientRect(), t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t === e || e.contains(t); });
    expect(seen, '320 × 256, an issue: its first field, once reached, can be seen');
    await runs.pop().close();
    // Where the top bar wraps onto a second line, the bars below are placed under it, not beneath it.
    for (const [w, hgt] of [[1024, 768], [1280, 800], [640, 600]]) {
      page = await open(SAMPLE, { viewport: { width: w, height: hgt } });
      V = await VIEWS(page);
      await go(page, ...V['Contents grid']);
      await page.evaluate(() => scrollTo(0, 400)); await page.waitForTimeout(250);
      const r = await page.evaluate(() => { const b = s => { const e = document.querySelector(s); if (!e || getComputedStyle(e).position !== 'sticky') return null; const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
        return { top: b('.topbar'), ctx: b('.context-bar'), tools: b('.grid-tools') }; });
      const ok = r.top && r.tools && (!r.ctx || (r.ctx[0] >= r.top[1] - 1 && r.tools[0] >= r.ctx[1] - 1)) && (r.ctx || r.tools[0] >= r.top[1] - 1);
      expect(ok, w + ' × ' + hgt + ', the Contents grid scrolled: top bar ' + JSON.stringify(r.top) + ', context bar ' + JSON.stringify(r.ctx) + ', grid tools ' + JSON.stringify(r.tools) + ', each below the last', r);
      await go(page, ...V['Names']);
      const n = await page.evaluate(() => { const t = document.querySelector('.topbar').getBoundingClientRect(), l = document.querySelector('.nm-list'); return [Math.round(t.bottom), getComputedStyle(l).position, parseFloat(getComputedStyle(l).top)]; });
      expect(n[1] !== 'sticky' || n[2] >= n[0], w + ' × ' + hgt + ', Names: the list stays in view below the top bar (' + n[2] + ' px, the bar ending at ' + n[0] + ')', n);
      await runs.pop().close();
    }
    // A library with a long name: at 1280 px the top bar wraps, and the Names list and the Compiler's preview,
    // which stay in view beside the page at that width, must be placed below it.
    page = await open(LONG, { viewport: { width: 1280, height: 800 } });
    const tb = await page.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom));
    expect(tb > 60, '1280 × 800, a library with a long name: the top bar on two lines (ending at ' + tb + ' px)');
    for (const [name, hash, sel] of [['Names', '#/names', '.nm-list'], ['the Compiler', '#/compiler', '.cmp-preview']]) {
      await go(page, hash, sel);
      const n = await page.evaluate(s => { const t = document.querySelector('.topbar').getBoundingClientRect(), l = document.querySelector(s); return [Math.round(t.bottom), getComputedStyle(l).position, parseFloat(getComputedStyle(l).top)]; }, sel);
      expect(n[1] === 'sticky' && n[2] >= n[0], '1280 × 800, a long name, ' + name + ': ' + sel.slice(1) + ' stays in view below the top bar (' + n[2] + ' px, the bar ending at ' + n[0] + ')', n);
    }
    await runs.pop().close();
  });

  await section('5. Focus: every stop marked and none hidden beneath a bar, Tab and Shift+Tab (A11Y-04)', async () => {
    const SIZES = [[1280, 800, null], [1024, 768, ['Title', 'Names', 'Issue', 'New issue', 'Contents grid', 'Search']], [320, 640, ['Title', 'Names', 'Issue', 'New issue', 'Contents grid', 'Search']]];
    for (const [w, hgt, names] of SIZES) {
      const page = await open(SAMPLE, { viewport: { width: w, height: hgt } });
      const V = await VIEWS(page);
      for (const name of names || Object.keys(V)) {
        for (const back of [false, true]) {
          await go(page, ...V[name]);
          await page.evaluate(b => {
            document.querySelectorAll('*').forEach(e => { delete e.__a11ySeen; });
            if (document.activeElement) document.activeElement.blur();
            const old = document.getElementById('__a11y_end'); if (old) old.remove();
            if (b) { const x = document.createElement('button'); x.id = '__a11y_end'; x.textContent = 'end'; document.body.appendChild(x); x.focus({ preventScroll: true }); scrollTo(0, document.documentElement.scrollHeight); }
            else scrollTo(0, 0);
          }, back);
          let stops = 0; const unmarked = [], hidden = [];
          for (let k = 0; k < 160; k++) {
            await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
            const r = await page.evaluate(focusInfo);
            if (!r) continue;
            if (r.again || r.end) break;
            stops++;
            if (!r.marked) unmarked.push(r.d);
            if (!r.seen) hidden.push(r.d + ' (under ' + r.over + ')');
          }
          const what = w + ' × ' + hgt + ', ' + name + ', ' + (back ? 'Shift+Tab' : 'Tab') + ': ' + stops + ' stops';
          expect(stops > 0 && unmarked.length === 0, what + ', each marked', unmarked.slice(0, 6));
          expect(hidden.length === 0, what + ', none hidden', hidden.slice(0, 6));
        }
      }
      await runs.pop().close();
    }
  });

  await section('6. The keyboard in Library: loading files, a new library\'s form, a title opened, the list sorted (A11Y-04, LIB-15)', async () => {
    let page = await open(SAMPLE, { noOpen: true });
    const stops = [];
    for (let k = 0; k < 20; k++) { await page.keyboard.press('Tab'); const a = await active(page); stops.push(a.tag + ' ' + a.text); if (a.text === 'Start a new library') break; }
    expect(stops.indexOf('BUTTON Open library folder') !== -1 && stops.indexOf('BUTTON Load CSV files') !== -1 && stops.indexOf('BUTTON Start a new library') !== -1,
      'the welcome page: Open library folder, Load CSV files and Start a new library are each reached with Tab', stops);
    await page.focus('text=Load CSV files');
    // Listening for the file chooser turns on its interception, which takes a moment; Enter after that.
    const waiting = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    const chooser = await waiting;
    expect(!!chooser && chooser.isMultiple(), 'Enter on Load CSV files opens the file chooser, for several files');
    if (chooser) {
      await chooser.setFiles(Object.keys(SAMPLE).map(n => ({ name: n, mimeType: 'text/csv', buffer: Buffer.from(SAMPLE[n], 'utf8') })));
      await page.waitForSelector('table.shelf tbody tr');
      expect(await page.evaluate(() => SC.session.ui.mode === 'files' && SC.session.store.state.titles.size === 5), 'the files chosen are loaded (5 titles)');
    } else expect(false, 'the files chosen are loaded (5 titles)', 'no file chooser, so nothing chosen');
    await runs.pop().close();
    page = await open(SAMPLE, { noOpen: true });
    await page.focus('button:has-text("Start a new library")'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    expect(await page.isVisible('#nl-name'), 'Enter on Start a new library opens its form');
    await page.keyboard.type('Keyboard Library');
    expect(await page.inputValue('#nl-slug') === 'KEYBOARD-LIBRARY', 'typed in its first field without the mouse, the slug follows');
    expect(await tabTo(page, 'button', 12, 'Cancel'), 'Tab reaches Cancel');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    expect(!(await page.isVisible('#nl-name')) && await page.isVisible('text=Open library folder'), 'Enter on Cancel closes the form');
    expect((await active(page)).text === 'Start a new library', 'and the focus is back on Start a new library', await active(page));
    await runs.pop().close();

    page = await sample();
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    const reached = await tabTo(page, 'table.shelf a.row-main', 60);
    const a = await active(page);
    expect(reached && a.text === 'The Demonstration Quarterly', 'Library: Tab reaches the first title in the list, as a link', a);
    expect(await tabTo(page, 'table.shelf a.row-main', 6) && (await active(page)).text === 'The Example Gazette', 'and the next title after its Issues link');
    await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    expect(await hash(page) === '#/library/' + G && (await page.textContent('h1')) === 'Title: The Example Gazette', 'Enter opens the title', await hash(page));
    await page.goBack(); await page.waitForSelector('table.shelf tbody tr');
    const sortBtns = await page.evaluate(() => Array.from(document.querySelectorAll('table.shelf th.sortable')).map(t => { const b = t.querySelector('button.sort'); return b && b.type === 'button' && b.tabIndex === 0 ? b.textContent.trim() : null; }));
    expect(sortBtns.length === 7 && sortBtns.every(Boolean), 'each of the 7 column headings holds a button', sortBtns);
    const order = () => page.evaluate(() => ({ sort: Array.from(document.querySelectorAll('table.shelf th')).map(t => t.getAttribute('aria-sort')).join(','), rows: Array.from(document.querySelectorAll('table.shelf tbody tr td:nth-child(5)')).map(t => parseInt(t.textContent.replace(/,/g, ''), 10) || 0) }));
    await page.locator('table.shelf thead').getByText('Issues', { exact: true }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    let o = await order();
    expect(o.sort.split(',')[4] === 'ascending' && o.rows.join() === o.rows.slice().sort((x, y) => x - y).join(), 'Enter on Issues sorts by it, fewest first; aria-sort "ascending"', o);
    await page.keyboard.press('Space'); await page.waitForTimeout(150);
    o = await order();
    expect(o.sort.split(',')[4] === 'descending' && o.rows.join() === o.rows.slice().sort((x, y) => y - x).join() && o.sort.split(',').filter(x => x === 'none').length === 6, 'Space again: most first, "descending"; the other columns "none"', o);
  });

  await section('7. The keyboard in Issues: the run and the strip, an issue opened, a new issue recorded (A11Y-04)', async () => {
    const page = await sample();
    const iids = await issuesOf(page, G);
    await go(page, '#/issues/' + G + '/' + iids[3], '.issue-main .field');
    const tabbable = () => page.evaluate(() => Array.from(document.querySelectorAll('.run-list a')).filter(a => a.tabIndex === 0).map(a => a.getAttribute('href')));
    let t = await tabbable();
    expect(t.length === 1 && t[0].endsWith(iids[3]), 'the run: one link in the Tab order, the issue open', t);
    await page.focus('.run input[type=search]'); await page.keyboard.press('Tab');
    let a = await active(page);
    expect(a.inRun && a.href.endsWith(iids[3]), 'Tab from Find an issue reaches the issue open', a);
    await page.keyboard.press('Tab');
    a = await active(page);
    expect(a.inMain && !a.inRun, 'the next Tab leaves the run for the issue\'s form (not 308 more links)', a);
    await page.keyboard.press('Shift+Tab');
    for (const [key, n, what] of [['ArrowDown', 4, 'ArrowDown: the next issue'], ['ArrowUp', 3, 'ArrowUp: back'], ['ArrowUp', 2, 'ArrowUp again'], ['End', iids.length - 1, 'End: the last issue'], ['Home', 0, 'Home: the first'], ['ArrowUp', 0, 'ArrowUp at the first: stays']]) {
      await page.keyboard.press(key);
      a = await active(page); t = await tabbable();
      expect(a.inRun && a.href.endsWith(iids[n]) && t.length === 1 && t[0] === a.href, 'the run, ' + what + ', the only link in the Tab order', { a, t });
    }
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    expect(await hash(page) === '#/issues/' + G + '/' + iids[1], 'Enter opens it', await hash(page));
    await page.keyboard.press('Tab'); a = await active(page);
    expect(a.inMain, 'and Tab goes on into its form', a);

    await go(page, '#/issues/' + G, 'table.list');
    const strip = () => page.evaluate(() => ({ tab: Array.from(document.querySelectorAll('.strip a.sc')).filter(x => x.tabIndex === 0).map(x => x.getAttribute('href')), rows: Array.from(document.querySelectorAll('.strip-row')).map(r => Array.from(r.querySelectorAll('a.sc')).map(x => x.getAttribute('href'))) }));
    let s = await strip();
    expect(s.tab.length === 1 && s.tab[0].endsWith(iids[0]), 'the strip: one square in the Tab order, the first issue\'s', s.tab);
    await page.focus('.panel-head button:has-text("New issue")'); await page.keyboard.press('Tab');
    a = await active(page);
    expect(a.inStrip && a.href.endsWith(iids[0]), 'Tab from New issue reaches the strip\'s first square', a);
    await page.keyboard.press('ArrowRight'); a = await active(page);
    expect(a.href.endsWith(iids[1]), 'ArrowRight: the next square', a.href);
    await page.keyboard.press('ArrowDown'); a = await active(page);
    expect(a.href === s.rows[1][1], 'ArrowDown: the square at the same place in the next row (v. 2, its second)', { got: a.href, want: s.rows[1][1] });
    await page.keyboard.press('ArrowUp'); a = await active(page);
    expect(a.href === s.rows[0][1], 'ArrowUp: back up', a.href);
    await page.keyboard.press('End'); a = await active(page);
    expect(a.href.endsWith(iids[iids.length - 1]), 'End: the last square', a.href);
    s = await strip();
    expect(s.tab.length === 1 && s.tab[0] === a.href, 'still one square in the Tab order: the one reached', s.tab);
    await page.keyboard.press('Tab'); a = await active(page);
    expect(/row-main/.test(a.cls) && a.href.endsWith(iids[0]), 'Tab leaves the strip for the list: its first issue, a link', a);
    await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    expect(await hash(page) === '#/issues/' + G + '/' + iids[0], 'Enter on it opens the issue', await hash(page));
    await go(page, '#/issues/' + G, 'table.list');
    await page.focus('.strip a.sc >> nth=0'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    expect(await hash(page) === '#/issues/' + G + '/' + iids[1], 'Enter on a square opens its issue', await hash(page));

    await go(page, '#/issues/' + G, 'table.list');
    await page.focus('.panel-head button:has-text("New issue")'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    expect(await hash(page) === '#/issues/' + G + '/new', 'Enter on New issue starts a new issue', await hash(page));
    expect(await tabTo(page, '.issue-main input[type=text]', 40), 'Tab reaches its first field');
    const before = (await issuesOf(page, G)).length;
    await page.keyboard.press('Control+Enter'); await page.waitForTimeout(400);
    const msg = await page.evaluate(() => (SC.session.ui.message || {}).text || '');
    a = await active(page);
    expect((await issuesOf(page, G)).length === before + 1 && /^Recorded .*The next issue is ready\.$/.test(msg), 'Ctrl+Enter records it ("Recorded … The next issue is ready.")', msg);
    expect(a.inMain && a.tag === 'INPUT', 'the focus stays in the form, ready for the next', a);
  });

  await section('8. The keyboard in Contents: an issue opened, an item typed, nested, deleted and brought back (A11Y-04)', async () => {
    const page = await sample();
    const iids = await issuesOf(page, G);
    await go(page, '#/contents/' + G, 'table.list');
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo(0, 0); });
    expect(await tabTo(page, 'table.list a.row-main', 40), 'Tab reaches the first issue in the list (past the strip, one stop)');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const a = await active(page);
    expect(/row-main/.test(a.cls) && a.href.endsWith(iids[3]), 'Tab moves down the list, issue by issue', a);
    await page.keyboard.press('Enter');
    await page.waitForSelector('table.grid-toc', { timeout: 3000 }).catch(() => {});
    expect(await hash(page) === '#/contents/' + G + '/' + iids[3], 'Enter opens the issue\'s contents', await hash(page));
    await go(page, '#/contents/' + G + '/' + iids[3], 'table.grid-toc');         // (where it should be, whatever happened above)
    const items = () => page.evaluate(i => SC.session.store.contentsOfIssue(i).map(c => ({ id: c.contentID, t: c.itemTitle, p: c.parentID, s: c.sequence })), iids[3]);
    const was = await items();
    expect(await tabTo(page, 'table.grid-toc tr.draft-row .cell[placeholder="New item"]', 140), 'Tab reaches the empty last row (' + was.length + ' items above it)');
    await page.keyboard.type('Keyboard Notes'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    let now = await items();
    const made = now.find(c => c.t === 'Keyboard Notes');
    expect(now.length === was.length + 1 && !!made && made.s === String(was.length + 1), 'typed and Enter: a new item, last', now.slice(-2));
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.activeElement.value) === 'Keyboard Notes', 'ArrowUp: back to its title');
    await page.keyboard.press('Alt+Shift+ArrowRight'); await page.waitForTimeout(250);
    now = await items();
    const prev = was[was.length - 1];
    expect(now.find(c => c.id === made.id).p === (prev.p || prev.id) || now.find(c => c.id === made.id).p === prev.id, 'Alt+Shift+→ nests it in the item above', now.slice(-2));
    await page.keyboard.press('Alt+Shift+Delete'); await page.waitForTimeout(300);
    now = await items();
    expect(now.length === was.length && !now.some(c => c.id === made.id) && JSON.stringify(now) === JSON.stringify(was), 'Alt+Shift+Delete deletes it; the others as they were', now.slice(-2));
    const f = await active(page);
    expect(f.inGrid, 'the focus stays in the grid', f);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    now = await items();
    expect(now.length === was.length + 1 && now.some(c => c.id === made.id && c.t === 'Keyboard Notes'), 'Ctrl+Z brings it back', now.slice(-2));
    const title = await page.getAttribute('.grid-tools button:has-text("Delete")', 'title');
    expect(/Alt\+Shift\+Delete/.test(title), 'the toolbar\'s Delete names the keys: "' + title + '"');
    await go(page, '#/guide', '.guide');
    expect(/Alt \+ Shift \+ Delete/.test(await page.evaluate(() => document.querySelector('.guide').innerText)), 'the Guide lists Alt + Shift + Delete');
  });

  await section('9. The keyboard in Names: the list, a name opened, a heading made, a match combined (A11Y-04)', async () => {
    const page = await sample();
    await go(page, '#/names', '.nm-list');
    const tabbable = () => page.evaluate(() => Array.from(document.querySelectorAll('.nm-list a')).filter(a => a.tabIndex === 0).map(a => a.getAttribute('href')));
    const names = await page.evaluate(() => Array.from(document.querySelectorAll('.nm-list a')).map(a => a.getAttribute('href')));
    let t = await tabbable();
    expect(names.length > 20 && t.length === 1 && t[0] === names[0], 'the list of ' + names.length + ' names: one in the Tab order, the first', t);
    await page.focus('.toolbar input[aria-label="Find a name"]'); await page.keyboard.press('Tab');
    let a = await active(page);
    expect(a.href === names[0], 'Tab from Find a name reaches it', a);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    a = await active(page); t = await tabbable();
    expect(a.href === names[2] && t.length === 1 && t[0] === names[2], 'ArrowDown twice: the third name, now the one in the Tab order', { a: a.href, t });
    await page.keyboard.press('Enter'); await page.waitForSelector('.nm-make');
    expect(await hash(page) === decodeURIComponent(names[2]), 'Enter opens it', await hash(page));
    await page.keyboard.press('Tab');
    a = await active(page);
    expect(a.tag === 'INPUT' && /nm-name-input/.test(a.cls), 'the next Tab reaches the heading to make (the list is one stop)', a);
    const heading = await page.inputValue('.nm-name-input');
    await page.keyboard.press('Tab'); a = await active(page);
    expect(a.text === 'Make heading', 'then Make heading', a);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const auth = await page.evaluate(() => Array.from(SC.session.store.state.authorities.values()).map(x => x.name));
    expect(auth.length === 1 && auth[0] === heading, 'Enter makes the heading, as in the field', { heading, auth });
    await page.focus('.seg-btn:has-text("Suggested matches")'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const groups = await page.$$eval('.nm-group', g => g.length);
    expect(groups > 0, 'Enter on Suggested matches lists ' + groups + ' groups');
    expect(await tabTo(page, '.nm-group button', 10, 'Combine'), 'Tab reaches the first group\'s Combine');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const n = await page.evaluate(() => SC.session.store.state.authorities.size);
    expect(n === 2, 'Enter combines it into a heading', n);
  });

  await browser.close();
  const after = readSample();
  expect(JSON.stringify(after) === JSON.stringify(SAMPLE), 'sample-data/3.0/example-library is unchanged');
  expect(errors.length === 0, 'no page errors', errors.slice(0, 5));
  console.log(log.join('\n'));
  if (!axeRun && !only.length) console.log('\naxe-core was not run (SC_AXE not set): section 1 is missing from this run.');
  console.log(failures ? '\nFAILED ' + failures + ' of ' + count + ' checks.' : '\nAll ' + count + ' accessibility checks passed.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
