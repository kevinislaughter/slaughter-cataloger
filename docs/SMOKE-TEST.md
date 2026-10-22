# Release smoke test

This is a manual check in a real browser, with a real folder on a real disk. It complements the automated suite (`sh run-tests.sh`), which drives Chromium against an in-memory folder and the browser's private file system, but can't reach your disk, a real spreadsheet, Zotero or WordPress. It takes about 40 minutes.

**Record:** date, browser and version, operating system, and the result of each step (pass, or what happened instead).

## Setup

1. Copy `sample-data/3.0/example-library/` to somewhere ordinary, e.g. `Documents/sc3-smoke/`.
2. Open `dist/slaughter-cataloger-3.html` in **Chrome** (and again in **Edge** if you can), straight from disk.

## A. Open, edit, save, back up

| # | Do | Expect |
|---|---|---|
| A1 | **Open library folder**, choose `sc3-smoke`, and allow editing | 5 titles, 371 issues, 2,578 contents items; "All changes saved" |
| A2 | Library → **The Demonstration Quarterly** → change *General notes*; press Ctrl/⌘+S | "Saved SCAT_EXAMPLE-LIBRARY_TITLES.csv. The versions they replaced are in _backups/<date-time>-<code>." |
| A3 | Open the folder on disk: look at `_backups/<that folder>/` | `SCAT_EXAMPLE-LIBRARY_TITLES.csv` is the file **as it was before** the edit (open it in a text editor and check the notes; it is the same size as the original was). `BACKUPS.txt` lists it |
| A4 | Open the saved `SCAT_EXAMPLE-LIBRARY_TITLES.csv` in a text editor | Your new notes are there; nothing else in the file changed |
| A5 | Delete the `_backups` folder on disk. In the app, edit and Save again | Saved; a new `_backups/<date-time>-<code>/` holds the version it replaced |

## B. Undo past a save (review B-01)

| # | Do | Expect |
|---|---|---|
| B1 | Change *General notes* to "B", then Save | "All changes saved" |
| B2 | Undo (Ctrl/⌘+Z) | The notes go back; "1 file changed" |
| B3 | Type "D" in *General notes* | Still "1 file changed" (not "All changes saved") |
| B4 | Save | The file on disk has "D" |

## C. Reload, crash, reconnect

| # | Do | Expect |
|---|---|---|
| C1 | Contents → The Demonstration Quarterly → edit an item's title; **don't save**; reload the tab | **Allow access** banner. After allowing: the edit is there, marked unsaved |
| C2 | Save. Then edit again, without saving, and quit the browser entirely; reopen it and the app | The unsaved edit is restored |
| C3 | Save. With the app still open, open `SCAT_EXAMPLE-LIBRARY_TITLES.csv` in a spreadsheet, change a cell, save it there (as **CSV UTF-8**). In the app, edit the title and Save | The message says the file had been changed on disk and names the backup copy of the spreadsheet's version. Check that copy in `_backups/` |
| C4 | Close the app's tab. In the folder, copy `SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv` to the desktop, then delete it from the folder. Reopen the app and **Allow access** | The Quarterly's issues are still shown; the Library page lists the file as missing. Put the file back and reconnect: "Back in the folder" |
| C5 | Save twice within a few seconds in two separate sessions: Save, then **Open another folder** on the same folder, edit, Save | Two separate backup folders, each holding its own earlier version |

## D. Two tabs

| # | Do | Expect |
|---|---|---|
| D1 | With the library open, open the app in a second tab | "Already open in another tab" |
| D2 | **Use this tab instead** | The second tab has your work; the first says it has stopped |

## E. A broken file

| # | Do | Expect |
|---|---|---|
| E1 | Close the app. In the folder, open `SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv` in a text editor and delete one comma on a data row; save | — |
| E2 | Open the folder in the app | The load report names the Issues file and the line; the Quarterly shows no issues |
| E3 | Issues → The Demonstration Quarterly → **Record the first issue** → give it a short name → **Record issue** | Refused: "… is in the folder but was not loaded …". The broken file on disk is unchanged |
| E4 | Close the app. Put the Issues file back as it was, then save `SCAT_EXAMPLE-LIBRARY_TITLES.csv` from Excel as plain **CSV (Comma delimited)** (Windows; not "CSV UTF-8") after typing an accented letter (é) into a cell. Open the folder in the app | The load report says the Titles file is not UTF-8 and was not loaded; the file on disk is unchanged. Save it as CSV UTF-8 instead and reconnect: it loads, with the é intact |

## F. Firefox or Safari (only if you mean to say they work)

| # | Do | Expect |
|---|---|---|
| F1 | Open the app; **Load CSV files**; choose the folder's CSVs | The library loads |
| F2 | Edit; click **Download changed files** | The changed files download; "1 file changed" stays until **I've replaced the files** |

## G. Outputs in real applications

| # | Do | Expect |
|---|---|---|
| G1 | Compiler → **The Demonstration Quarterly** → **RIS** → Download; in Zotero, File → Import | One item per contents item; titles, issue, pages and authors right; the "Speculative fields" note present where expected |
| G2 | Compiler → **BibTeX** → Download; open in JabRef (or import into Zotero) | Parses without errors; accented names intact |
| G3 | Compiler → **WordPress** → Copy; in a WordPress draft, open the Code editor, paste, switch to the Visual editor | No "This block contains unexpected or invalid content" warnings; the catalog looks right |
| G4 | Compiler → **Proofing catalog** → Open → print to PDF | Each issue starts on a new page |

## H. Search with a keyboard and a screen reader (about 10 minutes)

Use the keyboard only. Turn on a screen reader: **VoiceOver** on a Mac (⌘+F5) or **NVDA** on Windows. Start with the library open and "All changes saved".

| # | Do | Expect |
|---|---|---|
| H1 | Click an empty part of the page, then press `/` | The focus is in the top bar's search box. The screen reader says "Search the catalog", a search field, and the hint naming the library |
| H2 | Type `public`, press Enter | The results page. The screen reader announces the summary once ("… for "public""). The scope line names the library (Example Library, `EXAMPLE-LIBRARY`) and says what is not searched |
| H3 | Move by headings (NVDA: H; VoiceOver: VO+⌘+H) | "Search" (level 1), then Titles, Issues, Contents, Names (level 2), each with its count. Each group is a list with its number of items |
| H4 | Tab from the search field | The kind buttons (All, Titles, Issues, Contents, Names), read as toggle buttons with "pressed" on the one in use; then Best match / Catalog order; then the results. Each result is one link, named by its first line. The focus is always visible |
| H5 | Press **Contents**, then **Catalog order** | Each time, the summary is announced again, once ("… Showing contents only."). The address bar holds `kind=item&order=catalog` |
| H6 | Tab to the first contents result, press Enter | The issue's contents grid opens. The item's row is in view and marked with a bar and a ribbon (visible without colour). The focus is on its Item Title cell, and the screen reader reads it |
| H7 | Press Tab, then Escape | Still "All changes saved": arriving and moving on changed nothing, and Undo offers nothing new |
| H8 | Go back (Alt+← on Windows, ⌘+[ on a Mac) | The results come back with the same kind and order, and the focus on the result you opened; the screen reader reads it |
| H9 | Search `the`; in the Contents group, press **Show 200 more** | The focus moves to the first newly shown result; "… of … shown" changes |
| H10 | Search `zzzz gazette` | "Nothing matches "zzzz gazette"". Each part is a button ("Search without zzzz"); pressing it searches again without that part |
| H11 | Open a contents result; press End, type a new word at the end of its Item Title, press Tab ("1 file changed"). Go back. With the focus on the result, press Ctrl/⌘+Z | Back on the results, the row shows the new word. After the undo, it shows the old title within a moment, and the screen reader **says nothing** about it; "All changes saved" again |
| H12 | Zoom the browser to 200%, then make the window as narrow as it goes (about 320 px) | The results page reads without scrolling sideways |
| H13 | Search `canary` | Nothing found. (Search never reads issue packages; nothing here should ever be found by a word that occurs only in one.) |

## I. The rest of the app with a keyboard and a screen reader (about 10 minutes)

The keyboard only, with the screen reader on, as in H. The automated suite checks the same with axe-core and Chromium's keyboard, but not what a screen reader says.

| # | Do | Expect |
|---|---|---|
| I1 | On the Library page, Tab to **The Example Gazette** and press Enter | The title opens. The screen reader reads a level-1 heading "Title: The Example Gazette" |
| I2 | Tab on until you reach the strip | One stop: "The run, group", then the first issue's square, read with its date and contents count. The arrow keys move square by square (up and down: volume by volume); one more Tab goes on to the title's fields |
| I3 | Issues → open an issue; Shift+Tab back to the list of the run | One stop, at the issue you are on; up and down move along the run; Enter opens one |
| I4 | Contents → an issue → type in the last row, press Enter, then ↑, then Alt+Shift+Delete | The item is added, then deleted; Ctrl/⌘+Z brings it back. The focus stays in the grid throughout |
| I5 | Library → Names → Tab into the list, press ↓ and Enter, then Tab | The name opens; the next Tab reaches the heading to make, not the next name |
| I6 | Zoom the browser to 400% (a window about 320 px wide) and open an issue | The bars at the top and the buttons at the foot scroll with the page; the issue's fields can be read and reached |
| I7 | Zoom back to 100%. In an issue, click into *Pages* and press Alt+Page Down | The next issue opens with the focus in its *Pages*; the screen reader reads it |

## Result

| Browser / OS | A | B | C | D | E | F | G | H | I | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
