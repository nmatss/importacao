"""Read model shared by products, reports and validation.

The original Sheets snapshot is never overwritten by certificate registration.
The CTE exposes exactly the existing cert_products columns; no migration or
spreadsheet/UI column change is needed. Removing a link immediately restores
the source snapshot. A different certificate/brand is an explicit conflict.
"""

CADASTRO_SNAPSHOT = "__cadastro_snapshot__"
CADASTRO_CONFLICT = "PENDENTE_CADASTRO"

# All values interpolated here are source-code constants. Request values remain
# bound parameters of the SELECT appended by execute_product_query.
EFFECTIVE_PRODUCTS_CTE = r"""
WITH cadastro_links AS (
    SELECT i.sku, c.brand, c.numero_certificado, c.validade_certificado,
           c.orgao_certificador, c.ocp, c.created_at, c.updated_at,
           CASE WHEN i.situacao = 'ATIVO' AND c.situacao = 'ENCERRADO' THEN 'PENDENTE'
                ELSE COALESCE(i.situacao, c.situacao) END AS situacao,
           COALESCE(i.fim_venda, c.fim_venda) AS fim_venda
    FROM cert_certificate_items i
    JOIN cert_certificates c ON c.id = i.certificate_id
    WHERE i.removed_at IS NULL
    UNION ALL
    SELECT c.sku, c.brand, c.numero_certificado, c.validade_certificado,
           c.orgao_certificador, c.ocp, c.created_at, c.updated_at,
           c.situacao, c.fim_venda
    FROM cert_certificates c
    WHERE NULLIF(TRIM(c.sku), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cert_certificate_items h WHERE h.certificate_id = c.id)
), cadastro_counts AS (
    SELECT *, COUNT(sku) FILTER (WHERE situacao = 'ATIVO') OVER (PARTITION BY sku) AS active_count
    FROM cadastro_links
), cadastro_candidates AS (
    SELECT * FROM cadastro_counts WHERE active_count = 0 OR situacao = 'ATIVO'
), cadastro AS (
    SELECT sku, COUNT(sku) AS candidates,
           MIN(brand) AS brand, MIN(numero_certificado) AS numero_certificado,
           MIN(validade_certificado) AS validade_certificado,
           MIN(situacao) AS situacao, MIN(fim_venda) AS fim_venda,
           MIN(orgao_certificador) AS orgao_certificador, MIN(ocp) AS ocp,
           MIN(created_at) AS created_at, MAX(updated_at) AS updated_at,
           STRING_AGG(DISTINCT COALESCE(NULLIF(numero_certificado, ''), 'sem número'), ', ') AS numbers
    FROM cadastro_candidates GROUP BY sku
), product_sources AS (
    SELECT p AS original, c.*,
           c.sku IS NOT NULL AND (
               c.candidates <> 1 OR NULLIF(TRIM(c.numero_certificado), '') IS NULL
               OR c.situacao NOT IN ('ATIVO', 'ENCERRADO') OR c.situacao IS NULL
               OR (c.situacao = 'ATIVO' AND (
                   c.fim_venda IS NOT NULL
                   OR UPPER(TRIM(p.situacao)) = 'ENCERRADO'
                   OR (NULLIF(TRIM(p.encerramento_numero_certificado), '') IS NOT NULL
                       AND REGEXP_REPLACE(UPPER(p.encerramento_numero_certificado), '\s+', '', 'g')
                           = REGEXP_REPLACE(UPPER(c.numero_certificado), '\s+', '', 'g'))
               ))
               OR (NULLIF(TRIM(p.numero_certificado), '') IS NOT NULL
                   AND REGEXP_REPLACE(UPPER(p.numero_certificado), '\s+', '', 'g')
                       <> REGEXP_REPLACE(UPPER(c.numero_certificado), '\s+', '', 'g'))
               OR (NULLIF(TRIM(p.brand), '') IS NOT NULL
                   AND REPLACE(REPLACE(LOWER(p.brand), '_', ' '), ' escolares', '')
                       <> REPLACE(REPLACE(LOWER(c.brand), '_', ' '), ' escolares', ''))
           ) AS conflict
    FROM public.cert_products p FULL JOIN cadastro c ON c.sku = p.sku
    WHERE c.sku IS NOT NULL OR p.sheet_status IS DISTINCT FROM '__cadastro_snapshot__'
), cert_products AS (
    SELECT (jsonb_populate_record(NULL::public.cert_products,
        COALESCE(to_jsonb(original), jsonb_build_object(
            'sku', sku, 'name', '', 'brand', brand, 'certification_type', '',
            'created_at', created_at, 'updated_at', updated_at
        )) || CASE
            WHEN sku IS NULL THEN '{}'::jsonb
            WHEN conflict THEN jsonb_build_object(
                'situacao', 'PENDENTE_CADASTRO',
                'sheet_status', 'Conflito de vínculo: planilha [' || COALESCE((original).numero_certificado, 'sem número')
                    || ']; cadastro [' || numbers || ']. Confirmar certificado e marca vigentes.'
            )
            ELSE jsonb_build_object(
                'numero_certificado', numero_certificado,
                'situacao', situacao, 'sheet_status', 'Cadastro validado: ' || situacao,
                'validade_certificado', validade_certificado,
                'validade_certificado_raw', validade_certificado::text,
                'sale_deadline_date', CASE WHEN situacao = 'ENCERRADO' THEN fim_venda END,
                'sale_deadline', CASE WHEN situacao = 'ENCERRADO' THEN fim_venda::text END,
                'encerramento_status', CASE WHEN situacao = 'ENCERRADO' THEN 'Encerrado' END,
                'encerramento_numero_certificado', CASE WHEN situacao = 'ENCERRADO' THEN numero_certificado END,
                'is_expired', COALESCE(validade_certificado < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date, false),
                'certification_type', CONCAT_WS(' ', NULLIF(orgao_certificador, ''), numero_certificado),
                'expected_cert_text', CONCAT_WS(' ', NULLIF(orgao_certificador, ''), numero_certificado),
                'updated_at', GREATEST(updated_at, (original).updated_at)
            ) END
    )).* FROM product_sources
)
"""


def execute_product_query(cur, query: str, params=None):
    """Execute an existing product SELECT against the shared effective read model."""
    if not query.lstrip().upper().startswith("SELECT"):
        raise ValueError("Effective products supports SELECT only")
    return cur.execute(EFFECTIVE_PRODUCTS_CTE + query, params)
