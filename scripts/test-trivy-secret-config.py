"""Prove the narrow template exception still detects literal credential objects."""

import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/cert-api/app/services/erp_service.py"
CONFIG = ROOT / "trivy-secret.yaml"


def scan(source: Path, config: Path, output: Path) -> set[str]:
    subprocess.run(
        [
            "trivy",
            "fs",
            "--scanners",
            "secret",
            "--secret-config",
            str(config),
            "--format",
            "json",
            "--output",
            str(output),
            str(source),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    report = json.loads(output.read_text())
    return {
        finding["RuleID"]
        for result in report.get("Results", [])
        for finding in result.get("Secrets", [])
    }


def main() -> None:
    original = SOURCE.read_text()
    with tempfile.TemporaryDirectory(prefix="importacao-trivy-") as directory:
        temp = Path(directory)
        sample = temp / "erp_service.py"
        output = temp / "result.json"
        builtin = temp / "builtin.yaml"
        builtin.write_text("{}\n")
        sample.write_text(original)
        assert "gcp-service-account" in scan(sample, builtin, output), (
            "baseline not reproduced"
        )
        assert not scan(sample, CONFIG, output), "template still flagged"
        for field in ("SHEETS_PRIVATE_KEY", "SHEETS_CLIENT_EMAIL"):
            # Deliberately invalid, synthetic values: no real secret is created or printed.
            sample.write_text(
                original.replace(f": {field},", ': "fixture-not-a-credential",')
            )
            assert "gcp-service-account" in scan(sample, CONFIG, output), (
                f"literal {field} hidden"
            )
        sample.write_text(original + '\nembedded = {"type": "service_account"}\n')
        assert "gcp-service-account" in scan(sample, CONFIG, output), (
            "adjacent object hidden"
        )
    print(
        "Trivy: template excluded; literal fields and adjacent credential objects detected"
    )


if __name__ == "__main__":
    main()
