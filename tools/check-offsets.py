#!/usr/bin/env python3
"""Slaughter Cataloger 3 — an independent check of an issue package's text offsets.

usage: python3 -I tools/check-offsets.py <native package folder>

Offsets in an issue package count Unicode code points. Python's str indexes are code points, so
this script reads text.json (and mentions.json and rights.json, if present) without any of the
package code and prints, as JSON, each page's length and SHA-256 and the SHA-256 of the text at
every segment, unassigned span, withheld span and mention anchor. tools/test-issuepkg.js compares
the result with what the JavaScript reader gets, so the two languages are shown to agree.
Writes nothing.
"""
import hashlib
import json
import os
import sys


def h(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    root = sys.argv[1]

    def load(name):
        p = os.path.join(root, name)
        if not os.path.exists(p):
            return None
        with open(p, encoding='utf-8') as f:
            return json.load(f)

    text = load('text.json')
    if text is None:
        print(json.dumps({'pages': [], 'spans': {}}))
        return 0
    pages = {p['page']: p['text'] for p in text['pages']}
    out = {'pages': [{'page': n, 'length': len(t), 'sha256': h(t)} for n, t in sorted(pages.items())], 'spans': {}}

    def put(key, page, start, end):
        out['spans'][key] = h(pages[page][start:end])

    for s in text.get('segments', []):
        put('segment:' + s['id'], s['page'], s['start'], s['end'])
    for s in text.get('unassigned', []):
        put('unassigned:' + s['id'], s['page'], s['start'], s['end'])
    rights = load('rights.json') or {}
    for s in rights.get('withheld', []):
        put('withheld:' + s['id'], s['page'], s['start'], s['end'])
    mentions = load('mentions.json') or {}
    for kind in ('entities', 'subjects'):
        for m in mentions.get(kind, []):
            for i, a in enumerate(m.get('anchors', [])):
                put('anchor:' + m['id'] + ':' + str(i), a['page'], a['start'], a['end'])
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
