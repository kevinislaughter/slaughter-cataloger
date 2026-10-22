#!/bin/sh
# Slaughter Cataloger 3.0 — every automated check in this package, in one command.
#
#   sh run-tests.sh                 everything (the release check)
#   sh run-tests.sh --no-browser    skip the browser checks (exit status 3: not a release check)
#   sh run-tests.sh --offline       skip the third-party format parsers and the accessibility scan,
#                                   which need npm (exit 3 as well)
#   sh run-tests.sh --quick         Node unit and data-safety suites only (exit 3)
#
# Needs Node 18+ and Python 3. The browser checks need Playwright with Chromium
# (npm i -g playwright && npx playwright install chromium); a global install is found
# automatically. The format checks install six parser packages into a temporary folder, and the
# browser walkthrough and the accessibility suite install axe-core there for their accessibility scans.
# Nothing under sample-data/ is modified.
#
# Exit status: 0 = every check ran and passed; 1 = a check failed; 3 = all checks that ran
# passed, but some were skipped (see the summary) — not a release check.
#
# Before publishing, also set SC_PRIVATE_TERMS to a list of terms that must not appear anywhere in
# the package (kept outside the repository; see tools/scan-terms.js). The scan then runs as one
# more check. Without it the scan is left out (it needs that private list) and this is said.
# So there are two full runs, both "nothing skipped", exit status 0:
#   on GitHub Actions (no list there):        30 checks, ending with a note that the term scan did not run
#   locally, before publishing (list set):    31 checks: the same 30 plus the term scan
# Only the 31-check run clears a release.
#
# Search performance (tools/test-search.js and the walkthrough; docs/SEARCH.md §10). As accepted at the
# Phase 2 closeout (2026-10-15), first-use indexing and every search interaction must complete within
# 2,000 ms on the generated 10,000-item library: a time over that limit fails its step, as a severe
# regression. Since A4 the same limit holds for the rest of the app at that scale (tools/test-performance.js:
# opening, every stage, a change while each is shown, the Compiler, saving, the working copy, a reload). The Phase 2 budgets (a 300 ms first build on a mid-range laptop, 50 ms queries, …) are
# diagnostic targets: measured on every run and reported as met or NOT MET, but never a failure. The
# summary at the end lists every figure; on GitHub Actions it also goes into the job summary.
# (SC_BUDGET_MODE, the earlier shared-runner mode, is retired and has no effect.)
#
# SC_PRIVATE_FIXTURE, if set, names a real staging package from the ingestion process (a .zip or a
# folder, kept outside the repository). One more check then converts it into a temporary folder and
# proves the conversion lossless (tools/test-issuepkg.js --private); it prints counts, never text.
# It is a private acceptance run for changes to the issue-package code, not part of the release check.

cd "$(dirname "$0")" || exit 2
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t sc3review)
trap 'rm -rf "$TMP"' EXIT
# The search suites append their performance figures here; the summary prints them.
SC_PERF_SUMMARY="$TMP/performance.txt"; export SC_PERF_SUMMARY
FAILED=""; SKIPPED=""; PASSED=0
BROWSER=1; FORMATS=1; QUICK=0
for a in "$@"; do
  case "$a" in
    --no-browser) BROWSER=0 ;;
    --offline) FORMATS=0 ;;
    --quick) QUICK=1; BROWSER=0; FORMATS=0 ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done

step() {
  name=$1; shift
  printf '\n━━ %s\n' "$name"
  if "$@"; then PASSED=$((PASSED + 1)); else FAILED="$FAILED\n  - $name"; fi
}
skip() { printf '\n━━ %s — SKIPPED (%s)\n' "$1" "$2"; SKIPPED="$SKIPPED\n  - $1 ($2)"; }

D=sample-data/3.0/example-library
B2=sample-data/beta2/example-library
step "numbering & table-of-contents unit tests"          node tools/test-numbering.js
step "store: undo, revisions, changed files (B-01)"       node tools/test-store.js
step "contents hierarchy: parts separated from their parent; Delete, Move, Nest, Un-nest, Insert; outputs (D-12, A3)" node tools/test-hierarchy.js $D
step "names & headings unit tests"                        node tools/test-names.js
step "outputs unit tests + every output on the sample"    node tools/test-outputs.js $D
step "data safety (B-03 B-04 M-02 M-03 M-05)"             node tools/test-safety.js $D
step "backups: never written over, byte for byte (review 2, F2-01)" node tools/test-backups.js
step "empty files: a header-only file read as empty only when asked and it is exactly 3.0's; change-titleid.js carries valid ones, the converter unchanged (DF-19, DF-21)" node tools/test-empty-files.js
step "library-rewriting tools: a new output folder only, verified before it is put in place; strict UTF-8; the input never written (A3)" node tools/test-rewriting-tools.js
step "tool paths: Beta 2 authority lists, records only in older copies set aside to _left-out/, the term scan's terms and refusal, the package validator's JSON (A2)" node tools/test-tool-paths.js
step "issue packages: strict ZIP reader, validator, every rejection, lossless conversion (twin)" node tools/test-issuepkg.js
step "search: normalization, query language, ranking, incremental index, read-only, performance" node tools/test-search.js

if [ $QUICK = 0 ]; then
  step "Beta 2 → 3.0 round trip (sample library)"         node tools/test-roundtrip.js $B2
  step "converter on the Beta 2 sample"                    node tools/convert-to-3.js sample-data/beta2 --out "$TMP/converted"
  sample_matches() {
    node tools/make-sample.js --out "$TMP/sample" --check || return 1
    if diff -r "$TMP/sample/3.0/example-library" $D >/dev/null && diff -r "$TMP/sample/beta2/example-library" $B2 >/dev/null; then
      echo "sample-data/ is exactly what tools/make-sample.js writes"
    else echo "sample-data/ differs from what tools/make-sample.js writes (regenerate: node tools/make-sample.js)"; return 1; fi
  }
  step "sample library: generated, and its Beta 2 copy converts to its 3.0 copy" sample_matches
  twin_matches() {
    node tools/make-issue-fixture.js --out "$TMP/twin" >/dev/null || return 1
    if diff -r "$TMP/twin/staging" sample-data/issue-package/staging >/dev/null && diff -r "$TMP/twin/native" sample-data/issue-package/native >/dev/null \
       && diff -r "$TMP/twin/booklet" sample-data/issue-package/booklet >/dev/null; then
      echo "sample-data/issue-package/ is exactly what tools/make-issue-fixture.js writes (staging twin, its conversion, and the booklet)"
    else echo "sample-data/issue-package/ differs from what tools/make-issue-fixture.js writes (regenerate: node tools/make-issue-fixture.js)"; return 1; fi
  }
  step "issue-package fixtures: generated; the twin converts to the committed native package" twin_matches
  build_matches() {
    python3 tools/build.py "$TMP/built.html" >/dev/null || return 1
    if cmp -s "$TMP/built.html" dist/slaughter-cataloger-3.html; then echo "dist/slaughter-cataloger-3.html matches the source"
    else echo "dist/slaughter-cataloger-3.html is OUT OF DATE with the source (rebuild: python3 tools/build.py)"; return 1; fi
  }
  step "single-file build matches the shipped dist"        build_matches
else
  skip "round trip, converter, sample and twin checks, build check" "--quick"
fi

if [ $FORMATS = 1 ]; then
  formats() {
    echo "installing parsers into a temporary folder…"
    ( cd "$TMP" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --silent \
        @retorquere/bibtex-parser tslib @citation-js/core @citation-js/plugin-ris @citation-js/plugin-bibtex @wordpress/block-serialization-default-parser ) \
      || { echo "npm install failed (offline? use --offline to skip)"; return 1; }
    node tools/test-formats.js "$TMP"
  }
  step "outputs read by third-party parsers (BibTeX, RIS, WordPress, HTML)" formats
else
  skip "outputs read by third-party parsers" "--offline or --quick"
  [ $BROWSER = 1 ] && SKIPPED="$SKIPPED\n  - the axe-core scans in the browser walkthrough and the accessibility suite (--offline)"
fi

# axe-core, for the walkthrough's and the accessibility suite's scans: installed once into the temporary folder.
AXE="$TMP/axe/node_modules/axe-core/axe.min.js"
need_axe() {
  [ -f "$AXE" ] && return 0
  echo "installing axe-core into a temporary folder…"
  mkdir -p "$TMP/axe" && ( cd "$TMP/axe" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --silent axe-core@4.10.2 ) \
    || { echo "npm install failed (offline? use --offline to skip)"; return 1; }
}

if [ $BROWSER = 1 ]; then
  if node -e "try{require.resolve('playwright')}catch(e){require.resolve(require('child_process').execSync('npm root -g').toString().trim()+'/playwright')}" >/dev/null 2>&1; then
    walkthrough() {
      if [ $FORMATS = 1 ]; then
        need_axe || return 1
        SC_AXE="$AXE" node tools/test-walkthrough.js dist/slaughter-cataloger-3.html $D $B2/SCAT_EXAMPLE-LIBRARY_TITLES.csv
      else
        node tools/test-walkthrough.js dist/slaughter-cataloger-3.html $D $B2/SCAT_EXAMPLE-LIBRARY_TITLES.csv
      fi
    }
    step "browser walkthrough, search and accessibility (Chromium)" walkthrough
    step "browser: saving, restoring, reconnecting, tabs, crash, real folder API (B-01 B-02 B-05 B-06 B-07 M-01 M-04)" \
      node tools/test-session.js dist/slaughter-cataloger-3.html $D
    step "browser: the Contents grid on parts separated from their parent, with undo, save and reload (D-12, A3)" \
      node tools/test-hierarchy-grid.js dist/slaughter-cataloger-3.html
    step "browser: Delete title, Delete issue, Delete heading, a new issue in the middle of a run and in a run in two Issues files; undo, save, read-back (A2, DF-19, DF-20)" \
      node tools/test-destructive.js dist/slaughter-cataloger-3.html
    step "browser: titles whose issues are in more than one Issues file named on the Library page, nothing changed (DF-22)" \
      node tools/test-split-files.js dist/slaughter-cataloger-3.html
    step "browser: keyboard Undo and Redo, unsaved work when leaving, closing or opening another folder (A2, D-K1, D-K2)" \
      node tools/test-undo-unsaved.js dist/slaughter-cataloger-3.html
    step "browser: a new issue entered and not recorded is asked about before it is lost (K-D1)" \
      node tools/test-drafts.js dist/slaughter-cataloger-3.html
    step "browser: reading, writing and library paths: copies, extra columns, a file that stops reading cleanly, permission refused, downloads, blocked and orphaned contents, kept parent links, new library, renaming, locked IDs, duplicates, Roman short names, rows set aside (A2)" \
      node tools/test-data-paths.js dist/slaughter-cataloger-3.html
    step "browser: everyday features: moving around, new-issue drafts, numbering controls, months and seasons, a title missing from the Titles file, Contents cells, a new library, dropped files, adding a title, Names, the Compiler, saving while the folder is read, Entry Order (A2)" \
      node tools/test-everyday.js dist/slaughter-cataloger-3.html
    step "browser: the smaller parts: the Compiler's address, what renaming the library marks, Alt+Page Down keeping the place, the load report, filters, Find a title, sorting, the unaddressed count, the run list, Shift+Enter, credits, messages, the window title (A2 minor)" \
      node tools/test-minor-ui.js dist/slaughter-cataloger-3.html
    step "browser: the app at scale: opening, every stage, changes, the Compiler, saving, the working copy and a reload on two generated 10,000-item libraries, within 2,000 ms each; names.index linear (A4, DF-14)" \
      node tools/test-performance.js dist/slaughter-cataloger-3.html
    accessibility() {
      if [ $FORMATS = 1 ]; then
        need_axe || return 1
        SC_AXE="$AXE" node tools/test-accessibility.js dist/slaughter-cataloger-3.html
      else
        node tools/test-accessibility.js dist/slaughter-cataloger-3.html
      fi
    }
    step "browser: accessibility: axe-core on every stage, text in fields, headings and names, reflow at 320 and 640 px, focus marked and never hidden, the keyboard in Library, Issues, Contents and Names (A6)" accessibility
  else
    printf '\n━━ browser checks — Playwright not found\n'
    echo "Install it (npm i -g playwright && npx playwright install chromium), or run with --no-browser."
    FAILED="$FAILED\n  - browser checks (Playwright not found)"
  fi
else
  skip "browser walkthrough, session, Contents-grid, destructive-action, split-file, undo, draft, data-path, everyday, minor-UI, performance and accessibility checks" "--no-browser or --quick"
fi

if [ -n "$SC_PRIVATE_TERMS" ]; then
  step "release check: no listed term anywhere in the package (SC_PRIVATE_TERMS)" node tools/scan-terms.js "$SC_PRIVATE_TERMS"
else
  printf '\n━━ term scan not run (set SC_PRIVATE_TERMS to a term list to run it before publishing)\n'
fi
if [ -n "$SC_PRIVATE_FIXTURE" ]; then
  step "private acceptance: a real staging package converts without loss (SC_PRIVATE_FIXTURE)" node tools/test-issuepkg.js --private "$SC_PRIVATE_FIXTURE"
fi

printf '\n════════════════════════════════════════\n'
NOTMET=0
if [ -s "$SC_PERF_SUMMARY" ]; then
  NOTMET=$(grep -c 'NOT MET' "$SC_PERF_SUMMARY")
  echo "PERFORMANCE on this machine (search, and the app at scale). A time over the 2,000 ms limit fails its step;"
  echo "search's Phase 2 targets are diagnostic: reported here, never a failure."
  echo
  cat "$SC_PERF_SUMMARY"
  if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    { echo "### Performance on this runner"; echo; echo "A time over the 2,000 ms limit fails the run; search's Phase 2 targets are diagnostic only."; echo; echo '```'; cat "$SC_PERF_SUMMARY"; echo '```'; } >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
  fi
  echo '────────────────────────────────────────'
fi
[ -n "$SC_BUDGET_MODE" ] && echo "SC_BUDGET_MODE is retired and had no effect."
PERF_NOTE=""
[ "$NOTMET" -gt 0 ] && PERF_NOTE="Performance: $NOTMET Phase 2 target(s) NOT MET on this machine (listed above). Diagnostic, not a failure."
if [ -n "$FAILED" ]; then
  printf "%s passed; FAILED:%b\n" "$PASSED" "$FAILED"
  [ -n "$SKIPPED" ] && printf "Skipped:%b\n" "$SKIPPED"
  exit 1
fi
if [ -n "$SKIPPED" ]; then
  printf "All %s checks that ran passed, but these were skipped:%b\nNOT A RELEASE CHECK.\n" "$PASSED" "$SKIPPED"
  [ -n "$PERF_NOTE" ] && echo "$PERF_NOTE"
  exit 3
fi
FIXTURE_NOTE=""
[ -n "$SC_PRIVATE_FIXTURE" ] && FIXTURE_NOTE=" (one of them the private acceptance run on SC_PRIVATE_FIXTURE)"
if [ -n "$SC_PRIVATE_TERMS" ]; then
  echo "All $PASSED checks passed$FIXTURE_NOTE, the term scan included. Nothing skipped. This is the release check."
else
  echo "All $PASSED checks passed$FIXTURE_NOTE. Nothing skipped."
  echo "The term scan did not run (SC_PRIVATE_TERMS not set): $PASSED of $((PASSED + 1)) checks. Enough for CI; before publishing, run again with the list set."
fi
[ -n "$PERF_NOTE" ] && echo "$PERF_NOTE"
exit 0
