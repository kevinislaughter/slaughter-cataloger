#!/usr/bin/env node
/* Slaughter Cataloger 3 — the smaller parts of the page (Stage A2, minor UI: the class 5 rows of the A1
   audit that no test had reached, DF-17, and the observations left for this round).

   usage: node tools/test-minor-ui.js <app.html>

   The invented sample library (sample-data/3.0/example-library, read only) in a folder held by
   tools/lib/held-folder.js. Each section starts from a new browser profile. What the app does was
   established from the code first; each section checks it:
   1  the Compiler chooses a title named in the address, also when the address changes while it is
      open (DF-17);
   2  renaming the library marks only the files that carry its name, and the top bar counts them,
      not an empty Issues file; editing its note, only the Titles file (O-1 of the data-safety round);
   3  Alt+Page Down and Page Up keep the place: the same field of the next issue, the same column of
      the next issue's first item (O-2 of the accessibility round);
   4  the load report: shown and hidden, with aria-expanded (LIB-12);
   5  the Library list's filters, with their counts (LIB-13), and Find a title (LIB-14);
   6  the Library list sorted by each column, both ways; cataloging statuses in the order of the work
      (LIB-15);
   7  the count of fields not yet addressed: on a title, and on an issue, where it goes to the first
      of them (LIB-27);
   8  the run beside an issue: the shared start of the short names shown once, numbers missing from
      the run, Find an issue (ISS-03);
   9  Shift+Enter: a new line in an item's title or note, the row above elsewhere (CON-14);
   10 the credits under a name: 60 shown, Show all (NAM-14);
   11 messages: a confirmation clears itself after about nine seconds, a notice stays until
      dismissed (NAV-08);
   12 the window's title follows the library's name (NAV-10);
   13 a count and its verb agree: the load report's button, the Compiler's note on contents left out
      (found in this round).
   Fails on any page error or failed check. */
'use strict';
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
const H = require('./lib/held-folder');
globalThis.SC = globalThis.SC || {}; require(path.join(ROOT, 'js', 'core', 'csv.js'));
const CSV = globalThis.SC.csv;
const DIR = path.join(ROOT, 'sample-data', '3.0', 'example-library');
const readSample = () => Object.fromEntries(fs.readdirSync(DIR).filter(n => /\.csv$/.test(n)).sort().map(n => [n, fs.readFileSync(path.join(DIR, n), 'utf8')]));
const SAMPLE = readSample();
const G = 'EXAGAZEX-1872', B = 'PLABULLX-1961', R = 'SAMREVIX-1990', Q = 'DEMQUARX-1995', M = 'SPEMONTX-2011';
const FT = 'SCAT_EXAMPLE-LIBRARY_TITLES.csv';

const log = [], errors = [];
let failures = 0, count = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700))); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const runs = [];
  async function open(files, opts) {
    opts = opts || {};
    const run = await H.open(browser, app, files, { viewport: opts.viewport, noOpen: opts.noOpen, onPage: p => {
      p.on('pageerror', e => errors.push('page error: ' + e.message));
      p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
      p.on('dialog', d => d.accept());
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
  const go = async (page, hash, sel) => { await page.evaluate(x => { location.hash = x; }, hash); if (sel) await page.waitForSelector(sel); await page.waitForTimeout(200); };
  const hash = page => page.evaluate(() => decodeURIComponent(location.hash));
  const dirty = page => page.evaluate(() => Array.from(SC.session.store.dirty).sort());
  const issuesOf = (page, tid) => page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => i.issueID), tid);
  const shelf = page => page.evaluate(() => Array.from(document.querySelectorAll('table.shelf tbody tr')).map(tr => tr.querySelector('td code').textContent));

  await section('1. The Compiler chooses a title named in the address, also once it is open (DF-17)', async () => {
    const page = await open(SAMPLE);
    const chosen = () => page.$$eval('.cmp-title.on .ct-name', l => l.map(x => x.textContent.trim()));
    await go(page, '#/compiler/' + R, '.cmp-layout');
    expect(same(await chosen(), ['Sample Review']), 'opened at #/compiler/' + R + ': Sample Review chosen', await chosen());
    await go(page, '#/compiler/' + Q);
    expect(same(await chosen(), ['The Demonstration Quarterly']), 'the address changed to #/compiler/' + Q + ' with the Compiler open: The Demonstration Quarterly chosen instead', await chosen());
    await page.click('.cmp-title:has-text("The Example Gazette")'); await page.waitForTimeout(150);
    expect(same((await chosen()).sort(), ['The Demonstration Quarterly', 'The Example Gazette']), 'a second title ticked: both chosen, the address unchanged', await chosen());
    await go(page, '#/compiler');
    expect(same((await chosen()).sort(), ['The Demonstration Quarterly', 'The Example Gazette']), 'the address without a title: the choice as it was', await chosen());
    await go(page, '#/compiler/NOSUCHTX-1900');
    expect(same((await chosen()).sort(), ['The Demonstration Quarterly', 'The Example Gazette']), 'a title not in the library in the address: the choice as it was', await chosen());
  });

  await section('2. Renaming the library marks only the files that carry its name; its note, only the Titles file (O-1)', async () => {
    // With an empty Issues file (its header row only, DF-19) for the title that has no issues: it carries nothing.
    const EMPTY = 'SCAT_EXAMPLE-LIBRARY_' + M + '_ISSUES.csv', some = SAMPLE['SCAT_EXAMPLE-LIBRARY_' + Q + '_ISSUES.csv'];
    const page = await open(Object.assign({}, SAMPLE, { [EMPTY]: some.slice(0, some.indexOf('\n') + 1) }));
    expect(await page.evaluate(n => { const f = SC.session.store.state.files.get(n); return !!f && f.kind === 'issue'; }, EMPTY), 'an empty Issues file loaded with the library');
    await page.click('button:has-text("Library details")');
    await page.fill('#f-name', 'Example Library, Renamed'); await page.locator('#f-name').press('Enter'); await page.waitForTimeout(150);
    const issuesFiles = Object.keys(SAMPLE).filter(n => /_ISSUES\.csv$/.test(n)).sort();
    expect(same(await dirty(page), [FT].concat(issuesFiles).sort()), 'renamed: the Titles file and the four Issues files with rows are marked changed, not the four Contents files or the empty Issues file', await dirty(page));
    expect((await page.textContent('.save-state')).trim() === '5 files changed', 'the top bar: "5 files changed"', await page.textContent('.save-state'));
    await page.click('.topbar button:has-text("Undo")'); await page.waitForTimeout(150);
    expect((await dirty(page)).length === 0 && /All changes saved/.test(await page.textContent('.save-state')), 'Undo: nothing marked changed');
    await page.fill('#f-note', 'A note, edited.'); await page.locator('#f-note').press('Enter'); await page.waitForTimeout(150);
    expect(same(await dirty(page), [FT]) && (await page.textContent('.save-state')).trim() === '1 file changed', 'the note edited: the Titles file only, "1 file changed"', await dirty(page));
  });

  await section('3. Alt+Page Down and Page Up keep the place: the same field, the same column (O-2)', async () => {
    const page = await open(SAMPLE);
    const iids = await issuesOf(page, G);
    await go(page, '#/issues/' + G + '/' + iids[3], '#f-pages');
    await page.focus('#f-pages');
    await page.keyboard.press('Alt+PageDown');
    await page.waitForFunction(id => location.hash.indexOf(id) !== -1, iids[4]); await page.waitForTimeout(300);
    let a = await page.evaluate(() => ({ id: document.activeElement.id, issue: document.activeElement.closest('.issue-main') ? location.hash : '' }));
    expect(a.id === 'f-pages' && a.issue.endsWith(iids[4]), 'Issues: in Pages, Alt+Page Down opens the next issue with the focus in its Pages', a);
    await page.keyboard.press('Alt+PageUp');
    await page.waitForFunction(id => location.hash.endsWith(id), iids[3]); await page.waitForTimeout(300);
    a = await page.evaluate(() => document.activeElement.id);
    expect(a === 'f-pages', 'Alt+Page Up: back, still in Pages', a);
    await page.keyboard.type('9');
    await page.keyboard.press('Alt+PageDown');
    await page.waitForFunction(id => location.hash.indexOf(id) !== -1, iids[4]); await page.waitForTimeout(300);
    const pages3 = await page.evaluate(id => SC.session.store.state.issues.get(id).pages, iids[3]);
    expect(/9$/.test(pages3) && await page.evaluate(() => document.activeElement.id) === 'f-pages', 'what was typed is kept on the issue left, and the focus is in the next issue\'s Pages', pages3);
    await go(page, '#/contents/' + G + '/' + iids[3], 'table.grid-toc');
    await page.focus('table.grid-toc tbody tr:nth-child(3) [data-cell$=":author"]');
    await page.keyboard.press('Alt+PageDown');
    await page.waitForFunction(id => location.hash.indexOf(id) !== -1, iids[4]); await page.waitForTimeout(300);
    const first = await page.evaluate(id => SC.session.store.contentsOfIssue(id)[0].contentID, iids[4]);
    a = await page.evaluate(() => document.activeElement.getAttribute('data-cell') || document.activeElement.tagName);
    expect(a === first + ':author', 'Contents: in Author, Alt+Page Down opens the next issue with the focus in its first item\'s Author', { a, first });
    await go(page, '#/issues/' + G + '/' + iids[3], '#f-pages');
    await page.click('.run-list .run-item.on a');
    await page.keyboard.press('Alt+PageDown');
    await page.waitForFunction(id => location.hash.indexOf(id) !== -1, iids[4]); await page.waitForTimeout(300);
    a = await page.evaluate(() => document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''));
    expect(!/^INPUT|^TEXTAREA/.test(a), 'from outside a field (the run), Alt+Page Down puts the focus in no field', a);
  });

  await section('4. The load report: shown and hidden (LIB-12)', async () => {
    const page = await open(Object.assign({}, SAMPLE, { 'reading-list.csv': 'Author,Book\nAnon,A Book\n' }));
    const btn = page.locator('.report > button');
    expect((await btn.textContent()).trim() === 'Show 1 note from loading needs a look', 'a note from loading: "Show 1 note from loading needs a look"', (await btn.textContent()).trim());
    expect(await btn.getAttribute('aria-expanded') === 'false' && !(await page.isVisible('.report ul')), 'folded at first (aria-expanded false)');
    await btn.click();
    const items = await page.$$eval('.report li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
    expect(await btn.getAttribute('aria-expanded') === 'true' && items.length === 1 && /^Not loaded ?reading-list\.csv Not a Slaughter Cataloger CSV/.test(items[0]), 'shown: "' + items[0] + '"', items);
    expect(/^Hide /.test((await btn.textContent()).trim()), 'its button now says Hide');
    await btn.click();
    expect(!(await page.isVisible('.report ul')) && await btn.getAttribute('aria-expanded') === 'false', 'hidden again');
    const plain = await open(SAMPLE);
    expect(await plain.locator('.report').count() === 0, 'a library that loads without a note shows no report');
  });

  await section('5. The Library list\'s filters and Find a title (LIB-13, LIB-14)', async () => {
    const page = await open(SAMPLE);
    const chips = await page.$$eval('.lib-head ~ .toolbar .seg-btn, section > .toolbar .seg-btn', l => l.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    expect(same(chips, ['All 5', 'No issues yet 1', 'In progress 2', 'Complete 2']), 'the filters with their counts: All 5, No issues yet 1, In progress 2, Complete 2', chips);
    for (const [name, want] of [['No issues yet', [M]], ['In progress', [G, B]], ['Complete', [Q, R]], ['All', [Q, G, B, R, M]]]) {
      await page.click('.toolbar .seg-btn:has-text("' + name + '")'); await page.waitForTimeout(100);
      const rows = await shelf(page);
      const pressed = await page.$$eval('.toolbar .seg-btn', l => l.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.replace(/\s*\d+$/, '').trim()));
      expect(same(rows, want) && same(pressed, [name]), name + ': ' + want.join(', ') + ', and only it pressed', { rows, pressed });
    }
    const find = page.locator('input[aria-label="Find a title"]');
    for (const [q, want, what] of [['gazette', [G], 'part of a name'], ['samrevix', [R], 'a TitleID, in any case'], ['letters and reviews', [R], 'part of a subtitle'], ['the', [Q, G, B, M], 'a word several share']]) {
      await find.fill(q); await page.waitForTimeout(100);
      expect(same(await shelf(page), want), 'Find a title "' + q + '" (' + what + '): ' + want.join(', '), await shelf(page));
    }
    await find.fill('zzzz'); await page.waitForTimeout(100);
    expect((await shelf(page)).length === 0 && (await page.textContent('.table-wrap .empty')).trim() === 'No titles match.', 'nothing found: "No titles match."');
    await find.fill('the'); await page.click('.toolbar .seg-btn:has-text("Complete")'); await page.waitForTimeout(100);
    expect(same(await shelf(page), [Q]), 'a filter and a search together: The Demonstration Quarterly only', await shelf(page));
  });

  await section('6. The Library list sorted by each column, both ways (LIB-15)', async () => {
    const page = await open(SAMPLE);
    // Expected orders, worked out from the sample's values: [column, ascending order of TitleIDs].
    const cols = [
      ['Title', [Q, G, B, R, M]],                    // Demonstration, Example, Placeholder, Sample, Specimen ("The" set aside)
      ['TitleID', [Q, G, B, R, M]],
      ['From', [G, B, R, Q, M]],                     // 1872, 1961, 1990, 1995, 2011
      ['Cataloging status', [M, G, B, R, Q]],        // the order of the work: Not started, Contents in progress (2), Contents complete, Fully cataloged
      ['Issues', [M, Q, R, B, G]],                   // 0, 2, 24, 36, 309
      ['Contents', [M, Q, B, R, G]],                 // 0, 28, 458, 528, 1,564
      ['Issues with contents', null]                 // none, 51%, then three at 100%: checked by their values
    ];
    // The values a column shows, row by row, as the list sorts them.
    const values = label => page.evaluate(l => {
      const ths = Array.from(document.querySelectorAll('table.shelf thead th')), k = ths.findIndex(t => t.textContent.trim() === l);
      return Array.from(document.querySelectorAll('table.shelf tbody tr')).map(tr => { const td = tr.children[k]; const m = td.querySelector('.meter-n'); return m ? parseInt(m.textContent, 10) : td.textContent.trim() ? -0.5 : -1; });
    }, label);
    for (const [label, asc] of cols) {
      await page.locator('table.shelf thead').getByText(label, { exact: true }).click(); await page.waitForTimeout(100);
      let rows = await shelf(page);
      if (!asc) {
        let v = await values(label);
        expect(v.every((x, k) => !k || v[k - 1] <= x) && v[0] === -1, label + ', ascending: the title without issues first, then by value', v);
        await page.locator('table.shelf thead').getByText(label, { exact: true }).click(); await page.waitForTimeout(100);
        v = await values(label);
        expect(v.every((x, k) => !k || v[k - 1] >= x), label + ', descending: by value', v);
        continue;
      }
      if (label !== 'Title') {
        expect(same(rows, asc), label + ', ascending: ' + asc.join(', '), rows);
        await page.locator('table.shelf thead').getByText(label, { exact: true }).click(); await page.waitForTimeout(100);
      } else {
        // The list opens sorted by Title, ascending: one click turns it round.
        expect(same(rows, asc.slice().reverse()), 'Title (open sorted by it), one click: descending', rows);
        await page.locator('table.shelf thead').getByText(label, { exact: true }).click(); await page.waitForTimeout(100);
        rows = await shelf(page);
        expect(same(rows, asc), 'and again: ascending, ' + asc.join(', '), rows);
        await page.locator('table.shelf thead').getByText(label, { exact: true }).click(); await page.waitForTimeout(100);
      }
      rows = await shelf(page);
      if (label === 'Cataloging status') {
        const st = await page.$$eval('table.shelf tbody tr td:nth-child(4)', l => l.map(x => x.textContent.trim()));
        expect(same(st, ['Fully cataloged', 'Contents complete', 'Contents in progress', 'Contents in progress', 'Not started']), label + ', descending: Fully cataloged, Contents complete, Contents in progress (2), Not started', st);
      } else expect(same(rows, asc.slice().reverse()), label + ', descending: ' + asc.slice().reverse().join(', '), rows);
    }
    const sorted = await page.$$eval('table.shelf th', l => l.map(t => t.getAttribute('aria-sort')));
    expect(sorted.filter(x => x && x !== 'none').length === 1, 'one column marked sorted at a time (aria-sort)', sorted);
  });

  await section('7. The count of fields not yet addressed: on a title, and on an issue, where it goes to the first (LIB-27)', async () => {
    const page = await open(SAMPLE);
    const titleCount = async tid => { await go(page, '#/library/' + tid, '.entry-facts'); return (await page.textContent('.entry-facts .unaddr-count')).trim(); };
    const want = await page.evaluate(t => { const rec = SC.session.store.state.titles.get(t); return SC.schema.entities.title.fields.filter(c => c.states && SC.ui.isUnaddressed(c, rec[c.key], SC.ui.fieldState(rec, c))).length; }, M);
    const tc = await titleCount(M);
    expect(want > 0 && tc === want + ' field' + (want === 1 ? '' : 's') + ' not yet addressed', 'a title: "' + tc + '", as its record has', want);
    const marked = await page.$$eval('.field.is-unaddressed', l => l.length);
    expect(marked === want, 'and as many fields marked unaddressed on its page (' + marked + ')');
    const iids = await issuesOf(page, B);
    let found = null;
    for (const id of iids) { const n = await page.evaluate(i => { const rec = SC.session.store.state.issues.get(i); return SC.schema.entities.issue.fields.filter(c => c.states && SC.ui.isUnaddressed(c, rec[c.key], SC.ui.fieldState(rec, c))).length; }, id); if (n) { found = id; break; } }
    expect(!!found, 'an issue of the Bulletin with fields not yet addressed');
    if (found) {
      await go(page, '#/issues/' + B + '/' + found, '.issue-main .field');
      const btn = page.locator('.entry-facts button.unaddr-count');
      expect(/^\d+ fields? not yet addressed$/.test((await btn.textContent()).trim()), 'on the issue, a button: "' + (await btn.textContent()).trim() + '"');
      await btn.click(); await page.waitForTimeout(200);
      const f = await page.evaluate(() => { const e = document.activeElement, fld = e.closest('.field'); const first = document.querySelector('.issue-form .field.is-unaddressed'); return { inField: !!fld, unaddr: !!fld && fld.classList.contains('is-unaddressed'), first: fld === first, open: !e.closest('details') || e.closest('details').open }; });
      expect(f.inField && f.unaddr && f.first && f.open, 'clicked: the focus is in the first field not yet addressed (its group unfolded if need be)', f);
    }
    await go(page, '#/issues/' + Q + '/' + (await issuesOf(page, Q))[0], '.issue-main .field');
    const qn = await page.evaluate(() => (document.querySelector('.entry-facts .unaddr-count') || {}).textContent || '');
    expect(/^Every field addressed$|not yet addressed$/.test(qn.trim()), 'the count is always shown: "' + qn.trim() + '"');
  });

  await section('8. The run beside an issue: the shared start, numbers missing, Find an issue (ISS-03)', async () => {
    const page = await open(SAMPLE);
    const iids = await issuesOf(page, B);
    await go(page, '#/issues/' + B + '/' + iids[0], '.run-list');
    const st = await page.evaluate(() => ({ title: (document.querySelector('.run-title') || {}).textContent || '', names: Array.from(document.querySelectorAll('.run-item .ri-name')).map(x => x.textContent), gaps: Array.from(document.querySelectorAll('.run-gap')).map(x => x.textContent), full: Array.from(document.querySelectorAll('.run-item a')).map(a => a.getAttribute('title')) }));
    const start = st.title.replace(/ …$/, '');
    expect(start.length > 0 && st.full.every(f => f.indexOf(start) === 0), 'the shared start shown once, above the run: "' + st.title + '"', st.title);
    expect(st.names.length === iids.length && st.names.every((n, k) => st.full[k] === start + n || st.full[k].slice(start.length).trim() === n.trim()), 'each issue listed by the rest of its short name (' + st.names.slice(0, 3).join(', ') + ' …), its full name as its title', st.names.slice(0, 3));
    const want = await page.evaluate(t => { const g = SC.numbering.runGaps(SC.session.store.issuesOfTitle(t)); let n = 0; g.forEach(x => { n += x.count; }); return { rows: g.size, missing: n }; }, B);
    expect(st.gaps.length === want.rows && want.rows === 6 && st.gaps.every(g => / missing$/.test(g)), 'the numbers missing from the run: ' + st.gaps.length + ' rows ("' + st.gaps[0] + '" …), ' + want.missing + ' numbers in all', st.gaps);
    const count = (await page.textContent('.run-count')).replace(/\s+/g, ' ').trim();
    expect(count === '36 issues8 numbers missing' || /^36 issues ?8 numbers missing$/.test(count), 'the head: 36 issues, 8 numbers missing ("' + count + '")');
    const find = page.locator('input[aria-label="Find an issue"]');
    const one = st.full[10];
    await find.fill(one.slice(start.length).trim()); await page.waitForTimeout(150);
    let shown = await page.$$eval('.run-item a', l => l.map(a => a.getAttribute('title')));
    expect(shown.indexOf(one) !== -1 && shown.length < iids.length && (await page.$$eval('.run-gap', l => l.length)) === 0, 'Find an issue "' + one.slice(start.length).trim() + '": ' + shown.length + ' shown, that issue among them, no gap rows', shown);
    await find.fill('zzzz'); await page.waitForTimeout(150);
    shown = await page.$$eval('.run-item a', l => l.length);
    expect(shown === 0, 'nothing found: no issue listed');
    await find.fill(''); await page.waitForTimeout(150);
    expect((await page.$$eval('.run-item a', l => l.length)) === iids.length && (await page.$$eval('.run-gap', l => l.length)) === 6, 'cleared: the whole run again, with its gaps');
  });

  await section('9. Shift+Enter: a new line in an item\'s title or note, the row above elsewhere (CON-14)', async () => {
    const page = await open(SAMPLE);
    const iid = (await issuesOf(page, G))[3];
    await go(page, '#/contents/' + G + '/' + iid, 'table.grid-toc');
    const items = await page.evaluate(i => SC.session.store.contentsOfIssue(i).map(c => c.contentID), iid);
    const cell = (k, col) => page.locator('[data-cell="' + items[k] + ':' + col + '"]');
    await cell(2, 'itemTitle').click(); await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Second line');
    let a = await page.evaluate(() => ({ cell: document.activeElement.getAttribute('data-cell'), v: document.activeElement.value }));
    expect(a.cell === items[2] + ':itemTitle' && /\nSecond line$/.test(a.v), 'in a title, Shift+Enter starts a new line in the same cell', a);
    await page.keyboard.press('Tab'); await page.waitForTimeout(150);
    const t = await page.evaluate(id => SC.session.store.state.contents.get(id).itemTitle, items[2]);
    expect(/\nSecond line$/.test(t), 'left with Tab: the title keeps its line break', t);
    await cell(2, 'notes').click(); await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('A note line');
    a = await page.evaluate(() => ({ cell: document.activeElement.getAttribute('data-cell'), v: document.activeElement.value }));
    expect(a.cell === items[2] + ':notes' && /\nA note line$/.test(a.v), 'in a note, the same', a);
    await page.keyboard.press('Escape');
    await cell(2, 'author').click();
    await page.keyboard.press('Shift+Enter'); await page.waitForTimeout(150);
    a = await page.evaluate(() => document.activeElement.getAttribute('data-cell'));
    expect(a === items[1] + ':author', 'in Author, Shift+Enter goes to the row above', a);
    await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    a = await page.evaluate(() => document.activeElement.getAttribute('data-cell'));
    expect(a === items[2] + ':author', 'and Enter back down', a);
  });

  await section('10. The credits under a name: 60 shown, Show all (NAM-14)', async () => {
    const page = await open(SAMPLE);
    await go(page, '#/names', '.nm-list');
    await page.click('.nm-row:has(.nm-label:text-is("John Q. Public"))'); await page.waitForSelector('.nm-credits');
    const head = (await page.textContent('.nm-credits h2')).replace(/\s+/g, ' ').trim();
    const n = parseInt(head.replace(/[^\d]/g, ''), 10);
    const items = () => page.$$eval('.nm-credits .nm-items > li:not(.nm-title-row)', l => l.length);
    expect(n === 242 && await items() === 60, 'John Q. Public: "' + head + '", 60 listed', await items());
    const btn = page.locator('.nm-credits button:has-text("Show all")');
    expect((await btn.textContent()).trim() === 'Show all 242', 'and a button "Show all 242"');
    await btn.click(); await page.waitForTimeout(150);
    expect(await items() === 242 && await page.locator('.nm-credits button:has-text("Show all")').count() === 0, 'clicked: all 242 listed, and the button gone', await items());
    const titles = await page.$$eval('.nm-credits .nm-title-row cite', l => l.map(x => x.textContent));
    expect(titles.length >= 1 && new Set(titles).size === titles.length, 'grouped by title, each title once: ' + titles.join(', '), titles);
    await page.click('.nm-row:has(.nm-label:text-is("Jane Roe"))');
    await page.waitForFunction(() => !/242/.test((document.querySelector('.nm-credits h2') || {}).textContent || '242'));
    const jr = parseInt((await page.textContent('.nm-credits h2')).replace(/[^\d]/g, ''), 10);
    expect(jr < 60 && await items() === jr && await page.locator('.nm-credits button:has-text("Show all")').count() === 0, 'a name with fewer than 60 credits (Jane Roe, ' + jr + '): all of them, no button', await items());
  });

  await section('11. Messages: a confirmation clears itself; a notice stays until dismissed (NAV-08)', async () => {
    let page = await open(SAMPLE);
    await go(page, '#/library/' + Q, '.entry-card');
    await page.fill('#f-generalNotes', 'Checked for the minor-UI test.'); await page.locator('#f-generalNotes').press('Tab'); await page.waitForTimeout(100);
    await page.keyboard.press('Control+s');
    await page.waitForSelector('.message.ok');
    const msg = (await page.textContent('.message.ok span')).trim();
    expect(/^Saved SCAT_EXAMPLE-LIBRARY_TITLES\.csv\./.test(msg), 'saved: a confirmation, "' + msg.slice(0, 60) + '…"');
    await page.waitForTimeout(6000);
    expect(await page.locator('.message.ok').count() === 1, 'still there after 6 seconds');
    await page.waitForTimeout(4000);
    expect(await page.locator('.message.ok').count() === 0, 'gone by 10 seconds, without being dismissed');
    await runs.pop().close();
    page = await open({}, { noOpen: true });
    await page.click('text=Open library folder'); await page.waitForFunction(() => SC.session.ui.mode === 'folder' && !SC.session.ui.busy);
    await page.waitForSelector('.message.info');
    const info = (await page.textContent('.message.info span')).trim();
    expect(info === 'This folder has no CSV files yet. Start by adding a title.', 'an empty folder: a notice, "' + info + '"');
    await page.waitForTimeout(10000);
    expect(await page.locator('.message.info').count() === 1, 'still there after 10 seconds');
    await page.click('.message.info button:has-text("Dismiss")'); await page.waitForTimeout(150);
    expect(await page.locator('.message').count() === 0, 'Dismiss: gone');
  });

  await section('12. The window\'s title follows the library\'s name (NAV-10)', async () => {
    const page = await open(SAMPLE, { noOpen: true });
    expect(await page.title() === 'Slaughter Cataloger', 'before a library is open: "' + await page.title() + '"');
    await page.click('text=Open library folder'); await page.waitForSelector('table.shelf tbody tr'); await page.waitForTimeout(150);
    expect(await page.title() === 'Example Library — Slaughter Cataloger', 'open: "' + await page.title() + '"');
    await page.click('button:has-text("Library details")');
    await page.fill('#f-name', 'Example Library, Renamed'); await page.locator('#f-name').press('Enter'); await page.waitForTimeout(150);
    expect(await page.title() === 'Example Library, Renamed — Slaughter Cataloger', 'renamed: "' + await page.title() + '"');
    await page.click('.topbar button:has-text("Undo")'); await page.waitForTimeout(150);
    expect(await page.title() === 'Example Library — Slaughter Cataloger', 'Undo: "' + await page.title() + '"');
  });

  await section('13. A count and its verb agree: the load report, the Compiler\'s note on contents left out', async () => {
    let page = await open(Object.assign({}, SAMPLE, { 'reading-list.csv': 'Author,Book\nAnon,A Book\n', 'shelf-list.csv': 'Shelf,Book\n1,A Book\n' }));
    const label = (await page.textContent('.report > button')).trim();
    expect(label === 'Show 2 notes from loading need a look', 'two notes from loading: "Show 2 notes from loading need a look"', label);
    await runs.pop().close();
    // The Quarterly's last issue taken out of its Issues file, and all but one of its contents items
    // (one with no parent) out of its Contents file: that item belongs to no issue in any Issues file.
    const QI = 'SCAT_EXAMPLE-LIBRARY_' + Q + '_ISSUES.csv', QC = 'SCAT_EXAMPLE-LIBRARY_' + Q + '_CONTENTS.csv';
    const rowsOf = t => { const p = CSV.parse(t); return { style: p.style, rows: p.rows.filter((r, k) => !k || r.some(v => String(v).trim())) }; };
    const iss = rowsOf(SAMPLE[QI]), con = rowsOf(SAMPLE[QC]);
    const ic = h => iss.rows[0].indexOf(h), cc = h => con.rows[0].indexOf(h);
    const gone = iss.rows[iss.rows.length - 1][ic('IssueID')];
    const keep = con.rows.find((r, k) => k && r[cc('IssueID')] === gone && !r[cc('Parent ContentID')]);
    const files = Object.assign({}, SAMPLE, {
      [QI]: CSV.serialize(iss.rows.filter(r => r[ic('IssueID')] !== gone), iss.style),
      [QC]: CSV.serialize(con.rows.filter(r => r[cc('IssueID')] !== gone || r === keep), con.style) });
    page = await open(files);
    await go(page, '#/compiler/' + Q, '.cmp-notes li');
    const notes = await page.$$eval('.cmp-notes li', l => l.map(x => x.textContent));
    expect(!!keep && notes.indexOf('1 contents item belongs to an issue not in any Issues file and is left out.') !== -1, 'one item left out: "1 contents item belongs to an issue not in any Issues file and is left out."', notes);
  });

  await browser.close();
  expect(JSON.stringify(readSample()) === JSON.stringify(SAMPLE), 'sample-data/3.0/example-library is unchanged');
  expect(errors.length === 0, 'no page errors', errors.slice(0, 5));
  console.log(log.join('\n'));
  console.log(failures ? '\nFAILED ' + failures + ' of ' + count + ' checks.' : '\nAll ' + count + ' minor-UI checks passed.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
