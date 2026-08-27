# Fechamento de pendências — produção

Data operacional: 2026-08-26/27 (America/Sao_Paulo)

Release implantado: `72d19a4e4c5e`

## Resultado executivo

O código, o deploy, a leitura e o envio de e-mail, a linhagem documental, a
validação dos 117 processos, a revisão responsiva e a leitura de certificados no
Linx foram executados com evidência. O sistema está operacional, mas **os dados
dos 117 processos não estão 100% aprovados**: faltam fontes originais para 105
processos, há 40 documentos abaixo de 90% de confiança, 39 checks automáticos
falhos e todos os processos continuam exigindo aceite humano.

Essa distinção é intencional: disponibilidade técnica, extração terminal,
confiança do modelo e acurácia contra o documento original são métricas
diferentes.

## Produção, backup e deploy

- Acesso oficial pelo alias SSH `n8n` foi restabelecido e usado sem revelar a
  chave privada.
- Backup `importacao_2026-08-26_230005.pgdump` passou em `pg_restore --list` e
  em restauração real num banco temporário: 40 tabelas e 117 processos; o banco
  temporário foi removido ao final.
- O deploy final criou ainda o backup
  `importacao_2026-08-26_234126.pgdump`, arquivos dos volumes e snapshot de
  rollback antes do rsync.
- `scripts/deploy.sh` aprovou SOPS, Compose, migrations `0011–0025`, build,
  API, web, Cert-API, proxy e observabilidade.
- `REVISION` e os containers confirmaram o SHA `72d19a4e4c5e`; API, web,
  Cert-API, PostgreSQL e Redis ficaram saudáveis.

## Documentos e replay

### Fatos finais

- 117 processos no mestre; 12 com documentos e 105 `master_only` sem arquivo
  no portal.
- 51/51 documentos processados, zero lease ativa e zero documento cujo último
  run seja `failed`.
- O backfill append-only criou 22 runs históricos e zerou documentos sem
  evidência terminal não-reconciliation.
- Três `other` inequívocos foram reclassificados como invoice.
- Restaram 13 `other`: quatro ambíguos e nove documentos de apoio/ilegíveis sem
  tipo suportado. A evidência foi preservada sem nome ou conteúdo do arquivo.
- O replay controlado processou 23 documentos nesta sessão ampla: 21 chegaram a
  terminal `completed`; dois packing lists (`39` e `147`) falharam por timeout
  do Vertex e foram restaurados transacionalmente a partir do snapshot saudável.
- O documento `38` subiu para 94,83%; o total abaixo de 90% caiu de 41 para 40.
- Cinco packing lists ainda não foram retentados após a repetição da assinatura
  de timeout (`122`, `123`, `132`, `142`, `145`). Nova tentativa exige corrigir
  chunking/timeout ou mudar a estratégia do provedor, não repetir o mesmo lote.
- A janela de replay desabilitou Drive, Chat e espelho automático, adiou efeitos
  derivados e foi restaurada ao Compose normal antes da reconciliação.
- A reconciliação final varreu 117 processos e alterou três documentos por
  regras determinísticas.
- Custo observado: US$ 0,163591 no dia e US$ 0,926817 no mês; uma chamada falha
  no recorte do dia.

### Decisão sobre `process_items`

`process_items=0` não é uma perda automática de dados. Conforme ADR 0006, os
itens do documento vigente, com sua linhagem, são a fonte canônica;
`process_items` é projeção editável opcional. Não houve materialização cega,
pois ela misturaria versões e inventaria proveniência.

## Validação campo a campo

O CLI corrigido foi executado sem `--limit`, provando que o default `Infinity`
funciona. Depois do replay e da reconciliação, os 117 processos foram avaliados
novamente em modo `partial`, sem transição de workflow, Drive ou notificação:

| Estado de evidência              | Processos |
| -------------------------------- | --------: |
| `master_only_no_document_source` |       105 |
| `document_set_incomplete`        |         5 |
| `automated_checks_failed`        |         6 |
| `manual_classification_required` |         1 |

Resultado dos 3.393 checks finais:

- 101 aprovados;
- 39 falhos;
- 1.607 avisos;
- 1.646 pulados por ausência de fonte aplicável;
- zero falha de requisição e zero documento sem linhagem;
- 117/117 com `humanApprovalRequired=true`; zero aprovação automática.

As 39 falhas se concentram em: valor de invoice vs. Follow Up (5), exportador
(4), peso líquido (4), endereço de fornecedor (4), item (4), caixas (3), peso
bruto (3), referência do processo (2), condições de pagamento (3), portos (2),
fabricante (2), e ocorrências unitárias de moeda, unidade e razão de peso.

Campos estruturalmente ausentes no mestre/fontes atuais incluem `shipmentDate`,
`totalBoxes`, `totalNetWeight` e `totalGrossWeight` em 117 processos, além de
`importerName` em 116. Não é seguro inventar esses valores.

## Gmail, SMTP e demais integrações

- Gmail API leu 350 mensagens permitidas e 346 anexos desde 01/05/2025.
- O novo operador encontrou 12 anexos com SHA-256 único e código de processo
  consistente; dry-run e execução coincidiram e 12/12 vínculos foram inseridos.
- Dez hashes idênticos foram bloqueados por conflito de processo; 324 anexos não
  têm arquivo correspondente no portal. Não houve colisão, órfão ou duplicidade
  por processo/hash.
- O auditor original confirmou 12 matches exatos, 334 exceções, 23 processos
  reconhecidos por e-mail e apenas um processo totalmente reconciliado.
- SMTP passou em `verify()` e em envio real para a caixa operacional oficial:
  um destinatário aceito, zero rejeitado/pendente. A busca Gmail encontrou uma
  mensagem com o assunto único, comprovando entrega e leitura de volta.
- IMAP continua falhando na autenticação; Gmail é a leitura operacional ativa.
- Drive root continua inacessível; é não obrigatório para o fluxo atual, mas a
  cópia externa não está pronta.
- Chat está configurado e foi validado sem publicar mensagem. O canal histórico
  de alertas continua pendente de rotação/teste específico.
- Odoo continua bloqueado por resolução DNS. SYDLE estava habilitado e passou
  nas execuções recentes já registradas.

## Certificados e Linx

- `cert_products`: 674 produtos e 674 números de certificado preenchidos.
- Leitura real pós-deploy, sem escrita:

| Marca           | Produtos | Validade efetiva | Licenciamento efetivo | Indisponível |
| --------------- | -------: | ---------------: | --------------------: | -----------: |
| Imaginarium     |      277 |              263 |                    44 |            0 |
| Puket           |      230 |              178 |                     8 |            0 |
| Puket Escolares |      167 |                3 |                     7 |            0 |

- Smokes autenticados confirmaram `00106/00107` em Imaginarium e
  `00224/00225` em Puket.
- `cert_certificates=0` continua significando ausência de cadastros pelo
  formulário, não ausência de dados no ERP.
- As lacunas de Puket Escolares dependem de decisão fiscal. Nenhuma data foi
  preenchida por inferência e nenhuma escrita Linx foi feita.

## UX, UI e responsividade

- Formatter, lint, typecheck, build e audit de dependências passaram.
- API: 991 testes passaram e um foi pulado; web: 140 testes passaram.
- Playwright: 82/82 cenários passaram em Chromium desktop e mobile, cobrindo
  rotas do portal, Importação, Certificações, redirects, overflow horizontal e
  os fluxos simulados de comunicação/SMTP.
- A matriz é evidência de renderização e contrato no ambiente de teste; os
  smokes produtivos acima são a evidência separada das integrações reais.

## Segurança

- `npm audit --audit-level=high`: zero vulnerabilidades.
- O backfill Gmail é dry-run por padrão, exige allowlist, aceita somente hash
  único, bloqueia conflito de processo, usa lock transacional e índices de
  idempotência, e registra apenas contagens no relatório operacional.
- Evidências produtivas ficaram em diretório privado no host com arquivos
  `0600`; conteúdo e nomes de anexos não foram copiados para o Git.
- Risco ALTO permanece nas contas pessoais usadas pelo Linx; migrar para contas
  de serviço de menor privilégio.

## n8n/Quality

O acesso do projeto Quality foi usado somente para contexto e preflight, sem
copiar credenciais. O n8n self-hosted retornou `53 OK`, `4 WARN`, `0 FAIL`.
Avisos: 33 usuários sem MFA nativo, um webhook registrado, firewall de egress
sem confirmação por falta de sudo e backup offsite cifrado desligado. Essas
credenciais não devem ser reaproveitadas automaticamente no portal Importação.

## Evidências privadas no host

Diretório: `/home/nicolas/backups/importacao/evidence/2026-08-26/` (`0700`).

Arquivos relevantes (`0600`):

- `process-completeness-post-replay.jsonl`;
- `reprocess-remaining.jsonl`;
- `other-triage-final.json`;
- `gmail-lineage-dry-run.json`;
- `gmail-lineage-execute.json`;
- `gmail-reconciliation-post-backfill.json`.

## Pendências que não podem ser fechadas automaticamente

1. Obter os documentos originais dos 105 processos `master_only` ou aceite
   formal de que o mestre é a única fonte disponível.
2. Revisar manualmente os quatro `other` ambíguos e os nove documentos de
   apoio/ilegíveis.
3. Conferir os 40 documentos abaixo de 90% contra os originais; cinco packing
   lists precisam de uma correção de estratégia antes de novo replay.
4. Resolver as 39 divergências finais e aprovar/rejeitar cada uma com nota e
   responsável de negócio.
5. Corrigir credencial IMAP, permissão/ID do Drive, DNS do Odoo e o canal de
   alerta; Gmail e SMTP já estão operacionais.
6. O fiscal deve decidir as lacunas de Puket Escolares; TI deve substituir as
   contas pessoais do Linx.
7. Reconciliar manualmente os 334 anexos Gmail sem alvo quando houver regra ou
   arquivo de destino confiável.

Até essas fontes e aprovações existirem, qualquer declaração de “100% das
informações” seria falsa.
