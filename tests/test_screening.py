import copy
import importlib.util
import tempfile
from pathlib import Path
import unittest
from test_backend import b, document
from test_markers import FakeStash

spec=importlib.util.spec_from_file_location('screening',Path(__file__).parents[1]/'plugins/marker-compilations/screening.py')
screening=importlib.util.module_from_spec(spec);spec.loader.exec_module(screening)


class Library(FakeStash):
    def __init__(self):
        super().__init__()
        self.tags=[{'id':'1','name':'Interview'},{'id':'2','name':'Behind scenes'},{'id':'3','name':'Unrelated'}]
        self.scenes={str(i):{'id':str(i),'title':'Scene '+str(i),'tags':[{'id':'3'}],'scene_markers':[]} for i in range(1,4)}
        self.marker_scenes={};self.deltas=[]
    def query(self,query,variables=None):
        variables=variables or {}
        if query==screening.TAGS:return {'findTags':{'tags':copy.deepcopy(self.tags)}}
        if query==screening.TAG_CREATE:
            tag={'id':str(len(self.tags)+1),'name':variables['input']['name']};self.tags.append(tag);return {'tagCreate':copy.deepcopy(tag)}
        if query==screening.SCENES:
            scenes=copy.deepcopy(list(self.scenes.values()))
            if variables.get('ids') is not None:scenes=[s for s in scenes if s['id'] in variables['ids']]
            q=variables.get('filter',{}).get('q','')
            scenes=[s for s in scenes if q.lower() in s['title'].lower()]
            required=variables.get('criteria',{}).get('tags',{}).get('value',[])
            scenes=[s for s in scenes if set(required)<=set(t['id'] for t in s['tags'])]
            for scene in scenes:scene['scene_markers']=[copy.deepcopy(m) for m in self.markers if self.marker_scenes.get(m['id'])==scene['id']]
            count=len(scenes);f=variables.get('filter',{});size=f.get('per_page',-1)
            if size>0:scenes=scenes[(f.get('page',1)-1)*size:f.get('page',1)*size]
            return {'findScenes':{'count':count,'scenes':scenes}}
        if query==screening.SCENE_TAGS:
            value=variables['input'];self.deltas.append(copy.deepcopy(value));change=value['tag_ids']
            for id_ in value['ids']:
                ids={t['id'] for t in self.scenes[id_]['tags']}
                if change['mode']=='ADD':ids.update(change['ids'])
                elif change['mode']=='REMOVE':ids.difference_update(change['ids'])
                else:raise AssertionError('Must use tag deltas')
                self.scenes[id_]['tags']=[{'id':v} for v in sorted(ids)]
            return {'bulkSceneUpdate':[]}
        result=super().query(query,variables)
        if 'sceneMarkerCreate' in result:self.marker_scenes[result['sceneMarkerCreate']['id']]=variables['input']['scene_id']
        return result


class ScreeningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=b.Store(Path(self.temp.name));self.stash=Library()
    def tearDown(self):self.store.db.close();self.temp.cleanup()
    def create(self,**extra):
        args={'name':'Interviews and extras','targets':[{'marker_tag_id':'1'},{'marker_tag_id':'2'}],**extra}
        return screening.create(self.store,self.stash,args)
    def result(self,p,target,state,scene='1',publish=b.publish_marker_draft):
        return screening.result(self.store,self.stash,{'id':p['id'],'scene_id':scene,'target':target,'result':state},publish)['project']
    def draft(self,p,start=1):
        return b.save_marker_draft(self.store,{'clip':{'scene_id':'1','start':start,'end':start+1},'primary':'1','review_id':p['id']})

    def test_custom_status_tags_reuse_and_queue_filters(self):
        self.stash.tags.append({'id':'4','name':'Reviewed interviews'})
        p=self.create(targets=[{'marker_tag_id':'1','screened_name':'Reviewed interviews','absent_name':'No interviews'}],filters={'q':'Scene 2','tags':['3']})
        self.assertEqual(p['scene_ids'],['2']);self.assertEqual(p['targets'][0]['screened_tag_id'],'4')
        self.assertEqual(len(self.stash.tags),5)
        self.assertEqual(self.stash.deltas,[])
        with self.assertRaisesRegex(ValueError,'distinct'):
            self.create(targets=[{'marker_tag_id':'1','screened_name':'Interview'}])

    def test_absence_and_done_are_independent_per_target_and_portable(self):
        p=self.create();self.draft(p)
        with self.assertRaisesRegex(ValueError,'markers or drafts'):self.result(p,'1','absent')
        p=self.result(p,'2','absent')
        self.assertEqual(p['scenes'][0]['statuses']['1']['state'],'pending')
        self.assertEqual(p['scenes'][0]['statuses']['2']['state'],'absent')
        p=self.result(p,'1','done')
        self.assertEqual(p['scenes'][0]['statuses']['1']['state'],'done')
        self.assertEqual(len(self.stash.markers),1)
        self.assertIn('3',[t['id'] for t in self.stash.scenes['1']['tags']])
        p=self.result(p,'1','pending')
        self.assertEqual(p['scenes'][0]['statuses']['1']['state'],'pending')
        self.assertEqual(p['scenes'][0]['statuses']['2']['state'],'absent')
        self.assertEqual(len(self.stash.markers),1,'Reopening never removes markers')

    def test_external_tags_are_authoritative_and_conflicts_can_be_repaired(self):
        p=self.create();t=p['targets'][0]
        self.stash.scenes['1']['tags'] += [{'id':t['screened_tag_id']},{'id':t['absent_tag_id']}]
        self.draft(p)
        p=screening.snapshot(self.store,self.stash,screening.read(self.store,p['id']))
        self.assertEqual(p['scenes'][0]['statuses']['1']['state'],'conflict')
        reopened=self.create(targets=[{'marker_tag_id':'1'}],filters={'q':'Scene 1'})
        self.assertEqual(reopened['scene_ids'],['1'],'Unpublished drafts keep conflicting scenes in the review queue')
        p=self.result(p,'1','done')
        self.assertEqual(p['scenes'][0]['statuses']['1']['state'],'done')
        self.assertNotIn(t['absent_tag_id'],[v['id'] for v in self.stash.scenes['1']['tags']])
        self.stash.tags=[tag for tag in self.stash.tags if tag['id']!=t['screened_tag_id']]
        with self.assertRaisesRegex(ValueError,'deleted'):self.result(p,'1','done')

    def test_skipping_and_resume_do_not_mark_scenes_reviewed(self):
        p=self.create()
        screening.progress(self.store,{'id':p['id'],'scene_id':'1','position':12.5,'target':'2'})
        next_=screening.navigate(self.store,self.stash,{'id':p['id'],'move':'skip'})
        self.assertEqual(next_['current_id'],'2');self.assertEqual(next_['skipped'],['1'])
        screening.progress(self.store,{'id':p['id'],'scene_id':'1','position':13})
        latest=screening.read(self.store,p['id'])
        self.assertEqual(latest['current_id'],'2','A late playback update must not move the queue backwards')
        self.assertEqual(latest['positions']['1'],13);self.assertEqual(latest['active_target'],'2')
        self.assertEqual(self.stash.deltas,[])
        reopened=screening.navigate(self.store,self.stash,{'id':p['id'],'scene_id':'1'})
        self.assertEqual(reopened['scenes'][0]['statuses']['1']['state'],'pending')

    def test_partial_publication_does_not_mark_done_or_duplicate_on_retry(self):
        destination=self.store.save(document(clips=[]));p=self.create(project_id=destination['id']);self.draft(p);self.draft(p,3)
        attempts=[]
        def fail_second(store,stash,args):
            attempts.append(args['id'])
            if len(attempts)==2:raise ValueError('Network unavailable')
            return b.publish_marker_draft(store,stash,args)
        with self.assertRaisesRegex(ValueError,'Network'):self.result(p,'1','done',publish=fail_second)
        self.assertEqual(len(self.stash.markers),1);self.assertEqual(self.stash.deltas,[])
        p=self.result(p,'1','done')
        self.assertEqual(len(self.stash.markers),2);self.assertEqual(p['scenes'][0]['statuses']['1']['state'],'done')
        self.assertEqual(len(self.store.get(destination['id'])['media']),2)

    def test_already_screened_scenes_are_excluded_and_deleted_scenes_are_skippable(self):
        p=self.create(targets=[{'marker_tag_id':'1'}]);self.result(p,'1','absent')
        second=self.create(targets=[{'marker_tag_id':'1','screened_name':p['targets'][0]['screened_name'],'absent_name':p['targets'][0]['absent_name']}])
        self.assertEqual(second['scene_ids'],['2','3'])
        del self.stash.scenes['2']
        next_=screening.navigate(self.store,self.stash,{'id':second['id'],'move':'next'})
        self.assertTrue(next_['scenes'][0]['missing']);self.assertEqual(next_['current_id'],'3')
        with self.assertRaisesRegex(ValueError,'No published markers'):self.result(p,'1','done',scene='3')

    def test_new_compilation_is_created_only_for_a_valid_queue(self):
        with self.assertRaisesRegex(ValueError,'No scenes'):
            self.create(filters={'q':'no match'},new_compilation=True)
        self.assertEqual(self.store.list(),[])
        p=self.create(new_compilation=True)
        self.assertEqual(self.store.get(p['project_id'])['name'],p['name'])
        self.assertEqual(self.store.get(p['project_id'])['clips'],[])

    def test_project_status_is_independent_even_with_duplicate_project_names(self):
        p=self.create(targets=[{'marker_tag_id':'1'}]);self.result(p,'1','absent')
        for name in ('Another project',p['name']):
            other=self.create(name=name,targets=[{'marker_tag_id':'1'}])
            self.assertEqual(other['scene_ids'],['1','2','3'])
            self.assertNotEqual(other['targets'][0]['screened_tag_id'],p['targets'][0]['screened_tag_id'])
        self.assertEqual(screening.read(self.store,p['id'])['targets'],p['targets'])

    def test_multiple_targets_share_primary_tag_and_keep_marker_defaults(self):
        p=self.create(targets=[{'id':'age','marker_tag_id':'1','title':'Asking age','tag_ids':['2']},
                               {'id':'intro','marker_tag_id':'1','title':'Introduction','tag_ids':[]}])
        self.assertEqual(p['active_target'],'age')
        target=p['targets'][0]
        self.assertEqual(target['title'],'Asking age');self.assertEqual(target['tag_ids'],['2'])
        self.assertIn(p['name']+' / Asking age',target['screened_name'])
        draft=b.save_marker_draft(self.store,{'clip':{'scene_id':'1','start':1,'end':2},'title':'Age: refined title','primary':'1','tag_ids':['2'],'review_id':p['id'],'review_target_id':'age'})
        self.assertEqual(draft['review_target_id'],'age')
        p=self.result(p,'age','done')
        marker=self.stash.markers[0]
        self.assertEqual(marker['title'],'Age: refined title')
        self.assertIn('2',[t['id'] for t in marker['tags']])
        p=self.result(p,'intro','absent')
        self.assertEqual(p['scenes'][0]['statuses']['intro']['state'],'absent')
        with self.assertRaisesRegex(ValueError,'markers or drafts'):self.result(p,'age','absent')
        p=self.result(p,'age','pending');p=self.result(p,'age','done')
        self.assertEqual(len(self.stash.markers),1)

    def test_legacy_projects_keep_their_tag_mapping_and_primary_tag_identity(self):
        p=self.create();legacy=screening.read(self.store,p['id'])
        for target in legacy['targets']:
            for key in ('id','title','tag_ids'):target.pop(key,None)
        legacy.pop('status_scope',None)
        screening.write(self.store,legacy);self.store.db.commit()
        self.draft(legacy);updated=self.result(legacy,'1','done')
        self.assertEqual(updated['targets'],legacy['targets'])
        self.assertEqual(updated['scenes'][0]['statuses']['1']['state'],'done')
