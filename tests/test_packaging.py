"""Guard metadata used by Stash's date-based update detection."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile


class PackagingTests(unittest.TestCase):
    def test_source_has_update_date_and_matching_archive(self):
        root = Path(__file__).resolve().parents[1]
        before = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run([sys.executable, str(root / 'build_site.py'), temporary], check=True, capture_output=True)
            output = Path(temporary)
            index = (output / 'index.yml').read_text()
            date = re.search(r'^  date: "([^"]+)"$', index, re.M)
            self.assertIsNotNone(date, 'Stash cannot detect updates without a package date')
            released = datetime.strptime(date[1], '%Y-%m-%d %H:%M:%S')
            self.assertGreaterEqual(released, before)
            self.assertLessEqual(released, datetime.now(timezone.utc).replace(tzinfo=None))
            archive = output / 'marker-compilations.zip'
            self.assertIn('sha256: ' + hashlib.sha256(archive.read_bytes()).hexdigest(), index)
            with zipfile.ZipFile(archive) as zipped:
                self.assertEqual(len(zipped.namelist()), 8)
                self.assertIn('screening.py', zipped.namelist())
                zipped.extractall(output / 'installed')
                subprocess.run([sys.executable, '-c', 'import backend, screening'], cwd=output / 'installed', check=True, capture_output=True)
                version = re.search(r'^version: (.+)$', zipped.read('marker-compilations.yml').decode(), re.M)[1]
                self.assertIn('version: ' + version + '-', index)
