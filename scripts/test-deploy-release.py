#!/usr/bin/env python3
"""Exercise release ordering and recovery using synthetic git/SSH, never a server."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('deploy.sh').resolve()

class ReleaseTests(unittest.TestCase):
    def run_release(self, fail='', expected_linx=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'scripts').mkdir()
            (root / 'scripts/deploy.sh').write_bytes(SCRIPT.read_bytes())
            (root / 'scripts/backup-db.sh').write_text('#!/bin/sh\necho backup >> "$TRACE"\n')
            binary = root / 'bin'
            binary.mkdir()
            stubs = {
                'git': '''#!/bin/sh
case "$*" in
  'rev-parse --abbrev-ref HEAD') echo master;;
  'rev-parse HEAD'|'rev-parse origin/master') echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
esac
''',
                'rsync': '#!/bin/sh\necho local-rsync >> "$TRACE"\n',
                'docker': '''#!/usr/bin/env python3
import json,os,sys
fail=os.environ.get('FAIL_POINT','')
if fail=='linx-compose':
    print('SYNTHETIC_PRIVATE_CONFIG',file=sys.stderr)
    sys.exit(1)
if fail=='linx-json':
    print('SYNTHETIC_PRIVATE_CONFIG invalid json')
    sys.exit(0)
environment={'LINX_WRITE_ENABLED': 'true' if fail=='linx-enabled' else 'false',
             'DATABASE_URL':'SYNTHETIC_PRIVATE_CONFIG'}
if fail=='linx-missing': environment.pop('LINX_WRITE_ENABLED')
print(json.dumps({'services':{'cert-api':{'environment':environment}}}))
''',
                'ssh': '''#!/usr/bin/env python3
import os,sys,subprocess,shlex
from pathlib import Path
cmd=' '.join(sys.argv[1:])
with open(os.environ['TRACE'],'a') as f: f.write(cmd+'\\n')
fail=os.environ.get('FAIL_POINT','')
state=Path(os.environ['TRACE']+'.restored')
if 'rsync -a --delete' in cmd: state.touch()
if "awk -F=" in cmd: print('false')
if "python3 - 'docker-compose.prod.yml'" in cmd:
    args=shlex.split(cmd.split('python3 ',1)[1])
    sys.exit(subprocess.run(['python3',*args],input=sys.stdin.read(),text=True).returncode)
if fail=='snapshot' and 'cp -al' in cmd: sys.exit(1)
if fail=='ssh-inspection' and 'test -d ' in cmd: sys.exit(255)
if fail=='build' and ' build api web cert-api' in cmd: sys.exit(1)
if fail=='migration' and 'release_migrations --apply' in cmd: sys.exit(1)
if not state.exists():
    if fail=='cert-health' and '/api/ready' in cmd: sys.exit(1)
    if fail=='proxy-health' and '8085/api/health' in cmd: sys.exit(1)
    if fail=='restart' and ' up -d --no-deps api web cert-api' in cmd: sys.exit(1)
''',
            }
            for name, content in stubs.items():
                p = binary / name
                p.write_text(content)
                p.chmod(0o700)
            env = dict(os.environ, PATH=str(binary)+os.pathsep+os.environ['PATH'],
                       TRACE=str(root/'trace'), FAIL_POINT=fail, HEALTH_RETRIES='1', HEALTH_INTERVAL='0',
                       GOOGLE_CHAT_WEBHOOK_URL='', PUBLIC_WEB_HEALTH_ENDPOINT='', SKIP_BACKUP='0')
            env.pop('EXPECTED_LINX_WRITE_ENABLED', None)
            if expected_linx is not None:
                env['EXPECTED_LINX_WRITE_ENABLED'] = expected_linx
            result = subprocess.run(['bash','scripts/deploy.sh'], input='y\n', text=True,
                                    capture_output=True, cwd=root, env=env, timeout=20)
            return result, (root/'trace').read_text()

    def test_success_builds_then_migrates_then_restarts_and_retains_snapshot(self):
        result, trace = self.run_release()
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertLess(trace.index('backup'), trace.index('local-rsync'))
        self.assertLess(trace.index(' build api web cert-api'), trace.index('apply-pending-migrations.sh'))
        self.assertLess(trace.index('release_migrations --apply'), trace.index(' up -d --no-deps api web cert-api'))
        self.assertLess(trace.index('generate-env-from-vault.sh --sops'), trace.index("python3 - 'docker-compose.prod.yml'"))
        self.assertLess(trace.index("python3 - 'docker-compose.prod.yml'"), trace.index('apply-pending-migrations.sh'))
        self.assertIn('Effective Linx write flag matches', result.stdout)
        self.assertNotIn('SYNTHETIC_PRIVATE_CONFIG', result.stdout+result.stderr)
        self.assertIn('/api/ready', trace)
        self.assertIn('8085/api/health', trace)
        self.assertNotIn('rm -rf /home/nicolas/importacao.rollback\n', trace) # no post-success removal

    def test_missing_snapshot_aborts_before_sync(self):
        result, trace = self.run_release('snapshot')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('local-rsync', trace)

    def test_unexpected_linx_write_or_unreadable_flag_blocks_before_schema_mutations(self):
        for failure in ['linx-enabled', 'linx-json', 'linx-compose', 'linx-missing']:
            with self.subTest(failure=failure):
                result, trace = self.run_release(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Linx write verification failed', result.stdout)
                self.assertNotIn('apply-pending-migrations.sh', trace)
                self.assertNotIn('release_migrations --apply', trace)
                self.assertNotIn(' up -d', trace)
                self.assertNotIn('SYNTHETIC_PRIVATE_CONFIG', result.stdout+result.stderr)

    def test_explicit_linx_expectation_is_compared_without_changing_configuration(self):
        result, trace = self.run_release('linx-enabled', expected_linx='true')
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn("python3 - 'docker-compose.prod.yml' 'true'", trace)
        result, trace = self.run_release(expected_linx='true')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('apply-pending-migrations.sh', trace)

    def test_failed_ssh_inspection_is_not_first_deploy(self):
        result, trace = self.run_release('ssh-inspection')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('local-rsync', trace)

    def test_partial_hardlink_copy_falls_back_to_complete_root(self):
        _, trace = self.run_release()
        command = next(line.split(' ',1)[1] for line in trace.splitlines() if 'cp -al' in line)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            live = root/'live'
            live.mkdir()
            (live/'docker-compose.prod.yml').write_text('original compose')
            (live/'app').write_text('original app')
            binary = root/'bin'
            binary.mkdir()
            cp = binary/'cp'
            cp.write_text('#!/bin/sh\nif [ "$1" = "-al" ]; then mkdir -p "$3"; echo partial > "$3/partial"; exit 1; fi\nexec /bin/cp "$@"\n')
            cp.chmod(0o700)
            command = command.replace('/home/nicolas/importacao',str(live))
            result = subprocess.run(['bash','-c',command],env=dict(os.environ,PATH=str(binary)+':'+os.environ['PATH']),capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            snapshot = root/'live.rollback'
            self.assertEqual((snapshot/'app').read_text(),'original app')
            self.assertFalse((snapshot/'partial').exists())
            self.assertFalse((snapshot/'live').exists())

    def test_alert_render_preserves_hardlinked_snapshot(self):
        source = SCRIPT.read_text()
        code = source.split("<<'PY'\n",1)[1].split('\nPY\n',1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root/'infra/alertmanager/alertmanager.yml'
            target.parent.mkdir(parents=True)
            target.write_text('previous config')
            snapshot = root/'snapshot.yml'
            os.link(target,snapshot)
            (root/'.env').write_text('ALERTMANAGER_WEBHOOK_URL=http://bridge.invalid/test\n')
            (target.parent/'alertmanager.webhook.yml.template').write_text('url: ${ALERTMANAGER_WEBHOOK_URL}')
            result = subprocess.run(['python3','-c',code],cwd=root,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(snapshot.read_text(),'previous config')
            self.assertIn('bridge.invalid',target.read_text())
            self.assertNotEqual(snapshot.stat().st_ino,target.stat().st_ino)

    def test_failed_build_does_not_migrate(self):
        result, trace = self.run_release('build')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('apply-pending-migrations.sh', trace)

    def test_failed_cert_migration_does_not_restart(self):
        result, trace = self.run_release('migration')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(' up -d', trace)

    def test_each_post_restart_failure_restores_code_and_checks_all_services(self):
        for failure in ['restart','cert-health','proxy-health']:
            with self.subTest(failure=failure):
                result, trace = self.run_release(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('rsync -a --delete', trace)
                after = trace.split('rsync -a --delete',1)[1]
                self.assertIn('/api/ready',after)
                self.assertIn('8085/api/health',after)
                self.assertIn("--exclude 'uploads'",after)

if __name__ == '__main__':
    unittest.main()
