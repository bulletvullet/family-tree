#!/usr/bin/env python3
"""Family tree: local server backed by SQLite.

Serves the static site and the API:
  GET  /api/tree    whole tree: {"schema": n, "people": [...], "marriages": [...]}
  POST /api/tree    atomically replace both lists (same shape)
  GET  /api/people  just the people, kept for the public page export

Run:       python3 server.py
Site:      http://localhost:8791/
Database:  data/family.db (SQLite)

Both are overridable, so a throwaway instance never shares state with the
real one:
  FAMILY_TREE_PORT=8799 FAMILY_TREE_DB=.test-data/family.db python3 server.py
"""

import json
import os
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Bump when the API gains or changes a field the page relies on. The page
# refuses to trust an older server, because a server running old code accepts
# a request happily and drops every field it does not recognise, losing data
# with no error anywhere.
SCHEMA = 1

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.abspath(os.environ.get('FAMILY_TREE_DB') or os.path.join(ROOT, 'data', 'family.db'))
PORT = int(os.environ.get('FAMILY_TREE_PORT') or 8791)


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute('''CREATE TABLE IF NOT EXISTS people (
        id          TEXT PRIMARY KEY,
        last_name   TEXT NOT NULL DEFAULT '',
        first_name  TEXT NOT NULL DEFAULT '',
        middle_name TEXT NOT NULL DEFAULT '',
        birth_date  TEXT NOT NULL DEFAULT '',
        death_date  TEXT NOT NULL DEFAULT '',
        parents     TEXT NOT NULL DEFAULT '[]',
        focus       INTEGER NOT NULL DEFAULT 0,
        gender      TEXT NOT NULL DEFAULT '',
        maiden_name TEXT NOT NULL DEFAULT '',
        birth_place TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT ''
    )''')
    # migrations for databases created before the newer columns existed
    cols = [r[1] for r in con.execute('PRAGMA table_info(people)')]
    if 'focus' not in cols:
        con.execute('ALTER TABLE people ADD COLUMN focus INTEGER NOT NULL DEFAULT 0')
    if 'gender' not in cols:
        con.execute("ALTER TABLE people ADD COLUMN gender TEXT NOT NULL DEFAULT ''")
    if 'maiden_name' not in cols:
        con.execute("ALTER TABLE people ADD COLUMN maiden_name TEXT NOT NULL DEFAULT ''")
    if 'birth_place' not in cols:
        con.execute("ALTER TABLE people ADD COLUMN birth_place TEXT NOT NULL DEFAULT ''")
    if 'notes' not in cols:
        con.execute("ALTER TABLE people ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
    # A marriage is one row for the unordered pair {a, b}. A person may appear
    # in several, which is how remarriage is represented. Children are not
    # listed here: a child already names its two parents, and that pair says
    # which marriage it belongs to.
    con.execute('''CREATE TABLE IF NOT EXISTS marriages (
        id         TEXT PRIMARY KEY,
        a          TEXT NOT NULL,
        b          TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'married',
        start_date TEXT NOT NULL DEFAULT '',
        place      TEXT NOT NULL DEFAULT '',
        end_date   TEXT NOT NULL DEFAULT ''
    )''')
    mcols = [r[1] for r in con.execute('PRAGMA table_info(marriages)')]
    for name in ('start_date', 'place', 'end_date'):
        if name not in mcols:
            con.execute(f"ALTER TABLE marriages ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
    return con


def row_to_marriage(r):
    return {
        'id': r[0], 'a': r[1], 'b': r[2], 'status': r[3],
        'date': r[4], 'place': r[5], 'endDate': r[6],
    }


def marriage_to_row(m):
    status = str(m.get('status') or 'married')
    if status not in ('married', 'divorced'):
        status = 'married'
    return (
        str(m.get('id', '')), str(m.get('a', '')), str(m.get('b', '')), status,
        str(m.get('date', '')), str(m.get('place', '')), str(m.get('endDate', '')),
    )


def read_tree(con):
    people = con.execute(
        'SELECT id, last_name, first_name, middle_name,'
        ' birth_date, death_date, parents, focus, gender, maiden_name,'
        ' birth_place, notes FROM people'
    ).fetchall()
    marriages = con.execute(
        'SELECT id, a, b, status, start_date, place, end_date FROM marriages'
    ).fetchall()
    return {
        'schema': SCHEMA,
        'people': [row_to_person(r) for r in people],
        'marriages': [row_to_marriage(r) for r in marriages],
    }


def row_to_person(r):
    return {
        'id': r[0], 'lastName': r[1], 'firstName': r[2], 'middleName': r[3],
        'birthDate': r[4], 'deathDate': r[5], 'parents': json.loads(r[6]),
        'focus': bool(r[7]), 'gender': r[8], 'maidenName': r[9],
        'birthPlace': r[10], 'notes': r[11],
    }


def person_to_row(p):
    return (
        str(p.get('id', '')),
        str(p.get('lastName', '')),
        str(p.get('firstName', '')),
        str(p.get('middleName', '')),
        str(p.get('birthDate', '')),
        str(p.get('deathDate', '')),
        json.dumps(p.get('parents', []), ensure_ascii=False),
        1 if p.get('focus') else 0,
        str(p.get('gender', '')),
        str(p.get('maidenName', '')),
        str(p.get('birthPlace', '')),
        str(p.get('notes', '')),
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def _cors(self):
        # lets the API work when the site is opened through Apache or file://
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ('/api/tree', '/api/people'):
            con = db()
            try:
                tree = read_tree(con)
            finally:
                con.close()
            self._json(200, tree if self.path == '/api/tree' else tree['people'])
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != '/api/tree':
            self._json(404, {'error': 'not found'})
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            data = json.loads(self.rfile.read(n) or b'{}')
            if not isinstance(data, dict):
                raise ValueError('expected a JSON object with people and marriages')
            people = [p for p in data.get('people', []) if isinstance(p, dict) and p.get('id')]
            ids = {p['id'] for p in people}
            # Drop marriages naming someone who is gone, so a deleted person
            # cannot leave a dangling spouse behind.
            marriages = [
                m for m in data.get('marriages', [])
                if isinstance(m, dict) and m.get('id')
                and m.get('a') in ids and m.get('b') in ids and m.get('a') != m.get('b')
            ]
            con = db()
            try:
                with con:  # one transaction: all or nothing
                    con.execute('DELETE FROM people')
                    con.executemany(
                        'INSERT INTO people VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                        [person_to_row(p) for p in people],
                    )
                    con.execute('DELETE FROM marriages')
                    con.executemany(
                        'INSERT INTO marriages VALUES (?,?,?,?,?,?,?)',
                        [marriage_to_row(m) for m in marriages],
                    )
            finally:
                con.close()
            self._json(200, {'ok': True, 'people': len(people), 'marriages': len(marriages)})
        except Exception as e:
            self._json(400, {'error': str(e)})


if __name__ == '__main__':
    # Bind first: a refused start must not create or touch any database.
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as e:
        # Someone else already holds the port. Starting is impossible, and
        # staying quiet would leave that other server answering requests
        # meant for this one, against a different database.
        raise SystemExit(
            f'Port {PORT} is already in use, refusing to start.\n'
            f'Another family tree server is probably running and it owns a\n'
            f'different database. Stop it, or pick another port:\n'
            f'  FAMILY_TREE_PORT=8799 FAMILY_TREE_DB=.test-data/family.db python3 server.py'
        ) from e
    db().close()
    print(f'Family tree: http://localhost:{PORT}/')
    print(f'Database:    {DB_PATH}')
    server.serve_forever()
