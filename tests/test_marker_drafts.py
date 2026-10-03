import tempfile
from pathlib import Path
import unittest
from test_backend import b, document
from test_markers import FakeStash


class DraftTests(unittest.TestCase):
    def test_untagged_drafts_persist_and_refine_with_conflict_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);store=b.Store(root)
            first=b.save_marker_draft(store,{'id':'first','clip':{'scene_id':'1','start':1,'end':5}})
            second=b.save_marker_draft(store,{'id':'second','clip':{'scene_id':'1','start':8,'end':12}})
            b.save_marker_draft(store,{'id':'other','clip':{'scene_id':'2','start':1,'end':3}})
            store.db.close();store=b.Store(root)
            self.assertEqual([d['id'] for d in b.list_marker_drafts(store,'1')],['first','second'])
            self.assertEqual(first['primary'],'')
            refined=b.save_marker_draft(store,dict(first,primary='1',title='Focus',clip=dict(first['clip'],hot_zones=[{'id':'z','name':'Core','start':2,'end':3}])))
            self.assertEqual(refined['revision'],2)
            self.assertEqual(refined['clip']['hot_zones'][0]['name'],'Core')
            with self.assertRaisesRegex(ValueError,'changed'):
                b.save_marker_draft(store,dict(first,title='Stale'))
            with self.assertRaisesRegex(ValueError,'changed'):
                b.delete_marker_draft(store,first)
            b.delete_marker_draft(store,refined)
            self.assertEqual(b.list_marker_drafts(store,'1'),[second])
            store.db.close()

    def test_publish_requires_tag_and_retries_do_not_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash()
            draft=b.save_marker_draft(store,{'clip':{'scene_id':'1','start':1,'end':4}})
            with self.assertRaisesRegex(ValueError,'primary tag'):
                b.publish_marker_draft(store,stash,dict(draft,title='Topic'))
            self.assertEqual(len(b.list_marker_drafts(store,'1')),1)
            draft=b.save_marker_draft(store,dict(draft,primary='1'))
            project=store.save(document())
            args=dict(draft,title='Topic',project_id=project['id'])
            result=b.publish_marker_draft(store,stash,args)
            self.assertEqual(b.publish_marker_draft(store,stash,args),result)
            self.assertEqual(len(stash.markers),1)
            self.assertTrue(result['added_to_project'])
            self.assertEqual(len(store.get(project['id'])['media']),2)
            self.assertEqual(b.list_marker_drafts(store,'1'),[])
            with self.assertRaisesRegex(ValueError,'changed'):
                b.save_marker_draft(store,dict(draft,title='Already published'))
            store.db.close()

    def test_existing_marker_can_be_refined_as_draft_then_updated(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash()
            marker=b.save_marker(store,stash,{'clip':{'scene_id':'1','start':1,'end':4},'mode':'new','title':'Original','primary_tag_id':'1'})['marker']
            draft=b.save_marker_draft(store,{'clip':{'scene_id':'1','marker_id':marker['id'],'start':1,'end':6},'expected':marker,'primary':'1','title':'Refined'})
            self.assertEqual(stash.markers[0]['end_seconds'],4)
            result=b.publish_marker_draft(store,stash,dict(draft,mode='update'))
            self.assertEqual(result['marker']['id'],marker['id'])
            self.assertEqual(result['marker']['end_seconds'],6)
            self.assertEqual(len(stash.markers),1)
            store.db.close()

    def test_failed_publish_keeps_remaining_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash()
            first=b.save_marker_draft(store,{'clip':{'scene_id':'1','start':1,'end':4},'primary':'1','title':'One'})
            second=b.save_marker_draft(store,{'clip':{'scene_id':'1','start':8,'end':70},'primary':'1','title':'Two'})
            b.publish_marker_draft(store,stash,first)
            with self.assertRaises(ValueError):
                b.publish_marker_draft(store,stash,second)
            self.assertEqual(b.list_marker_drafts(store,'1'),[second])
            self.assertEqual(len(stash.markers),1)
            store.db.close()

    def test_screening_capture_appends_in_order_once_and_updates_do_not_append(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash();project=store.save(document(clips=[]))
            for start in (8,2):
                draft=b.save_marker_draft(store,{'clip':{'scene_id':'1','start':start,'end':start+1},'primary':'1','title':'Captured'})
                args=dict(draft,project_id=project['id'],add_to_timeline=True)
                first=b.publish_marker_draft(store,stash,args)
                self.assertTrue(first['added_to_timeline'])
                self.assertEqual(b.publish_marker_draft(store,stash,args),first)
            doc=store.get(project['id']);self.assertEqual([c['start'] for c in doc['clips']],[8,2]);self.assertEqual(len(doc['media']),2)
            marker=stash.markers[0]
            edited=b.save_marker_draft(store,{'clip':{'scene_id':'1','marker_id':marker['id'],'start':8,'end':10},'primary':'1','title':'Edited','expected':marker})
            b.publish_marker_draft(store,stash,dict(edited,mode='update',project_id=project['id'],add_to_timeline=True))
            self.assertEqual(len(store.get(project['id'])['clips']),2)
            self.assertEqual(len(stash.markers),2)
            store.db.close()

    def test_failed_timeline_addition_can_retry_without_creating_marker_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            store=b.Store(Path(directory));stash=FakeStash();project=store.save(document(clips=[]))
            draft=b.save_marker_draft(store,{'clip':{'scene_id':'1','start':1,'end':2},'primary':'1','title':'Retry'})
            args=dict(draft,project_id=project['id'],add_to_timeline=True)
            save=store.save
            def fail(doc):raise ValueError('Compilation changed')
            store.save=fail
            result=b.publish_marker_draft(store,stash,args)
            self.assertIn('warning',result);self.assertEqual(store.get(project['id'])['clips'],[])
            store.save=save
            result=b.publish_marker_draft(store,stash,args)
            self.assertNotIn('warning',result);self.assertTrue(result['added_to_timeline'])
            b.publish_marker_draft(store,stash,args)
            self.assertEqual(len(stash.markers),1);self.assertEqual(len(store.get(project['id'])['clips']),1)
            store.db.close()
