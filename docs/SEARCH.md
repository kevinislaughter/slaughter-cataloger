# Catalog search

One search box finds titles, issues, contents items and credited names anywhere in the library that is open. This page describes what it searches, how it compares text, the query language, how results are ranked and shown, and what it promises never to do.

It is versioned with the app, not as a data format: nothing here changes a file or a column.

**The code:**
- `js/core/search.js`: folding, documents, the index, the query language, ranking. Pure, tested in Node.
- `js/ui/search.js`: the box in the top bar and the results page.
- `tools/test-search.js`: the Node suite. The browser checks are in `tools/test-walkthrough.js`.

Every example below uses the invented sample library in `sample-data/3.0/example-library/`.

## 1. Scope

**The scope is the library open now.** The results page names it ("Searching *Example Library* `EXAMPLE-LIBRARY`, the library open now: 5 titles, …") and says what is not searched.

**Searched:** the canonical 3.0 records the app has loaded from the library's CSV files:
- **Titles** (the Titles file);
- **Issues** (each title's Issues file);
- **Contents items** (each title's Contents file);
- **Names.** These are the names *credited* in Author / Credit:
  - headings from the Authorities file, with every credited form filed under them;
  - credited forms that have no heading yet.

**Not searched** (stated so that nothing is assumed):

| Not searched | Why |
|---|---|
| Anything under `_issues/`: issue packages, transcriptions (`text.json`), the deep index of names mentioned in a text (`mentions.json`), covers | Search never opens that folder. A name merely *mentioned* in an article is not a credit. A later phase may add full-text search as a separate index. |
| Unknown extra CSV columns | They are kept on save, but they are not schema fields |
| Rows set aside on reading; files not loaded (Beta 2, unreadable, another library) | They are not in the store. The Library page lists them. |
| Coded and structural fields: issues' `specialIssue`, `supplement`, `dateType`, `yearCalendar`, `sizeUnit`, `evidence`; items' `sequence` and `parentItem`; titles' `catalogingStatus` and `knownIssues` | They hold a flag or a fixed word, not catalog text. Some are shown on result rows. |
| Bookkeeping: Speculative, Speculative Fields, N/A Fields, Overridden Fields, Entry Order, Schema Version, the tool column, the library's slug, name and note | Not catalog text |
| File names, backups, the browser's working copy | Not records |

## 2. What is searched in each record

Each record becomes one **document**. Each field has a **weight**, which feeds ranking (§5). A field also belongs to a **group** used by the field filters (§4): *title*, *credit*, *type* or *note*.

The field lists name the schema's keys. If a key is renamed in `schema.js`, the module refuses to load, so a field cannot quietly drop out of search.

### Titles

| Weight | Fields | Filter group |
|---|---|---|
| 10 | Canonical Title | title |
| 10 | Title Code | |
| 6 | Original Title, Subtitle, Former Titles, Later Titles, Related Titles | title |
| 3 | Publisher, Editors, City, State, Country, Language, Frequency, ISSN, First Year | |
| 1 | First Year Note, Publication History, Mission, Editorial, Bibliographic Note, General Notes | note |

The TitleID is matched as an ID (§4, *IDs*).

### Issues

**Only the issue's own values are indexed.** A value the issue inherits from its title is found on the title, not on every issue: "Anytown" finds *The Example Gazette* once. An override is the issue's own value and is found on the issue (a mid-run change of title, a different printer).

| Weight | Fields | Filter group |
|---|---|---|
| 8 | Short Name, Issue Designation | |
| 6 | Volume, Issue and Number together, with their labels: "vol 4 no 1 whole no 37". So `vol 4 no 1` matches. | |
| 6 | Its own (overridden) Title, Subtitle, Former Title, Later Title | title |
| 5 | Year, Year End, Months, Day, Date Printed | |
| 3 | Contributors, Printer, Printer Location, Series, Series Number, Edition, Supplement Label, Price, Pages, Size; its own (overridden) Publisher, Editors, City, State, Country, Language, Frequency, ISSN | |
| 1 | Notes, Evidence Note, Calendar Note | note |

### Contents items

| Weight | Fields | Filter group |
|---|---|---|
| 10 | Item Title | title |
| 8 | Author / Credit. Each credit is indexed as words, and also by its credit key (§3). | credit |
| 4 | Content Type | type |
| 2 | Pages, as "p 12 15", so `p 12` can be typed | |
| 1 | Notes | note |

- **Parent Item text is not matched.** It repeats the parent's own title, which is its own document. The row shows it as context: *in "Around the County"*.
- **An item's date is its issue's date.** It is looked up when the query runs, for `year:` and for display, so an edit to the issue shows at once.

### Names

The name list is the one the Names tab shows (`names.index`). Search builds it in one pass. The tests check, entry for entry, that the two lists are the same.

| Entry | Weight | Fields | Filter group |
|---|---|---|---|
| A heading (Authorities record) | 10 | Authorized form, and the same name in direct order ("John Q. Public" for "Public, John Q.") | credit |
| | 8 | Variants; every credited form filed under the heading | credit |
| | 3 | Dates, Roles, Honorifics, Name Type | |
| | 1 | Notes, Sources, See Also | note |
| A credited name with no heading | 8 | Each form it is credited under | credit |

The AuthorityID is matched as an ID. A name with no heading has no ID.

### Speculative and N/A values

- **A speculative value** is searched like any value. It is shown as `[1872?]`.
- **A field marked N/A** holds no value, so nothing matches in it.
- **A field left blank** is not searched either.

## 3. How text is compared

Documents and queries go through the same **folding**:

1. **Accents and case.** Unicode NFD, then combining marks (U+0300–U+036F) removed, then lower case. This is the same as `names.sortKey`.
2. **Letters that NFD keeps whole:** æ→ae, œ→oe, ß→ss, ø→o, ł→l, đ→d, ð→d, þ→th, ı→i, and final ς→σ. This applies to search only; `names.nameKey` is not changed.
3. **Apostrophes** (`'` `‘` `’` `ʼ`) are removed without splitting the word: `O'Brien` → `obrien`.
4. **A period between single letters is removed:** `S.E.P.` → `sep`, `J.Q.` → `jq`. A period after a whole word is a break: `Mr. Smith` → `mr smith`.
5. **Everything else** that is not a letter, a digit or a mark becomes one space. Letters outside the Basic Multilingual Plane are letters like any other.

The **words** of a text are the pieces between the spaces.

| Typed or stored | Words |
|---|---|
| `Café`, with é as one character or as e + U+0301 | `cafe` |
| `The Example Gazette, Vol. IV` | `the example gazette vol iv` |
| `Æsop’s Fables` | `aesops fables` |
| `J.Q. Public` | `jq public` |

**Credits** are also compared by their **credit key**, `names.nameKey`, which ignores spacing and punctuation entirely:
- "J. Q. Public", "J.Q. Public" and "j q public" have one key, `jqpublic`.
- A query matches a credit when the query's key equals the credit's key, or is the start of it.
- **No new equivalences are made.** "Jno. Q. Public" finds "John Q. Public" only when a heading lists both forms (§5, *heading expansion*).

**Highlighting** marks the original text, not the folded text. Folding keeps, for every folded character, where it came from. So `cafe` marks the whole of `Café`, whether its accent is part of the letter or a separate mark, and `aesop` marks `Æsop`.

## 4. The query language

| Type | Finds |
|---|---|
| `gazette report` | Records that hold **every word**, in any of their searched fields |
| `town ta` | The **last word** also matches as the **start** of a word (`talk`, `tavern`). It needs 2 characters or more. A space after it, or a closing quote, makes it whole. |
| `"town talk"` | A **phrase:** these words, in this order, in one field |
| `title:county` | **Title fields:** a title's names, an issue's own title fields, an item's Item Title |
| `credit:"j q public"` | **Credits:** Author / Credit of items, by words or by credit key, and the forms of names. Heading expansion applies. |
| `type:poem`, `type:rev` | **Content Type** of items; the start of a word is enough |
| `year:1872`, `year:1870-1875` | **Dates.** Issues whose Year…Year End overlaps; items through their issue; titles with an issue in it or a First Year in it; names with a credited item in it. A speculative year counts. |
| `id:EXAGAZEX-1872-K` | **IDs:** the start of a TitleID, IssueID, ContentID or AuthorityID, in any case |
| `EXAGAZEX-1872-K7V47UA` | **A word shaped like an ID** is matched as an ID, whole or as its start. When it is the whole query and one record's ID, that record comes first. |
| `note:dealers` | **Note fields** only (the weight-1 fields of every kind) |
| `in:gazette`, `in:"sample review"`, `in:EXAGAZEX-1872` | **One periodical:** only records of the titles whose names (Canonical, Original, Former, Later Title, Title Code) contain these words, or whose TitleID starts with the value. It combines with everything else. |
| `-john`, `-"town talk"`, `-type:notice` | **Leave out** records that match |

A filter takes one word, or a "quoted value". The chips on the results page (Titles, Issues, Contents, Names) choose which groups are shown; they are not typed.

**Edge cases.** The parser never fails: malformed input always gives a query, with notices shown above the results.

| Input | What happens |
|---|---|
| An empty query | The "How to search" help, with examples. No results. |
| An unclosed `"` | It is closed at the end |
| An unknown `word:` | The colon is read as text: `ratio:` is the word "ratio" |
| `year:abc`, or a filter with no value | A notice ("year: "abc" is not a year or a range of years; it was ignored."), and the filter is ignored |
| Exclusions only (`-notice`) | Nothing is shown, with a notice that an exclusion needs something to search for |
| Upper case or accents | Folded like the documents |
| More than 200 characters, or more than 32 terms | Cut, with a notice |

## 5. Ranking

Results are grouped by kind (§6). Within a group, they are ordered by **tier**, then **score**, then **catalog order**.

**Tiers** come before the score, so a text match never outranks them:
1. **An exact ID:** the whole query is one record's ID.
2. **Direct matches.**
3. **Heading expansion** (contents items only). A query that matches a heading's name or forms also finds the items credited under any form filed under that heading, even a form the query does not match. They come after every direct match, and are labelled: *Credited as **J.Q.P.**, filed under **Public, John Q.***. They still have to pass the query's other filters and exclusions.

**Score.** For each word, phrase and text filter, the best field it matches in counts:

`field weight × quality`

| Match | Quality |
|---|---|
| A whole word | 1 |
| The start of a word (the last word of the query) | 0.6 |
| …and it is the field's first word | × 1.5 |
| The whole field is exactly the query | 3 (1.8 when the last word is only the start of the field's last word) |
| A phrase: the whole field / at its start / elsewhere | 3 / 1.5 / 1 |
| A credit matched by its credit key: the whole key / its start | 1 / 0.6, at the credit weight (8), for each word |

A record's score is the sum.

**Ties** are broken by catalog order, so the same query on the same library always gives the same list:
- **titles:** as the catalog sorts them, a leading article ignored;
- **issues:** title order, then the order of the Issues file;
- **items:** issue order, then Sequence;
- **names:** filing order, as the Names tab lists them.

The **Catalog order** switch puts contents items in catalog order instead of best match, under a sub-heading for each title and issue (*The Example Gazette* › Vol. 1, No. 1, May 4, 1872). It is kept in the address (`order=catalog`).

## 6. The results page

**Ways in:**
- **The box in the top bar,** shown whenever a library is open. Enter opens the results.
- **The `/` key** focuses the box, when the focus is not in a text field, a drop-down list or an editable cell. No browser shortcut is taken.
- **A link** to `#/search?q=…`. The Guide's examples are links.

**The address** holds the whole search: `#/search?q=<query>&kind=<kind>&order=catalog`. Nothing else is kept. The address lands in the browser's history, which stays on this computer.

**The page:**
- the heading "Search";
- the scope line (§1);
- the field, which updates the results 150 ms after the last key;
- a summary that accounts for every kind: "1 title, 21 issues, 401 contents items and 4 names for "public""; "4 titles, 6 issues and 1,205 contents items for "title:the"; no names" (the sample library);
- **Only in *this title*:** when the search began on a title's Issues or Contents stage, a button adds `in:<TitleID>`. It is offered, never applied silently.
- the kind chips: All, Titles, Issues, Contents, Names, each with its count;
- for contents items, *Best match* or *Catalog order* (with title and issue sub-headings);
- the groups, always in the order **Titles, Issues, Contents, Names**. An empty group is left out.

**Each row** is one link, named by its first line. The second line is plain text.

| Kind | First line (the link) | Then |
|---|---|---|
| Title | Canonical Title (TitleID) | Place · publisher · first year · number of issues · cataloging status |
| Issue | Short name or numbers, and the date | The title; "Supplement", "Special issue" or "speculative" when so marked |
| Item | Item Title, or "[untitled]" | Credit · type · pages; then Title › Issue, date; "in "parent"" when nested |
| Name | The heading, or the most-used form | Number of credited items · the forms (up to 5) · dates; "Needs review" or "no heading" |

- **Matched words are marked** (`<mark>`, in bold as well as colour).
- **A match in a field the row does not show** (a note, say) adds a line with the field's name and up to 120 characters around the match.
- **Records whose file is missing or unreadable** are still found (they are still in the store), with a note.
- **An issue whose title is not in the Titles file,** or an item whose issue is not in an Issues file, is shown with that said.
- Every value is shown as text, never as HTML.

**Paging.** A group shows its first rows (Titles 20, Issues 50, Contents 100, Names 50). **Show more** adds up to 200 and moves the focus to the first new row.

**Nothing found:** "Nothing matches "…"". Each part of the query is a button that searches again without it.

**Live results.** While the page is open, an edit, an undo or a reload anywhere updates the results, 150 ms after the last change. This is not announced, so editing never makes the page speak.

## 7. Opening a result

| Result | Opens | Address |
|---|---|---|
| Title | The title in Library | `#/library/<TitleID>` |
| Issue | The issue's form | `#/issues/<TitleID>/<IssueID>` |
| Contents item | The issue's contents grid, at the item | `#/contents/<TitleID>/<IssueID>/<ContentID>` |
| Heading | The heading in Names | `#/names/<AuthorityID>` |
| Name without a heading | The name in Names | `#/names/k:<credit key>` |

**Arriving at an item:**
- its row is scrolled to the middle of the grid and marked, with a bar and a ribbon (not colour alone) and `aria-current`;
- the focus goes to its Item Title cell.

**Arriving changes nothing.** The grid writes only what is typed. Arriving, then Tab or Escape, leaves the record, the undo list and the changed files as they were. The tests check this.

**An item that has gone** since the search: the issue opens, with "That item is no longer in this issue."

**Back** returns to the results, with the same query, chip, order and rows shown, and the focus on the result that was opened. That is kept in memory only: after a reload, the address alone rebuilds the page.

Older addresses, without the item segment or a query, work as before.

## 8. The index

- **In memory only.** The index is never written to the browser's storage, the working copy, a file or an output. It goes away with the page.
- **Lazy.** Nothing is built when the app starts. The index is built the first time the search box takes the focus, or a search page opens. "Preparing search…" shows while it is built.
- **Kept up from the store's events:**

  | Event | What the index does |
  |---|---|
  | An edit, undo or redo (`change`, with the records changed) | Each changed record's document is made again. A changed title also re-makes its issues' documents, because what an issue inherits depends on the title. |
  | A changed credit, or any change to a heading | The name list is worked out again before the next query. Only the entries that changed are indexed again. |
  | Opening, reconnecting or restoring a library (`load`) | The index is dropped, and built again when next used |
  | Saving, the changed-files list | Nothing: no record changed |

- **Tested to stay right.** After 500 random edits, undos, redos and loads, the index kept up from events is the same as one built afresh, and gives the same results.

## 9. The read-only promise

Search reads the store and nothing else.

| It never… | Checked by |
|---|---|
| changes a record, or calls `put`, `remove`, `batch`, `undo`, `redo`, `load` or `markDirty` | Node: every query runs on a state whose maps throw on any write; the store's version, changed files, undo and redo, and revisions are equal before and after. A static check that the two search modules name no store mutator. |
| changes the undo list, the changed files or the save state | Browser: all equal before and after a whole search session (search, chips, order, Show more, opening each kind of result, Back) |
| reads or writes a file | Browser: the test folder logs every list, open, read and write. A search session adds nothing. |
| opens anything under `_issues/` | Browser: the invented twin's issue package is placed in the test folder. Searching for each of its canary strings finds nothing, and nothing below `_issues/` is touched. |
| writes the browser's working copy, localStorage or sessionStorage | Browser: the journal and both storages are equal before and after |
| changes a Compiler output | Browser: the Compiler's RIS output for a title is the same before and after a search session. Every Compiler and format test runs unchanged. |
| renders a value as HTML | A record titled `<img src=x onerror=…>` shows as text and runs nothing; a static check finds no `innerHTML` |

## 10. Performance

### The acceptance criterion

**First-use indexing and normal search interactions must complete within about two seconds on representative hardware.** This was set when Phase 2 was accepted (2026-10-15). It replaced the Phase 2 budgets as the release criterion.

**The limit: 2,000 ms.** It is the only performance figure that fails a test run. A time over it is treated as a severe regression, and fails its step.

**The test conditions** are the same on every run:
- **The library:** generated by the tests from a fixed seed (`tools/lib/search-library.js`). It has 10,000 contents items, 1,000 issues, 50 titles and 2,000 headings, about 26,000 distinct invented words, and credits in varying forms: 13,782 documents.
- **Node** (`tools/test-search.js`), each figure checked against the limit:
  - the first build in a fresh process (median of 5);
  - the full build (median of 5);
  - the slowest of 40 queries;
  - the slowest first query after an edit;
  - the slowest record update;
  - the slowest name-list rebuild.
- **Chromium** (`tools/test-walkthrough.js`), each figure checked against the limit:
  - first-use indexing: from the first focus of the search box to the index ready;
  - the results page drawn;
  - the last key typed to visible results.

  Both at sample scale and at 10,000 items.

### Diagnostic targets (not blocking)

The Phase 2 budgets are kept as **diagnostic targets**. Every run measures them and prints each as *met* or *NOT MET*, but a target that is not met never fails a run.

`run-tests.sh` lists every figure at the end of its output, with the number of targets not met. On GitHub Actions the same list goes into the job summary.

| Measure | Target |
|---|---|
| First index build, in a fresh process (median of 5) | **300 ms, on a mid-range laptop.** The original optimization target, kept for comparison. |
| Full build once the code is warm (a library reopened; median of 5) | 300 ms |
| A query, from text to grouped results | 50 ms at the 95th percentile of 40 queries |
| One changed record | 5 ms |
| The name list after a credit or heading change | 100 ms |
| The first build in Chromium, with catalog order | 300 ms |
| The results page drawn (Chromium) | 100 ms |
| Typing to visible results, including the 150 ms pause (Chromium) | 250 ms |
| App start-up | unchanged: no index work before first use (a functional check, which does fail) |

**The measurements behind the decision.** They are not a statement about representative hardware. They were taken on 2026-10-15, on a shared 2-vCPU cloud VM. That VM sorted 1,000,000 numbers in JavaScript in 1.0–2.0 s; a current laptop typically takes 150–250 ms.

*Generated library*

| Measure | Result |
|---|---|
| First build, fresh process | medians 580–763 ms |
| Full build | medians 413–539 ms |
| Query, 95th percentile | 32–40 ms |
| Names rebuild | slowest 86–135 ms |

*In Chromium*

| Measure | Result |
|---|---|
| First build, with order | 367–551 ms |
| Results page drawn | 114–154 ms |
| Typing to visible results | 237–270 ms |

*Earlier and private runs*
- Earlier the same day, on a faster host, the first build measured a median of 313 ms.
- **A real library,** read privately from outside the repository with `--private`:
  - over 10,000 contents items;
  - no Authorities file, so no headings: heading expansion and the headings' share of the name list were not exercised;
  - first build 780.5 ms;
  - queries 3.1 ms median, 40.5 ms at the 95th percentile.

  No title, credit or text of it is recorded anywhere in the repository.

**Not changed by this decision:**
- the index design (in memory, lazy, incremental);
- `names.index`;
- every functional, data-safety, privacy, read-only and accessibility check, which fail as before.

**`SC_BUDGET_MODE`**, the earlier shared-runner mode with a 400 ms allowance, is retired. If it is set, the suite says so, and it has no effect.

### Running it on your own computer

In the project folder, with Node 18 or later:

```
node tools/test-search.js
```

It ends with lines like these (the times are this machine's):

```
Performance, generated library: 50 titles, 1000 issues, 10000 items, 2000 headings; 25774 distinct words; 13782 documents
  first build, 5 fresh processes (ms): …  (median …)
  full build, 5 runs (ms): …
  query, 40 queries (ms): median …, 95th percentile …, slowest …
  …
  this machine sorts 1,000,000 numbers in … ms (a typical current laptop: roughly 150–250 ms)
  LIMIT (fails the suite): 2,000 ms for first-use indexing and every search interaction: held; the slowest figure is … ms
  Phase 2 targets (diagnostic: reported, never a failure):
    met      first build in a fresh process, median of 5: … ms (target 300 ms, set for a mid-range laptop)
    …
PASSED 156 search checks
```

- Close other heavy programs first, and plug a laptop in: a battery saver slows it.
- To keep the times, add `SC_SEARCH_TIMES=times.json` before the command. The file records every time, the machine's sort time, whether the limit held and which targets were met.
- The sort time says how fast the machine was at the moment, so results from different machines can be compared.

**A real library, privately.**
- `node tools/test-search.js --private <library folder>` reads a real library in place, outside the repository.
- It prints counts and times only: never a title, a credit or a word of text.
- It refuses a folder inside the repository.
- It is not part of the release check.

## 11. Limits

- **No fuzzy matching, stemming or regular expressions.** `review` does not find `reviews` unless it is the last word (then it is a start). Catalogers' vocabulary is exact.
- **Only the last word is a prefix.**
- **No new name equivalences.** Spelling variants are joined only by a heading's forms.
- **Exclusions match whole words only.** `-john` leaves out records with the word `john`, not `johnson`.
- **Nothing is persisted:** no saved searches, no history beyond the browser's own.
- **Opening a result in a new tab** meets the app's one-tab rule: the new tab offers "Use this tab instead". Results open in the same tab.
- **The small finders** (Library "Find a title", Issues "Find an issue", Names "Find a name") are unchanged.
- **Scale.** The index takes about 26–30 MB of memory at 10,000 items.
