"""Oracle WMS connection helpers."""

from app.config import (
    WMS_ORACLE_HOST,
    WMS_ORACLE_PASS,
    WMS_ORACLE_PORT,
    WMS_ORACLE_SID,
    WMS_ORACLE_USER,
)

_oracle_initialized = False


def _init_oracle_client() -> None:
    """Initialize Oracle Instant Client (thick mode). Safe to call multiple times."""
    global _oracle_initialized
    if _oracle_initialized:
        return
    import oracledb

    try:
        oracledb.init_oracle_client(lib_dir="/opt/oracle/instantclient_23_7")
    except Exception:
        pass  # Already initialized or not required
    _oracle_initialized = True


def fetch_wms_stock() -> list[dict]:
    """Fetch stock data from WMS Biguacu via Oracle thick mode.

    Returns:
        List of dicts with keys: CD_PRODUTO, DS_PRODUTO, AREA, SITUACAO,
        ESTOQUE, RESERVA, TRANSITO, DISPONIVEL.

    Raises:
        Exception: On connection or query failure.
    """
    import oracledb

    _init_oracle_client()

    dsn = oracledb.makedsn(WMS_ORACLE_HOST, WMS_ORACLE_PORT, sid=WMS_ORACLE_SID)
    with oracledb.connect(user=WMS_ORACLE_USER, password=WMS_ORACLE_PASS, dsn=dsn) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT te.CD_PRODUTO, tcp.DS_PRODUTO,
                tta.DS_AREA_ARMAZ AS Area,
                ts.DS_SITUACAO AS Situacao,
                SUM(te.QT_ESTOQUE) AS Estoque,
                SUM(te.QT_RESERVA_SAIDA) AS Reserva,
                SUM(te.QT_TRANSITO_ENTRADA) AS Transito,
                SUM(te.QT_TRANSITO_ENTRADA + te.QT_ESTOQUE - te.QT_RESERVA_SAIDA) AS Disponivel
            FROM T_ESTOQUE te
            JOIN T_CAB_PRODUTO tcp ON te.CD_PRODUTO = tcp.CD_PRODUTO
            JOIN T_ENDERECO_ESTOQUE tee ON te.CD_ENDERECO = tee.CD_ENDERECO
            JOIN T_SITUACAO ts ON ts.CD_SITUACAO = tee.CD_SITUACAO
            JOIN T_TIPO_AREA tta ON tta.CD_AREA_ARMAZ = tee.CD_AREA_ARMAZ
            GROUP BY te.CD_PRODUTO, tcp.DS_PRODUTO, tta.DS_AREA_ARMAZ, ts.DS_SITUACAO
        """)
        columns = [col[0] for col in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
