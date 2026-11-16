#!/usr/bin/env python3
"""Family tree: local server backed by one JSON file.

Serves the static site and the API:
  GET  /api/tree    whole tree: {"schema": n, "people": [...], "marriages": [...]}
  POST /api/tree    replace the whole tree (same shape)
  POST /api/import  the same, but always back up the current tree first
  GET  /api/people  just the people, kept for the public page export

Run:       python3 server.py
Site:      http://localhost:8791/
Data:      data/family.json, the same shape as GET /api/tree
Backups:   data/backups/, next to the data file

Both are overridable, so a throwaway instance never shares state with the
real one:
  FAMILY_TREE_PORT=8799 FAMILY_TREE_DATA=.test-data/family.json python3 server.py
"""

import json
import os
import pathlib
import shutil
import sqlite3
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Bump when the API gains or changes a field the page relies on. The page
# refuses to trust an older server, because a server running old code accepts
# a request happily and drops every field it does not recognise, losing data
# with no error anywhere.
SCHEMA = 2

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.abspath(
    os.environ.get('FAMILY_TREE_DATA') or os.path.join(ROOT, 'data', 'family.json')
)
BACKUP_DIR = os.path.join(os.path.dirname(DATA_PATH), 'backups')
# A save backs up the current file first when the newest backup is older than this.
BACKUP_EVERY = 24 * 60 * 60
# The SQLite file the JSON store replaced. Read once, if the JSON file does not exist yet.
LEGACY_DB = os.path.join(os.path.dirname(DATA_PATH), 'family.db')
PORT = int(os.environ.get('FAMILY_TREE_PORT') or 8791)

# One writer at a time: the server is threaded and a save is backup plus write.
WRITE_LOCK = threading.Lock()


class DataFileError(Exception):
    """The data file exists but cannot be read. The server never overwrites it."""


def text(obj, key):
    value = obj.get(key)
    return '' if value is None else str(value)


def clean_person(p):
    parents = p.get('parents')
    return {
        'id': text(p, 'id'),
        'lastName': text(p, 'lastName'),
        'maidenName': text(p, 'maidenName'),
        'firstName': text(p, 'firstName'),
        'middleName': text(p, 'middleName'),
        'birthDate': text(p, 'birthDate'),
        'deathDate': text(p, 'deathDate'),
        # dead with no known date; a deathDate says so on its own
        'deceased': bool(p.get('deceased')),
        'gender': text(p, 'gender'),
        'focus': bool(p.get('focus')),
        'parents': [str(x) for x in parents] if isinstance(parents, list) else [],
        'birthPlace': text(p, 'birthPlace'),
        'notes': text(p, 'notes'),
    }


# A marriage is one entry for the unordered pair {a, b}. A person may appear
# in several, which is how remarriage is represented. Children are not listed
# here: a child already names its two parents, and that pair says which
# marriage it belongs to.
def clean_marriage(m):
    status = text(m, 'status')
    return {
        'id': text(m, 'id'),
        'a': text(m, 'a'),
        'b': text(m, 'b'),
        'status': status if status in ('married', 'divorced') else 'married',
        'date': text(m, 'date'),
        'place': text(m, 'place'),
        'endDate': text(m, 'endDate'),
    }


def clean_tree(data):
    if not isinstance(data, dict):
        raise ValueError('expected a JSON object with people and marriages')
    people = [clean_person(p) for p in data.get('people') or [] if isinstance(p, dict) and p.get('id')]
    ids = {p['id'] for p in people}
    # Drop marriages naming someone who is gone, so a deleted person cannot
    # leave a dangling spouse behind.
    marriages = [
        clean_marriage(m) for m in data.get('marriages') or []
        if isinstance(m, dict) and m.get('id')
        and m.get('a') in ids and m.get('b') in ids and m.get('a') != m.get('b')
    ]
    return {'schema': SCHEMA, 'people': people, 'marriages': marriages}


def read_tree():
    try:
        with open(DATA_PATH, encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        return clean_tree({})
    except ValueError as e:
        raise DataFileError(f'{DATA_PATH} is not valid JSON ({e}). Fix it or move it away.') from e
    try:
        return clean_tree(data)
    except ValueError as e:
        raise DataFileError(f'{DATA_PATH}: {e}') from e


def write_tree(tree):
    # Write a temporary file next to the real one and rename it over, so a
    # crash mid-write leaves the old file whole instead of half a new one.
    folder = os.path.dirname(DATA_PATH)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix='.family-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(tree, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, DATA_PATH)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def backup(reason):
    """Copy the data file into BACKUP_DIR. Returns the new path, or None with no file yet."""
    if not os.path.exists(DATA_PATH):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stem = os.path.join(BACKUP_DIR, f'family-{time.strftime("%Y%m%d-%H%M%S")}-{reason}')
    path, n = f'{stem}.json', 1
    # Two imports in one second must not overwrite each other's backup.
    # Callers hold WRITE_LOCK, so nothing else claims the name in between.
    while os.path.exists(path):
        n += 1
        path = f'{stem}-{n}.json'
    # copyfile, not copy2: the backup's mtime must be the time of the backup,
    # because backup_due() reads it.
    shutil.copyfile(DATA_PATH, path)
    return path


def backup_due():
    try:
        times = [e.stat().st_mtime for e in os.scandir(BACKUP_DIR) if e.name.endswith('.json')]
    except FileNotFoundError:
        return True
    return not times or time.time() - max(times) > BACKUP_EVERY


def store(data, imported):
    """Replace the tree. Returns the stored tree and the backup made, if any."""
    tree = clean_tree(data)
    with WRITE_LOCK:
        read_tree()  # raises DataFileError rather than overwrite a file it cannot read
        made = None
        if imported:
            made = backup('import')
        elif backup_due():
            made = backup('auto')
        write_tree(tree)
    return tree, made


# Column names of the old SQLite tables, mapped to the JSON field names.
PERSON_COLUMNS = {
    'id': 'id', 'last_name': 'lastName', 'first_name': 'firstName',
    'middle_name': 'middleName', 'birth_date': 'birthDate', 'death_date': 'deathDate',
    'parents': 'parents', 'focus': 'focus', 'gender': 'gender',
    'maiden_name': 'maidenName', 'birth_place': 'birthPlace', 'notes': 'notes',
}
MARRIAGE_COLUMNS = {
    'id': 'id', 'a': 'a', 'b': 'b', 'status': 'status',
    'start_date': 'date', 'place': 'place', 'end_date': 'endDate',
}


def import_sqlite(path):
    """Read the tree from the old SQLite file. Opened read-only, never changed."""
    con = sqlite3.connect(pathlib.Path(path).as_uri() + '?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        # Older files lack the newer columns, so map whatever each row has.
        people = []
        if 'people' in tables:
            for row in con.execute('SELECT * FROM people'):
                p = {PERSON_COLUMNS[k]: row[k] for k in row.keys() if k in PERSON_COLUMNS}
                p['parents'] = json.loads(p.get('parents') or '[]')
                people.append(p)
        marriages = []
        if 'marriages' in tables:
            for row in con.execute('SELECT * FROM marriages'):
                marriages.append({MARRIAGE_COLUMNS[k]: row[k] for k in row.keys() if k in MARRIAGE_COLUMNS})
    finally:
        con.close()
    return clean_tree({'people': people, 'marriages': marriages})


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def send_cors(self):
        # lets the API work when the site is opened through Apache or file://
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ('/api/tree', '/api/people'):
            try:
                tree = read_tree()
            except DataFileError as e:
                self.send_json(500, {'error': str(e)})
                return
            self.send_json(200, tree if self.path == '/api/tree' else tree['people'])
        else:
            super().do_GET()

    def do_POST(self):
        if self.path not in ('/api/tree', '/api/import'):
            self.send_json(404, {'error': 'not found'})
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            data = json.loads(self.rfile.read(n) or b'{}')
            tree, made = store(data, imported=self.path == '/api/import')
        except DataFileError as e:
            self.send_json(409, {'error': str(e)})
            return
        except ValueError as e:
            self.send_json(400, {'error': str(e)})
            return
        self.send_json(200, {
            'ok': True,
            'people': len(tree['people']),
            'marriages': len(tree['marriages']),
            'backup': os.path.relpath(made, ROOT) if made else None,
        })


if __name__ == '__main__':
    # The variable used to name the SQLite file. Ignoring it would quietly
    # serve the real data to a test meant to run on a throwaway copy.
    if os.environ.get('FAMILY_TREE_DB'):
        raise SystemExit(
            'FAMILY_TREE_DB is set, but the tree now lives in a JSON file.\n'
            'Use FAMILY_TREE_DATA instead, for example:\n'
            '  FAMILY_TREE_PORT=8799 FAMILY_TREE_DATA=.test-data/family.json python3 server.py'
        )
    # Bind first: a refused start must not create or touch any data.
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as e:
        # Someone else already holds the port. Starting is impossible, and
        # staying quiet would leave that other server answering requests
        # meant for this one, against different data.
        raise SystemExit(
            f'Port {PORT} is already in use, refusing to start.\n'
            f'Another family tree server is probably running and it owns\n'
            f'different data. Stop it, or pick another port:\n'
            f'  FAMILY_TREE_PORT=8799 FAMILY_TREE_DATA=.test-data/family.json python3 server.py'
        ) from e
    if not os.path.exists(DATA_PATH) and os.path.exists(LEGACY_DB):
        tree = import_sqlite(LEGACY_DB)
        write_tree(tree)
        print(f'Imported {len(tree["people"])} people and {len(tree["marriages"])} marriages')
        print(f'from {LEGACY_DB}. That file is no longer used.')
    try:
        read_tree()  # fail at start, not on the first request, if the file is broken
    except DataFileError as e:
        raise SystemExit(str(e)) from e
    print(f'Family tree: http://localhost:{PORT}/')
    print(f'Data:        {DATA_PATH}')
    server.serve_forever()
