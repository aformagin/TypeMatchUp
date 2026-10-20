"""Validate the mandatory bundled SQLite catalog without changing it."""
import json
from pathlib import Path
import sqlite3
import sys

root = Path(__file__).resolve().parents[1]
expected_revision = sys.argv[1] if len(sys.argv) > 1 else json.loads(
    (root / 'src/data/SOURCE.json').read_text(encoding='utf-8-sig'))['revision']


def require(condition, message):
    if not condition:
        raise SystemExit('Catalog validation failed: ' + message)


with sqlite3.connect((root / 'src/data/encounters.sqlite').as_uri() + '?mode=ro', uri=True) as catalog:
    require(catalog.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SQLite integrity check')
    metadata = dict(catalog.execute('SELECT key, value FROM catalog_meta'))
    require(metadata.get('revision') == expected_revision, 'catalog revision differs from the pinned source')
    require(metadata.get('schema_version') == '1', 'unsupported catalog schema')
    counts = {table: catalog.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
              for table in ('games', 'areas', 'encounters')}
    require(all(counts.values()), 'catalog tables must not be empty')
    require(catalog.execute('SELECT COUNT(*) FROM encounters WHERE chance < 0 OR chance > 100').fetchone()[0] == 0,
            'encounter rates must be 0 to 100 percent, or NULL')
    require(catalog.execute('SELECT COUNT(*) FROM encounters WHERE min_level < 1 OR max_level < min_level').fetchone()[0] == 0,
            'invalid encounter level range')
    require(catalog.execute('''SELECT COUNT(*) FROM encounters e
        LEFT JOIN games g ON g.id = e.game_id LEFT JOIN areas a ON a.id = e.area_id
        WHERE g.id IS NULL OR a.id IS NULL''').fetchone()[0] == 0, 'orphaned encounter references')

for filename in ('SOURCE.json', 'POKEAPI-LICENSE.txt'):
    file = root / 'src/data' / filename
    require(file.is_file() and file.stat().st_size > 0, 'missing ' + filename)
require(json.loads((root / 'src/data/SOURCE.json').read_text(encoding='utf-8-sig'))['revision'] == expected_revision,
        'SOURCE.json revision differs from requested revision')
print('Catalog validation passed: ' + json.dumps({'revision': expected_revision, **counts}))
