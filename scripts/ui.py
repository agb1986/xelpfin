#!/usr/bin/env python3
"""Reads a uiautomator XML dump on stdin and answers simple questions about it.

  ui.py focused          resource-id of the focused node
  ui.py has ID           exit 0 if a node with that resource-id exists
  ui.py center ID        "x y" centre of that node
  ui.py text ID          concatenated text of the node and its descendants
  ui.py ids              all resource-ids with focus marker
  ui.py focustext        text of the focused node and its descendants
"""
import sys
import xml.etree.ElementTree as ET

def main() -> int:
    data = sys.stdin.read()
    start = data.find('<?xml')
    if start < 0:
        start = data.find('<hierarchy')
    root = ET.fromstring(data[start:] if start >= 0 else data)
    nodes = list(root.iter('node'))
    cmd = sys.argv[1]
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    find = lambda rid: next((n for n in nodes if n.get('resource-id') == rid), None)
    if cmd == 'focused':
        n = next((n for n in nodes if n.get('focused') == 'true'), None)
        print(n.get('resource-id') if n is not None else '')
        return 0
    if cmd == 'has':
        return 0 if find(arg) is not None else 1
    if cmd == 'center':
        n = find(arg)
        if n is None:
            return 1
        b = n.get('bounds').replace('][', ',').strip('[]').split(',')
        x1, y1, x2, y2 = map(int, b)
        print((x1 + x2) // 2, (y1 + y2) // 2)
        return 0
    if cmd == 'text':
        n = find(arg)
        if n is None:
            return 1
        print(' '.join(t for t in (m.get('text') or m.get('content-desc') for m in n.iter('node')) if t))
        return 0
    if cmd == 'focustext':
        n = next((n for n in nodes if n.get('focused') == 'true'), None)
        if n is None:
            return 1
        print(' '.join(t for t in (m.get('text') or m.get('content-desc') for m in n.iter('node')) if t))
        return 0
    if cmd == 'ids':
        for n in nodes:
            rid = n.get('resource-id')
            if rid and ':' not in rid:
                print(('* ' if n.get('focused') == 'true' else '  ') + rid)
        return 0
    return 2

sys.exit(main())
