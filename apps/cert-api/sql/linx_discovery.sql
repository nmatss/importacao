-- =====================================================================
-- DESCOBERTA DE SCHEMA LINX — tabelas de propriedade de produto
-- =====================================================================
-- Objetivo: cravar os nomes EXATOS de coluna de PROP_PRODUTOS / PROPRIEDADE
-- e entender como o SKU do portal mapeia para o codigo de produto do Linx.
--
-- TUDO SOMENTE LEITURA. Nao altera nada.
--
-- Rodar no SSMS conectado a CADA base e colar o resultado de cada bloco:
--   Puket:        host db01.grupounico.com  /  base DB_puket            (codigos 00224 / 00225)
--   Imaginarium:  host db02.grupounico.com  /  base Grupo_Imaginarium   (codigos 00106 / 00107)
--
-- Substitua <SKU_EXEMPLO> por um SKU real conhecido (de preferencia um que
-- voce ja sabe que tem certificado), de produto+cor+tamanho, no bloco [6].
-- =====================================================================

PRINT '===== [1] Colunas de PROP_PRODUTOS =====';
SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
       CHARACTER_MAXIMUM_LENGTH AS LEN, IS_NULLABLE
FROM   INFORMATION_SCHEMA.COLUMNS
WHERE  TABLE_NAME = 'PROP_PRODUTOS'
ORDER  BY ORDINAL_POSITION;

PRINT '===== [2] Colunas de PROPRIEDADE =====';
SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
       CHARACTER_MAXIMUM_LENGTH AS LEN, IS_NULLABLE
FROM   INFORMATION_SCHEMA.COLUMNS
WHERE  TABLE_NAME = 'PROPRIEDADE'
ORDER  BY ORDINAL_POSITION;

PRINT '===== [3] Chaves primarias dessas tabelas =====';
SELECT t.TABLE_NAME, kcu.COLUMN_NAME, kcu.ORDINAL_POSITION
FROM   INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
JOIN   INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON  t.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE  t.CONSTRAINT_TYPE = 'PRIMARY KEY'
  AND  t.TABLE_NAME IN ('PROP_PRODUTOS','PROPRIEDADE')
ORDER  BY t.TABLE_NAME, kcu.ORDINAL_POSITION;

PRINT '===== [4] Conteudo da PROPRIEDADE (catalogo de propriedades) =====';
-- Tabela pequena de referencia: confirma qual coluna guarda o codigo (00224 etc)
-- e qual guarda a descricao (VALIDADE DO CERTIFICADO / VENCIMENTO DO LICENCIAMENTO).
SELECT TOP 200 * FROM PROPRIEDADE ORDER BY 1;

PRINT '===== [5] Amostra de PROP_PRODUTOS =====';
-- Mostra a forma: qual coluna referencia o produto, qual a propriedade, qual o valor.
SELECT TOP 30 * FROM PROP_PRODUTOS ORDER BY 1;

PRINT '===== [6] Mapeamento SKU -> produto (cor/tamanho) =====';
-- Procura, em todas as tabelas, colunas candidatas a produto/sku/cor/tamanho.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM   INFORMATION_SCHEMA.COLUMNS
WHERE  ( COLUMN_NAME LIKE '%PRODUTO%'
      OR COLUMN_NAME LIKE '%SKU%'
      OR COLUMN_NAME LIKE '%REFERENC%'
      OR COLUMN_NAME LIKE '%COR%'
      OR COLUMN_NAME LIKE '%TAMANHO%'
      OR COLUMN_NAME LIKE '%GRADE%'
      OR COLUMN_NAME LIKE '%BARRA%'   -- codigo de barras / EAN costuma ser o "SKU"
      OR COLUMN_NAME LIKE '%EAN%' )
  AND TABLE_NAME LIKE '%PRODUT%'
ORDER  BY TABLE_NAME, ORDINAL_POSITION;

PRINT '===== [7] (opcional) Como um SKU real aparece nas tabelas de produto =====';
-- Troque <SKU_EXEMPLO> por um SKU real e rode para ver em qual coluna/tabela ele cai,
-- e qual e o codigo de produto "pai" correspondente que a PROP_PRODUTOS usaria.
-- Exemplo de ponto de partida (ajuste o nome da tabela de produto que aparecer em [6]):
-- SELECT TOP 20 * FROM PRODUTOS WHERE <coluna_sku> = '<SKU_EXEMPLO>'
--                                  OR <coluna_referencia> = '<SKU_EXEMPLO>';
