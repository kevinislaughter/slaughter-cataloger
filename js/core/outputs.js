/* Slaughter Cataloger 3 — Compiler outputs.
   Each builder takes a view model from catalog.build() and options, and returns the
   finished text of one file. Pure; testable in Node.
     checklist   issues as a list to tick off (HTML, Markdown or plain text)
     catalog     a standalone HTML catalog: titles, issues and their contents
     wordpress   the same catalog as WordPress blocks, to paste into the Code Editor
     proofing    a print-ready proofing catalog for checking records against the issues
     ris         one RIS record per contents item, for Zotero and other reference managers
     bibtex      one BibTeX entry per contents item, for JabRef */
(function (SC) {
  'use strict';
  const C = SC.catalog, S = SC.schema;
  const { toText, toHTML, esc, join, close, part, val } = C;
  const IENT = S.entities.issue, TENT = S.entities.title, CENT = S.entities.content;
  const NM = SC.names;
  const REPO = 'https://github.com/kevinislaughter/Slaughter-Cataloger/';

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const longDate = d => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : (many || one + 's'));
  const H = (parts, o) => toHTML(parts, o);
  const T = (parts, o) => toText(parts, o);

  // ── Common ────────────────────────────────────────────────────────────
  function attribution(fmt, d) {
    const text = 'The Slaughter Cataloger was used to compile and export this bibliographic information on ' + longDate(d) + '. Learn more at ' + REPO;
    const link = '<a href="' + REPO + '">' + REPO + '</a>';
    if (fmt === 'html') return '<footer class="sc-attribution">' + esc(text).replace(esc(REPO), link) + '</footer>';
    if (fmt === 'wp') return '<!-- wp:separator {"opacity":"css"} -->\n<hr class="wp-block-separator has-css-opacity"/>\n<!-- /wp:separator -->\n\n' +
      '<!-- wp:paragraph {"style":{"typography":{"fontSize":"0.8em"},"color":{"text":"#999"}}} -->\n<p class="has-text-color" style="font-size:0.8em;color:#999;">' +
      esc(text).replace(esc(REPO), link) + '</p>\n<!-- /wp:paragraph -->';
    if (fmt === 'md') return '---\n*' + text + '*';
    if (fmt === 'txt') return '---\n' + text;
    if (fmt === 'ris') return '; ' + text;
    if (fmt === 'bib') return '@comment{' + text.replace(/[{}]/g, '') + '}';
    return text;
  }

  const TYPES = {
    checklist: { code: 'CHECKLIST' },
    catalog: { code: 'CATALOG', ext: 'html' },
    wordpress: { code: 'CATALOG-WPBLOCKS', ext: 'txt' },
    proofing: { code: 'PROOFING-CATALOG', ext: 'html' },
    ris: { code: 'RIS-ZOTERO', ext: 'ris' },
    bibtex: { code: 'BIBTEX', ext: 'bib' },
    names: { code: 'NAME-INDEX' }
  };
  // SCATOUT_<LIBRARY>[_<TITLEID> when one title]_<TYPE>_<YYYYMMDD>.<ext>
  function filename(vm, type, ext) {
    const slug = vm.library.slug || 'LIBRARY';
    const scope = vm.titles.length === 1 ? '_' + vm.titles[0].id : '';
    return 'SCATOUT_' + slug + scope + '_' + TYPES[type].code + '_' + ymd(vm.date) + '.' + (ext || TYPES[type].ext);
  }
  const titleHeading = tv => tv.name + (tv.runYears ? ' (' + tv.runYears + ')' : '');
  const overridden = (iv, k) => !iv.inherited.has(k) && val(iv, k) !== '';
  const docShell = (title, css, body) => '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
    esc(title) + '</title>\n<style>\n' + css + '\n</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';

  // ── Checklist ─────────────────────────────────────────────────────────
  const CHECKLIST = { style: 'bibliographic', format: 'html', checkboxes: true, marks: true, issueID: false, notes: false, subtitle: false,
    pages: false, size: false, price: false, publisher: false, printer: false, designation: false, evidence: false };

  // One issue as one line, as parts. Styles: plain (numbers, date), bibliographic (sentences), technical (IssueID first).
  function checklistLine(iv, tv, o) {
    const num = C.numbering(iv), date = C.dateOf(iv);
    const name = num.length ? num : C.label(iv);
    const biblio = o.style === 'bibliographic';
    let line;
    if (o.style === 'plain') line = join([name, date], ' — ');
    else if (o.style === 'technical') line = join([[iv.id], name, date], ' — ');
    else line = join([close(name), date.length ? close(date) : []], ' ');
    const add = (sentence, bracketed) => { if (sentence.length) line = line.concat(biblio ? [' '].concat(close(sentence)) : [' ['].concat(bracketed || sentence, [']'])); };
    if (o.pages && val(iv, 'pages')) add([part(iv, 'pages', /^\d+$/.test(val(iv, 'pages')) ? val(iv, 'pages') + ' pp.' : val(iv, 'pages'))]);
    if (o.size && val(iv, 'size')) add([part(iv, 'size', val(iv, 'size') + (val(iv, 'sizeUnit') ? ' ' + val(iv, 'sizeUnit') : ''))]);
    if (o.price && val(iv, 'price')) add([part(iv, 'price')]);
    if (o.publisher) add(C.imprint(iv));
    if (o.printer && val(iv, 'printer')) add(['Printed by ', part(iv, 'printer')].concat(val(iv, 'printerLocation') ? [', ', part(iv, 'printerLocation')] : []));
    if (o.designation) add(C.kindOf(iv));
    if (o.evidence && val(iv, 'evidence') === 'Reported') add(['Reported'].concat(val(iv, 'evidenceNote') ? [': ', part(iv, 'evidenceNote')] : []));
    if (o.subtitle && val(iv, 'subtitle')) line = line.concat([' — “', part(iv, 'subtitle'), '”']);
    if (o.issueID && o.style !== 'technical') line = line.concat([' {' + iv.id + '}']);
    return line;
  }

  function checklist(vm, opts) {
    const o = Object.assign({}, CHECKLIST, opts);
    const fmt = o.format;
    const many = vm.titles.length > 1;
    const out = [];
    if (fmt === 'html') {
      const css = [
        'body{font:15px/1.6 Georgia,"Times New Roman",serif;color:#111;max-width:820px;margin:40px auto;padding:0 22px;}',
        'h1{font-size:26px;line-height:1.2;margin:0 0 4px;}h2{font-size:19px;margin:34px 0 4px;padding-top:12px;border-top:2px solid #111;}',
        '.meta{color:#555;font-size:13px;margin:0 0 14px;}',
        'ol.cl{list-style:none;margin:0;padding:0;font-family:"Courier Prime","Courier New",Courier,monospace;font-size:13.5px;}',
        'ol.cl li{padding:4px 0 4px 1.8em;text-indent:-1.8em;border-bottom:1px solid #e3e3e3;}',
        'ol.cl.plain li{padding-left:0;text-indent:0;}',
        '.box{display:inline-block;width:1.8em;text-indent:0;font-size:15px;}',
        '.note{display:block;text-indent:0;color:#555;font-style:italic;font-family:Georgia,serif;font-size:13px;margin-top:2px;}',
        '.unc{font-style:italic;color:#7a5200;}',
        '.sc-attribution{margin-top:3em;padding-top:1em;border-top:1px solid #ccc;font-size:11px;color:#999;}.sc-attribution a{color:inherit;}',
        '@media print{body{margin:0;max-width:none;}ol.cl li{break-inside:avoid;}h2{break-after:avoid;}}'
      ].join('\n');
      const body = [];
      body.push('<h1>' + esc(many ? (vm.library.name || vm.library.slug) + ': checklist' : titleHeading(vm.titles[0])) + '</h1>');
      body.push('<p class="meta">' + esc((many ? plural(vm.titles.length, 'title') + ', ' : '') + plural(vm.counts.issues, 'issue')) + ' · ' + esc(longDate(vm.date)) + '</p>');
      vm.titles.forEach(tv => {
        if (many) body.push('<h2>' + esc(titleHeading(tv)) + '</h2>\n<p class="meta">' + esc(plural(tv.total, 'issue')) + '</p>');
        body.push('<ol class="cl' + (o.checkboxes ? '' : ' plain') + '">');
        tv.issues.forEach(iv => {
          const note = o.notes && val(iv, 'notes') ? '<span class="note">' + H([part(iv, 'notes')], o) + '</span>' : '';
          body.push('<li>' + (o.checkboxes ? '<span class="box">☐</span>' : '') + H(checklistLine(iv, tv, o), o) + note + '</li>');
        });
        body.push('</ol>');
      });
      body.push(attribution('html', vm.date));
      return docShell(many ? (vm.library.name || vm.library.slug) + ' checklist' : titleHeading(vm.titles[0]) + ' — checklist', css, body.join('\n'));
    }
    const md = fmt === 'md';
    if (md) out.push('# ' + (many ? (vm.library.name || vm.library.slug) + ': checklist' : titleHeading(vm.titles[0])), '');
    else { const h = many ? (vm.library.name || vm.library.slug) + ': checklist' : titleHeading(vm.titles[0]); out.push(h, '='.repeat(h.length), ''); }
    vm.titles.forEach(tv => {
      if (many) {
        const h = titleHeading(tv);
        if (md) out.push('## ' + h, ''); else out.push(h, '-'.repeat(h.length));
      }
      tv.issues.forEach(iv => {
        const line = T(checklistLine(iv, tv, o), o);
        out.push(md ? (o.checkboxes ? '- [ ] ' : '- ') + line : (o.checkboxes ? '☐ ' : '') + line);
        if (o.notes && val(iv, 'notes')) out.push(md ? '  > ' + T([part(iv, 'notes')], o) : '   ' + T([part(iv, 'notes')], o));
      });
      out.push('');
    });
    out.push(attribution(md ? 'md' : 'txt', vm.date));
    return out.join('\n') + '\n';
  }

  // ── Catalog (standalone HTML) ─────────────────────────────────────────
  const CATALOG = { types: true, itemNotes: false, evidence: false, marks: true };
  const CATALOG_CSS = [
    ':root{--ink:#111;--ink-soft:#4a4a4a;--line:#c9c9c9;--panel:#f3f3f1;}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{background:#fff;color:var(--ink);font-family:"Courier Prime","Courier New",Courier,monospace;font-size:14px;line-height:1.7;max-width:880px;margin:0 auto;padding:48px 32px 80px;}',
    'a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line);}a:hover{border-bottom-color:var(--ink);}',
    '.journal-title{font-family:Georgia,"Times New Roman",serif;font-size:28px;font-weight:700;line-height:1.2;margin-bottom:4px;}',
    '.journal-subtitle{font-family:Georgia,serif;font-size:15px;font-style:italic;color:var(--ink-soft);margin-bottom:4px;}',
    '.journal-years{font-size:11px;letter-spacing:2px;color:var(--ink-soft);}',
    '.journal-id{font-size:10px;letter-spacing:2px;color:var(--ink-soft);}',
    '.title-block{margin-bottom:56px;}.title-block+.title-block{padding-top:36px;border-top:4px double var(--ink);}',
    '.pub-facts{margin:24px 0 28px;padding:16px 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--line);display:grid;grid-template-columns:repeat(3,1fr);gap:10px 24px;}',
    '.pub-fact b{font-family:Georgia,serif;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-soft);display:block;font-weight:400;}',
    '.pub-fact span{font-size:13px;}',
    '.journal-mission{margin-bottom:24px;padding:14px 20px;border-left:3px solid var(--ink);background:var(--panel);font-size:13px;line-height:1.8;color:var(--ink-soft);font-style:italic;}',
    '.journal-notes{margin-bottom:20px;font-size:13px;line-height:1.8;color:var(--ink-soft);white-space:pre-line;}',
    '.toc{margin:28px 0 40px;padding-top:14px;border-top:2px solid var(--ink);}',
    '.toc-title{font-family:Georgia,serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-soft);margin-bottom:8px;}',
    '.toc-list{list-style:none;font-size:13px;line-height:2;}.toc-list a{border-bottom:none;}.toc-list span{color:var(--ink-soft);}',
    '.volume-heading{font-family:Georgia,serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-soft);margin:36px 0 0;padding:8px 0;border-top:1px solid var(--line);font-weight:400;}',
    '.issue{margin-bottom:44px;padding-top:20px;border-top:2px solid var(--ink);}',
    '.issue-shortname{font-family:Georgia,serif;font-size:17px;font-weight:700;margin-bottom:1px;}',
    '.issue-subtitle{font-size:13px;color:var(--ink-soft);font-style:italic;}',
    '.issue-meta{font-size:12px;color:var(--ink-soft);margin-bottom:3px;}',
    '.issue-physical,.issue-production,.issue-editor,.issue-evidence{font-size:11px;color:var(--ink-soft);margin-bottom:3px;}',
    '.issue-notes{font-size:12px;color:var(--ink-soft);margin:8px 0;font-style:italic;white-space:pre-line;}',
    '.contents-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;}',
    '.contents-table th{font-family:Georgia,serif;font-size:8.5px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-soft);text-align:left;padding:3px 8px 3px 0;border-bottom:1.5px solid var(--ink);font-weight:400;white-space:nowrap;}',
    '.contents-table td{text-align:left;padding:2px 8px 2px 0;vertical-align:top;}',
    '.contents-table tbody tr:nth-child(even){background:#f7f7f5;}',
    '.ct-page{width:4.5em;color:var(--ink-soft);text-align:right!important;padding-right:12px!important;white-space:nowrap;}',
    '.ct-type{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-soft);width:8em;}',
    '.ct-author{color:var(--ink-soft);}',
    '.ct-nest{color:var(--line);}',
    '.ct-note{display:block;font-size:10px;color:var(--ink-soft);font-style:italic;}',
    '.unc{font-style:italic;}',
    '.catalog-footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font-size:10px;color:var(--ink-soft);}',
    '.sc-attribution{margin-top:2em;font-family:Georgia,serif;font-size:11px;color:#999;}.sc-attribution a{color:inherit;}',
    '@media(max-width:600px){.pub-facts{grid-template-columns:repeat(2,1fr);}.ct-author,.ct-type{display:none;}}',
    '@media print{body{padding:0;max-width:none;}.issue{break-inside:avoid-page;}}'
  ].join('\n');

  function pubFacts(tv, o) {
    const fact = (label, parts) => parts.length ? '<div class="pub-fact"><b>' + esc(label) + '</b><span>' + H(parts, o) + '</span></div>' : '';
    const v = k => val(tv, k) ? [part(tv, k)] : [];
    const place = join([v('city'), v('state'), v('country')], ', ');
    return [fact('Publisher', v('publisher')), fact('Editor(s)', v('editors')), fact('Place', place), fact('Language', v('language')),
      fact('Frequency', v('frequency')), fact('ISSN', v('issn')), fact('Former title(s)', v('formerTitles')), fact('Later title(s)', v('laterTitles'))].filter(Boolean).join('\n');
  }
  function catalogIssue(iv, tv, o) {
    o = Object.assign({}, o, { types: o.types && tv.hasTypes });
    const heading = C.label(iv);
    const num = C.numbering(iv), date = C.dateOf(iv);
    const meta = join([val(iv, 'shortname') ? join([num, date], ' — ') : (num.length ? date : []), C.kindOf(iv)], ' | ');
    const phys = C.physical(iv);
    const prod = [];
    if (val(iv, 'printer')) prod.push(['Printed by ', part(iv, 'printer')].concat(val(iv, 'printerLocation') ? [', ', part(iv, 'printerLocation')] : []));
    if (['publisher', 'city', 'state', 'country'].some(k => overridden(iv, k))) prod.push(C.imprint(iv));
    const rows = iv.contents.map(cv => {
      const nest = cv.depth ? '<span class="ct-nest">' + '\u00a0\u00a0'.repeat(cv.depth - 1) + '└\u00a0</span>' : '';
      const note = o.itemNotes && val(cv, 'notes') ? '<span class="ct-note">' + H([part(cv, 'notes')], o) + '</span>' : '';
      const partOf = cv.partOf ? '<span class="ct-note">' + esc(C.partOfText(cv)) + '</span>' : '';   // D-12: not the item above
      return '<tr><td class="ct-page">' + H(C.pagesOf(cv), o) + '</td><td class="ct-title">' + nest + H(val(cv, 'itemTitle') ? [part(cv, 'itemTitle')] : [], o) + partOf + note + '</td>' +
        (o.types ? '<td class="ct-type">' + H(val(cv, 'contentType') ? [part(cv, 'contentType')] : [], o) + '</td>' : '') +
        '<td class="ct-author">' + H(val(cv, 'author') ? [part(cv, 'author')] : [], o) + '</td></tr>';
    });
    return '<div class="issue" id="' + esc(iv.id) + '">\n' +
      '<div class="issue-shortname">' + H(heading, o) + '</div>\n' +
      (overridden(iv, 'subtitle') ? '<div class="issue-subtitle">' + H([part(iv, 'subtitle')], o) + '</div>\n' : '') +
      (meta.length ? '<div class="issue-meta">' + H(meta, o) + '</div>\n' : '') +
      (phys.length ? '<div class="issue-physical">' + H(phys, o) + '</div>\n' : '') +
      (overridden(iv, 'editors') ? '<div class="issue-editor">Edited by ' + H([part(iv, 'editors')], o) + '</div>\n' : '') +
      (prod.length ? '<div class="issue-production">' + prod.map(p => H(p, o)).join(' · ') + '</div>\n' : '') +
      (o.evidence && val(iv, 'evidence') ? '<div class="issue-evidence">' + esc(val(iv, 'evidence')) + (val(iv, 'evidenceNote') ? ': ' + H([part(iv, 'evidenceNote')], o) : '') + '</div>\n' : '') +
      (val(iv, 'notes') ? '<div class="issue-notes">' + H([part(iv, 'notes')], o) + '</div>\n' : '') +
      (rows.length ? '<table class="contents-table"><thead><tr><th class="ct-page">Pg.</th><th>Item</th>' + (o.types ? '<th class="ct-type">Type</th>' : '') +
        '<th class="ct-author">Author</th></tr></thead>\n<tbody>\n' + rows.join('\n') + '\n</tbody></table>\n' : '') +
      '</div>';
  }
  function catalogTitle(tv, o) {
    tv = Object.assign({}, tv, { hasTypes: tv.issues.some(iv => iv.contents.some(cv => val(cv, 'contentType'))) });
    const out = ['<section class="title-block" id="' + esc(tv.id) + '">', '<header>',
      '<div class="journal-title">' + (val(tv, 'canonicalTitle') ? H([part(tv, 'canonicalTitle')], o) : esc(tv.name)) + '</div>'];
    if (val(tv, 'subtitle')) out.push('<div class="journal-subtitle">' + H([part(tv, 'subtitle')], o) + '</div>');
    if (tv.runYears) out.push('<div class="journal-years">' + esc(tv.runYears) + '</div>');
    out.push('<div class="journal-id">' + esc(tv.id) + '</div>', '</header>');
    const facts = pubFacts(tv, o);
    if (facts) out.push('<div class="pub-facts">\n' + facts + '\n</div>');
    if (val(tv, 'mission')) out.push('<blockquote class="journal-mission">' + H([part(tv, 'mission')], o) + '</blockquote>');
    ['pubHistory', 'editorial', 'biblioNote'].forEach(k => { if (val(tv, k)) out.push('<div class="journal-notes">' + H([part(tv, k)], o) + '</div>'); });
    C.sections(tv.issues).forEach(sec => {
      if (sec.label) out.push('<h2 class="volume-heading">' + esc(sec.label) + '</h2>');
      sec.issues.forEach(iv => out.push(catalogIssue(iv, tv, o)));
    });
    out.push('</section>');
    return out.join('\n');
  }
  function catalog(vm, opts) {
    const o = Object.assign({}, CATALOG, opts);
    const many = vm.titles.length > 1;
    const body = [];
    if (many) {
      body.push('<header><div class="journal-title">' + esc(vm.library.name || vm.library.slug) + '</div><div class="journal-years">' + esc(plural(vm.titles.length, 'title') + ' · ' + plural(vm.counts.issues, 'issue')) + '</div></header>');
      body.push('<nav class="toc"><div class="toc-title">Titles</div><ol class="toc-list">' +
        vm.titles.map(tv => '<li><a href="#' + esc(tv.id) + '">' + esc(tv.name) + '</a>' + (tv.runYears ? ' <span>' + esc(tv.runYears) + '</span>' : '') + '</li>').join('') + '</ol></nav>');
    }
    vm.titles.forEach(tv => body.push(catalogTitle(tv, o)));
    body.push('<footer class="catalog-footer">' + esc((many ? (vm.library.name || vm.library.slug) : vm.titles[0].name + ' · ' + vm.titles[0].id) + ' · Slaughter Cataloger · ' + isoDate(vm.date)) + '</footer>');
    body.push(attribution('html', vm.date));
    return docShell(many ? (vm.library.name || vm.library.slug) + ' — catalog' : titleHeading(vm.titles[0]), CATALOG_CSS, body.join('\n'));
  }

  // ── WordPress blocks ──────────────────────────────────────────────────
  function wordpress(vm, opts) {
    const o = Object.assign({}, CATALOG, opts);
    const many = vm.titles.length > 1;
    const out = [];
    const heading = (level, html, anchor) => '<!-- wp:heading ' + (anchor ? '{"level":' + level + ',"anchor":"' + esc(anchor) + '"}' : '{"level":' + level + '}') + ' -->\n<h' + level +
      ' class="wp-block-heading"' + (anchor ? ' id="' + esc(anchor) + '"' : '') + '>' + html + '</h' + level + '>\n<!-- /wp:heading -->';
    const para = html => html ? '<!-- wp:paragraph -->\n<p>' + html + '</p>\n<!-- /wp:paragraph -->' : '';
    const separator = () => '<!-- wp:separator {"className":"is-style-wide"} -->\n<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>\n<!-- /wp:separator -->';
    const TBL = 'border-collapse:collapse;border:none;width:100%;font-size:0.85em;';
    const TH = 'border:none;border-bottom:1px solid #111;font-size:0.75em;letter-spacing:0.08em;text-transform:uppercase;color:#666;padding:3px 10px 3px 0;text-align:left;font-weight:normal;';
    const TD = 'border:none;padding:3px 10px 3px 0;vertical-align:top;';
    const TD_PG = TD + 'width:4em;text-align:right;padding-right:12px;color:#666;white-space:nowrap;';
    vm.titles.forEach(tv => {
      // On a one-title page the page title is the journal title; with several, each gets a heading.
      const base = many ? 3 : 2;
      if (many) out.push(heading(2, esc(tv.name), tv.id));
      const intro = [];
      if (val(tv, 'subtitle')) intro.push('<em>' + H([part(tv, 'subtitle')], o) + '</em>');
      if (tv.runYears) intro.push(esc(tv.runYears));
      if (intro.length) out.push(para(intro.join(' · ')));
      const facts = [];
      const f = (label, k) => { if (val(tv, k)) facts.push('<strong>' + label + ':</strong> ' + H([part(tv, k)], o)); };
      f('Publisher', 'publisher'); f('Editor(s)', 'editors');
      const place = join(['city', 'state', 'country'].map(k => val(tv, k) ? [part(tv, k)] : []), ', ');
      if (place.length) facts.push('<strong>Place:</strong> ' + H(place, o));
      f('Language', 'language'); f('Frequency', 'frequency'); f('ISSN', 'issn');
      facts.push('<strong>TitleID:</strong> <code>' + esc(tv.id) + '</code>');
      out.push(para(facts.join('<br>')));
      if (val(tv, 'mission')) out.push('<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>' + H([part(tv, 'mission')], o) + '</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->');
      ['pubHistory', 'editorial', 'biblioNote'].forEach(k => { if (val(tv, k)) out.push(para(H([part(tv, k)], o))); });
      const secs = C.sections(tv.issues);
      const grouped = secs.some(s => s.label);
      secs.forEach(sec => {
        if (sec.label) out.push(heading(base, esc(sec.label)));
        sec.issues.forEach(iv => {
          out.push(separator());
          out.push(heading(grouped ? base + 1 : base, H(C.label(iv), o), iv.id));
          const lines = [];
          if (overridden(iv, 'subtitle')) lines.push('<em>' + H([part(iv, 'subtitle')], o) + '</em>');
          const num = C.numbering(iv), date = C.dateOf(iv);
          const meta = join([val(iv, 'shortname') ? join([num, date], ' — ') : (num.length ? date : []), C.kindOf(iv)], ' | ');
          if (meta.length) lines.push(H(meta, o));
          if (overridden(iv, 'editors')) lines.push('Edited by ' + H([part(iv, 'editors')], o));
          const phys = C.physical(iv);
          const extra = val(iv, 'printer') ? ['Printed by ', part(iv, 'printer')].concat(val(iv, 'printerLocation') ? [', ', part(iv, 'printerLocation')] : []) : [];
          const pp = join([phys, extra], ' · ');
          if (pp.length) lines.push('<span style="color:#555;font-size:0.9em;">' + H(pp, o) + '</span>');
          if (lines.length) out.push(para(lines.join('<br>')));
          if (val(iv, 'notes')) out.push(para('<em style="color:#555;font-size:0.9em;">' + H([part(iv, 'notes')], o) + '</em>'));
          if (iv.contents.length) {
            const rows = iv.contents.map(cv => {
              const nest = cv.depth ? '\u00a0\u00a0'.repeat(cv.depth - 1) + '└\u00a0' : '';
              const type = o.types && val(cv, 'contentType') ? '<span style="font-size:0.8em;color:#888;"> — ' + H([part(cv, 'contentType')], o) + '</span>' : '';
              const partOf = cv.partOf ? '<span style="font-size:0.85em;color:#555;font-style:italic;"> (' + esc(C.partOfText(cv)) + ')</span>' : '';   // D-12
              return '<tr><td style="' + TD_PG + '">' + H(C.pagesOf(cv), o) + '</td><td style="' + TD + '"><span style="color:#111;">' + nest +
                H(val(cv, 'itemTitle') ? [part(cv, 'itemTitle')] : [], o) + '</span>' + partOf + type + '</td><td style="' + TD + 'color:#555;">' +
                H(val(cv, 'author') ? [part(cv, 'author')] : [], o) + '</td></tr>';
            }).join('');
            out.push('<!-- wp:table {"hasFixedLayout":false} -->\n<figure class="wp-block-table" style="margin:0 !important;"><table style="' + TBL + '"><thead><tr><th style="' + TH +
              'width:3em;text-align:right;padding-right:12px;">Pg.</th><th style="' + TH + '">Item</th><th style="' + TH + '">Author</th></tr></thead><tbody>' + rows +
              '</tbody></table></figure>\n<!-- /wp:table -->');
          }
        });
      });
    });
    out.push(attribution('wp', vm.date));
    return out.filter(Boolean).join('\n\n') + '\n';
  }

  // ── Proofing catalog ──────────────────────────────────────────────────
  // Every issue field, in the order a reviewer checks them against the issue in hand.
  const PROOF_ISSUE = ['Short Name', 'Title', 'Subtitle', 'Former Title(s)', 'Later Title(s)', 'Volume', 'Issue', 'Whole No.', 'Series', 'Series Number',
    'Year', 'End Year', 'Month(s)', 'Date Type', 'Day', 'Date as Printed', 'Year Calendar', 'Calendar Note', 'Special Issue', 'Issue Designation', 'Supplement',
    'Supplement Label', 'Edition', 'Publisher', 'Editor(s)', 'Contributors', 'Printer', 'Printer Location', 'City', 'State', 'Country', 'Language', 'Frequency',
    'ISSN', 'Price', 'Pages', 'Size', 'Size Unit', 'Evidence Basis', 'Evidence Note', 'Notes on Issue'];
  const PROOF_TITLE = ['Canonical Title', 'Original / First Published Title', 'Subtitle', 'Former Title(s)', 'Later Title(s)', 'Related Title(s)', 'Publisher',
    'Editor(s)', 'City', 'State / Province', 'Country', 'Language', 'Frequency', 'ISSN', 'First Year of Publication (CE)', 'First Year Note',
    'Publication History Note', 'Mission Statement / Prospectus', 'Introduction / Editorial Statement', 'Bibliographic Note', 'General Notes',
    'Cataloging Status', 'Total Known Issues'];
  const PROOF_CSS = [
    '@page{size:letter;margin:0.55in;}',
    'body{font-family:Georgia,"Times New Roman",serif;color:#111;background:#fff;font-size:10.5pt;line-height:1.35;margin:0 auto;padding:24px;max-width:8in;}',
    'h1{font-size:16pt;margin:0 0 6pt;}h2{font-size:13pt;margin:16pt 0 6pt;border-bottom:1pt solid #999;padding-bottom:3pt;}h3{font-size:11pt;margin:12pt 0 4pt;}',
    'table{width:100%;border-collapse:collapse;margin:4pt 0 10pt;font-size:9.5pt;}',
    'th,td{border:1pt solid #999;padding:3pt 5pt;vertical-align:top;}th{background:#f0f0f0;text-align:left;}',
    '.pc{width:0.3in;text-align:center;font-size:12pt;}.pl{width:1.45in;}.pv{width:2.3in;word-break:break-word;}.ps{width:0.85in;}.pn{min-width:1.7in;}',
    '.id-line{font-family:"Courier New",monospace;font-size:9pt;color:#333;margin:2pt 0;}',
    '.dim{color:#888;}.q{font-weight:bold;}.small{font-size:8pt;color:#555;}',
    '.legend td,.meta-block td{border:none;padding:2pt 10pt 2pt 0;}table.legend{width:auto;}',
    'table.ct{font-size:9pt;}.ct .c-seq{width:0.35in;}.ct .c-pg{width:0.55in;}.ct .c-type{width:0.8in;}.ct .c-au{width:1.25in;}.ct .c-st{width:0.85in;}.ct .c-fix{width:1.3in;}',
    '.ct tr.note-row td{border-top:none;padding-top:0;}.ct tbody.item tr:first-child td{border-bottom-color:#ddd;}',
    'tbody.item{break-inside:avoid;page-break-inside:avoid;}',
    '.meta-block{background:#f8f8f8;border:1pt solid #ddd;}',
    '.signoff{margin-top:12pt;padding:8pt;border:1pt solid #bbb;break-inside:avoid;page-break-inside:avoid;}',
    '.signoff table{margin:4pt 0;}.signoff td{border:none;padding:4pt 6pt;}',
    '.blank-line{display:block;border-bottom:1pt solid #999;height:0.26in;}',
    '.proof-explainer,.proof-title-page,.proof-issue{padding-bottom:18pt;}',
    '@media screen{.proof-title-page,.proof-issue{border-top:3px double #999;padding-top:12pt;}}',
    '@media print{body{padding:0;max-width:none;}.proof-explainer,.proof-title-page{break-after:page;page-break-after:always;}',
    '.proof-issue{break-before:page;page-break-before:always;}tr{break-inside:avoid;page-break-inside:avoid;}h2,h3{break-after:avoid;}}',
    '.sc-attribution{margin-top:2em;font-size:8pt;color:#999;}.sc-attribution a{color:inherit;}'
  ].join('\n');

  function proofCell(view, c, value, o) {
    // Value as recorded; [N/A] and [blank] in grey; status from the field's state.
    let shown, status;
    if (c.type === 'bool') { shown = esc(view.v[c.key] ? 'Yes' : 'No'); status = 'Filled'; }
    else if (view.na.has(c.key)) { shown = '<span class="dim">[N/A]</span>'; status = '<span class="dim">[N/A]</span>'; }
    else if (!C.val(view, c.key)) { shown = '<span class="dim">[blank]</span>'; status = c.states === false ? '' : '<span class="dim">[blank]</span>'; }
    else { shown = esc(value != null ? value : C.val(view, c.key)); status = view.spec.has(c.key) ? '<span class="q">?</span>' : 'Filled'; }
    if (view.inherited && view.inherited.has(c.key)) status += ' <span class="small">from title</span>';
    return { shown, status };
  }
  function proofTable(view, ent, headers, extra) {
    const rows = headers.map(h => ent.byHeader.get(h)).filter(Boolean).map(c => {
      const x = proofCell(view, c);
      return '<tr><td class="pc">☐</td><td class="pl"><b>' + esc(c.header) + '</b></td><td class="pv">' + x.shown + '</td><td class="ps">' + x.status + '</td><td class="pn"></td></tr>';
    }).concat((extra || []).map(([label, value]) => '<tr><td class="pc">☐</td><td class="pl"><b>' + esc(label) + '</b></td><td class="pv">' +
      (value ? esc(value) : '<span class="dim">[none]</span>') + '</td><td class="ps"></td><td class="pn"></td></tr>'));
    return '<table><thead><tr><th class="pc"></th><th class="pl">Field</th><th class="pv">Value</th><th class="ps">Status</th><th class="pn">Correction / notes</th></tr></thead><tbody>\n' +
      rows.join('\n') + '\n</tbody></table>';
  }
  const signoff = '<div class="signoff"><table><tbody>' +
    '<tr><td style="width:1.9in"><b>Reviewer:</b></td><td><span class="blank-line" style="width:2in"></span></td><td style="width:1.3in"><b>Date reviewed:</b></td><td><span class="blank-line" style="width:1.2in"></span></td></tr>' +
    '<tr><td><b>Corrections entered:</b></td><td>☐ Yes &nbsp; ☐ No</td><td><b>Needs follow-up:</b></td><td>☐ Yes &nbsp; ☐ No</td></tr>' +
    '</tbody></table><b>General notes:</b><span class="blank-line"></span><span class="blank-line"></span><span class="blank-line"></span></div>';

  function proofing(vm, opts) {
    const o = Object.assign({ files: {} }, opts);
    const lib = vm.library.slug || '';
    const h = [];
    h.push('<section class="proof-explainer">');
    h.push('<h1>Slaughter Cataloger proofing catalog</h1>');
    h.push('<p>This document is for checking Slaughter Cataloger records against the physical issues or reliable source images. Each issue begins on a new page, and no page holds two issues. Tick each field as you verify it. Write corrections in the right-hand column or in the margin, then make them in Slaughter Cataloger.</p>');
    h.push('<p>Values marked <b>?</b> were recorded as speculative: inferred, uncertain, or taken from a secondary source. Check those first. Fields marked <i>from title</i> are not recorded on the issue itself but inherited from the title record; correct them there unless this issue differs.</p>');
    h.push('<h2>Legend</h2><table class="legend"><tbody>' + [
      ['☐', 'Not yet checked'], ['✓', 'Checked by the reviewer'], ['?', 'Marked speculative in the record'], ['[N/A]', 'Marked not applicable in the record'],
      ['[blank]', 'Not yet addressed in the record'], ['from title', 'Inherited from the title record'], ['TitleID', 'Permanent title identifier, e.g. EXAGAZEX-1872'],
      ['IssueID', 'Permanent issue identifier, e.g. EXAGAZEX-1872-K4R8V2M'], ['ContentID', 'Permanent contents-item identifier, e.g. EXAGAZEX-1872-C7M4Q2B']
    ].map(([a, b]) => '<tr><td><b>' + esc(a) + '</b></td><td>' + esc(b) + '</td></tr>').join('') + '</tbody></table>');
    h.push('<h2>Summary</h2><table class="meta-block"><tbody>');
    const row = (a, b) => h.push('<tr><td><b>' + esc(a) + '</b></td><td>' + b + '</td></tr>');
    row('Library', esc(vm.library.name || lib) + (vm.library.name && lib ? ' <code>' + esc(lib) + '</code>' : ''));
    row('Generated', esc(longDate(vm.date)));
    row(vm.titles.length === 1 ? 'Title' : 'Titles', vm.titles.map(tv => '<b>' + esc(tv.name) + '</b> <code>' + esc(tv.id) + '</code>').join('<br>'));
    row('Issues', esc(plural(vm.counts.issues, 'issue')));
    row('Contents items', esc(plural(vm.counts.contents, 'item')));
    vm.titles.forEach(tv => {
      const f = o.files[tv.id] || {};
      if (f.issues || f.contents) row('Files' + (vm.titles.length > 1 ? ', ' + tv.name : ''), [f.issues, f.contents].filter(Boolean).map(n => '<code>' + esc(n) + '</code>').join('<br>'));
    });
    h.push('</tbody></table></section>');

    vm.titles.forEach(tv => {
      const f = o.files[tv.id] || {};
      h.push('<section class="proof-title-page">');
      h.push('<h1>Title proof sheet: ' + esc(tv.name) + '</h1>');
      h.push('<div class="id-line">TitleID: ' + esc(tv.id) + '</div>');
      if (!tv.rec) h.push('<p><b>This title is not in the Titles file.</b> Its issues are proofed below without title-level values.</p>');
      else h.push(proofTable(tv, TENT, PROOF_TITLE, [['TitleID', tv.id], ['Title Code', tv.rec.titleCode], ['Issues file', f.issues], ['Contents file', f.contents]]));
      h.push('<div class="signoff"><b>Title-level review notes:</b><span class="blank-line"></span><span class="blank-line"></span></div>');
      h.push('</section>');
      tv.issues.forEach(iv => {
        h.push('<section class="proof-issue">');
        h.push('<h2>' + esc(tv.name) + ' — ' + esc(T(C.label(iv))) + '</h2>');
        h.push('<div class="id-line">TitleID: ' + esc(tv.id) + ' · IssueID: ' + esc(iv.id) + '</div>');
        const num = T(C.numbering(iv)), date = T(C.dateOf(iv, { printed: false }));
        if (num || date) h.push('<div class="id-line">' + esc([num, date].filter(Boolean).join(' — ')) + '</div>');
        if (val(iv, 'datePrinted')) h.push('<div class="id-line">Date as printed: ' + esc(val(iv, 'datePrinted')) + '</div>');
        h.push('<h3>Issue fields</h3>');
        h.push(proofTable(iv, IENT, PROOF_ISSUE, [
          ['Speculative Fields', (iv.rec.spec || []).join('; ')], ['N/A Fields', (iv.rec.na || []).join('; ')], ['IssueID', iv.id], ['TitleID', tv.id]
        ]));
        if (iv.contents.length) {
          h.push('<h3>Contents (' + esc(plural(iv.contents.length, 'item')) + ')</h3>');
          h.push('<table class="ct"><thead><tr><th class="pc"></th><th class="c-seq">Seq.</th><th class="c-pg">Page(s)</th><th class="c-type">Type</th><th>Item title</th>' +
            '<th class="c-au">Author / credit</th><th class="c-st">Status</th><th class="c-fix">Correction / notes</th></tr></thead>');
          iv.contents.forEach(cv => {
            const cell = k => cv.na.has(k) ? '<span class="dim">[N/A]</span>' : val(cv, k) ? H([part(cv, k)]) : '<span class="dim">[blank]</span>';
            const specs = Array.from(cv.spec).map(k => CENT.byKey.get(k).label);
            const status = specs.length ? '<span class="q">?</span> <span class="small">' + esc(specs.join(', ')) + '</span>' : !val(cv, 'itemTitle') ? '<span class="dim">[blank]</span>' : 'Filled';
            const pg = C.pagesOf(cv);
            // An item and its note stay together on the page; the note runs the full width.
            h.push('<tbody class="item"><tr><td class="pc">☐</td><td>' + esc(val(cv, 'sequence')) + '</td><td>' + (pg.length ? H(pg) : '<span class="dim">[blank]</span>') + '</td><td>' + cell('contentType') + '</td>' +
              '<td>' + (cv.depth ? '<span class="small">' + '› '.repeat(cv.depth) + '</span>' : '') + cell('itemTitle') +
              (cv.partOf ? '<br><span class="small">' + esc(cv.partOf.title ? C.partOfText(cv) + ' (no. ' + cv.partOf.sequence + ', above)' : 'part of no. ' + cv.partOf.sequence + ', above') + '</span>'   // D-12: not the item above
                : cv.parentTitle ? '<br><span class="small">in “' + esc(cv.parentTitle) + '”</span>' : '') + '</td>' +
              '<td>' + cell('author') + '</td><td>' + status + '</td><td></td></tr>' +
              (val(cv, 'notes') ? '<tr class="note-row"><td></td><td colspan="7"><span class="small">Note: ' + H([part(cv, 'notes')]) + '</span></td></tr>' : '') + '</tbody>');
          });
          h.push('</table>');
        } else h.push('<p class="small">No contents items recorded for this issue.</p>');
        h.push(signoff);
        h.push('</section>');
      });
    });
    h.push(attribution('html', vm.date));
    return docShell('Proofing catalog — ' + (vm.titles.length === 1 ? vm.titles[0].name : vm.library.name || lib) + ' — ' + isoDate(vm.date), PROOF_CSS, h.join('\n'));
  }

  // ── RIS ───────────────────────────────────────────────────────────────
  const risClean = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^ER {2}-/, 'ER -');
  // The headings of a view model: credit -> heading record, by match key.
  function headingLookup(vm) {
    const byKey = new Map();
    Array.from((vm.authorities || new Map()).values()).sort((a, b) => (a.entryOrder || 1e9) - (b.entryOrder || 1e9))
      .forEach(a => NM.headingKeys(a).forEach(k => { if (!byKey.has(k)) byKey.set(k, a); }));
    return raw => byKey.get(NM.nameKey(raw)) || null;
  }
  // Authors of an item for a reference manager: the heading where there is one (surname first,
  // as Zotero and JabRef expect), otherwise the credit without a role ("translated by").
  function authorsOf(cv, lookup, useHeadings) {
    return NM.splitCredits(val(cv, 'author')).map(raw => {
      const a = useHeadings !== false && lookup(raw);
      return { raw, name: a ? a.name : (NM.cleanCredit(raw).name || raw), type: a ? a.nameType : '' };
    });
  }
  const specLabels = view => Array.from(view.spec).map(k => (view.kind === 'content' ? CENT : IENT).byKey.get(k).header);
  function risDate(iv) {
    if (val(iv, 'datePrinted')) return val(iv, 'datePrinted');
    return T(C.dateOf(iv, { printed: false }), { marks: false });
  }
  function ris(vm, opts) {
    const o = Object.assign({ headings: true }, opts);
    const lookup = headingLookup(vm);
    const recs = [];
    const slug = vm.library.slug;
    vm.titles.forEach(tv => tv.issues.forEach(iv => iv.contents.forEach(cv => {
      const L = [];
      const add = (tag, v) => { const c = risClean(v); if (c) L.push(tag + '  - ' + c); };
      L.push('TY  - JOUR');
      add('TI', val(cv, 'itemTitle'));
      const au = authorsOf(cv, lookup, o.headings);
      au.forEach(a => add('AU', a.name));
      add('T2', tv.name);
      add('PY', (/\d{4}/.exec(val(iv, 'year')) || [''])[0]);
      add('DA', risDate(iv));
      add('VL', val(iv, 'volume'));
      add('IS', val(iv, 'issue') || val(iv, 'number'));
      add('SP', val(cv, 'startPage'));
      add('EP', val(cv, 'endPage'));
      add('SN', val(iv, 'issn'));
      add('LA', val(iv, 'language'));
      if (slug) add('KW', slug);
      add('KW', tv.id); add('KW', iv.id);
      add('KW', val(cv, 'contentType'));
      add('N1', 'Slaughter Cataloger TitleID: ' + tv.id);
      add('N1', 'Slaughter Cataloger IssueID: ' + iv.id);
      add('N1', 'Slaughter Cataloger ContentID: ' + cv.id);
      if (val(cv, 'contentType')) add('N1', 'Content Type: ' + val(cv, 'contentType'));
      if (cv.parentTitle) add('N1', 'Part of: ' + cv.parentTitle);
      const spec = specLabels(cv).concat(specLabels(iv).map(l => l + ' (issue)'));
      if (spec.length) add('N1', 'Speculative fields: ' + spec.join('; '));
      if (au.some(a => a.name !== a.raw)) add('N1', 'Credited as: ' + val(cv, 'author'));
      if (val(cv, 'notes')) add('N1', val(cv, 'notes'));
      L.push('ER  - ');
      recs.push(L.join('\n'));
    })));
    return recs.join('\n\n') + '\n\n' + attribution('ris', vm.date) + '\n';
  }

  // ── BibTeX ────────────────────────────────────────────────────────────
  const MONTH_MACROS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // Plain text to BibTeX: TeX's special characters escaped, and TeX's ligatures broken up so
  // that what is printed is what was typed ("--" stays two hyphens, "<" stays "<", '' stays two
  // apostrophes). Checked against Better BibTeX's parser in tools/test-formats.js.
  const bibEsc = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/[\\{}&%$#_~^<>`]/g, ch => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '<': '\\textless{}', '>': '\\textgreater{}', '`': '\\textasciigrave{}' })[ch] || '\\' + ch)
    .replace(/-(?=-)/g, '-{}').replace(/'(?=')/g, "'{}").replace(/([?!])(?=\\textasciigrave)/g, '$1{}');
  // A name BibTeX would read as two people ("Smith and Sons") or as surname, forename
  // ("Example Co., Inc.") is braced as one corporate name.
  const bibName = a => {
    const corporate = a.type === 'Corporate body' || (!a.type && NM.suggestHeading(a.raw).nameType === 'Corporate body');
    return corporate || /\band\b/i.test(a.name) ? '{' + bibEsc(a.name) + '}' : bibEsc(a.name);
  };
  function bibtex(vm, opts) {
    const o = Object.assign({ headings: true }, opts);
    const lookup = headingLookup(vm);
    const recs = [];
    const slug = vm.library.slug;
    vm.titles.forEach(tv => tv.issues.forEach(iv => iv.contents.forEach(cv => {
      const F = [];
      const add = (k, v) => { const e = bibEsc(v); if (e) F.push('  ' + k + ' = {' + e + '}'); };
      // Titles keep their capitals: the inner braces tell BibTeX styles not to change case.
      const addKeepCase = (k, v) => { const e = bibEsc(v); if (e) F.push('  ' + k + ' = {{' + e + '}}'); };
      addKeepCase('title', val(cv, 'itemTitle'));
      const au = authorsOf(cv, lookup, o.headings).filter(a => a.name);
      if (au.length) F.push('  author = {' + au.map(bibName).join(' and ') + '}');
      addKeepCase('journal', tv.name);
      add('year', (/\d{4}/.exec(val(iv, 'year')) || [''])[0]);
      const p = SC.numbering.parsePeriod(val(iv, 'months'));
      if (p && p.kind === 'months' && p.idx.length === 1) F.push('  month = ' + MONTH_MACROS[p.idx[0]]);
      add('volume', val(iv, 'volume'));
      add('number', val(iv, 'issue') || val(iv, 'number'));
      const s = val(cv, 'startPage'), e = val(cv, 'endPage');
      if (s && e && e !== s) F.push('  pages = {' + bibEsc(s) + '--' + bibEsc(e) + '}');     // "--": the en dash of a page range
      else add('pages', s || e);
      add('issn', val(iv, 'issn'));
      add('language', val(iv, 'language'));
      add('keywords', [slug, tv.id, iv.id, val(cv, 'contentType')].filter(Boolean).join(', '));
      const notes = [];
      if (val(iv, 'datePrinted')) notes.push('Dated: ' + val(iv, 'datePrinted'));
      if (cv.parentTitle) notes.push('Part of: ' + cv.parentTitle);
      if (au.some(a => a.name !== a.raw)) notes.push('Credited as: ' + val(cv, 'author'));
      const spec = specLabels(cv).concat(specLabels(iv).map(l => l + ' (issue)'));
      if (spec.length) notes.push('Speculative fields: ' + spec.join('; '));
      if (val(cv, 'notes')) notes.push(val(cv, 'notes'));
      add('note', notes.join('. '));
      recs.push('@article{' + cv.id + ',\n' + F.join(',\n') + '\n}');
    })));
    return attribution('bib', vm.date) + '\n\n' + recs.join('\n\n') + '\n';
  }

  // ── Name index ────────────────────────────────────────────────────────
  const NAMES = { format: 'html', unheaded: 'suggest', see: true, forms: true, marks: true };
  /* Every credit in the selection, filed under its heading, or for a name without one under
     the form a heading would take (surname first; opts.unheaded 'asis' files it as credited).
     Returns [{ heading, sort, authority, forms: Map<raw, count>, items: [{ tv, iv, cv, role, spec }] }], alphabetical. */
  function nameEntries(vm, o) {
    const lookup = headingLookup(vm);
    const map = new Map();
    vm.titles.forEach(tv => tv.issues.forEach((iv, run) => iv.contents.forEach(cv => {
      if (cv.na.has('author')) return;
      NM.splitCredits(val(cv, 'author')).forEach(raw => {
        const a = lookup(raw);
        const heading = a ? a.name : (o.unheaded === 'asis' ? raw : NM.suggestHeading(raw).name);
        const sort = NM.sortKey(heading);
        if (!sort) return;
        const key = a ? 'a:' + a.authorityID : 's:' + sort;
        if (!map.has(key)) map.set(key, { heading, sort, authority: a, forms: new Map(), items: [] });
        const e = map.get(key);
        e.forms.set(raw, (e.forms.get(raw) || 0) + 1);
        e.items.push({ tv, iv, cv, run, role: NM.cleanCredit(raw).role, spec: cv.spec.has('author') });
      });
    })));
    const out = Array.from(map.values());
    out.forEach(e => e.items.sort((a, b) => a.tv.name.localeCompare(b.tv.name) || a.run - b.run || (parseFloat(val(a.cv, 'sequence')) || 0) - (parseFloat(val(b.cv, 'sequence')) || 0)));
    return out.sort((a, b) => a.sort.localeCompare(b.sort) || a.heading.localeCompare(b.heading));
  }
  // The forms a heading was credited under, other than the heading itself.
  function otherForms(e) {
    const own = new Set([NM.nameKey(e.heading), NM.nameKey(NM.directOrder(e.heading))]);
    const seen = new Set(), out = [];
    Array.from(e.forms.entries()).sort((a, b) => b[1] - a[1]).forEach(([raw]) => {
      const name = NM.cleanCredit(raw).name || raw, k = NM.nameKey(name);
      if (!own.has(k) && !seen.has(k)) { seen.add(k); out.push(name); }
    });
    return out;
  }
  // "See" references: forms that would file under another word than their heading.
  function seeRefs(entries) {
    const refs = [];
    entries.forEach(e => otherForms(e).forEach(f => {
      const sort = NM.sortKey(NM.suggestHeading(f).name);
      if (sort && sort.split(' ')[0] !== e.sort.split(' ')[0]) refs.push({ see: true, from: NM.suggestHeading(f).name, to: e.heading, sort });
    }));
    return refs;
  }
  // One credit as parts: "The Example Gazette, Vol. 1, no. 1 (whole no. 1), May 4, 1872, p. 1: “Town Talk.” (translated by)"
  // A title already in quotation marks gets single ones inside the double: “‘What Became of the Ferry?’”.
  const innerQuotes = t => t.replace(/^[“"]/, '‘').replace(/[”"]$/, '’');
  function creditParts(it, many) {
    const pg = C.pagesOf(it.cv);
    const num = C.numbering(it.iv), date = C.dateOf(it.iv);
    const where = join([num.length ? num : C.label(it.iv), date], ', ');
    const out = [].concat(many ? [it.tv.name, ', '] : [], where, pg.length ? [', ' + (C.toText(pg).indexOf('–') !== -1 ? 'pp. ' : 'p. ')].concat(pg) : []);
    const title = val(it.cv, 'itemTitle');
    return out.concat(title ? [': “', part(it.cv, 'itemTitle', innerQuotes(title)), '”'] : [], it.role ? [' (' + it.role + ')'] : [], it.spec ? [' (attribution uncertain)'] : []);
  }
  function names(vm, opts) {
    const o = Object.assign({}, NAMES, opts);
    const many = vm.titles.length > 1;
    const entries = nameEntries(vm, o);
    const all = entries.concat(o.see ? seeRefs(entries) : []).sort((a, b) => a.sort.localeCompare(b.sort) || (a.see ? 1 : 0) - (b.see ? 1 : 0));
    const credits = entries.reduce((n, e) => n + e.items.length, 0);
    const scope = many ? (vm.library.name || vm.library.slug) : titleHeading(vm.titles[0]);
    const meta = (many ? plural(vm.titles.length, 'title') + ' · ' : '') + plural(entries.length, 'name') + ' · ' + plural(credits, 'credit') + ' · ' + longDate(vm.date);
    const letter = x => { const c = x.sort.charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
    const extra = e => {
      const bits = [];
      if (e.authority && e.authority.dates) bits.push(e.authority.dates);
      const forms = o.forms ? otherForms(e) : [];
      return { dates: bits.join(', '), forms, seeAlso: e.authority && e.authority.seeAlso ? e.authority.seeAlso : '' };
    };
    if (o.format === 'html') {
      const css = [
        'body{font:15px/1.55 Georgia,"Times New Roman",serif;color:#111;max-width:860px;margin:40px auto;padding:0 22px;}',
        'h1{font-size:26px;margin:0 0 4px;}.meta{color:#555;font-size:13px;margin:0 0 20px;}',
        'h2{font-size:20px;margin:28px 0 8px;padding-top:8px;border-top:2px solid #111;}',
        '.nx{margin:0 0 12px;}.hd{margin:0;}.hd b{font-weight:700;}.hd .dt{color:#333;}.as{color:#555;font-size:13.5px;}',
        '.nx ul{list-style:none;margin:2px 0 0;padding:0 0 0 1.6em;font-size:13.5px;}.nx li{text-indent:-1em;padding-left:1em;}',
        '.see{margin:0 0 10px;font-size:14px;}.see i{font-style:italic;}.sa{margin:2px 0 0 1.6em;font-size:13.5px;}',
        '.unc{font-style:italic;color:#7a5200;}cite{font-style:italic;}',
        '.sc-attribution{margin-top:3em;padding-top:1em;border-top:1px solid #ccc;font-size:11px;color:#999;}.sc-attribution a{color:inherit;}',
        '@media print{body{margin:0;max-width:none;}.nx{break-inside:avoid;}h2{break-after:avoid;}}'
      ].join('\n');
      const body = ['<h1>Index of names</h1>', '<p class="meta">' + esc(scope) + ' · ' + esc(meta) + '</p>'];
      let cur = '';
      all.forEach(x => {
        const L = letter(x);
        if (L !== cur) { cur = L; body.push('<h2>' + esc(L) + '</h2>'); }
        if (x.see) { body.push('<p class="see"><i>' + esc(x.from) + '</i> see <b>' + esc(x.to) + '</b></p>'); return; }
        const x2 = extra(x);
        body.push('<div class="nx"><p class="hd"><b>' + esc(x.heading) + '</b>' + (x2.dates ? '<span class="dt">, ' + esc(x2.dates) + '</span>' : '') +
          (x2.forms.length ? ' <span class="as">(as ' + esc(x2.forms.join('; ')) + ')</span>' : '') + '</p>' +
          '<ul>' + x.items.map(it => '<li>' + (many ? '<cite>' + esc(it.tv.name) + '</cite>, ' : '') + H(creditParts(it, false), o) + '</li>').join('') + '</ul>' +
          (x2.seeAlso ? '<p class="sa">See also <b>' + esc(x2.seeAlso) + '</b></p>' : '') + '</div>');
      });
      if (!entries.length) body.push('<p>No credited names in this selection.</p>');
      body.push(attribution('html', vm.date));
      return docShell('Index of names — ' + scope, css, body.join('\n'));
    }
    const md = o.format === 'md';
    const out = md ? ['# Index of names', '', '*' + scope + ' · ' + meta + '*', ''] : ['Index of names', '==============', scope + ' · ' + meta, ''];
    let cur = '';
    all.forEach(x => {
      const L = letter(x);
      if (L !== cur) { cur = L; out.push(md ? '## ' + L : '— ' + L + ' —', ''); }
      if (x.see) { out.push(md ? '*' + x.from + '* see **' + x.to + '**' : x.from + ' see ' + x.to, ''); return; }
      const x2 = extra(x);
      out.push((md ? '**' + x.heading + '**' : x.heading) + (x2.dates ? ', ' + x2.dates : '') + (x2.forms.length ? ' (as ' + x2.forms.join('; ') + ')' : ''));
      x.items.forEach(it => out.push((md ? '- ' : '    ') + T(creditParts(it, many), o)));
      if (x2.seeAlso) out.push((md ? '- *See also* ' : '    See also ') + x2.seeAlso);
      out.push('');
    });
    out.push(attribution(md ? 'md' : 'txt', vm.date));
    return out.join('\n') + '\n';
  }

  SC.outputs = { TYPES, CHECKLIST, CATALOG, NAMES, PROOF_ISSUE, PROOF_TITLE, attribution, filename, checklist, checklistLine, catalog, wordpress, proofing, ris, bibtex, names, nameEntries };
})(globalThis.SC = globalThis.SC || {});
