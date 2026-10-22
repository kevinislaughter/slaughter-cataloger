#!/usr/bin/env node
/* Unit tests for js/core/numbering.js (next-issue numbering, dates, short names)
   and js/core/toc.js (contents ordering, nesting and paste parsing).
   usage: node tools/test-numbering.js */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
['js/core/numbering.js', 'js/core/toc.js'].forEach(f => require(path.join(ROOT, f)));
const N = globalThis.SC.numbering, T = globalThis.SC.toc;

let fails = 0, count = 0;
const eq = (got, want, what) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL ' + what + '\n   got  ' + g + '\n   want ' + w); }
};

// ── numbers
eq(N.incrementString('7'), '8', 'arabic');
eq(N.incrementString('07'), '08', 'zero-padded');
eq(N.incrementString('99'), '100', 'grows past padding');
eq(N.incrementString('5/6'), '7', 'double issue');
eq(N.incrementString('No. 5-6'), 'No. 7', 'double issue with prefix');
eq(N.incrementString('IV'), 'V', 'Roman');
eq(N.incrementString('xiv'), 'xv', 'lower-case Roman');
eq(N.incrementString('Vol. XIX'), 'Vol. XX', 'Roman with prefix');
eq(N.incrementString('2a'), '3a', 'digit with suffix');
eq(N.incrementString(''), '', 'empty stays empty');
eq(N.incrementString('?'), '?', 'unknown stays');
eq(N.firstOf('26'), '1', 'first of arabic');
eq(N.firstOf('07'), '01', 'first keeps padding');
eq(N.firstOf('XII'), 'I', 'first of Roman');
eq(N.numberOf('XII'), 12, 'number of Roman');
eq(N.numberOf('5/6'), 6, 'number of double');
eq(N.firstNumberOf('5/6'), 5, 'first number of double');
// gaps between consecutive issues
const gp = g => g && { count: g.count, label: g.label };
eq(gp(N.gapBetween({ volume: '1', issue: '4', number: '4' }, { volume: '1', issue: '5', number: '5' })), null, 'no gap');
eq(gp(N.gapBetween({ volume: '1', issue: '4', number: '4' }, { volume: '1', issue: '6', number: '6' })), { count: 1, label: 'whole no. 5' }, 'one missing whole number');
eq(gp(N.gapBetween({ number: '5/6' }, { number: '7' })), null, 'double issue then the next');
eq(gp(N.gapBetween({ number: '6' }, { number: '9/10' })), { count: 2, label: 'whole nos. 7–8' }, 'gap before a double issue');
eq(gp(N.gapBetween({ volume: 'II', issue: '3' }, { volume: 'II', issue: '6' })), { count: 2, label: 'vol. II, nos. 4–5' }, 'gap in issue numbers within a volume');
eq(gp(N.gapBetween({ volume: '3', issue: '12' }, { volume: '4', issue: '3' })), { count: 2, label: 'vol. 4, nos. 1–2' }, 'new volume starts late');
eq(gp(N.gapBetween({ volume: '3', issue: '12' }, { volume: '4', issue: '1' })), null, 'new volume starts at 1');
eq(gp(N.gapBetween({ volume: '3', issue: '2' }, { volume: '5', issue: '1' })), null, 'a skipped volume is not guessed at');
eq(gp(N.gapBetween({ issue: 'Spring' }, { issue: 'Fall' })), null, 'words are not numbers');
const held = N.numbersHeld([{ number: '12' }, { number: '22' }, { number: '13/14' }, { number: '20' }]);
eq(gp(N.gapBetween({ number: '12' }, { number: '22' }, held)), { count: 6, label: 'whole nos. 15–19, 21' }, 'numbers held elsewhere in the run are not missing');
eq(gp(N.gapBetween({ number: '12' }, { number: '13/14' }, held)), null, 'double issue counts as both numbers');
const g1 = N.gapBetween({ number: '12' }, { number: '22' }, held); held.add(g1);
eq(gp(N.gapBetween({ number: '20' }, { number: '22' }, held)), null, 'a missing number is reported once');

// ── periods
eq(N.parsePeriod('Mar–Apr').idx, [2, 3], 'abbr range');
eq(N.parsePeriod('March-April').full, true, 'full names detected');
eq(N.parsePeriod('Dec–Jan').run, { start: 11, end: 0, len: 2 }, 'wrapping run');
eq(N.parsePeriod('Jul/Aug').idx, [6, 7], 'slash range');
eq(N.parsePeriod('Sept.').idx, [8], 'Sept.');
eq(N.parsePeriod('Jan, Mar').run, null, 'non-contiguous');
eq(N.parsePeriod('Autumn').autumn, true, 'Autumn kept');
eq(N.parsePeriod('Christmas'), null, 'not a period');
eq(N.parsePeriod('May').full, null, 'May is ambiguous');
eq(N.periodLabel([11, 0], 'months', { full: false }), 'Dec–Jan', 'label wraps');
eq(N.periodLabel([2, 3, 4], 'months', { full: true }), 'March–May', 'full label');
eq(N.periodLabel([0, 2], 'months', {}), 'Jan, Mar', 'list label');
eq(N.periodStyle(['March–April', 'May–June', 'Jul']), { full: true, autumn: false }, 'title style');

// ── dates
const D = (months, day, year, yearEnd) => ({ months, day: day || '', year: year || '', yearEnd: yearEnd || '' });
eq(N.advanceDate(D('March–April', '', '1989'), 'run'), D('May–June', '', '1989'), 'bimonthly run');
eq(N.advanceDate(D('November–December', '', '1989'), 'run'), D('January–February', '', '1990'), 'run wraps the year');
eq(N.advanceDate(D('Oct–Nov', '', '1989'), 'run'), D('Dec–Jan', '', '1989', '1990'), 'run spans the year end');
eq(N.advanceDate(D('Dec–Jan', '', '1989', '1990'), 'run'), D('Feb–Mar', '', '1990'), 'after a span the year moves on');
eq(N.advanceDate(D('Jul', '', '1985'), 'm2'), D('Sep', '', '1985'), 'every two months');
eq(N.advanceDate(D('Nov', '', '1985'), 'm2'), D('Jan', '', '1986'), 'two months over the year');
eq(N.advanceDate(D('Aug', '6', '1881'), 'd14'), D('Aug', '20', '1881'), 'fortnightly');
eq(N.advanceDate(D('Dec', '24', '1881'), 'd14'), D('Jan', '7', '1882'), 'fortnightly over the year');
eq(N.advanceDate(D('February', '15', '1898'), 'm2'), D('April', '15', '1898'), 'day of month kept');
eq(N.advanceDate(D('Jan', '31', '1899'), 'm1'), D('Feb', '28', '1899'), 'day clamped to month length');
eq(N.advanceDate(D('Autumn', '', '1903'), 'run'), D('Winter', '', '1903'), 'season');
eq(N.advanceDate(D('Winter', '', '1903'), 'run'), D('Spring', '', '1904'), 'season wraps the year');
eq(N.advanceDate(D('Fall–Winter', '', '2012'), 'run'), D('Spring–Summer', '', '2013'), 'two seasons');
eq(N.advanceDate(D('Spring', '', '1990'), 'm6'), D('Fall', '', '1990'), 'six months of seasons');
eq(N.advanceDate(D('', '', '1990'), 'y1'), D('', '', '1991'), 'annual');
eq(N.advanceDate(D('Christmas', '', '1990'), 'run'), D('Christmas', '', '1990'), 'unknown months left alone');
eq(N.advanceDate(D('Jan', '', '189X'), 'm12'), D('Jan', '', '189X'), 'uncertain year left alone');
eq(N.advanceDate(D('Aug', 'Tuesday', '1881'), 'd7'), D('Sep', 'Tuesday', '1881'), 'week without a full date moves by span');

// ── cadence
eq(N.inferCadence(D('Aug', '6', '1881'), D('Aug', '20', '1881')), 'd14', 'fortnightly inferred');
eq(N.inferCadence(D('Aug', '6', '1881'), D('Aug', '13', '1881')), 'd7', 'weekly inferred');
eq(N.inferCadence(D('February', '15', '1898'), D('April', '15', '1898')), 'm2', 'two months with day');
eq(N.inferCadence(D('Jul', '', '1985'), D('Sep', '', '1985')), 'm2', 'two months');
eq(N.inferCadence(D('March–April', '', '1989'), D('May–June', '', '1989')), 'run', 'bimonthly runs');
eq(N.inferCadence(D('Nov', '', '1989'), D('Feb', '', '1990')), 'm3', 'quarterly over the year');
eq(N.inferCadence(D('Autumn', '', '1903'), D('Winter', '', '1903')), 'run', 'quarterly seasons');
eq(N.inferCadence(D('', '', '1990'), D('', '', '1991')), 'y1', 'annual');
eq(N.inferCadence(null, D('Jan', '', '1990')), 'run', 'first issue');

// ── next issue
const base = { volume: '1', issue: '26', number: '26', months: 'Jul', day: '22', year: '1882' };
eq(N.nextIssue(base, { issue: true, number: true, date: 'd14' }), { volume: '1', issue: '27', number: '27', seriesNumber: '', months: 'Aug', day: '5', year: '1882', yearEnd: '' }, 'next weekly issue');
eq(N.nextIssue(base, { newVolume: true, number: true, date: 'd14' }).volume + '/' + N.nextIssue(base, { newVolume: true, number: true, date: 'd14' }).issue, '2/1', 'new volume');
eq(N.nextIssue({ volume: 'II', issue: '6' }, { newVolume: true }).volume, 'III', 'new Roman volume');

// ── short names
const vals = (volume, issue, number, months, year) => ({ volume, issue, number, months, year });
eq(N.nextShortName('Example Gazette V1 I1 N1', vals('1', '1', '1', 'Aug', '1881'), vals('1', '2', '2', 'Aug', '1881'), 'Example Gazette'), 'Example Gazette V1 I2 N2', 'V/I/N pattern');
eq(N.nextShortName('Placeholder Bulletin No. 9', vals('', '9', '', 'Jul–Aug', '1965'), vals('', '10', '', 'Sep–Oct', '1965'), 'Placeholder Bulletin'), 'Placeholder Bulletin No. 10', 'No. pattern');
eq(N.nextShortName('Sample Newsletter V2N3', vals('II', '3', '', 'May–June', '1990'), vals('II', '4', '', 'July–August', '1990'), 'Sample Newsletter'), 'Sample Newsletter V2N4', 'Roman volume written in arabic');
eq(N.nextShortName('Specimen Monthly Vol. II, No. 1 (Whole No. 53)', vals('II', '1', '53', 'Jul', '1897'), vals('II', '2', '54', 'Jul', '1897'), 'Specimen Monthly'), 'Specimen Monthly Vol. II, No. 2 (Whole No. 54)', 'Vol./No./Whole No.');
eq(N.nextShortName('Demonstration Quarterly No. 1 (August 1995)', vals('', '1', '', 'Aug', '1995'), vals('', '2', '', 'Sep', '1996'), 'Demonstration Quarterly'), 'Demonstration Quarterly No. 2 (September 1996)', 'month written out');
eq(N.nextShortName('No. 1, Vol. 1', vals('1', '1', '', '', ''), vals('1', '2', '', '', ''), 'X'), 'No. 2, Vol. 1', 'labels decide equal numbers');
eq(N.nextShortName('Town/Country No.6', vals('', '6', '', 'December', '1898'), vals('', '7', '', 'February', '1899'), 'The Town and the Country'), 'Town/Country No.7', 'no space after No.');
eq(N.nextShortName('The Sample Review Memorial Edition', vals('', '', '', '', ''), vals('', '1', '', '', ''), 'The Sample Review'), 'The Sample Review I1', 'no pattern: default');
eq(N.nextShortName('Sample Newsletter VIIN6', vals('II', '6', '', 'November–December', '1990'), vals('III', '1', '', 'January–February', '1991'), 'Sample Newsletter'), 'Sample Newsletter V.III N1', 'V + Roman volume run together: the next name separates them');
eq(N.nextShortName('Example Gazette V1 I1 N1', vals('1', '1', '1', '', ''), vals('1', '2', '2', '', ''), 'Example Gazette'), 'Example Gazette V1 I2 N2', 'arabic 1 is not read as Roman I');
eq(N.nextShortName('Anytown V10N4', vals('10', '4', '', '', ''), vals('XI', '5', '', '', ''), 'Anytown'), 'Anytown V11N5', 'number keeps the form the short name used');
eq(N.defaultShortName('Sample Newsletter', vals('II', '4', '', '', '')), 'Sample Newsletter V.II I4', 'Roman volume gets a point');
eq(N.defaultShortName('Example Gazette', vals('1', '1', '1', '', '')), 'Example Gazette V1 I1 N1', 'default pattern');

// Roman numerals run into letters by the old builder
const sn = (v, i, m, y) => ({ volume: v, issue: i, number: '', months: m || '', year: y || '' });
eq(N.fixShortName('Sample Newsletter VXIIIN2', sn('XIII', '2')), 'Sample Newsletter V.XIII N2', 'Roman volume separated from the letters around it');
eq(N.fixShortName('Sample Newsletter VIIN4', sn('II', '4')), 'Sample Newsletter V.II N4', 'VIIN4 is vol. II no. 4');
eq(N.fixShortName('Sample Newsletter V.XIII N2', sn('XIII', '2')), null, 'already separated');
eq(N.fixShortName('Example Gazette V1 I1 N1', { volume: '1', issue: '1', number: '1' }), null, 'arabic numbers left alone');
eq(N.fixShortName('Anytown Sample Newsletter V13N1', sn('XIII', '1')), null, 'a Roman volume written in arabic is left alone');
eq(N.fixShortName('Vol. XII no. 4', sn('XII', '4')), null, 'Roman numeral after a space');
eq(N.nextShortName('Sample Newsletter VXIIIN2', sn('XIII', '2', 'March–April', '2001'), sn('XIII', '3', 'May–June', '2001'), 'Sample Newsletter'), 'Sample Newsletter V.XIII N3', 'next name follows the pattern, separated');
eq(N.nextShortName('Anytown Sample Newsletter V14N2', sn('XIV', '2'), sn('XIV', '3'), 'x'), 'Anytown Sample Newsletter V14N3', 'arabic rendering of a Roman volume kept');

// ── contents: order and nesting
const rows = ids => ids.map(([id, parentID]) => ({ id, parentID: parentID || '' }));
// A, a1, a2, a3 (children of A), B, b1
const R1 = rows([['A'], ['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['B'], ['b1', 'B']]);
eq(T.depths(R1), [0, 1, 1, 1, 0, 1], 'depths');
eq(T.subtreeEnd(T.depths(R1), 0), 3, 'subtree of A');
eq(T.indent(R1, 4), { B: 'A' }, 'indent B under A');
eq(T.indent(R1, 1), null, 'first child cannot indent further without a sibling');
eq(T.indent(R1, 2), { a2: 'a1' }, 'indent a2 under a1');
eq(T.outdent(R1, 2), { a2: '', a3: 'a2' }, 'outdent a2: following sibling a3 goes under it');
eq(T.outdent(R1, 0), null, 'top level cannot outdent');
eq(T.moveUp(R1, 4), ['B', 'b1', 'A', 'a1', 'a2', 'a3'], 'move B (with b1) above A');
eq(T.moveDown(R1, 0), ['B', 'b1', 'A', 'a1', 'a2', 'a3'], 'move A below B');
eq(T.moveUp(R1, 1), null, 'first child cannot move up out of its parent');
eq(T.moveDown(R1, 2), ['A', 'a1', 'a3', 'a2', 'B', 'b1'], 'move a2 down among siblings');
eq(T.insertIndex(R1, 0), 4, 'insert after A goes after its children');
eq(T.insertIndex(R1, 2), 3, 'insert after a leaf');

// ── contents: pasted lines
const P = (text, opts) => T.parseLines(text, opts || {}).map(x => x.values);
eq(P('The Village Green ........ 3\nNotes   12\nReviews, pp. 14-16'),
  [{ itemTitle: 'The Village Green', startPage: '3' }, { itemTitle: 'Notes', startPage: '12' }, { itemTitle: 'Reviews', startPage: '14', endPage: '16' }], 'page numbers at line ends');
eq(P('Chapter 12'), [{ itemTitle: 'Chapter 12' }], 'a single space is not a page separator');
eq(P('Gazette\tPublic\tarticle\t1\t2'), [{ itemTitle: 'Gazette', author: 'Public', contentType: 'article', startPage: '1', endPage: '2' }], 'tab columns');
eq(P('\tPublic', { startCol: 'itemTitle' }), [{ itemTitle: '', author: 'Public' }], 'empty first tab cell keeps columns');
eq(P('Smith\nJones', { startCol: 'author' }), [{ author: 'Smith' }, { author: 'Jones' }], 'paste into another column');
eq(P('A Plea for Better Roads, by J. Doe', { by: true }), [{ itemTitle: 'A Plea for Better Roads', author: 'J. Doe' }], 'by-line split when asked');
eq(P('Stand By Me'), [{ itemTitle: 'Stand By Me' }], 'no by-line split unless asked');
eq(P('• Notes\n– Reviews'), [{ itemTitle: 'Notes' }, { itemTitle: 'Reviews' }], 'bullets removed');
eq(T.parseLines('A\n  a1\n  a2\nB', { nest: true }).map(x => x.depth), [0, 1, 1, 0], 'nesting by indentation');
eq(P('Preface ....... iii'), [{ itemTitle: 'Preface', startPage: 'iii' }], 'Roman page after leaders');
eq(P('Notes on Mix'), [{ itemTitle: 'Notes on Mix' }], 'Roman-looking word is not a page');

console.log((fails ? 'FAILED ' + fails + ' of ' : 'PASSED ') + count + ' numbering and contents checks');
process.exit(fails ? 1 : 0);
