#!/usr/bin/env python3
"""Build a Stash source index without packaging generated clips or local data."""
import hashlib
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else '_site/main')
out.mkdir(parents=True, exist_ok=True)
package = root / 'plugins/marker-compilations'
archive = out / 'marker-compilations.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
    for relative in ['marker-compilations.yml', 'backend.py', 'ui/patterns.js', 'ui/compilations.js', 'ui/compilations.css']:
        zipped.write(package / relative, relative)
    for relative in ['README.md', 'LICENCE']:
        zipped.write(root / relative, relative)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / 'index.yml').write_text('''- id: marker-compilations
  name: Marker Compilations
  metadata:
    description: Saved marker compilations with source playback and full-duration clip caching.
  version: 0.1.0-{}
  path: marker-compilations.zip
  sha256: {}
'''.format(digest[:12], digest))
print(archive.resolve())
