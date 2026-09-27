#!/usr/bin/env python3
"""Build a Stash source index without packaging generated clips or local data."""
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else '_site/main')
out.mkdir(parents=True, exist_ok=True)
package = root / 'plugins/marker-compilations'
version = next(line.split(':', 1)[1].strip() for line in (package / 'marker-compilations.yml').read_text().splitlines() if line.startswith('version:'))
archive = out / 'marker-compilations.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
    for relative in ['marker-compilations.yml', 'backend.py', 'ui/patterns.js', 'ui/compilations.js', 'ui/compilations.css']:
        zipped.write(package / relative, relative)
    for relative in ['README.md', 'LICENCE']:
        zipped.write(root / relative, relative)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
# Stash compares package dates (not version strings) when checking for updates.
release_date = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
(out / 'index.yml').write_text('''- id: marker-compilations
  name: Marker Compilations
  metadata:
    description: Saved marker compilations with source playback and full-duration clip caching.
  version: {}-{}
  date: "{}"
  path: marker-compilations.zip
  sha256: {}
'''.format(version, digest[:12], release_date, digest))
print(archive.resolve())
