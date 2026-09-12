#!/usr/bin/env python3
"""Exercise real Nginx headers in an isolated, unpublished web container."""
import os
import subprocess
import time
import unittest
import uuid

class WebHeadersTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = 'importacao-header-test-' + uuid.uuid4().hex[:10]
        subprocess.run(['docker','run','-d','--network','none','--name',cls.container,
                        '-e','CERT_API_KEY=synthetic-test-key',
                        os.environ.get('WEB_TEST_IMAGE','importacao-web:ci')],
                       check=True,capture_output=True,text=True)
        cls.addClassCleanup(subprocess.run,['docker','rm','-f',cls.container],
                            check=True,capture_output=True)
        for _ in range(120):
            result=cls.request('/', 'localhost')
            if result.returncode==0:
                break
            time.sleep(.5)
        else:
            raise RuntimeError('Isolated web server did not become ready')
        subprocess.run(['docker','exec',cls.container,'nginx','-t'],
                       check=True,capture_output=True,text=True)

    @classmethod
    def request(cls,path,host):
        return subprocess.run(['docker','exec',cls.container,'curl','-sS','--max-time','5',
                               '-D','-','-o','/dev/null','-H','Host: '+host,
                               'http://127.0.0.1'+path],capture_output=True,text=True,timeout=10)

    def test_production_html_has_scoped_short_hsts_and_existing_headers(self):
        r=self.request('/','importacao.grupounico.com')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('200 OK',r.stdout)
        self.assertIn('Strict-Transport-Security: max-age=300',r.stdout)
        self.assertIn('X-Content-Type-Options: nosniff',r.stdout)
        self.assertIn('Content-Security-Policy:',r.stdout)
        self.assertNotIn('includeSubDomains',r.stdout)
        self.assertNotIn('preload',r.stdout)

    def test_error_responses_keep_the_policy(self):
        r=self.request('/assets/missing-r7.js','importacao.grupounico.com')
        self.assertIn('404 Not Found',r.stdout)
        self.assertIn('Strict-Transport-Security: max-age=300',r.stdout)

    def test_localhost_and_other_domains_do_not_receive_hsts(self):
        for host in ['localhost','other.grupounico.com']:
            with self.subTest(host=host):
                r=self.request('/',host)
                self.assertIn('200 OK',r.stdout)
                self.assertNotIn('Strict-Transport-Security:',r.stdout)

if __name__ == '__main__':
    unittest.main()
