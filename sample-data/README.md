# Sample data

An invented library of five titles at different stages of cataloging. Every title, name, place and item is made up; the names are placeholders (John Q. Public, Jane Doe, Anytown). The tests use it, and it's handy for trying the app.

**Copy the folder before opening it in the app:** saving writes into the folder you open.

`3.0/example-library/` holds 5 titles, 371 issues and 2,578 contents items:

| Title | Status | Issues | Contents | Shows |
|---|---|---|---|---|
| **The Example Gazette** (Anytown, 1872–1882) | Contents in progress | 309 | 1,564 (volumes 1–3 of 11) | A long run: weekly, then fortnightly, then monthly, then one issue after a four-month pause; two supplements and a special issue; title-level fields inherited, and overridden from volume 7 (City) and volume 9 (Publisher); many credits to gather under one heading (Public, John Q.: "J.Q.P.", "Jno. Q. Public", "J. Q. Public") |
| **The Placeholder Bulletin** (Springfield, 1961–1973) | Contents in progress | 36 | 458 | Numbers without volumes, so the run strip has a row per year; 8 numbers missing; a speculative first year |
| **Sample Review** (Riverton, 1990–1995) | Contents complete | 24 | 528 | A complete run, with contents nested three levels deep and speculative values |
| **The Demonstration Quarterly** (Lakeside, 1995–1996) | Fully cataloged | 2 | 28 | A small, finished title with nested contents |
| **The Specimen Monthly** (Oakdale, 2011–) | Not started | 0 | 0 | A title record only, with 24 issues known |

`beta2/example-library/` holds the same five titles in the Beta 2 format, for the converter and the round-trip test. It has what Beta 2 folders often have:
- dated copies of one list: an early Issues copy (`…_DRAFT_ISSUES_…`) whose one record differs from the full list, and two copies of the Gazette's contents (the later one corrected, with one item more), so the converter has copies to merge;
- older names inside the Speculative and N/A lists (`Series No.`, `firstYear`), names that match no column, IssueIDs in an older code pattern, and Parent Item given as a sequence number or in capitals;
- different CSV layouts: with and without a byte-order mark, CRLF line endings, quoted and unquoted values.

The converter picks the newest copy by the file's modification date. The dated copies carry their dates, and their names sort in the same order, so a fresh checkout (where every file has the same date) gives the same result.

`issue-package/` holds one invented issue package (the full text, contents rows, mention index, cover and source file of one issue), for the issue-package tools and tests. See [its README](issue-package/README.md).

## Regenerating

The files are written by [`tools/make-sample.js`](../tools/make-sample.js) from a fixed seed, so they are the same every time:

```sh
node tools/make-sample.js            # rewrites sample-data/3.0/example-library and sample-data/beta2/example-library
node tools/make-sample.js --check    # also converts the Beta 2 copy and compares it with the 3.0 copy, record by record
```

`run-tests.sh` checks that the files here are exactly what the generator writes. To change the sample, change the generator, not the CSVs.

The issue package is written by [`tools/make-issue-fixture.js`](../tools/make-issue-fixture.js) in the same way (`node tools/make-issue-fixture.js`), and checked the same way.
