"""Stash raw plugin. Standard library only; FFmpeg is needed only for caching."""
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
        scene = self.query('query($id:ID!){findScene(id:$id){id title files{id path duration} sceneStreams{url mime_type label}}}', {'id': scene_id})['findScene']
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
        if not isinstance(phases, list) or not 1 <= len(phases) <= 10:
            raise ValueError('Each clip needs 1–10 playback phases')
        clean_phases = []
        for phase in phases:
            repeat, speed = number(phase.get('repeat'), 'Repeat count'), number(phase.get('speed'), 'Speed')
            if repeat != int(repeat) or not 1 <= repeat <= 20:
                raise ValueError('Repeat count must be a whole number from 1 to 20')
            if speed not in (0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3):
                raise ValueError('Choose one of the supported playback speeds')
            clean_phases.append({'repeat': int(repeat), 'speed': speed})
        clean.append({'scene_id': scene_id, 'marker_id': str(clip.get('marker_id', '')),
                      'title': str(clip.get('title', ''))[:300], 'start': start, 'end': end, 'phases': clean_phases})
    return clean


def media_key(clip):
    return (clip['scene_id'], clip.get('marker_id') or (clip['start'], clip['end']))


def project_media(document):
    # Older projects derive their catalog from the saved timeline without changing it.
    items = {}
    for clip in document.get('media', []) + document.get('clips', []):
        items.setdefault(media_key(clip), clip)
    return list(items.values())


def validate(document):
    if not isinstance(document, dict):
        raise ValueError('Invalid compilation')
    name = str(document.get('name', '')).strip()
    if not name or len(name) > 200:
        raise ValueError('Give the compilation a name of 1–200 characters')
    clean = validate_clips(document.get('clips', []))
    media = validate_clips(document.get('media', []))
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


def run(payload):
    conn, args = payload['server_connection'], payload.get('args', {})
    store = Store(Path(conn['Dir']) / 'marker-compilations')
    cache = Path(conn['PluginDir']) / 'cache'
    action = args.get('action')
    if action == 'list':
        return store.list()
    if action == 'save':
        return store.save(args['document'])
    if action == 'delete':
        return store.delete(args['id'], args['revision'])
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
            resolved.append(dict(clip, streams=scene['sceneStreams'], cached=cached))
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
                    temporary.unlink(missing_ok=True)
                    sys.stderr.write('Clip generation cancelled or timed out')
                    return 1
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--ffmpeg-worker':
        sys.exit(ffmpeg_worker())
    try:
        print(json.dumps({'output': run(json.load(sys.stdin))}))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
