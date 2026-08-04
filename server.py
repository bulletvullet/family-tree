#!/usr/bin/env python3
"""Семейное древо — локальный сервер с SQLite.

Отдаёт статику сайта и API:
  GET  /api/people  — список всех людей
  POST /api/people  — атомарно заменить весь список (тело: JSON-массив)

Запуск:  python3 server.py
Сайт:    http://localhost:8791/
БД:      data/family.db (SQLite)
"""

import json
import os
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'data', 'family.db')
PORT = 8791


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
        maiden_name TEXT NOT NULL DEFAULT ''
    )''')
    # миграции для баз, созданных до появления новых колонок
    cols = [r[1] for r in con.execute('PRAGMA table_info(people)')]
    if 'focus' not in cols:
        con.execute('ALTER TABLE people ADD COLUMN focus INTEGER NOT NULL DEFAULT 0')
    if 'gender' not in cols:
        con.execute("ALTER TABLE people ADD COLUMN gender TEXT NOT NULL DEFAULT ''")
    if 'maiden_name' not in cols:
        con.execute("ALTER TABLE people ADD COLUMN maiden_name TEXT NOT NULL DEFAULT ''")
    return con


def row_to_person(r):
    return {
        'id': r[0], 'lastName': r[1], 'firstName': r[2], 'middleName': r[3],
        'birthDate': r[4], 'deathDate': r[5], 'parents': json.loads(r[6]),
        'focus': bool(r[7]), 'gender': r[8], 'maidenName': r[9],
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
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def _cors(self):
        # чтобы API работало и при открытии сайта через Apache / file://
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
        if self.path == '/api/people':
            con = db()
            try:
                rows = con.execute(
                    'SELECT id, last_name, first_name, middle_name,'
                    ' birth_date, death_date, parents, focus, gender, maiden_name FROM people'
                ).fetchall()
            finally:
                con.close()
            self._json(200, [row_to_person(r) for r in rows])
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != '/api/people':
            self._json(404, {'error': 'not found'})
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            data = json.loads(self.rfile.read(n) or b'[]')
            if not isinstance(data, list):
                raise ValueError('expected a JSON list')
            people = [p for p in data if isinstance(p, dict) and p.get('id')]
            con = db()
            try:
                with con:  # одна транзакция: либо всё, либо ничего
                    con.execute('DELETE FROM people')
                    con.executemany(
                        'INSERT INTO people VALUES (?,?,?,?,?,?,?,?,?,?)',
                        [person_to_row(p) for p in people],
                    )
            finally:
                con.close()
            self._json(200, {'ok': True, 'count': len(people)})
        except Exception as e:
            self._json(400, {'error': str(e)})


if __name__ == '__main__':
    db().close()
    print(f'Семейное древо: http://localhost:{PORT}/')
    print(f'База данных:    {DB_PATH}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
