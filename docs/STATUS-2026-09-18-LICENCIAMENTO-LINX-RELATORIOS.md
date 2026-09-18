# Licenciamento Linx nos relatórios — 18/09/2026

## Contrato

Consulta de vencimento do licenciamento, SKU e descrição, a partir das propriedades
Linx 00107 (Imaginarium) e 00225 (Puket). O portal apenas lê essas propriedades;
`LINX_WRITE_ENABLED=false` permanece no deploy. A propriedade de certificação
continua representando fim de vendas, sem troca por validade do certificado.

Preservar as 29 colunas, sua ordem, os dados originais e a separação entre
certificação, licenciamento e data de validação. A faixa de licenciamento é
inclusiva; a data de hoje ainda é válida. Sentinelas anteriores a 2000 e ausência
não são vencimentos. Atalho de 30 dias usa hoje até hoje + 29, inclusive, no calendário de São Paulo.

## Implementação

- Listagem e exportação compartilham filtros SQL e status derivados. Parâmetros
  `license_start_date` / `license_end_date` aceitam ISO YYYY-MM-DD, rejeitam data
  inválida e faixa invertida; filtros são aplicados antes da paginação.
- Produtos permite filtrar e exportar o conjunto completo selecionado. Dashboard
  e Relatórios oferecem acesso aos licenciamentos vencidos/próximos do vencimento.
- Excel mantém o contrato de colunas e identifica leitura mais antiga do conjunto
  e produtos sem timestamp; geração do arquivo não comprova nova leitura da fonte.
- Duplicidade/item inesperado na propriedade de licença ou valor ilegível
  preserva o snapshot da marca e sinaliza falha. Produto ausente preserva seus
  dados e timestamp; produto encontrado sem data pode limpar ausência legítima.
- Não há migration nem nova dependência. Autorizações de exportação são mantidas.

## Evidências da fonte (somente leitura)

Base publicada 8bb9fda, 674 produtos (397 Puket, 277 Imaginarium), todos com nome.
Leitura no SQL Server comparada ao snapshot: 60 datas reais, nenhuma divergência;
30 vencidas e 30 válidas. Nenhum vencimento nos próximos 30 ou 90 dias na data da
consulta. Propriedades de licenciamento sem duplicidades/item inesperado.
A leitura candidata, executada sem aplicar sync, reproduziu esses resultados.
Os números descrevem esta consulta, não uma garantia sobre alterações futuras.

## Validação e publicação

Validações locais: 1.215 testes Python passaram (4 integrações opt-in ignoradas
na suíte padrão); PostgreSQL real de filtros e SQL Server real de leitura/escrita
passaram separadamente. API: 2.087 testes passaram, 5 ignorados; web: 435 passaram.
Lint e formatação passaram. Build e typecheck passaram após corrigir o uso de
`exact` em dois testes e instalar dependências completas da worktree com `npm ci`.
Navegador desktop/mobile: filtros e download conferidos com dados sintéticos;
troca de status e navegação voltar/avançar corrigidas sem atualização durante
renderização. Testes em StrictMode e nova passagem de navegador sem esse aviso.

CI/publicação em execução. O estado canônico, evidências e próximo passo estão na sessão
Dotcontext `8b14cb7f-1584-4fbc-9441-c936beeb9cef`. Deploy depende de testes locais,
revisão integrada e CI aprovados para a revisão exata. Push, integração e deploy
foram autorizados pelo usuário. Nenhuma ativação de escrita Linx está incluída.
