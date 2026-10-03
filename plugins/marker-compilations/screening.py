"""Review queues use plugin storage; screening outcomes use ordinary Stash tags."""
import json
import math
import uuid

SCENES = 'query($ids:[ID!],$filter:FindFilterType,$criteria:SceneFilterType){findScenes(ids:$ids,filter:$filter,scene_filter:$criteria){count scenes{id title tags{id} scene_markers{id title primary_tag{id} tags{id}}}}}'
TAGS = 'query{findTags(filter:{per_page:-1}){tags{id name}}}'
TAG_CREATE = 'mutation($input:TagCreateInput!){tagCreate(input:$input){id name}}'
SCENE_TAGS = 'mutation($input:BulkSceneUpdateInput!){bulkSceneUpdate(input:$input){id tags{id}}}'


def read(store, id_):
    row = store.db.execute('SELECT document FROM screening_projects WHERE id=?', (str(id_),)).fetchone()
    if not row:
        raise ValueError('Screening project not found')
    return json.loads(row[0])


def write(store, project):
    store.db.execute('INSERT OR REPLACE INTO screening_projects VALUES (?,?)', (project['id'], json.dumps(project)))


def criteria(filters):
    result = {}
    for key in ('tags', 'studios'):
        ids = filters.get(key, [])
        if not isinstance(ids, list) or any(not str(id_).isdigit() for id_ in ids):
            raise ValueError('Invalid scene filters')
        if ids:
            result[key] = {'value': [str(id_) for id_ in ids], 'modifier': 'INCLUDES_ALL' if key == 'tags' else 'INCLUDES'}
    return result


def find_queue(stash, filters):
    rows = []; page = 1
    while True:
        data = stash.query(SCENES, {'filter': {'q': str(filters.get('q', '')), 'sort': 'id', 'direction': 'ASC', 'page': page, 'per_page': 200}, 'criteria': criteria(filters)})['findScenes']
        rows.extend(data['scenes'])
        if not data['scenes'] or len(rows) >= data['count']:
            return rows
        page += 1


def target_key(target):
    return target.get('id') or target['marker_tag_id']


def has_marker(scene, target):
    required = {target['marker_tag_id'], *target.get('tag_ids', [])}
    return any(str(marker['id']) in target.get('_published_ids', set()) or required <= {str(marker['primary_tag']['id']), *(str(t['id']) for t in marker.get('tags', []))}
               and (not target.get('title') or marker.get('title') == target['title'])
               for marker in scene.get('scene_markers', []))


def matches_draft(draft, target):
    if draft.get('review_target_id'):
        return draft['review_target_id'] == target_key(target)
    return draft.get('primary') == target['marker_tag_id'] and set(target.get('tag_ids', [])) <= set(draft.get('tag_ids', [])) and (not target.get('title') or draft.get('title') == target['title'])


def status(scene, target, drafts):
    ids = {str(tag['id']) for tag in scene.get('tags', [])}
    found = has_marker(scene, target)
    draft_count = sum(1 for d in drafts if d['clip']['scene_id'] == scene['id'] and matches_draft(d, target))
    screened = target['screened_tag_id'] in ids
    absent = target['absent_tag_id'] in ids
    state = 'conflict' if absent and (found or draft_count or not screened) else 'absent' if screened and absent else 'done' if screened else 'pending'
    return {'state': state, 'has_markers': found, 'drafts': draft_count}


def snapshot(store, stash, project):
    rows = {}
    ids = project['scene_ids']
    for offset in range(0, len(ids), 200):
        found = stash.query(SCENES, {'ids': ids[offset:offset+200], 'filter': {'per_page': -1}})['findScenes']['scenes']
        rows.update({str(scene['id']): scene for scene in found})
    drafts = [json.loads(r[0]) for r in store.db.execute('SELECT document FROM marker_drafts')]
    tracked = [{**t, '_published_ids': {str(d['published']['marker']['id']) for d in drafts if d.get('published') and d.get('review_id') == project['id'] and matches_draft(d, t)}} for t in project['targets']]
    drafts = [d for d in drafts if not d.get('published')]
    scenes = []
    for id_ in ids:
        scene = rows.get(id_)
        scenes.append({'id': id_, 'title': (scene or {}).get('title') or 'Scene '+id_, 'missing': scene is None,
                       'skipped': id_ in project['skipped'], 'statuses': {target_key(t): status(scene, t, drafts) if scene else {'state': 'missing', 'drafts': 0} for t in tracked}})
    tags = {str(t['id']): t['name'] for t in stash.query(TAGS)['findTags']['tags']}
    missing_tags = [t[key] for t in project['targets'] for key in ('marker_tag_id', 'screened_tag_id', 'absent_tag_id') if t[key] not in tags]
    missing_tags.extend(id_ for t in project['targets'] for id_ in t.get('tag_ids', []) if id_ not in tags)
    return {**project, 'scenes': scenes, 'missing_tags': missing_tags,
            'targets': [{**t, 'name': tags.get(t['marker_tag_id'], t['name']), 'screened_name': tags.get(t['screened_tag_id'], t['screened_name']), 'absent_name': tags.get(t['absent_tag_id'], t['absent_name'])} for t in project['targets']]}


def create(store, stash, args):
    name = str(args.get('name', '')).strip()
    targets = args.get('targets', [])
    if not name or len(name) > 120 or not isinstance(targets, list) or not 1 <= len(targets) <= 12:
        raise ValueError('Give the project a name and choose 1–12 target tags')
    tags = stash.query(TAGS)['findTags']['tags']; by_id = {str(t['id']): t for t in tags}
    by_name = {t['name'].casefold(): t for t in tags}
    marker_ids = [str(t.get('marker_tag_id', '')) for t in targets]
    keys = [str(t.get('id') or id_) for t, id_ in zip(targets, marker_ids)]
    if len(set(keys)) != len(keys) or any(id_ not in by_id for id_ in marker_ids):
        raise ValueError('Choose distinct existing marker tags')
    scopes = {json.loads(r[0]).get('status_scope', json.loads(r[0])['name']).casefold() for r in store.db.execute('SELECT document FROM screening_projects')}
    scope = name; suffix = 2
    while scope.casefold() in scopes:
        scope = name+' ('+str(suffix)+')'; suffix += 1
    names = []
    for target in targets:
        extra = target.get('tag_ids', [])
        if not isinstance(extra, list) or any(str(id_) not in by_id for id_ in extra):
            raise ValueError('Choose existing additional marker tags')
        if len(str(target.get('title') or '').strip()) > 100:
            raise ValueError('Default marker titles must be at most 100 characters')
    for target, id_ in zip(targets, marker_ids):
        for key, prefix in (('screened_name', 'Screened: '), ('absent_name', 'Absent: ')):
            value = str(target.get(key) or prefix+scope+' / '+(str(target.get('title') or '').strip() or by_id[id_]['name'])).strip()
            if not value or len(value) > 300:
                raise ValueError('Status tag names must contain 1–300 characters')
            names.append(value)
    if len({name.casefold() for name in names}) != len(names) or any(name.casefold() == by_id[id_]['name'].casefold() for name in names for id_ in marker_ids):
        raise ValueError('Screened, absent and marker tags must all be distinct')
    filters = args.get('filters') or {}
    queue = find_queue(stash, filters)
    if not queue:
        raise ValueError('No scenes match these filters')
    destination = str(args.get('project_id') or '')
    if destination:
        store.get(destination)
    mapped = []
    for index, id_ in enumerate(marker_ids):
        status_tags = []
        for name_ in names[index*2:index*2+2]:
            tag = by_name.get(name_.casefold())
            if not tag:
                tag = stash.query(TAG_CREATE, {'input': {'name': name_}})['tagCreate']; by_name[name_.casefold()] = tag
            status_tags.append(str(tag['id']))
        mapped.append({'id': keys[index], 'title': str(targets[index].get('title') or '').strip(), 'tag_ids': sorted({str(v) for v in targets[index].get('tag_ids', []) if str(v) != id_}), 'marker_tag_id': id_, 'name': by_id[id_]['name'], 'screened_tag_id': status_tags[0], 'absent_tag_id': status_tags[1], 'screened_name': names[index*2], 'absent_name': names[index*2+1]})
    # Start with scenes that need at least one target reviewed. A queue is a stable snapshot.
    if args.get('unreviewed_only', True):
        drafts = [json.loads(r[0]) for r in store.db.execute('SELECT document FROM marker_drafts')]
        drafts = [d for d in drafts if not d.get('published')]
        queue = [s for s in queue if any(status(s, t, drafts)['state'] not in ('done', 'absent') for t in mapped)]
    if not queue:
        raise ValueError('All matching scenes are already screened for these targets')
    if args.get('new_compilation'):
        destination = store.save({'name': name, 'clips': [], 'media': [], 'width': 1280, 'audio': True})['id']
    project = {'id': str(uuid.uuid4()), 'name': name, 'status_scope': scope, 'targets': mapped, 'filters': filters,
               'scene_ids': [str(s['id']) for s in queue], 'current_id': str(queue[0]['id']),
               'active_target': keys[0], 'skipped': [], 'positions': {}, 'project_id': destination}
    with store.db:
        write(store, project)
    return snapshot(store, stash, project)


def progress(store, args):
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        project = read(store, args['id'])
        scene_id = str(args.get('scene_id') or project['current_id'])
        if scene_id not in project['scene_ids']:
            raise ValueError('Scene is not in this queue')
        if args.get('target'):
            if args['target'] not in [target_key(t) for t in project['targets']]:
                raise ValueError('Unknown target')
            project['active_target'] = args['target']
        if 'position' in args:
            point = float(args['position'])
            if not math.isfinite(point) or point < 0:
                raise ValueError('Invalid playback position')
            project['positions'][scene_id] = point
        if args.get('select_scene'):
            project['current_id'] = scene_id
        write(store, project)
    return project


def result(store, stash, args, publish):
    project = read(store, args['id']); scene_id = str(args['scene_id'])
    if scene_id not in project['scene_ids']:
        raise ValueError('Scene is not in this queue')
    target = next((t for t in project['targets'] if target_key(t) == args.get('target')), None)
    if not target:
        raise ValueError('Unknown screening target')
    available = {str(t['id']) for t in stash.query(TAGS)['findTags']['tags']}
    if any(target[key] not in available for key in ('marker_tag_id', 'screened_tag_id', 'absent_tag_id')) or any(id_ not in available for id_ in target.get('tag_ids', [])):
        raise ValueError('A configured tag was deleted in Stash. Create a review project with valid tags.')
    action = args.get('result')
    if action not in ('done', 'absent', 'pending'):
        raise ValueError('Choose Done, None found or Reopen')
    scenes = stash.query(SCENES, {'ids': [scene_id], 'filter': {'per_page': -1}})['findScenes']['scenes']
    if not scenes:
        raise ValueError('This scene was deleted. Skip to the next scene.')
    scene = scenes[0]
    drafts = [json.loads(r[0]) for r in store.db.execute('SELECT document FROM marker_drafts WHERE scene_id=?', (scene_id,))]
    target = {**target, '_published_ids': {str(d['published']['marker']['id']) for d in drafts if d.get('published') and d.get('review_id') == project['id'] and matches_draft(d, target)}}
    drafts = [d for d in drafts if not d.get('published') and matches_draft(d, target)]
    if action == 'absent' and (has_marker(scene, target) or drafts):
        raise ValueError('This scene has markers or drafts with this target tag. Review those before marking None found.')
    warnings = []
    if action == 'done':
        published_here = False
        for draft in drafts:
            if draft.get('review_id') == project['id']:
                saved = publish(store, stash, {'id': draft['id'], 'revision': draft['revision'], 'mode': 'new', 'add_to_timeline': True, 'title': draft['title'] or target.get('title') or target['name'], 'project_id': project['project_id']})
                published_here = True
                if saved.get('warning'):
                    warnings.append(saved['warning'])
        scenes = stash.query(SCENES, {'ids': [scene_id], 'filter': {'per_page': -1}})['findScenes']['scenes']
        receipts = [json.loads(r[0]) for r in store.db.execute('SELECT document FROM marker_drafts WHERE scene_id=?', (scene_id,))]
        published_ids = {str(d['published']['marker']['id']) for d in receipts if d.get('published') and d.get('review_id') == project['id'] and matches_draft(d, target)}
        if not scenes or not (published_here or has_marker(scenes[0], target) or any(str(m['id']) in published_ids for m in scenes[0]['scene_markers'])):
            raise ValueError('No published markers for this target. Capture a highlight or choose None found.')
    # Delta updates preserve unrelated scene tags, including concurrent edits.
    remove = [target['absent_tag_id']] if action == 'done' else [target['screened_tag_id'], target['absent_tag_id']] if action == 'pending' else []
    add = [target['screened_tag_id'], target['absent_tag_id']] if action == 'absent' else [target['screened_tag_id']] if action == 'done' else []
    for mode, ids in (('REMOVE', remove), ('ADD', add)):
        if ids:
            stash.query(SCENE_TAGS, {'input': {'ids': [scene_id], 'tag_ids': {'ids': ids, 'mode': mode}}})
    with store.db:
        latest = read(store, project['id'])
        latest['skipped'] = [id_ for id_ in latest['skipped'] if id_ != scene_id]
        write(store, latest)
    return {'project': snapshot(store, stash, latest), 'warnings': warnings}


def navigate(store, stash, args):
    project = read(store, args['id']); action = args.get('move', 'next')
    if action == 'skip' and project['current_id'] not in project['skipped']:
        project['skipped'].append(project['current_id'])
    if action == 'revisit':
        project['skipped'] = []
    snap = snapshot(store, stash, project)
    if args.get('scene_id'):
        id_ = str(args['scene_id'])
        if id_ not in project['scene_ids']:
            raise ValueError('Scene is not in this queue')
        project['current_id'] = id_
    else:
        index = project['scene_ids'].index(project['current_id'])
        ordered = snap['scenes'][index+1:] + snap['scenes'][:index+1]
        candidate = next((s for s in ordered if not s['missing'] and not s['skipped'] and any(v['state'] in ('pending', 'conflict') for v in s['statuses'].values())), None)
        if candidate:
            project['current_id'] = candidate['id']
    with store.db:
        latest = read(store, project['id'])
        latest.update(current_id=project['current_id'], skipped=project['skipped'])
        write(store, latest)
    return snapshot(store, stash, latest)


def run(store, stash, args, publish):
    action = args['action']
    if action == 'screening_list':
        return [json.loads(row[0]) for row in store.db.execute('SELECT document FROM screening_projects ORDER BY rowid DESC')]
    if action == 'screening_create':
        return create(store, stash, args)
    if action == 'screening_get':
        return snapshot(store, stash, read(store, args['id']))
    if action == 'screening_progress':
        return progress(store, args)
    if action == 'screening_result':
        return result(store, stash, args, publish)
    if action == 'screening_navigate':
        return navigate(store, stash, args)
    raise ValueError('Unknown screening action')
