#!/usr/bin/env python3
"""Exercise the real environment generator with synthetic SOPS output only."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("generate-env-from-vault.sh")


class GenerateEnvTest(unittest.TestCase):
    def run_generator(self, payload, status=0, existing=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "bin"
            binary.mkdir()
            sops = binary / "sops"
            sops.write_text('#!/bin/sh\ncat "$TEST_PAYLOAD"\nexit "$TEST_STATUS"\n')
            sops.chmod(0o700)
            (root / "payload").write_text(payload)
            (root / ".env.sops.yaml").write_text("synthetic fixture\n")
            original = b"PREVIOUS=preserved\n"
            if existing:
                (root / ".env").write_bytes(original)
                (root / ".env").chmod(0o640)
            env = dict(os.environ, HOME=str(root),
                       TEST_PAYLOAD=str(root / "payload"), TEST_STATUS=str(status))
            result = subprocess.run(["bash", str(SCRIPT), "--sops"], cwd=root,
                                    env=env, capture_output=True, text=True)
            target = root / ".env"
            content = target.read_bytes() if target.exists() else None
            mode = target.stat().st_mode & 0o777 if target.exists() else None
            self.assertEqual(list(root.glob(".env.tmp.*")), [])
            return result, content, mode

    def test_success_replaces_environment_with_private_permissions(self):
        result, content, mode = self.run_generator(
            'PLAIN: value\nQUOTED: "with space"\nEMPTY: null\nDOLLAR: a$b\n'
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(content, b'PLAIN=value\nQUOTED="with space"\nEMPTY=\nDOLLAR=a$$b\n')
        self.assertEqual(mode, 0o600)

    def test_decryption_failure_preserves_existing_environment(self):
        for payload in ["", "PARTIAL: invalid\n"]:
            with self.subTest(payload=payload):
                result, content, mode = self.run_generator(payload, status=7)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Done.", result.stdout)
                self.assertEqual(content, b"PREVIOUS=preserved\n")
                self.assertEqual(mode, 0o640)

    def test_empty_configuration_is_not_published(self):
        result, content, _ = self.run_generator("# no configuration\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(content, b"PREVIOUS=preserved\n")

    def test_failed_first_run_does_not_create_environment(self):
        result, content, _ = self.run_generator("PARTIAL: invalid\n", status=7, existing=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(content)


if __name__ == "__main__":
    unittest.main()
