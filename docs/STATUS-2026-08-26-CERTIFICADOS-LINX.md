# Status 2026-08-26 — Certificados e propriedades Linx

## Objetivo

Confirmar se o módulo de Certificações está preenchido, se lê as propriedades de
certificado dos Linx Puket e Imaginarium e corrigir as lacunas encontradas sem fazer
gravações de diagnóstico no ERP.

## Fatos observados

- Produção estava saudável: Cert-API `healthy`, PostgreSQL conectado e Google Sheets
  configurado.
- `LINX_WRITE_ENABLED=true`; host, banco, usuário e senha estão configurados nas duas
  conexões de marca. Nenhum valor sensível foi impresso.
- Os códigos confirmados são:

  | Marca                   | Validade do certificado | Vencimento do licenciamento |
  | ----------------------- | ----------------------: | --------------------------: |
  | Imaginarium             |                 `00106` |                     `00107` |
  | Puket / Puket Escolares |                 `00224` |                     `00225` |

- `cert_products` tinha 674 produtos e número de certificado preenchido em 674/674:

  | Marca           | Produtos | Nº certificado | Tipo preenchido |
  | --------------- | -------: | -------------: | --------------: |
  | Imaginarium     |      277 |            277 |             277 |
  | Puket           |      230 |            230 |             122 |
  | Puket Escolares |      167 |            167 |             167 |

- Consulta read-only direta a `PROP_PRODUTOS`:

  | Marca           | Validade efetiva | Licenciamento efetivo |
  | --------------- | ---------------: | --------------------: |
  | Imaginarium     |          263/277 |                44/277 |
  | Puket           |          178/230 |                 8/230 |
  | Puket Escolares |            3/167 |                 7/167 |

- Não foi encontrado texto inválido nas quatro propriedades. Valores ausentes e a
  sentinela `01/01/1900` foram classificados como “sem data efetiva”.
- `cert_certificates` tinha zero registro. Isso não significa ausência de propriedade:
  essa tabela audita somente cadastros feitos pelo formulário; o Linx é a fonte real da
  trava de faturamento.
- O relatório Excel já consultava o Linx em lote. O cadastro e a página de detalhe não
  faziam a consulta nem mostravam as propriedades.

## Inferências

- A integração de leitura funciona nas duas bases, com confiança alta porque as
  consultas reais retornaram dados agregados de Puket e Imaginarium.
- A baixa quantidade de licenciamento e de validade em Puket Escolares é um estado de
  dados, não prova de defeito técnico. Não é seguro preencher automaticamente sem regra
  fiscal.
- A tabela vazia do formulário explica a lista “Certificados recentes” vazia, mas não
  invalida os dados existentes no ERP.

## Alterações

- Nova rota autenticada `GET /api/certificates/linx-lookup`, read-only e limitada por
  taxa, que usa a mesma resolução SKU→produto e o mesmo mapa da escrita.
- Cadastro ganhou “Buscar no Linx”; preenche somente campos vazios com validade,
  licenciamento e número do certificado da planilha.
- Detalhe do produto ganhou card responsivo distinguindo fonte Planilha e fonte Linx.
- Respostas atrasadas de lookup são descartadas quando marca/SKU mudam, evitando
  pré-preenchimento cruzado durante edição rápida.
- Datas são exibidas em pt-BR sem conversão de timezone; inputs continuam ISO.
- Marca passou a ser resolvida por correspondência exata normalizada, não substring.
- Multipart ganhou limites de texto e validação ISO de datas antes do PostgreSQL.
- Erros do driver SQL Server foram redigidos em respostas e logs.

## Segurança

- **MÉDIO — corrigido:** exceções internas podiam chegar a `linx_error` e revelar
  detalhes de conexão.
- **MÉDIO — corrigido:** marca contendo `puket` como substring podia escolher a base
  Puket.
- **BAIXO — corrigido:** data inválida chegava ao cast do PostgreSQL e campos de texto
  não tinham limites explícitos.
- **ALTO — aberto:** as conexões ERP ainda usam contas pessoais; migrar para contas de
  serviço com menor privilégio.
- O lookup permanece atrás do JWT/gate de papéis do Node, da API key interna do Nginx,
  de rate limit e de queries parametrizadas.

## Decisões

- Não copiar em massa os dados Linx para `cert_certificates`: duplicaria fonte de
  verdade e criaria histórico falso.
- Não executar cadastro, retry ou sync de prazo durante a auditoria.
- Não tratar `01/01/1900` como certificado vencido.
- Não preencher lacunas de Puket Escolares sem validação do time fiscal.

## Validação

- Probes de produção: containers/health, flags de configuração apenas como booleanos,
  agregados PostgreSQL e leitura das propriedades Linx.
- Gate completo antes do fechamento: Prettier, ESLint, typecheck API/web, 981 testes
  Node API + 1 skip, 139 testes web, build de produção, 523 testes Python e Ruff.
- Testes direcionados adicionais cobriram o lookup, sentinela, marca exata, redação de
  falhas, autorização, formatação sem timezone e descarte de resposta obsoleta.
- Playwright CLI pós-build em 1440×900 e 390×844: cadastro Puket e detalhe
  Imaginarium renderizaram as propriedades corretas, sem overflow horizontal e sem
  erros de console. Evidências locais ignoradas pelo Git em `output/playwright/`.
- `python3 -m pip_audit -r apps/cert-api/requirements.txt` não encontrou
  vulnerabilidades conhecidas. `npm audit --omit=dev` manteve duas moderadas
  preexistentes do React Router 6; a correção disponível exige migração major já
  registrada em `docs/TECH_DEBT.md`.
- `docker compose config --quiet` e `git diff --check` passaram.

## Riscos e próximos passos

1. Validar com o fiscal se os 164 produtos Puket Escolares sem validade efetiva e os
   baixos preenchimentos de licenciamento são esperados.
2. Migrar credenciais pessoais do ERP para contas de serviço.
3. No pós-deploy, repetir health/smoke read-only do endpoint com amostras Puket e
   Imaginarium; não acionar cadastro/retry/sync.
