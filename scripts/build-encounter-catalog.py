"""Build the offline encounter catalog from a pinned PokéAPI CSV revision.
Run: python scripts/build-encounter-catalog.py [commit SHA]
Only this maintenance script uses the network; the app browses SQLite offline.
"""
import csv
import io
import json
import sqlite3
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
revision = sys.argv[1] if len(sys.argv) > 1 else json.load(urllib.request.urlopen(
    'https://api.github.com/repos/PokeAPI/pokeapi/commits/master'))['sha']
base = f'https://raw.githubusercontent.com/PokeAPI/pokeapi/{revision}/'

def rows(name):
    data = urllib.request.urlopen(base + 'data/v2/csv/' + name + '.csv', timeout=60).read()
    return list(csv.DictReader(io.StringIO(data.decode('utf-8-sig'))))

def names(name, key):
    return {r[key]: r['name'] for r in rows(name) if r['local_language_id'] == '9' and r['name']}

groups = {r['id']: r for r in rows('version_groups')}
version_names = names('version_names', 'version_id')
locations = names('location_names', 'location_id')
area_names = names('location_area_prose', 'location_area_id')
areas = {r['id']: r for r in rows('location_areas')}
methods = names('encounter_method_prose', 'encounter_method_id')
method_ids = {r['id']: r['identifier'] for r in rows('encounter_methods')}
condition_names = names('encounter_condition_value_prose', 'encounter_condition_value_id')
conditions = {r['id']: condition_names.get(r['id'], r['identifier'].replace('-', ' '))
              for r in rows('encounter_condition_values')}
condition_map = defaultdict(list)
for r in rows('encounter_condition_value_map'):
    condition_map[r['encounter_id']].append(r['encounter_condition_value_id'])
slots = {r['id']: r for r in rows('encounter_slots')}
pokemon = {r['id']: r['identifier'] for r in rows('pokemon')}
# Preserve individual slots: summing special encounters or alternative conditions
# can produce false percentages above 100%.
encounters = []
for r in rows('encounters'):
    slot = slots[r['encounter_slot_id']]
    condition = '; '.join(conditions[c] for c in sorted(condition_map[r['id']], key=int))
    encounters.append((int(r['version_id']), int(r['location_area_id']), pokemon[r['pokemon_id']],
        methods.get(slot['encounter_method_id'], method_ids[slot['encounter_method_id']]), condition,
        int(r['min_level']), int(r['max_level']), int(slot['rarity']) if slot['rarity'] else None))

output = ROOT / 'src/data/encounters.sqlite'
# Build a new file first so a failed download/build preserves the previous catalog.
staging = output.with_suffix('.building')
if staging.exists():
    staging.unlink()
conn = sqlite3.connect(staging)
conn.executescript('''
CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, label TEXT NOT NULL, generation INTEGER);
CREATE TABLE areas (id INTEGER PRIMARY KEY, location_id INTEGER NOT NULL, location_name TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE encounters (game_id INTEGER NOT NULL, area_id INTEGER NOT NULL, pokemon TEXT NOT NULL,
  method TEXT NOT NULL, conditions TEXT NOT NULL, min_level INTEGER NOT NULL, max_level INTEGER NOT NULL, chance INTEGER);
CREATE INDEX encounters_game_area ON encounters(game_id, area_id);
''')
conn.executemany('INSERT INTO games VALUES (?,?,?,?)', [
    (int(v['id']), v['identifier'], version_names.get(v['id'], v['identifier'].title()),
     int(groups[v['version_group_id']]['generation_id'])) for v in rows('versions')])
if not conn.execute("SELECT 1 FROM games WHERE name = 'champions'").fetchone():
    conn.execute('INSERT INTO games VALUES (?,?,?,?)', (100000, 'champions', 'Champions', None))
used_areas = {entry[1] for entry in encounters}
conn.executemany('INSERT INTO areas VALUES (?,?,?,?)', [
    (int(aid), int(areas[str(aid)]['location_id']),
     locations.get(areas[str(aid)]['location_id'], 'Unknown location'),
     area_names.get(str(aid), areas[str(aid)]['identifier'].replace('-', ' ').title() or 'Main area'))
    for aid in sorted(used_areas)])
conn.executemany('INSERT INTO encounters VALUES (?,?,?,?,?,?,?,?)', encounters)
conn.executemany('INSERT INTO catalog_meta VALUES (?,?)', [
    ('source', 'https://github.com/PokeAPI/pokeapi'), ('revision', revision),
    ('built_at', datetime.now(timezone.utc).isoformat()), ('schema_version', '1')])
conn.commit()
assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print(json.dumps({'revision': revision, 'games': conn.execute('SELECT COUNT(*) FROM games').fetchone()[0],
                  'encounter_rows': len(encounters), 'areas': len(used_areas),
                  'games_with_encounters': conn.execute('SELECT COUNT(DISTINCT game_id) FROM encounters').fetchone()[0]}))
conn.close()
staging.replace(output)
(ROOT / 'src/data/POKEAPI-LICENSE.txt').write_bytes(urllib.request.urlopen(base + 'LICENSE.md').read())
(ROOT / 'src/data/SOURCE.json').write_text(json.dumps({'repository': 'https://github.com/PokeAPI/pokeapi',
    'revision': revision, 'rebuild': 'python scripts/build-encounter-catalog.py ' + revision}, indent=2) + '\n')
