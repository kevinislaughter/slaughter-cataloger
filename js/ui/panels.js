/* Slaughter Cataloger 3 — the context bar shared by stages 2 and 3, and the Guide.
   Stage 2 lives in issues.js, stage 3 in contents.js, stage 4 in compiler.js. */
(function (SC) {
  'use strict';
  const { html, useStore, navigate, issueLabel, issueDate } = SC.ui;

  const sortTitles = arr => arr.slice().sort((a, b) => (a.canonicalTitle || '').localeCompare(b.canonicalTitle || ''));

  // ── Context bar ───────────────────────────────────────────────────────
  function ContextBar({ route }) {
    const store = useStore();
    const titles = sortTitles(Array.from(store.state.titles.values()));
    // Titles that have issues or contents but no record in the Titles file.
    const orphanTIDs = Array.from(new Set(Array.from(store.state.issues.values()).map(i => i.titleID)
      .concat(Array.from(store.state.contents.values()).map(c => c.issueID && !store.state.issues.has(c.issueID) ? SC.records.titleOfContent(store.state, c) : ''))
      .filter(t => t && !store.state.titles.has(t)))).sort();
    const issues = route.titleID ? store.issuesOfTitle(route.titleID) : [];
    const isNew = route.issueID === 'new' && route.panel === 'issues';
    const pos = issues.findIndex(i => i.issueID === route.issueID);
    const go = (titleID, issueID) => navigate({ panel: route.panel, titleID, issueID: issueID || '' });
    return html`<div class="context-bar" role="navigation" aria-label="Current title and issue">
      <label class="ctx"><span>Title</span>
        <select value=${route.titleID} onChange=${e => go(e.target.value, '')}>
          <option value="">Choose a title</option>
          ${titles.map(t => html`<option value=${t.titleID}>${t.canonicalTitle} (${t.titleID})</option>`)}
          ${orphanTIDs.map(t => html`<option value=${t}>${t} (not in Titles file)</option>`)}
        </select></label>
      ${route.panel !== 'compiler' && html`<label class="ctx"><span>Issue</span>
        <select value=${isNew ? 'new' : pos === -1 ? '' : route.issueID} disabled=${!issues.length && !isNew} onChange=${e => go(route.titleID, e.target.value)}>
          <option value="">${issues.length ? (route.panel === 'issues' ? 'All issues (' : 'Choose an issue (') + issues.length + ')' : route.titleID ? 'No issues yet' : 'Choose a title first'}</option>
          ${isNew && html`<option value="new">New issue, not yet recorded</option>`}
          ${issues.map(i => html`<option value=${i.issueID}>${issueLabel(i)}${issueDate(i) ? ' — ' + issueDate(i) : ''}</option>`)}
        </select></label>
      <span class="ctx-step">
        <button class="btn small" disabled=${pos <= 0} onClick=${() => go(route.titleID, issues[pos - 1].issueID)} aria-label="Previous issue" title="Alt+PageUp">Previous</button>
        <button class="btn small" disabled=${pos === -1 || pos >= issues.length - 1} onClick=${() => go(route.titleID, issues[pos + 1].issueID)} aria-label="Next issue" title="Alt+PageDown">Next</button>
      </span>`}
    </div>`;
  }

  function GuidePanel() {
    return html`<section class="guide">
      <h1 class="panel-title">Guide</h1>
      <h2>Your library is a folder of CSV files</h2>
      <p>Open the folder once. Save writes your changes back into the same CSV files, only the files that changed. Before a file is overwritten for the first time in a session, the copy on disk is kept in <code>${'_backups/<date-time>-<code>'}</code> inside the folder, a folder of that session's own; if a file was changed by something else while the library was open (a spreadsheet, say), that version is kept there too and the save says so. A backup is never written over, each is checked byte for byte against the file it copies before that file is replaced (if it cannot be made, the file is not saved), and <code>BACKUPS.txt</code> in each backup folder lists what every copy is, when it was made and why. To go back to a copy, copy it into the library folder under its original name. The CSVs remain the record: readable in any spreadsheet, and yours.</p>
      <p>If the folder holds several versions of the same file — dated exports, for instance — the newest is loaded and the others are listed in the load report.</p>

      <h2>Saving, and what the browser keeps</h2>
      <p><strong>Your files.</strong> “All changes saved” means every file in the folder holds exactly what you see. A file shows as changed until it is saved, including after you undo past a save and then make a different change. If a save cannot write a file (no permission, disk full), the message names it; the others are saved, and that one stays changed until a later save writes it.</p>
      <p><strong>The browser's working copy.</strong> Every change is also written into this browser's storage as you make it, so closing the tab, a crash or a restart does not lose it: open the app again and your work is there, marked unsaved, until you save. A change made in the instant before a crash can be lost. The working copy is not a backup — clearing the browser's data for this page deletes it — so save to your folder often. If the browser cannot store a change, a red notice says so, and it stays until the whole library has been stored again; if the app is closed before then, opening it again says what could not be brought back.</p>
      <p><strong>One tab at a time.</strong> The working copy belongs to one tab. A second tab says the library is open elsewhere and offers <em>Use this tab instead</em>. The first tab then stops, and so does any save it was making, so it cannot write over what the new tab saves. The new tab carries on with every change the first had stored; only a change made in the very moment of switching could miss it.</p>
      <p><strong>When the folder changes.</strong> After a restart the app asks for access to the folder again (<em>Allow access</em>); it then reads files added there, reads again files changed there that you have not changed, and keeps your version of those you have. A file that is no longer in the folder keeps its records here and is listed on the Library page; nothing is written to its name until it is back, or until you remove it from the library. If the remembered folder now holds a different library, nothing is read from it or saved into it; <em>Choose folder</em> points the working copy at the right one, keeping your unsaved work.</p>
      <p><strong>Rows that cannot be read in</strong> — a row whose ID repeats an earlier row's, a row of another library, a row of another kind in the wrong file — are not loaded, but are kept exactly as they are and written back (at the end of the file) whenever that file is saved. The Library page lists them. A file that cannot be read as a whole (a quoted value never closed, a column heading used twice, a row with more or fewer values than columns, or text that is not UTF-8 — a spreadsheet's plain “CSV” rather than “CSV UTF-8”, whose accented letters would be damaged) is not loaded at all, and the load report says where the problem is. Nothing new is saved under that file's name until it is corrected — adding to it is refused, with the reason — so the file in the folder is never written over.</p>
      <p><strong>In Firefox and Safari</strong> the app cannot write into a folder: you load the CSV files, and Save downloads the changed ones. A download is not yet a save — the files stay marked changed until you move the downloaded files into your library folder, replacing the old copies, and click <em>I've replaced the files</em>.</p>
      <p><strong>Spreadsheet safety.</strong> A value that starts with <code>=</code>, <code>+</code>, <code>-</code> or <code>@</code> is written with an apostrophe in front (<code>'-- END</code>) so a spreadsheet does not take it for a formula; the app removes it again when reading. A value that itself starts with an apostrophe before one of those characters is written with one more (<code>''-ism</code>), so every value reads back exactly as it was. In a file edited elsewhere (a spreadsheet, a text editor), the same rule applies, as spreadsheets apply it: <code>'-ism</code> is read as <code>-ism</code>, and to keep a literal apostrophe before one of those characters, type it twice (<code>''-ism</code>). A value written there without the apostrophe (<code>=SUM(1,2)</code>) is read as it is, and gets one when the app next saves the file. An apostrophe before anything else (<code>'Twas</code>) is never touched.</p>

      <h2>The four stages</h2>
      <p>Library holds the titles. Issues records the issues of a title. Contents records what appears in each issue. Compiler turns the data into checklists, catalogs and citations. The title and issue you are working on stay selected as you move between stages, and the address bar remembers where you are.</p>

      <h2>The run at a glance</h2>
      <p>The issues of a title, in Issues, in the Contents issue list and on the title's page in Library, show as a strip: a row for each volume (or each year, when the run has no volumes) and a square for each issue. A filled square has its contents recorded; an open one has none yet; a hatched square is a number missing from the run; ochre marks an issue recorded as speculative; a round one is a supplement or special issue. Point at a square to see the issue, click it to open it. With the keyboard the strip is one stop for <kbd>Tab</kbd>, at the issue you are on (or the first): the arrow keys move from square to square, <kbd>Home</kbd> and <kbd>End</kbd> to the first and last, and <kbd>Enter</kbd> opens one. The list of the run beside an issue, and the list in Names, work the same way.</p>

      <h2>Recording issues</h2>
      <p>The run of issues sits on the left; the issue you are working on fills the rest. <strong>New issue</strong> starts a draft that follows the issue before it. Fields that rarely change from one issue to the next — pages, size, price, edition, series, calendar, evidence, and any title-level field the previous issue set for itself — are carried over. The volume, issue and whole numbers move on, and so does the date, by the same step as last time: a month, two months, a season, a week, a year. Roman numerals stay Roman, zero-padded numbers stay padded, and a double issue such as 5/6 is followed by 7. Months spanning the turn of a year (Dec–Jan) set the end year.</p>
      <p>Under <em>Moves on</em> you choose which numbers advance and how the date moves; the choice is remembered per title. <strong>Start next volume</strong> raises the volume and sets the issue number back to 1. When the previous volume ended at a lower number than the one you are about to record, the form suggests the new volume.</p>
      <p>The short name follows the pattern of the previous issue's short name, so <code>Example Gazette V1 I2 N2</code> is followed by <code>Example Gazette V1 I3 N3</code>. Type your own and it stays yours. A Roman volume gets a point (<code>Sample Newsletter V.II I.4</code>) so it can't run into the next letter.</p>
      <p><strong>Record issue</strong> (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>) adds the draft to the run and the next draft is ready. Nothing is asked first: the count of fields not yet addressed is shown on the draft, and an issue that matches one already in the run is pointed out. The IssueID is assigned when the issue is recorded and never changes. Until then the draft is kept only while the app is open, and it is not in your files or in the browser's working copy: once you have entered something in it, leaving or reloading the page, closing the library or opening another folder asks first.</p>

      <h2>Recording contents</h2>
      <p>The contents of an issue form one table, in printed order. Type in the last row to add an item; <kbd>Enter</kbd> moves down a row, <kbd>Shift</kbd> + <kbd>Enter</kbd> starts a new line inside a title or a note. Sequence numbers are kept as 1, 2, 3… as items are added, moved and removed.</p>
      <p>Paste several lines into a cell and each line becomes an item. Page numbers at the end of a line (<code>Notes ........ 12</code>, <code>Notes, p. 12</code>, <code>Notes  12–14</code>) go to the page columns. Columns copied from a spreadsheet go to title, author, type, start page, end page and notes, starting from the column you pasted into. <strong>Add several items…</strong> shows what will be added before it is added, and can split "…, by Author" and read indented lines as nested.</p>
      <p>An item can be part of another — a poem inside a section, a letter inside a correspondence column. <strong>Nest</strong> makes the item part of the one above it; <strong>Un-nest</strong> moves it out a level. Moving an item up or down takes the items nested in it along.</p>
      <p>A part can be printed apart from its parent, with another item between them: letters in a correspondence column, say, that go on after a market report. Such a part is marked with a dashed line and says whose part it is (<em>part of no. 3, “Correspondence”, above</em>), and its parent says where its parts further down are. Moving, deleting and nesting go by whose part an item is, not by how it is indented: deleting an item deletes its own parts wherever they are, and nothing else; a move that would put a part before its parent is not made. The catalog, the WordPress list and the proofing sheet name the parent of such a part.</p>
      <table class="keys"><tbody>
        <tr><td><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd></td><td>Nest / un-nest</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></td><td>Move up / down</td></tr>
        <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></td><td>Open an empty row below</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> / <kbd>N</kbd></td><td>Mark the cell ? / N/A</td></tr>
        <tr><td><kbd>Escape</kbd></td><td>Undo what you typed in the cell</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>Delete</kbd></td><td>Delete the item (the forward Delete key: <kbd>Fn</kbd> + <kbd>Delete</kbd> on a Mac laptop); <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> brings it back</td></tr>
      </tbody></table>
      <p>Authors and content types already used complete as you type, the most used first (this title's own before the rest of the library): type <code>Alex</code> and <code>ander Green</code> is filled in, selected. Keep typing to write something else, press <kbd>Backspace</kbd> to drop the suggestion, or <kbd>Enter</kbd> or <kbd>Tab</kbd> to take it.</p>

      <h2>Names and headings</h2>
      <p>Library › Names lists every name credited in the contents of the library, with how often it occurs. Credits are split where a cell names several people: on semicolons, on “&”, and on a slash between names (<code>A.N. Other/Public</code>, a letter and its reply). Case, spacing and punctuation are ignored, so <code>J. Q. Public</code> and <code>J.Q. Public</code> are one form.</p>
      <p>A <strong>heading</strong> gathers the forms one person or body is credited under and is the form the name files under in an index: <code>J.Q.P.</code>, <code>Jno. Q. Public</code> and <code>John Q. Public</code> under <strong>Public, John Q.</strong> Choose a name to make a heading from it (surname first is suggested; roles such as “translated by” and honorifics such as “Rev.” are set aside), to add it to an existing heading, or to combine it with the forms that are probably the same name. <em>Suggested matches</em> lists those groups for the whole library: same surname, with forenames and initials that agree (<code>Wm.</code> counts as William, and an initialism such as <code>J.Q.P.</code> joins the name it spells). Check each before combining.</p>
      <p>Headings never change the contents: each credit stays as printed. They are kept in the library's Authorities file, <code>${'SCAT_<library>_AUTHORITIES.csv'}</code>, each with a permanent AuthorityID (<code>AU-7M4Q2B</code>), its type, dates, see-also, roles, honorifics, sources, notes and status (Needs review or Confirmed). Authority lists from Beta 2 (<code>${'AUTHORITY_<TitleID>.csv'}</code>) are converted to this file along with the rest of a library.</p>

      <h2>Searching the catalog</h2>
      <p>The search box at the top finds titles, issues, contents items and credited names anywhere in the library that is open, and nothing else: not the text of an issue, and not a name merely mentioned in one. Press <kbd>/</kbd> to go to it from anywhere you are not typing. <kbd>Enter</kbd> opens the results, grouped as Titles, Issues, Contents and Names; a result opens the record where it is edited, and a contents item opens its issue with the item's row in view. <strong>Back</strong> returns to the results.</p>
      <table class="keys"><tbody>
        <tr><td><a href="#/search?q=town%20ta"><code>town ta</code></a></td><td>Every word must match the same record; the last word may be the start of one</td></tr>
        <tr><td><a href="#/search?q=%22town%20talk%22"><code>"town talk"</code></a></td><td>A phrase: these words, in this order</td></tr>
        <tr><td><a href="#/search?q=credit%3A%22J.%20Q.%20Public%22"><code>credit:"J. Q. Public"</code></a></td><td>Credits, however spaced or pointed: <code>J.Q. Public</code> is the same. A heading also brings in the items credited under its other forms, shown after the rest.</td></tr>
        <tr><td><a href="#/search?q=type%3Apoem%20year%3A1872"><code>type:poem year:1872</code></a></td><td>Content type; year or range of years (<code>year:1870-1875</code>)</td></tr>
        <tr><td><a href="#/search?q=in%3Agazette%20fair"><code>in:gazette fair</code></a></td><td>Only the records of one periodical, by its title or TitleID</td></tr>
        <tr><td><code>title:</code> <code>note:</code> <code>id:</code></td><td>Only titles; only notes; an ID or its start (<code>id:EXAGAZEX-1872-K</code>)</td></tr>
        <tr><td><a href="#/search?q=smith%20-john"><code>smith -john</code></a></td><td>Leave out what matches; also <code>-"a phrase"</code> and <code>-type:notice</code></td></tr>
      </tbody></table>
      <p>Case, accents and punctuation do not matter: <code>perez</code> finds <code>Pérez</code>, and <code>S.E.P.</code> is <code>sep</code>. An issue is found by its own values; a value it takes from its title (its place, say) is found on the title. Results that match equally well are in catalog order, and <em>Catalog order</em> lists contents items exactly as the issues print them. Search only reads: it never changes a record, a file or what the browser keeps, and an edit or an undo shows in the results at once. Opening a result in a new tab reaches the one-tab rule above (<em>Use this tab instead</em>), so results open in the same tab.</p>

      <h2>Compiling</h2>
      <p>The Compiler turns the library into finished files. Tick one title or several, choose an output, and the preview follows every choice; it shows the first 25 issues of a long run (fewer of each title when several are ticked), and <strong>Download</strong>, <strong>Copy</strong> and <strong>Open</strong> always include everything. Files are named <code>${'SCATOUT_<library>_<TitleID>_<output>_<date>'}</code>, without the TitleID when several titles are compiled together.</p>
      <table class="keys"><tbody>
        <tr><td><strong>Checklist</strong></td><td>The run as a list to tick off, as a web page, Markdown or plain text. Plain gives numbers and date; Bibliographic writes each issue as a citation; IssueID first suits data work. Pages, price, imprint, printer, designation, evidence, subtitle, notes and IssueID can be added.</td></tr>
        <tr><td><strong>Catalog</strong></td><td>One standalone web page: each title's facts and notes, then its issues, in volume or year sections for long runs, each with its table of contents. Place, publisher or editors appear on an issue only where it differs from the title.</td></tr>
        <tr><td><strong>WordPress</strong></td><td>The catalog as blocks, to paste into the WordPress code editor.</td></tr>
        <tr><td><strong>Proofing catalog</strong></td><td>A print-ready document for checking records against the issues in hand: an explainer, a proof sheet for each title, then every issue on its own printed pages, never two issues on one page, with every field, a box to tick, its status (?, [N/A], [blank], from title) and room for corrections. Use <strong>Open</strong> to print it.</td></tr>
        <tr><td><strong>Name index</strong></td><td>Every credited name in alphabetical order with each credit (issue, date, page, item), the forms a heading was credited under, and see-references from forms that file elsewhere: <em>J.Q.P.</em> see <strong>Public, John Q.</strong> Names without a heading file under the form a heading would take, or as credited if you prefer.</td></tr>
        <tr><td><strong>RIS</strong></td><td>One record per contents item, for Zotero and other reference managers. Authors are given as their heading where there is one; the credit as printed goes in a note.</td></tr>
        <tr><td><strong>BibTeX</strong></td><td>One entry per contents item, for JabRef. The ContentID is the citation key; authors as in RIS.</td></tr>
      </tbody></table>
      <p>Uncertain values print in brackets with a question mark, <span class="unc">[1872?]</span>, as in a printed bibliography, unless you turn that off. RIS and BibTeX keep the values plain and list the speculative fields in a note, with the TitleID, IssueID and ContentID, so every record can be traced back to the library.</p>

      <h2>Inherited fields</h2>
      <p>Twelve title-level fields — title, subtitle, former and later titles, publisher, editors, ISSN, language, frequency, city, state and country — come from the title record unless an issue says otherwise. They sit at the bottom of the issue form, folded away. Typing in one sets it for that issue only; <em>use title's</em> goes back to the title's value. Change the title record and every issue that inherits follows. Issue CSVs still carry the full values, plus an Overridden Fields column naming the fields that issue sets for itself.</p>

      <h2>Field states</h2>
      <p>A field is filled, speculative (?), not applicable (N/A), or not yet addressed. Unaddressed fields carry a blue underline. Speculative values appear in brackets with a question mark, as in a printed bibliography: <span class="unc">[1872?]</span>.</p>

      <h2>Identifiers</h2>
      <p>TitleID (<code>EXAGAZEX-1872</code>), IssueID (<code>EXAGAZEX-1872-K4R8V2M</code>) and ContentID (<code>EXAGAZEX-1872-C7M4Q2B</code>) are permanent. Editing a record never changes its ID, so links between titles, issues and contents survive any correction.</p>

      <h2>Undo and saving</h2>
      <p><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> undoes the last change; with <kbd>Shift</kbd> added (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Y</kbd>) it redoes. While a field holds typing you have not yet entered, they undo your typing instead; when nothing typed is waiting in it, or in the rest of the page, they undo changes to the library. In the search boxes they only ever undo typing. Leaving or reloading the page asks first while files are unsaved or a field holds typing not yet entered. Deleting an issue or an item can be undone the same way. A file whose last record you delete is saved with its column headings and no rows; it opens again as an empty file, and new records can be added to it. A title can be deleted once it has no issues or contents, but never the library's only title: the library's name, note and slug are kept with the titles. <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> saves. <kbd>Alt</kbd> + <kbd>Page Up</kbd> / <kbd>Page Down</kbd> step to the previous or next issue, keeping your place: the same field of the issue form, or the same column of the first item in Contents.</p>

      <h2>Files from Beta 2</h2>
      <p>This version opens 3.0 files only. Files from Beta 2 are converted once, outside the app: the conversion merges duplicate and dated copies, gives every contents item a permanent ContentID, works out which issue fields differ from their title, and writes one Issues file and one Contents file per title. Beta 2 files found in a folder are listed as not loaded and are never changed.</p>
      <p>Avoid re-saving library CSVs from a spreadsheet program: they tend to rewrite values such as <code>3.0</code> as <code>3</code> and <code>3-4</code> as a date.</p>
    </section>`;
  }

  SC.views = Object.assign(SC.views || {}, { ContextBar, GuidePanel });
})(globalThis.SC = globalThis.SC || {});
