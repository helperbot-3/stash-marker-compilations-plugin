import json
import sys
import time
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from test_backend import b, document


class ExportTests(unittest.TestCase):
    def test_explicit_and_legacy_sequence(self):
        clip = dict(scene_id='1', start=0, end=10, hot_zones=[dict(id='a', start=2, end=3), dict(id='b', start=5, end=7)], phases=[dict(target='zone:a', repeat=3, speed=.5), dict(target='full', repeat=1, speed=1), dict(target='zone:b', repeat=1, speed=.5)])
        plan = b.export_plan(dict(clips=[clip]))
        self.assertEqual([(p['start'], p['end'], p['speed']) for p in plan], [(2,3,.5)]*3+[(0,10,1),(5,7,.5)])
        clip['phases'] = [dict(repeat=3, speed=1)]
        self.assertEqual([(p['start'],p['end']) for p in b.export_plan(dict(clips=[clip]))], [(0,10),(2,3),(5,7),(0,10)])
        legacy=dict(clip);legacy.pop('phases')
        self.assertEqual(len(b.export_plan(dict(clips=[legacy]))),1)
        clip['phases'] = [dict(target='zone:missing', repeat=1, speed=1)]
        with self.assertRaisesRegex(ValueError, 'missing hot zone'):
            b.export_plan(dict(clips=[clip]))

    def test_interrupted_import_and_cancelled_render(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            store=b.Store(root)
            class Stash:
                def query(self, query, variables=None):
                    return {'findJob': {'status':'CANCELLED', 'error':None}}
            for status, key, expected in [('rendering','job_id','cancelled'),('importing','import_job','import_error')]:
                b.export_put(store, dict(id=status, compilation_id='1', status=status, path=str(root/'missing.mp4'), **{key:'1'}))
            items=b.list_exports(store,Stash(),root,root/'plugin','1')
            self.assertEqual({i['id']:i['status'] for i in items}, {'rendering':'cancelled','importing':'import_error'})
            store.db.close()

    def test_existing_render_gets_distinct_tag_without_losing_tags(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory))
            record=b.export_put(store,dict(id='render',scene_id='42'))
            calls=[]
            class Stash:
                def query(self, query, variables=None):
                    calls.append((query,variables))
                    if 'findScene' in query: return {'findScene':{'id':'42','tags':[{'id':'old-compilation'},{'id':'user-tag'}]}}
                    if 'findTags' in query:
                        self_name=variables['name']
                        assert self_name == 'Marker Compilations · Rendered'
                        return {'findTags':{'tags':[]}}
                    if 'tagCreate' in query: return {'tagCreate':{'id':'rendered-tag'}}
                    if 'sceneUpdate' in query:
                        assert variables['input']=={'id':'42','tag_ids':['old-compilation','rendered-tag','user-tag']}
                        return {'sceneUpdate':{'id':'42'}}
                    raise AssertionError(query)
            migrated=b.migrate_rendered_tag(store,Stash(),record)
            self.assertTrue(migrated['rendered_tag'])
            count=len(calls)
            b.migrate_rendered_tag(store,Stash(),migrated)
            self.assertEqual(len(calls),count)
            store.db.close()

    def test_cancelled_export_cleans_worker_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            work=root/'work'; work.mkdir()
            (work/'partial.mp4').write_bytes(b'incomplete')
            pidfile=root/'encoder.pid'
            encoder="import os,time;from pathlib import Path;Path({!r}).write_text(str(os.getpid()));time.sleep(60)".format(str(pidfile))
            args=[sys.executable, str(Path(b.__file__).resolve()), '--export-worker']
            launcher="import os,subprocess,time;subprocess.Popen({!r}+[str(os.getpid()),{!r},{!r},'-c',{!r}]);time.sleep(60)".format(args,str(work),sys.executable,encoder)
            parent=subprocess.Popen([sys.executable,'-c',launcher],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                deadline=time.monotonic()+5
                while not pidfile.exists() and time.monotonic()<deadline: time.sleep(.05)
                self.assertTrue(pidfile.exists())
                parent.kill(); parent.wait(timeout=5)
                deadline=time.monotonic()+5
                while work.exists() and time.monotonic()<deadline: time.sleep(.05)
                self.assertFalse(work.exists())
            finally:
                if parent.poll() is None: parent.kill(); parent.wait()

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_render_snapshot_mixed_sources_and_persistent_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, size, audio in [('red','160x90',True), ('blue','90x160',False)]:
                cmd = ['ffmpeg','-v','error','-f','lavfi','-i',f'color=c={name}:s={size}:r=24:d=2']
                if audio:
                    cmd += ['-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','aac']
                subprocess.run(cmd+['-c:v','libx264','-pix_fmt','yuv420p',str(root/(name+'.mp4'))],check=True)
            class Stash:
                def query(self, query, variables=None):
                    return {'configuration': {'general': {'ffmpegPath':'ffmpeg','ffprobePath':'ffprobe','stashes':[]}}}
                def scene(self, id_):
                    return {'files':[{'id':id_, 'path':str(root/({'1':'red','2':'blue'}[id_]+'.mp4')), 'duration':2}], 'tags':[], 'performers':[]}
            store=b.Store(root/'state')
            saved=store.save(document(clips=[dict(scene_id='1',start=0,end=.5,phases=[dict(target='full',repeat=2,speed=.5)]),dict(scene_id='2',start=0,end=.5)]))
            record=b.prepare_export(store,Stash(),root/'state',dict(id=saved['id'],quality='720p',library=False))
            store.save(dict(saved,name='Edited after queuing'))
            b.render_export(store,Stash(),root/'state',root/'plugin',record['id'])
            ready=b.export_get(store,record['id'])
            self.assertEqual(ready['name'],'Topics')
            self.assertEqual(ready['status'],'ready')
            self.assertAlmostEqual(ready['duration'],2.5,delta=.15)
            info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',ready['path']]))
            video=next(s for s in info['streams'] if s['codec_type']=='video')
            self.assertEqual((video['width'],video['height']),(1280,720))
            self.assertTrue(any(s['codec_type']=='audio' for s in info['streams']))
            for timestamp, channel in [(0.25,0),(1.25,0),(2.25,2)]:
                pixel=subprocess.check_output(['ffmpeg','-v','error','-ss',str(timestamp),'-i',ready['path'],'-frames:v','1','-vf','crop=2:2:640:360','-f','rawvideo','-pix_fmt','rgb24','-'])
                self.assertGreater(pixel[channel],150)
                self.assertLess(pixel[(channel+1)%3],50)
            shutil.rmtree(root/'plugin')
            self.assertTrue(b.export_link(ready,root/'plugin'))
            self.assertTrue(Path(ready['path']).is_file())
            self.assertFalse((root/'state'/'render-work'/record['id']).exists())
            store.db.close()
