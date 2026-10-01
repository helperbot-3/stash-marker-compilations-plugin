import copy
import tempfile
from pathlib import Path
import unittest
from test_backend import b, document


class FakeStash:
    def __init__(self):
        self.markers=[]
    def scene(self,id_):
        return {'files':[{'duration':60}]}
    def query(self,query,variables=None):
        if 'findScene' in query:
            return {'findScene':{'scene_markers':copy.deepcopy(self.markers)}}
        if 'sceneMarkerDestroy' in query:
            self.markers=[m for m in self.markers if m['id']!=variables['id']]
            return {'sceneMarkerDestroy':True}
        if 'sceneMarkerCreate' in query or 'sceneMarkerUpdate' in query:
            fields=variables['input'];id_=fields.get('id',str(len(self.markers)+1))
            marker={'id':id_,'title':fields['title'],'seconds':fields['seconds'],'end_seconds':fields['end_seconds'],'primary_tag':{'id':fields['primary_tag_id'],'name':'Topic'},'tags':[{'id':id_,'name':'Tag'} for id_ in fields['tag_ids']]}
            self.markers=[m for m in self.markers if m['id']!=id_]+[marker]
            return {'sceneMarkerUpdate' if 'sceneMarkerUpdate' in query else 'sceneMarkerCreate':copy.deepcopy(marker)}
        raise AssertionError(query)


class MarkerTests(unittest.TestCase):
    def test_create_update_copy_hot_zones_and_snapshot_independence(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash()
            project=store.save(document())
            clip={'scene_id':'1','start':2,'end':8,'hot_zones':[{'id':'focus','name':'Focus','start':3,'end':4}]}
            args={'clip':clip,'mode':'new','title':'Topic','primary_tag_id':'1','tag_ids':['2'],'project_id':project['id']}
            created=b.save_marker(store,stash,args)
            self.assertTrue(created['added_to_project'])
            self.assertEqual(len(store.get(project['id'])['media']),2)
            context=b.marker_context(store,stash,'1',created['marker']['id'])
            self.assertEqual(context['hot_zones'],clip['hot_zones'])
            original_project=store.get(project['id'])
            updated_clip=dict(clip,marker_id=created['marker']['id'],end=10)
            updated=b.save_marker(store,stash,dict(args,mode='update',clip=updated_clip,expected=context['marker']))
            self.assertEqual(updated['marker']['end_seconds'],10)
            self.assertEqual(store.get(project['id']),original_project,'saved project snapshots never change')
            with self.assertRaisesRegex(ValueError,'changed'):
                b.save_marker(store,stash,dict(args,mode='update',clip=updated_clip,expected=context['marker']))
            copied=b.save_marker(store,stash,dict(args,clip=updated_clip,mode='new'))
            self.assertNotEqual(copied['marker']['id'],updated['marker']['id'])
            self.assertEqual(len(stash.markers),2)
            stash.markers[0]['seconds']=1
            self.assertEqual(b.marker_context(store,stash,'1',updated['marker']['id'])['hot_zones'],[],'ignore zones after external range edits')
            store.db.close()

    def test_undo_new_marker_keeps_timeline_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash();project=store.save(document())
            args={'clip':{'scene_id':'1','start':1,'end':5},'mode':'new','title':'Topic','primary_tag_id':'1','project_id':project['id']}
            created=b.save_marker(store,stash,args)
            marker=created['marker']
            result=b.undo_marker(store,stash,{'scene_id':'1','marker_id':marker['id'],'expected':marker,'project_id':project['id']})
            self.assertIsNone(result['warning']);self.assertEqual(stash.markers,[])
            self.assertEqual(len(store.get(project['id'])['clips']),1)
            self.assertEqual(len(store.get(project['id'])['media']),1)
            store.db.close()

    def test_invalid_marker_cannot_write_and_project_failure_does_not_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash()
            args={'clip':{'scene_id':'1','start':1,'end':5},'mode':'new','title':'Topic','primary_tag_id':'1'}
            with self.assertRaisesRegex(ValueError,'primary tag'):
                b.save_marker(store,stash,dict(args,primary_tag_id=''))
            self.assertEqual(stash.markers,[])
            result=b.save_marker(store,stash,dict(args,project_id='missing'))
            self.assertIn('warning',result)
            self.assertEqual(len(stash.markers),1)
            store.db.close()
