import importlib.util
import json
from pathlib import Path
import shutil
import os
import sys
import time
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backend', Path(__file__).parents[1] / 'plugins/marker-compilations/backend.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def document(**kwargs):
    return dict({'name': 'Topics', 'clips': [{'scene_id': '1', 'marker_id': '2', 'title': 'Example', 'start': 1.25, 'end': 26.75}], 'width': 640, 'audio': True}, **kwargs)


class BackendTests(unittest.TestCase):
    def test_persistence_conflict_and_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            store = b.Store(Path(directory))
            saved = store.save(document())
            other = b.Store(Path(directory))
            self.assertEqual(saved, other.get(saved['id']))
            edited = store.save(dict(saved, name='Updated'))
            with self.assertRaisesRegex(ValueError, 'another window'):
                other.save(dict(saved, name='Stale'))
            with self.assertRaises(ValueError):
                other.delete(saved['id'], saved['revision'])
            store.delete(edited['id'], edited['revision'])
            self.assertEqual([], other.list())
            store.db.close()
            other.db.close()

    def test_invalid_intervals_and_settings(self):
        for start, end in [(-1, 2), (2, 2), (3, 2), (float('nan'), 4), (0, float('inf')), ('', 3), (False, 2)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                b.validate(document(clips=[{'scene_id': '1', 'start': start, 'end': end}]))
        with self.assertRaises(ValueError):
            b.validate(document(width=999))
        with self.assertRaises(ValueError):
            b.validate(document(name=' '))

    def test_patterns_are_saved_validated_and_do_not_duplicate_cache(self):
        clip = document()['clips'][0]
        clip['phases'] = [{'repeat': 3, 'speed': 1}, {'repeat': 2, 'speed': .5}, {'repeat': 3, 'speed': 1}]
        self.assertEqual(clip['phases'], b.validate(document(clips=[clip]))['clips'][0]['phases'])
        for phase in [{'repeat': 0, 'speed': 1}, {'repeat': 1.5, 'speed': 1}, {'repeat': 2, 'speed': 0}, {'repeat': 2, 'speed': 9}]:
            with self.subTest(phase=phase), self.assertRaises(ValueError):
                b.validate(document(clips=[dict(clip, phases=[phase])]))
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'media.mp4'
            file.write_bytes(b'test identity')
            source = {'id': '1', 'path': str(file)}
            self.assertEqual(b.cache_key(clip, source, document()), b.cache_key(dict(clip, phases=[{'repeat': 1, 'speed': 1}]), source, document()))

    def test_cancelled_parent_stops_encoder_and_removes_partial_clip(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory)/'partial.mp4'
            partial.write_bytes(b'incomplete')
            pidfile = Path(directory)/'encoder.pid'
            encoder = "import os,time;from pathlib import Path;Path({!r}).write_text(str(os.getpid()));time.sleep(60)".format(str(pidfile))
            arguments = [sys.executable, str(Path(b.__file__).resolve()), '--ffmpeg-worker']
            launcher = "import os,subprocess,time;subprocess.Popen({!r}+[str(os.getpid()),{!r},{!r},'-c',{!r}]);time.sleep(60)".format(arguments, str(partial), sys.executable, encoder)
            parent = subprocess.Popen([sys.executable, '-c', launcher], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic()+5
                while not pidfile.exists() and time.monotonic()<deadline:
                    time.sleep(.05)
                self.assertTrue(pidfile.exists(), 'encoder started')
                parent.kill()
                parent.wait(timeout=5)
                deadline = time.monotonic()+5
                while partial.exists() and time.monotonic()<deadline:
                    time.sleep(.05)
                self.assertFalse(partial.exists(), 'supervisor cleaned interrupted clip')
            finally:
                if parent.poll() is None:
                    parent.kill()
                    parent.wait()

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_full_interval_audio_cache_reuse_and_invalidation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=24:d=28',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=28', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', str(source)], check=True)
            file = {'id':'1', 'path':str(source), 'duration':28}
            doc = document()
            clip = doc['clips'][0]
            cache = root/'cache'
            key = b.render(clip, file, doc, cache, 'ffmpeg')
            output = cache/(key+'.mp4')
            data = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(output)]))
            self.assertAlmostEqual(25.5, float(data['format']['duration']), delta=.1)
            self.assertTrue(any(s['codec_type']=='audio' for s in data['streams']))
            before = output.stat().st_mtime_ns
            self.assertEqual(key, b.render(clip,file,doc,cache,'ffmpeg'))
            self.assertEqual(before, output.stat().st_mtime_ns)
            self.assertNotEqual(key, b.cache_key(dict(clip,end=27),file,doc))
            self.assertNotEqual(key, b.cache_key(clip,file,dict(doc,audio=False)))
            muted = b.render(dict(clip,end=2),file,dict(doc,audio=False),cache,'ffmpeg')
            streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(cache/(muted+'.mp4'))]))['streams']
            self.assertFalse(any(s['codec_type']=='audio' for s in streams))
            with self.assertRaises(OSError):
                b.render(clip,dict(file,path=str(root/'missing.mp4')),doc,cache,'ffmpeg')


if __name__ == '__main__':
    unittest.main()
