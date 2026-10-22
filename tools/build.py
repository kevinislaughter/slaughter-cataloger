#!/usr/bin/env python3
"""Inline css/ and js/ into one self-contained HTML file for release.
usage: python3 tools/build.py [output.html]
The source folder also runs as-is: open index.html from disk."""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dist' / 'slaughter-cataloger-3.html'
src = (ROOT / 'index.html').read_text(encoding='utf-8')

def inline_css(m):
    css = (ROOT / m.group(1)).read_text(encoding='utf-8')
    return '<style>\n' + css + '\n</style>'

# The vendored libraries' licenses travel with the single file (js/vendor/NOTICE.md has them in full).
VENDOR_NOTICE = {
    'js/vendor/preact.umd.js': 'Preact 10, https://preactjs.com, MIT License, Copyright (c) 2015-present Jason Miller',
    'js/vendor/preact-hooks.umd.js': 'Preact 10 hooks, https://preactjs.com, MIT License, Copyright (c) 2015-present Jason Miller',
    'js/vendor/htm.umd.js': 'htm 3, https://github.com/developit/htm, Copyright 2018 Google Inc., Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0)',
}

def inline_js(m):
    js = (ROOT / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
    note = VENDOR_NOTICE.get(m.group(1))
    return '<script>/* ' + m.group(1) + (' -- ' + note if note else '') + ' */\n' + js + '\n</script>'

html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, src)
html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
html = re.sub(r'<!-- /?build:scripts[^>]*-->\n?', '', html)
html = html.replace('<head>', '<head>\n<!-- Slaughter Cataloger 3.0, https://github.com/kevinislaughter/slaughter-cataloger. MIT License, Copyright (c) 2026 Kevin I. Slaughter.\n     Includes Preact (MIT) and htm (Apache 2.0); their notices are with their code below. -->', 1)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'wrote {out} ({len(html.encode("utf-8")):,} bytes)')
