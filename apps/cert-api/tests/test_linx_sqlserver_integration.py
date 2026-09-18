"""Opt-in Linx writer verification against an owned, disposable SQL Server.

CERT_RUN_SQLSERVER_TESTS=1 requires Docker, real pymssql and the cached image
mcr.microsoft.com/mssql/server:2022-latest. No production configuration is used.
The worker is a subprocess because conftest intentionally stubs pymssql.
"""

import json
import os
import secrets
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("CERT_RUN_SQLSERVER_TESTS") != "1",
    reason="Opt-in: CERT_RUN_SQLSERVER_TESTS=1 and cached SQL Server Docker image required",
)


def _docker(*args, env=None):
    result = subprocess.run(["docker", *args], env=env, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        # Do not expose container configuration, environment or diagnostic logs.
        pytest.fail("Owned SQL Server container operation failed", pytrace=False)
    return result.stdout.strip()


@pytest.fixture
def isolated_sqlserver(tmp_path):
    container_id = None
    password = "Synthetic-A9!" + secrets.token_urlsafe(24)
    docker_env = dict(os.environ, MSSQL_SA_PASSWORD=password)
    try:
        container_id = _docker(
            "run",
            "--detach",
            "--rm",
            "--pull=never",
            "--name",
            f"cert-linx-test-{uuid.uuid4().hex}",
            "--publish",
            "127.0.0.1::1433",
            "--env",
            "ACCEPT_EULA=Y",
            "--env",
            "MSSQL_PID=Developer",
            "--env",
            "MSSQL_SA_PASSWORD",
            "mcr.microsoft.com/mssql/server:2022-latest",
            env=docker_env,
        )
        binding = _docker("port", container_id, "1433/tcp")
        if not binding.startswith("127.0.0.1:") or "\n" in binding:
            pytest.fail("Owned SQL Server must bind exclusively to loopback", pytrace=False)
        yield {"port": int(binding.rsplit(":", 1)[1]), "password": password, "directory": str(tmp_path)}
    finally:
        if container_id is not None:
            _docker("rm", "--force", container_id)


_WORKER = r'''
import json
import logging
import os
import sys
import time

stage = "input"
try:
    config = json.load(sys.stdin)
    import pymssql
    import dotenv

    # Avoid loading repository .env, including any remote credentials.
    dotenv.load_dotenv = lambda *args, **kwargs: False
    os.environ["REPORTS_DIR"] = config["directory"]
    os.environ["CERTS_DIR"] = config["directory"]
    logging.disable(logging.CRITICAL)

    host = "127.0.0.1:" + str(config["port"])
    password = config["password"]

    def connect():
        return pymssql.connect(host, "sa", password, "master", timeout=10, login_timeout=2)

    stage = "server readiness"
    deadline = time.monotonic() + 90
    while True:
        try:
            connection = connect()
            connection.close()
            break
        except pymssql.OperationalError:
            if time.monotonic() >= deadline:
                raise RuntimeError("readiness timeout") from None
            time.sleep(0.5)

    from app.db import sqlserver
    from app.services import linx_service

    brand = {
        "host": host, "db": "master", "user": "sa", "password": password,
        "prop_validade_certificado": "00224", "prop_vencimento_licenciamento": "00225",
    }
    sqlserver.LINX_BRANDS.clear()
    sqlserver.LINX_BRANDS["puket"] = brand
    sqlserver.LINX_SCHEMA.clear()
    sqlserver.LINX_SCHEMA.update({
        "prop_table": "PROP_PRODUTOS", "prop_col_produto": "PRODUTO",
        "prop_col_propriedade": "PROPRIEDADE", "prop_col_valor": "VALOR_PROPRIEDADE",
        "prop_col_item": "ITEM_PROPRIEDADE", "prop_item_value": "1",
        "produto_table": "PRODUTOS", "produto_col_codigo": "PRODUTO",
        "sku_is_produto": "true", "date_format": "%d/%m/%Y",
    })
    linx_service.LINX_WRITE_ENABLED = True

    def execute(sql, params=()):
        with connect() as connection:
            cursor = connection.cursor()
            cursor.execute(sql, params)
            connection.commit()

    def query(sql, params=()):
        with connect() as connection:
            cursor = connection.cursor()
            cursor.execute(sql, params)
            return cursor.fetchall()

    stage = "synthetic schema"
    execute("CREATE TABLE PRODUTOS (PRODUTO VARCHAR(30) NOT NULL PRIMARY KEY)")
    execute("""CREATE TABLE PROP_PRODUTOS (
        PROPRIEDADE VARCHAR(5) NOT NULL, PRODUTO VARCHAR(30) NOT NULL,
        ITEM_PROPRIEDADE SMALLINT NOT NULL, VALOR_PROPRIEDADE VARCHAR(100) NULL,
        PRIMARY KEY (PROPRIEDADE, PRODUTO, ITEM_PROPRIEDADE),
        FOREIGN KEY (PRODUTO) REFERENCES PRODUTOS(PRODUTO))""")
    execute("CREATE TABLE WRITE_AUDIT (ID INT IDENTITY PRIMARY KEY)")
    for sku in ("SYNTHETIC", "DUPLICATE", "WRONG-ITEM", "TRIGGER"):
        execute("INSERT INTO PRODUTOS VALUES (%s)", (sku,))
    execute("INSERT INTO PROP_PRODUTOS VALUES ('00225', 'SYNTHETIC', 1, '31/12/2035')")
    execute("""CREATE TRIGGER TRACK_PROPERTY_WRITE ON PROP_PRODUTOS AFTER INSERT, UPDATE AS
        BEGIN SET NOCOUNT ON; INSERT INTO WRITE_AUDIT DEFAULT VALUES; END""")

    def write(deadline):
        return linx_service.write_certificate_to_linx(
            "puket", "SYNTHETIC", "2040-01-01", "2041-01-01",
            fim_venda=deadline, situacao="Encerrado",
        )

    stage = "INSERT with full primary key"
    result = write("2030-01-01")
    assert result["status"] == "applied"
    assert result["details"][0]["action"] == "inserted"
    assert query("SELECT ITEM_PROPRIEDADE, VALOR_PROPRIEDADE FROM PROP_PRODUTOS WHERE PROPRIEDADE='00224'") == [(1, "01/01/2030")]

    stage = "UPDATE certification only"
    result = write("2031-02-03")
    assert result["status"] == "applied"
    assert result["details"][0]["action"] == "updated"
    assert query("SELECT ITEM_PROPRIEDADE, VALOR_PROPRIEDADE FROM PROP_PRODUTOS WHERE PROPRIEDADE='00224'") == [(1, "03/02/2031")]
    assert query("SELECT VALOR_PROPRIEDADE FROM PROP_PRODUTOS WHERE PROPRIEDADE='00225'") == [("31/12/2035",)]

    stage = "unchanged does not fire trigger"
    audit_before = query("SELECT COUNT(*) FROM WRITE_AUDIT")
    result = write("2031-02-03")
    assert result["details"][0]["action"] == "unchanged"
    assert query("SELECT COUNT(*) FROM WRITE_AUDIT") == audit_before

    stage = "duplicate and unexpected item abort before write"
    for sku, items in (("DUPLICATE", (1, 2)), ("WRONG-ITEM", (2,))):
        for item in items:
            execute("INSERT INTO PROP_PRODUTOS VALUES ('00224', %s, %s, 'UNCHANGED')", (sku, item))
        rows_before = query("SELECT * FROM PROP_PRODUTOS WHERE PRODUTO=%s ORDER BY ITEM_PROPRIEDADE", (sku,))
        audit_before = query("SELECT COUNT(*) FROM WRITE_AUDIT")
        try:
            sqlserver.upsert_produto_propriedade("puket", sku, "00224", "04/02/2031")
        except sqlserver.LinxPropertyCardinalityError:
            pass
        else:
            raise AssertionError("unexpected cardinality accepted")
        assert query("SELECT * FROM PROP_PRODUTOS WHERE PRODUTO=%s ORDER BY ITEM_PROPRIEDADE", (sku,)) == rows_before
        assert query("SELECT COUNT(*) FROM WRITE_AUDIT") == audit_before

    stage = "trigger changes committed value and requires reconciliation"
    execute("""CREATE TRIGGER CHANGE_FINAL_VALUE ON PROP_PRODUTOS AFTER INSERT, UPDATE AS
        BEGIN
            SET NOCOUNT ON;
            IF TRIGGER_NESTLEVEL() > 1 RETURN;
            UPDATE p SET VALOR_PROPRIEDADE='TRIGGER-ALTERED'
            FROM PROP_PRODUTOS p INNER JOIN inserted i
              ON p.PRODUTO=i.PRODUTO AND p.PROPRIEDADE=i.PROPRIEDADE
              AND p.ITEM_PROPRIEDADE=i.ITEM_PROPRIEDADE
            WHERE p.PRODUTO='TRIGGER';
        END""")
    try:
        sqlserver.upsert_produto_propriedade("puket", "TRIGGER", "00224", "04/02/2031")
    except sqlserver.LinxReconciliationRequiredError:
        pass
    else:
        raise AssertionError("trigger divergence accepted")
    # The commit happened: no false claim of rollback after read-back mismatch.
    assert query("SELECT VALOR_PROPRIEDADE FROM PROP_PRODUTOS WHERE PRODUTO='TRIGGER'") == [("TRIGGER-ALTERED",)]
    assert query("SELECT VALOR_PROPRIEDADE FROM PROP_PRODUTOS WHERE PROPRIEDADE='00225'") == [("31/12/2035",)]
    print("SQLSERVER_REAL_OK")
except Exception as exc:
    # Never print exception text, connection objects, credentials or server logs.
    print("SQLSERVER_REAL_FAILURE: " + stage + " (" + type(exc).__name__ + ")")
    sys.exit(1)
'''


def test_real_sqlserver_writer_reconciliation_and_cardinality(isolated_sqlserver):
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LD_LIBRARY_PATH") if key in os.environ}
    result = subprocess.run(
        [sys.executable, "-c", _WORKER],
        input=json.dumps(isolated_sqlserver),
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=150,
        check=False,
    )
    if result.returncode or result.stdout.strip() != "SQLSERVER_REAL_OK":
        # Worker emits only a controlled phase and error class. Ignore stderr.
        phase = next(
            (line for line in result.stdout.splitlines() if line.startswith("SQLSERVER_REAL_FAILURE:")),
            "SQL Server subprocess did not complete verification",
        )
        pytest.fail(phase, pytrace=False)
