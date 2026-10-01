"""Stash raw plugin. Standard library only; FFmpeg renders clips and FFprobe reads frame timestamps."""
import re
import shutil
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid


class Stash:
    def __init__(self, connection):
        host = connection.get('Host') or 'localhost'
        if host in ('0.0.0.0', '::'):
            host = 'localhost'
        if ':' in host and not host.startswith('['):
            host = '[' + host + ']'
        self.url = '{}://{}:{}/graphql'.format(connection['Scheme'], host, connection['Port'])
        cookie = connection.get('SessionCookie') or {}
        self.headers = {'Content-Type': 'application/json'}
        if cookie.get('Value'):
            self.headers['Cookie'] = cookie.get('Name', 'session') + '=' + cookie['Value']

    def query(self, query, variables=None):
        req = urllib.request.Request(self.url, json.dumps({'query': query, 'variables': variables or {}}).encode(), self.headers)
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.load(response)
        if result.get('errors'):
            raise ValueError('; '.join(e['message'] for e in result['errors']))
        return result['data']

    def scene(self, scene_id):
        scene = self.query('query($id:ID!){findScene(id:$id){id title files{id path duration frame_rate} performers{id} tags{id} sceneStreams{url mime_type label}}}', {'id': scene_id})['findScene']
        if not scene or not scene['files']:
            raise ValueError('Source scene {} is missing or has no files'.format(scene_id))
        return scene


def number(value, label):
    if isinstance(value, bool):
        raise ValueError(label + ' must be a number')
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(label + ' must be a number')
    if not math.isfinite(result):
        raise ValueError(label + ' must be finite')
    return result


def validate_clips(clips):
    if not isinstance(clips, list) or len(clips) > 2000:
        raise ValueError('A compilation supports up to 2000 clips and 2000 catalog markers')
    clean = []
    for clip in clips:
        if not isinstance(clip, dict):
            raise ValueError("Invalid clip")
        start, end = number(clip.get('start'), 'Start'), number(clip.get('end'), 'End')
        if start < 0 or end <= start:
            raise ValueError('Each clip needs an end later than its non-negative start')
        scene_id = str(clip.get('scene_id', ''))
        if not scene_id.isdigit():
            raise ValueError('Each clip needs a source scene')
        phases = clip.get('phases', [{'repeat': 1, 'speed': 1}])
        if not isinstance(phases, list) or not 1 <= len(phases) <= 200:
            raise ValueError('Each clip needs 1–200 playback steps')
        clean_phases = []
        for phase in phases:
            repeat, speed = number(phase.get('repeat'), 'Repeat count'), number(phase.get('speed'), 'Speed')
            if repeat != int(repeat) or not 1 <= repeat <= 20:
                raise ValueError('Repeat count must be a whole number from 1 to 20')
            if speed not in (0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3):
                raise ValueError('Choose one of the supported playback speeds')
            clean_phases.append({'repeat': int(repeat), 'speed': speed})
            if 'target' in phase:
                target = phase['target']
                if not isinstance(target, str) or not re.fullmatch(r'(full|hot|zone:[A-Za-z0-9_-]{1,80}|slot:[0-9]{1,2})', target):
                    raise ValueError('Invalid step range')
                clean_phases[-1]['target'] = target
            if 'ranges' in phase:
                ranges = phase['ranges']
                if not isinstance(ranges, list) or len(ranges) != int(repeat) or any(r not in ('auto', 'full', 'hot') for r in ranges):
                    raise ValueError('Choose Full clip or Hot zone for each repetition')
                clean_phases[-1]['ranges'] = ranges[:]

        clean.append({'scene_id': scene_id, 'marker_id': str(clip.get('marker_id', '')),
                      'title': str(clip.get('title', ''))[:300], 'start': start, 'end': end, 'phases': clean_phases})
        multiple = 'hot_zones' in clip
        zones = clip.get('hot_zones') if multiple else ([clip['hot_zone']] if clip.get('hot_zone') is not None else [])
        if not isinstance(zones, list) or len(zones) > 20:
            raise ValueError('A clip supports up to 20 hot zones')
        cleaned_zones = []
        for zone in zones:
            if not isinstance(zone, dict):
                raise ValueError('Invalid hot zone')
            hot_start, hot_end = number(zone.get('start'), 'Hot zone start'), number(zone.get('end'), 'Hot zone end')
            if not start <= hot_start < hot_end <= end:
                raise ValueError('Hot zones must have start < end and stay inside the clip range')
            cleaned_zones.append({'start': hot_start, 'end': hot_end})
            if 'id' in zone:
                if not isinstance(zone['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', zone['id']):
                    raise ValueError('Invalid zone identity')
                cleaned_zones[-1]['id'] = zone['id']
            if 'name' in zone:
                cleaned_zones[-1]['name'] = str(zone['name'])[:80]
        ids = [z['id'] for z in cleaned_zones if 'id' in z]
        if len(ids) != len(set(ids)):
            raise ValueError('Zone identities must be unique')
        cleaned_zones.sort(key=lambda z: z['start'])
        if any(a['end'] > b['start'] for a, b in zip(cleaned_zones, cleaned_zones[1:])):
            raise ValueError('Hot zones must not overlap')
        if multiple:
            clean[-1]['hot_zones'] = cleaned_zones
        elif cleaned_zones:
            clean[-1]['hot_zone'] = cleaned_zones[0]

    return clean


def media_key(clip):
    return (clip['scene_id'], clip.get('marker_id') or (clip['start'], clip['end']))


def project_media(document):
    # Older projects derive their catalog from the saved timeline without changing it.
    items = {}
    for clip in document.get('media', document.get('clips', [])):
        items.setdefault(media_key(clip), clip)
    return list(items.values())


def validate(document):
    if not isinstance(document, dict):
        raise ValueError('Invalid compilation')
    name = str(document.get('name', '')).strip()
    if not name or len(name) > 200:
        raise ValueError('Give the compilation a name of 1–200 characters')
    clean = validate_clips(document.get('clips', []))
    media = validate_clips(document.get('media', document.get('clips', [])))
    media = project_media({'media': media, 'clips': clean})
    if len(media) > 2000:
        raise ValueError('A project supports up to 2000 catalog markers')
    width = document.get('width', 1280)
    if width not in (640, 1280, 1920):
        raise ValueError('Choose 640, 1280 or 1920 pixel clip width')
    return {'name': name, 'clips': clean, 'media': media, 'width': width, 'audio': bool(document.get('audio', True))}


class Store:
    def __init__(self, root):
        root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(root / 'compilations.sqlite3', timeout=30)
        self.db.execute('CREATE TABLE IF NOT EXISTS compilations (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, record TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS patterns (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, revision INTEGER NOT NULL, phases TEXT NOT NULL)')

    def list_patterns(self):
        return [{'id': id_, 'name': name, 'revision': revision, 'phases': json.loads(phases)}
                for id_, name, revision, phases in self.db.execute('SELECT id,name,revision,phases FROM patterns ORDER BY name')]

    def save_pattern(self, pattern):
        if not isinstance(pattern, dict):
            raise ValueError('Invalid pattern')
        name = str(pattern.get('name', '')).strip()
        if not name or len(name) > 100:
            raise ValueError('Give the pattern a name of 1–100 characters')
        phases = validate_clips([{'scene_id': '1', 'start': 0, 'end': 1, 'phases': pattern.get('phases')}])[0]['phases']
        id_ = pattern.get('id') or str(uuid.uuid4())
        try:
            with self.db:
                if pattern.get('id'):
                    cursor = self.db.execute('UPDATE patterns SET name=?,phases=?,revision=revision+1 WHERE id=? AND revision=?',
                                             (name, json.dumps(phases), id_, pattern.get('revision')))
                    if cursor.rowcount != 1:
                        raise ValueError('Pattern changed in another window. Close and reopen Patterns to refresh.')
                else:
                    self.db.execute('INSERT INTO patterns VALUES (?,?,1,?)', (id_, name, json.dumps(phases)))
        except sqlite3.IntegrityError as exc:
            raise ValueError('A pattern with this name already exists') from exc
        return next(p for p in self.list_patterns() if p['id'] == id_)

    def delete_pattern(self, id_, revision):
        with self.db:
            if self.db.execute('DELETE FROM patterns WHERE id=? AND revision=?', (id_, revision)).rowcount != 1:
                raise ValueError('Pattern changed in another window. Close and reopen Patterns to refresh.')
        return True

    def list(self):
        documents = [dict(json.loads(doc), id=id_, revision=revision) for id_, revision, doc in self.db.execute('SELECT id, revision, document FROM compilations ORDER BY rowid DESC')]
        for document in documents:
            document['media'] = project_media(document)
        return documents

    def get(self, id_):
        for doc in self.list():
            if doc['id'] == id_:
                return doc
        raise ValueError('Compilation no longer exists')

    def save(self, document):
        clean = validate(document)
        id_ = document.get('id') or str(uuid.uuid4())
        with self.db:
            if document.get('id'):
                cursor = self.db.execute('UPDATE compilations SET document=?, revision=revision+1 WHERE id=? AND revision=?',
                                         (json.dumps(clean), id_, document.get('revision')))
                if cursor.rowcount != 1:
                    raise ValueError('This compilation changed in another window. Reload it before saving.')
            else:
                self.db.execute('INSERT INTO compilations VALUES (?,1,?)', (id_, json.dumps(clean)))
        return self.get(id_)

    def delete(self, id_, revision):
        with self.db:
            if self.db.execute('DELETE FROM compilations WHERE id=? AND revision=?', (id_, revision)).rowcount != 1:
                raise ValueError('Compilation changed or was deleted. Reload the list first.')
        return True


def source(clip, stash):
    scene = stash.scene(clip['scene_id'])
    file = scene['files'][0]
    duration = number(file['duration'], 'Source duration')
    if clip['end'] > duration + .05:
        raise ValueError('Clip "{}" ends beyond the source duration ({:.2f}s)'.format(clip['title'], duration))
    return scene, file


def cache_key(clip, file, document):
    path = Path(file['path'])
    stat = path.stat()
    identity = [1, str(path), file['id'], stat.st_size, stat.st_mtime_ns,
                clip['start'], clip['end'], document['width'], document['audio']]
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def render(clip, file, document, cache, ffmpeg):
    cache.mkdir(parents=True, exist_ok=True)
    key = cache_key(clip, file, document)
    output = cache / (key + '.mp4')
    if output.exists():
        return key
    fd, temporary = tempfile.mkstemp(suffix='.mp4', prefix='.render-', dir=cache)
    os.close(fd)
    try:
        args = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                '-ss', str(clip['start']), '-i', file['path'], '-t', str(clip['end'] - clip['start']),
                '-map', '0:v:0', '-vf', "scale=w='min({},iw)':h=-2".format(document['width']),
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p']
        args += ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k'] if document['audio'] else ['-an']
        args += ['-movflags', '+faststart', temporary]
        result = subprocess.run([sys.executable, __file__, '--ffmpeg-worker', str(os.getpid()), temporary] + args, capture_output=True, text=True, timeout=7260)
        if result.returncode:
            raise ValueError('FFmpeg could not generate this clip: ' + result.stderr[-1500:])
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return key


def frame_window(file, position, ffprobe):
    position = number(position, 'Frame position')
    duration = number(file['duration'], 'Source duration')
    if not 0 <= position <= duration:
        raise ValueError('Frame position is outside the source')
    def probe(options):
        result = subprocess.run([ffprobe, '-v', 'error', '-select_streams', 'v:0'] + options +
                                ['-of', 'json', file['path']], capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise ValueError('Could not read source frames: ' + result.stderr[-500:])
        return json.loads(result.stdout)
    metadata = probe(['-show_entries', 'stream=codec_name,field_order,avg_frame_rate,r_frame_rate,time_base:format=start_time,format_name'])
    streams = metadata['streams']
    if not streams:
        raise ValueError('No video frames in this source')
    stream = streams[0]
    rate = 0
    for value in (stream.get('avg_frame_rate'), stream.get('r_frame_rate')):
        try:
            rate = float(Fraction(value))
            if 0 < rate <= 1000:
                break
        except (ValueError, ZeroDivisionError, TypeError):
            pass
    if not 0 < rate <= 1000:
        raise ValueError('The source frame rate is unavailable')
    origin = float(metadata.get('format', {}).get('start_time', 0))
    radius = max(2, 12 / rate)
    lower, upper = max(0, position-radius), min(duration, position+radius)
    interval = ['-read_intervals', '{}%{}'.format(lower+origin, upper+origin)]
    time_base = Fraction(stream.get('time_base', '1/1000000'))
    times = []
    timestamp_source = 'decoded_frames'
    # Progressive AVC/HEVC samples in MP4/MOV and Matroska carry presentation
    # timestamps per picture. Read these without reconstructing pixels. Sort by
    # PTS (not DTS) to retain display order for B-frames and variable-rate video.
    formats = set(metadata.get('format', {}).get('format_name', '').split(','))
    packet_safe = (stream.get('codec_name') in ('h264', 'hevc')
                   and stream.get('field_order') == 'progressive'
                   and bool(formats & {'mov', 'mp4', 'matroska'}))
    if packet_safe:
        data = probe(interval + ['-show_entries', 'packet=pts,flags'])
        packets = [p for p in data.get('packets', []) if 'D' not in p.get('flags', '')]
        if packets and all('pts' in p for p in packets):
            values = [float(int(p['pts']) * time_base) - origin for p in packets]
            if len(values) == len(set(values)):
                times = sorted(values)
                timestamp_source = 'packet_pts'
    if not times:
        data = probe(interval + ['-show_entries', 'frame=best_effort_timestamp,best_effort_timestamp_time'])
        times = sorted(set((float(int(frame['best_effort_timestamp']) * time_base) if 'best_effort_timestamp' in frame
                            else float(frame['best_effort_timestamp_time'])) - origin
                           for frame in data.get('frames', []) if 'best_effort_timestamp' in frame or 'best_effort_timestamp_time' in frame))
    times = [t for t in times if 0 <= t < duration]
    if not times:
        raise ValueError('No frame timestamps are available near this position')
    return {'times': times, 'fps': rate, 'at_start': lower == 0, 'at_end': upper == duration, 'timestamp_source': timestamp_source}


def export_get(store, id_):
    row = store.db.execute('SELECT record FROM exports WHERE id=?', (id_,)).fetchone()
    if not row:
        raise ValueError('Rendered version not found')
    return json.loads(row[0])


def export_put(store, record):
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        previous = store.db.execute('SELECT record FROM exports WHERE id=?', (record['id'],)).fetchone()
        if previous:
            for key in ('job_id', 'import_job', 'scan_job'):
                if key not in record and key in json.loads(previous[0]):
                    record[key] = json.loads(previous[0])[key]
        store.db.execute('INSERT OR REPLACE INTO exports VALUES (?,?)', (record['id'], json.dumps(record)))
    return record


def export_patch(store, id_, **changes):
    # Serialize short updates with the worker's progress writes.
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        record = export_get(store, id_)
        record.update(changes)
        store.db.execute('UPDATE exports SET record=? WHERE id=?', (json.dumps(record), id_))
    return record


def export_plan(document):
    result = []
    for clip in document['clips']:
        zones = sorted(clip.get('hot_zones', [clip['hot_zone']] if clip.get('hot_zone') else []), key=lambda z: z['start'])
        zones = [dict(z, id=z.get('id', 'legacy-'+str(i))) for i, z in enumerate(zones)]
        phases = clip.get('phases') or [{'repeat': 1, 'speed': 1, 'target': 'full'}]
        total = sum(p['repeat'] for p in phases)
        ordinal = 0
        for phase in phases:
            for repeat in range(phase['repeat']):
                target = phase.get('target') or (phase.get('ranges') or ['auto'] * phase['repeat'])[repeat]
                if target == 'auto':
                    target = 'hot' if 0 < ordinal < total-1 else 'full'
                ranges = [clip] if target == 'full' else (zones or [clip]) if target == 'hot' else [z for z in zones if target == 'zone:'+z['id']]
                if not ranges:
                    raise ValueError('Choose a range for every missing hot zone before rendering')
                for zone in ranges:
                    result.append({'scene_id': clip['scene_id'], 'start': zone['start'], 'end': zone['end'], 'speed': phase['speed']})
                ordinal += 1
    if not result:
        raise ValueError('Add at least one clip before rendering')
    return result


def export_config(stash, root):
    general = stash.query('{configuration{general{ffmpegPath ffprobePath stashes{path excludeVideo}}}}')['configuration']['general']
    libraries = [str(Path(s['path']).resolve()) for s in general['stashes'] if not s['excludeVideo']]
    return {'libraries': libraries, 'private_directory': str(root / 'renders'), 'ffmpeg': general['ffmpegPath'] or 'ffmpeg', 'ffprobe': general['ffprobePath'] or 'ffprobe'}


def export_link(record, plugin_dir):
    path = Path(record['path'])
    if not path.is_file():
        return False
    assets = plugin_dir / 'exports'
    assets.mkdir(parents=True, exist_ok=True)
    link = assets / (record['id']+'.mp4')
    if not link.exists():
        try:
            link.symlink_to(path)
        except OSError:
            os.link(path, link)
    return True


def prepare_export(store, stash, root, args):
    doc = store.get(args['id'])
    export_plan(doc)
    settings = export_config(stash, root)
    quality = args.get('quality', '1080p')
    if quality not in ('720p', '1080p'):
        raise ValueError('Choose 720p or 1080p')
    library = bool(args.get('library', True))
    if library:
        directory = str(Path(args.get('directory', '')).resolve())
        if directory not in settings['libraries']:
            raise ValueError('Choose a configured video library folder')
        output = Path(directory) / 'Marker Compilations'
    else:
        output = root / 'renders'
    output.mkdir(parents=True, exist_ok=True)
    id_ = str(uuid.uuid4())
    name = re.sub(r'[^\w -]', '', doc['name'], flags=re.UNICODE).strip()[:70] or 'Compilation'
    path = output / ('{}-r{}-{}.mp4'.format(name, doc['revision'], id_[:8]))
    return export_put(store, {'id': id_, 'compilation_id': doc['id'], 'revision': doc['revision'], 'name': doc['name'],
                              'snapshot': doc, 'quality': quality, 'audio': bool(args.get('audio', True)), 'library': library,
                              'copy_metadata': bool(args.get('copy_metadata', False)), 'path': str(path.resolve()),
                              'status': 'queued', 'progress': 0, 'created': time.time()})


def export_encode(args, work):
    result = subprocess.run([sys.executable, __file__, '--export-worker', str(os.getpid()), str(work)] + args,
                            capture_output=True, text=True, timeout=7260)
    if result.returncode:
        raise ValueError('Video rendering failed: '+result.stderr[-1500:])


def render_export(store, stash, root, plugin_dir, id_):
    record = export_get(store, id_)
    if record['status'] != 'queued':
        raise ValueError('This rendered version has already been started')
    record.update(status='rendering', progress=0)
    export_put(store, record)
    work = root / 'render-work' / id_
    work.mkdir(parents=True, exist_ok=True)
    output = Path(record['path'])
    partial = output.parent / ('.'+id_+'.partial')
    try:
        config = export_config(stash, root)
        plan = export_plan(record['snapshot'])
        sources, metadata = {}, {}
        for clip in record['snapshot']['clips']:
            scene, file = source(clip, stash)
            sources[clip['scene_id']] = file
            metadata[clip['scene_id']] = scene
        width, height = (1280, 720) if record['quality'] == '720p' else (1920, 1080)
        segments, files = {}, []
        for index, part in enumerate(plan):
            key = (part['scene_id'], part['start'], part['end'], part['speed'])
            if key not in segments:
                segment = work / ('segment-'+str(len(segments))+'.mp4')
                file = sources[part['scene_id']]
                length = part['end']-part['start']
                duration = max(1/30, round(length/part['speed']*30)/30)
                probe = subprocess.run([config['ffprobe'], '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'json', file['path']], capture_output=True, text=True, check=True, timeout=30)
                audio = bool(json.loads(probe.stdout).get('streams'))
                command = [config['ffmpeg'], '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', str(part['start']), '-t', str(length), '-i', file['path']]
                if record['audio'] and not audio:
                    command += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
                vf = 'setpts=(PTS-STARTPTS)/{},scale={}:{}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=1'.format(part['speed'], width, height, width, height)
                command += ['-map', '0:v:0', '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000']
                if record['audio']:
                    speed, tempo = part['speed'], []
                    while speed < .5:
                        tempo.append('atempo=0.5'); speed /= .5
                    while speed > 2:
                        tempo.append('atempo=2'); speed /= 2
                    tempo.append('atempo='+str(speed))
                    af = ','.join(['asetpts=PTS-STARTPTS'] + (tempo if audio else []) + ['aresample=48000', 'apad', 'atrim=duration='+str(duration)])
                    command += ['-map', '0:a:0' if audio else '1:a:0', '-af', af, '-ac', '2', '-c:a', 'aac', '-b:a', '160k']
                else:
                    command += ['-an']
                command += ['-t', str(duration), str(segment)]
                export_encode(command, work)
                segments[key] = segment
            files.append(segments[key])
            record['progress'] = .9*(index+1)/len(plan)
            export_put(store, record)
            print('\x01p\x02'+str(record['progress']), file=sys.stderr)
        manifest = work / 'sequence.txt'
        manifest.write_text(''.join("file '{}'\nduration {:.9f}\n".format(f.name, max(1/30, round((p['end']-p['start'])/p['speed']*30)/30)) for f, p in zip(files, plan)))
        final = work / 'finished.mp4'
        export_encode([config['ffmpeg'], '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', str(manifest), '-c', 'copy', '-movflags', '+faststart', str(final)], work)
        probe = subprocess.run([config['ffprobe'], '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', str(final)], capture_output=True, text=True, check=True, timeout=30)
        info = json.loads(probe.stdout)
        duration = float(info['format']['duration'])
        expected = sum(max(1/30, round((p['end']-p['start'])/p['speed']*30)/30) for p in plan)
        if abs(duration-expected) > max(.5, len(plan)*.06):
            raise ValueError('Rendered duration differs from the saved sequence')
        if duration <= 0 or not any(s['codec_type'] == 'video' for s in info['streams']):
            raise ValueError('The rendered video could not be verified')
        shutil.copyfile(final, partial)
        os.replace(partial, output)
        record.update(status='ready', progress=1, duration=duration, bytes=output.stat().st_size)
        if record['copy_metadata']:
            record['performer_ids'] = sorted({p['id'] for scene in metadata.values() for p in scene.get('performers', [])})
            record['tag_ids'] = sorted({p['id'] for scene in metadata.values() for p in scene.get('tags', [])})
        export_put(store, record)
        export_link(record, plugin_dir)
        if record['library']:
            request_export_import(store, stash, id_)
        return {'id': id_, 'path': str(output)}
    except Exception as exc:
        record.update(status='import_error' if output.exists() else 'failed', error=str(exc))
        export_put(store, record)
        raise
    finally:
        partial.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)


def request_export_import(store, stash, id_):
    record = export_get(store, id_)
    if not record['library'] or not Path(record['path']).exists():
        raise ValueError('This version is not ready for library import')
    scan = stash.query('mutation($input:ScanMetadataInput!){metadataScan(input:$input)}', {'input': {'paths': [str(Path(record['path']).parent)], 'scanGenerateCovers': True}})['metadataScan']
    record.update(status='importing', scan_job=scan, error=None)
    export_put(store, record)
    job = stash.query('mutation($args:Map!){runPluginTask(plugin_id:"marker-compilations",task_name:"Render compilation video",args_map:$args)}', {'args': {'action': 'finalize_export', 'export_id': id_}})['runPluginTask']
    return export_patch(store, id_, import_job=job)


def rendered_tag(stash):
    name = 'Marker Compilations · Rendered'
    tags = stash.query('query($name:String!){findTags(tag_filter:{name:{value:$name,modifier:EQUALS}},filter:{per_page:-1}){tags{id}}}', {'name': name})['findTags']['tags']
    return tags[0]['id'] if tags else stash.query('mutation($name:String!){tagCreate(input:{name:$name}){id}}', {'name': name})['tagCreate']['id']


def migrate_rendered_tag(store, stash, record):
    if not record.get('scene_id') or record.get('rendered_tag'):
        return record
    scene = stash.query('query($id:ID!){findScene(id:$id){id tags{id}}}', {'id': record['scene_id']})['findScene']
    if scene:
        tag = rendered_tag(stash)
        tags = {t['id'] for t in scene['tags']}
        if tag not in tags:
            stash.query('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {'input': {'id': scene['id'], 'tag_ids': sorted(tags | {tag})}})
    return export_patch(store, record['id'], rendered_tag=True)


def finalize_export(store, stash, id_):
    record = export_get(store, id_)
    try:
        scenes = stash.query('query($filter:SceneFilterType!){findScenes(scene_filter:$filter,filter:{per_page:-1}){scenes{id files{path}}}}', {'filter': {'path': {'value': record['path'], 'modifier': 'EQUALS'}}})['findScenes']['scenes']
        scene = next((s for s in scenes if any(Path(f['path']).resolve() == Path(record['path']).resolve() for f in s['files'])), None)
        if not scene:
            raise ValueError('The scan has not imported this video. Check Stash Tasks, then retry the library import.')
        tag = rendered_tag(stash)
        details = 'Rendered compilation: {}\nProject ID: {}\nSaved revision: {}\nEdit in Marker Compilations (/marker-compilations).\nSource scenes: {}'.format(record['name'], record['compilation_id'], record['revision'], ', '.join(sorted({c['scene_id'] for c in record['snapshot']['clips']})))
        update = {'id': scene['id'], 'title': record['name'], 'details': details, 'tag_ids': sorted(set([tag]+record.get('tag_ids', [])))}
        if record.get('copy_metadata'):
            update['performer_ids'] = record.get('performer_ids', [])
        stash.query('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {'input': update})
        record.update(status='ready', scene_id=scene['id'], rendered_tag=True, error=None)
    except Exception as exc:
        record.update(status='import_error', error=str(exc))
    return export_put(store, record)


def list_exports(store, stash, root, plugin_dir, compilation_id):
    records = [json.loads(r[0]) for r in store.db.execute('SELECT record FROM exports ORDER BY rowid DESC')]
    result = []
    for record in records:
        if record['compilation_id'] != compilation_id:
            continue
        if record['status'] in ('queued', 'rendering') and record.get('job_id'):
            job = stash.query('query($id:ID!){findJob(input:{id:$id}){status error}}', {'id': record['job_id']})['findJob']
            record = export_get(store, record['id'])
            if record['status'] in ('queued', 'rendering') and (not job or job['status'] in ('CANCELLED', 'FAILED', 'FINISHED')):
                record.update(status='cancelled' if job and job['status']=='CANCELLED' else 'failed', error=(job or {}).get('error') or 'Rendering was interrupted. Start a new render to retry.')
                export_put(store, record)
        if record['status'] == 'importing' and record.get('import_job'):
            job = stash.query('query($id:ID!){findJob(input:{id:$id}){status error}}', {'id': record['import_job']})['findJob']
            record = export_get(store, record['id'])
            if record['status'] == 'importing' and (not job or job['status'] in ('CANCELLED', 'FAILED', 'FINISHED')):
                record = export_patch(store, record['id'], status='import_error', error='Library import was interrupted. Retry import to finish adding the video.')
        if record['status'] == 'queued' and not record.get('job_id') and time.time()-record['created'] > 120:
            record = export_patch(store, record['id'], status='failed', error='The render could not be queued. Start a new render to retry.')
        record = migrate_rendered_tag(store, stash, record)
        playable = export_link(record, plugin_dir) if record['status'] not in ('queued', 'rendering') else False
        result.append({k: v for k, v in record.items() if k not in ('snapshot', 'performer_ids', 'tag_ids')} | {'playable': playable})
    return result


def run(payload):
    conn, args = payload['server_connection'], payload.get('args', {})
    store = Store(Path(conn['Dir']) / 'marker-compilations')
    cache = Path(conn['PluginDir']) / 'cache'
    action = args.get('action')
    root = Path(conn['Dir']) / 'marker-compilations'
    if action in ('export_config', 'prepare_export', 'list_exports', 'render_export', 'finalize_export', 'retry_import', 'export_job'):
        stash = Stash(conn)
        if action == 'export_config':
            return export_config(stash, root)
        if action == 'prepare_export':
            return {k: v for k, v in prepare_export(store, stash, root, args).items() if k != 'snapshot'}
        if action == 'list_exports':
            return list_exports(store, stash, root, Path(conn['PluginDir']), args['id'])
        if action == 'render_export':
            return render_export(store, stash, root, Path(conn['PluginDir']), args['export_id'])
        if action == 'finalize_export':
            return finalize_export(store, stash, args['export_id'])
        if action == 'retry_import':
            return request_export_import(store, stash, args['export_id'])
        export_patch(store, args['export_id'], job_id=args['job_id'])
        return True

    if action == 'list_patterns':
        return store.list_patterns()
    if action == 'save_pattern':
        return store.save_pattern(args['pattern'])
    if action == 'delete_pattern':
        return store.delete_pattern(args['id'], args.get('revision'))
    if action == 'list':
        return store.list()
    if action == 'save':
        return store.save(args['document'])
    if action == 'delete':
        return store.delete(args['id'], args['revision'])
    if action == 'frames':
        stash = Stash(conn)
        file = stash.scene(args['scene_id'])['files'][0]
        config = stash.query('{configuration{general{ffprobePath}}}')
        return frame_window(file, args['position'], config['configuration']['general']['ffprobePath'] or 'ffprobe')
    if action not in ('resolve', 'generate'):
        raise ValueError('Choose a compilation in the Marker Compilations page first')
    document = store.get(args['id'])
    stash = Stash(conn)
    if action == 'generate':
        config = stash.query('{configuration{general{ffmpegPath}}}')
        ffmpeg = config['configuration']['general']['ffmpegPath'] or 'ffmpeg'
        for index, clip in enumerate(document['clips']):
            _, file = source(clip, stash)
            render(clip, file, document, cache, ffmpeg)
            print('\x01p\x02' + str((index + 1) / len(document['clips'])), file=sys.stderr)
        return {'generated': len(document['clips'])}
    resolved = []
    for clip in document['clips']:
        try:
            scene, file = source(clip, stash)
            cached = None
            try:
                key = cache_key(clip, file, document)
                if (cache / (key + '.mp4')).exists():
                    cached = key + '.mp4'
            except OSError:
                pass  # Original streams can still work when a file is not locally accessible.
            resolved.append(dict(clip, streams=scene['sceneStreams'], cached=cached, frame_rate=file.get('frame_rate')))
        except (ValueError, OSError) as exc:
            resolved.append(dict(clip, error=str(exc)))
    return {'document': document, 'clips': resolved}


def ffmpeg_worker():
    # Stash kills the raw plugin on cancellation; terminate its encoder too.
    parent, temporary = int(sys.argv[2]), Path(sys.argv[3])
    child = subprocess.Popen(sys.argv[4:], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    deadline = time.monotonic() + 7200
    try:
        while True:
            try:
                _, stderr = child.communicate(timeout=.5)
                sys.stderr.write(stderr)
                return child.returncode
            except subprocess.TimeoutExpired:
                if os.getppid() != parent or time.monotonic() > deadline:
                    child.kill()
                    child.communicate()
                    if sys.argv[1] == '--export-worker':
                        shutil.rmtree(temporary, ignore_errors=True)
                    else:
                        temporary.unlink(missing_ok=True)
                    sys.stderr.write('Clip generation cancelled or timed out')
                    return 1
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('--ffmpeg-worker', '--export-worker'):
        sys.exit(ffmpeg_worker())
    try:
        print(json.dumps({'output': run(json.load(sys.stdin))}))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
