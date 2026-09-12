#!/usr/bin/env python3
"""Verify restore gates and cleanup using a synthetic Docker executable."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('restore-test.sh').resolve()

class RestoreTests(unittest.TestCase):
    def run_restore(self, failure='', db='importacao_restore_test'):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backup = root / 'backup with spaces.pgdump'
            backup.write_bytes(b'test backup')
            trace = root / 'trace'
            docker = root / 'docker'
            docker.write_text('''#!/usr/bin/env python3
import os,sys
from pathlib import Path
args=' '.join(sys.argv[1:])
with open(os.environ['TRACE'],'a') as f: f.write(args+'\\n')
fail=os.environ.get('FAIL_POINT','')
if sys.argv[1]=='ps': print('isolated-restore'); sys.exit(0)
if 'CREATE DATABASE' in args and fail=='exists': sys.exit(1)
if 'DROP DATABASE' in args and fail=='cleanup': sys.exit(1)
if 'pg_restore' in args:
    sys.stdin.buffer.read()
    if fail=='restore': sys.exit(1)
if 'information_schema.tables' in args: print('35')
if 'SELECT COUNT(*) FROM import_processes' in args: print('0' if fail=='rows' else '273')
''')
            docker.chmod(0o700)
            env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'],
                       TRACE=str(trace), FAIL_POINT=failure, BACKUP_FILE=str(backup),
                       CONTAINER_NAME='isolated-restore', TEST_DB=db)
            result = subprocess.run(['bash',str(SCRIPT)], env=env, text=True,
                                    capture_output=True, timeout=10)
            return result, trace.read_text() if trace.exists() else ''

    def test_success_and_cleanup(self):
        r,t=self.run_restore()
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertIn('--exit-on-error',t)
        self.assertEqual(t.count('DROP DATABASE'),1)
        self.assertLess(t.index('pg_restore'),t.index('DROP DATABASE'))

    def test_rejects_production_database_before_docker(self):
        r,t=self.run_restore(db='importacao')
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(t,'')

    def test_rejects_sql_injection_before_docker(self):
        r,t=self.run_restore(db='importacao_restore_test; DROP DATABASE importacao')
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(t,'')

    def test_existing_database_is_never_dropped(self):
        r,t=self.run_restore('exists')
        self.assertNotEqual(r.returncode,0)
        self.assertNotIn('DROP DATABASE',t)
        self.assertNotIn('pg_restore',t)

    def test_restore_failure_cleans_up_and_fails(self):
        r,t=self.run_restore('restore')
        self.assertNotEqual(r.returncode,0)
        self.assertIn('DROP DATABASE',t)

    def test_missing_processes_fails_and_cleans_up(self):
        r,t=self.run_restore('rows')
        self.assertNotEqual(r.returncode,0)
        self.assertIn('DROP DATABASE',t)

    def test_cleanup_failure_is_not_a_pass(self):
        r,_=self.run_restore('cleanup')
        self.assertNotEqual(r.returncode,0)
        self.assertNotIn('Restore test PASSED',r.stdout)

if __name__ == '__main__':
    unittest.main()
