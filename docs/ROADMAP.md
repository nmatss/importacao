# Roadmap

## 2026-09-12 — Cronograma e critérios de liberação

Cronograma autorizado atualizado no Sheets, com janelas propostas 14/09–23/10/2026.
[Estado técnico e dependências](STATUS-2026-09-12-RETOMADA-REUNIAO.md). Marcos semanais
continuam sob Nicolas + áreas, sem automação recorrente ou envio ao grupo. Prioridade seguinte:
resolver N/vínculo vigente, homologar extração/Registro e preparar conciliação antes de deploy/carga.

Plano mestre operacional e técnico: `docs/PLANO-MESTRE-SISTEMA-2026-07-10.md`.

Ultima atualizacao: 2026-08-29

## P0 - Operacao E Confiabilidade

- Concluir o rollout Drive-only: Follow Up já está cadastrado e legível; falta
  compartilhar a pasta operacional de 2026 com a conta de serviço, cadastrar a
  raiz no SOPS e exigir `health/integrations` + smoke sem avisos antes de trocar
  o override temporário `DOCUMENT_SOURCE=email` para `drive`.
  **ATENCAO — dois bloqueadores de codigo descobertos em 2026-08-29 que nao
  estavam registrados** (detalhe em
  `docs/STATUS-2026-08-29-AUDITORIA-E-CORRECAO-INTEGRAL.md`, P-14):
  1. `supportsAllDrives` faltava no download de conteudo e em sete escritas do
     Drive. Como a pasta esta em Shared Drive, a virada faria o sweep LISTAR os
     arquivos e falhar 100% dos downloads com 404 — e como o modo Drive-only
     tambem desliga a ingestao por e-mail e bloqueia o upload manual, o
     resultado seria nenhuma via de entrada documental funcional, com o sweep
     aparentemente saudavel. CORRIGIDO no codigo e coberto por guarda estatica;
     falta comprovar com um download real da pasta operacional.
  2. O re-upload do documento sobrescrevia `driveFileId` com o id da copia,
     quebrando a chave de deduplicacao da ingestao — o mesmo arquivo seria
     reimportado a cada dez minutos, com uma copia nova a cada passada.
     CORRIGIDO: `uploadToDrive` recusa re-subir documento cuja
     `ingestionSource` e `drive`, com a guarda no ponto unico de escrita da
     coluna. Falta comprovar inspecionando `documents.drive_file_id` apos uma
     ingestao real.
     O gate de virada deve exigir, alem do que ja esta escrito acima, um smoke que
     baixe de fato um arquivo da pasta operacional e uma inspecao de
     `documents.drive_file_id` apos uma ingestao real.
- **ATUALIZACAO 2026-09-11 (reuniao 11/09, D1):** o acesso de leitura a pasta
  PROCESSOS foi liberado e a arvore real foi lida. O layout que consta acima nao
  e o real; o codigo passou a montar um indice de pastas (areas numeradas, ano,
  colecao ou `FAT <mes>`, PENDENTES na raiz), a exportar espelho em Sheets
  nativo, a deduplicar por conteudo (`content_sha256` / `drive_md5`), a consultar
  tombstone antes de reimportar e a tratar PROCESSOS como SOMENTE LEITURA
  (`DRIVE_WRITE_MODE=off`). Sequencia de ativacao, backfill de hash que precisa
  de autorizacao e smoke em
  `docs/operations/document-intake-contract-2026-09-11.md`.
- Homologar Invoice, Packing List, BL e Espelho vindos exclusivamente da pasta de
  um processo listado no Follow Up; provar também os negativos de código de item
  e de referência incompleta. O negativo "upload manual 409" deixou de valer: a
  partir de 11/09 o upload manual tem flag propria (`MANUAL_UPLOAD_ENABLED`,
  padrao ligado) e o que impede a duplicata e o dedupe por conteudo.

- Executar o plano aprovado
  `docs/operations/backfill-plan-2026-08-26-completeness.yaml`: backup/restore
  test, triagem dos 16 `other`, piloto unitário, replay dos documentos
  suportados com causa identificada e reconciliação terminal.
- Implantar a lease de 25 minutos e o modo de replay que difere efeitos
  derivados; código e testes estão prontos, aguardando a janela remota.
- Criar backup novo de PostgreSQL/`uploads` e comprovar restore/listagem antes
  da janela de reprocessamento.
- Resolver ou monitorar o egress intermitente da API antes do lote, pois Vertex,
  Drive e login Google dependem da rota externa.
- Adicionar PDFs ou extracoes reais anonimizadas de validacao INV/PL/OHBL/Draft
  BL. Existe fixture representativa sem mock de `allChecks` desde 2026-06-17.
- Cadastrar destinatarios KIOM, Fenicia e ISA em
  `Configuracoes > Destinatarios operacionais` na producao.
- Formalizar decisao sobre provider de IA para extracao documental.
- Adicionar alerta externo para falha do restore test recorrente e medir RTO.

## P1 - Qualidade De Dados E Validacao

- Executar a triagem atual dos 16 documentos `other`; manter como apoio os
  inconclusivos e reclassificar apenas evidência unívoca. Não declarar acurácia
  sem ground truth/aceite humano.
- Executar validação diagnóstica auditável nos 117 processos e publicar o
  relatório campo a campo com exceções por fonte.
- Definir politica de reprocessamento para processos `completed`, que nao podem
  transicionar novamente para `validating` pela state machine atual.
- Persistir origem por campo no backend (`source`, `sourceDocumentId`, `sourceVersion`, `generatedAt`).
- Comparativo documental: evoluir a origem por campo para guardar
  `sourceDocumentId`, versao e timestamp da leitura; a edicao auditavel do valor
  consolidado ja existe via `comparison_field_overrides`.
- Conferencia de fornecedores/fabricantes: conectar base mestre opcional de
  fornecedores e validar dados completos, se o quadro por item e os aliases de
  rodape da Invoice nao forem suficientes.
- Draft DUIMP/DUIMP: validar documentos reais anonimizados e adicionar aliases
  especificos que nao estejam cobertos pela conferencia atual da aba Registro.
- Extracao real PK2052602TJ: refinar exportador, referencia do processo no
  OHBL, volumes/pesos/CBM do PL em portugues e ingles, frete somente via OHBL
  e fixtures anonimizadas para regressao.

## P1 - UX Operacional

- Avaliar uma visão unificada entre o checklist auditável do Draft BL e os
  aceites do comparativo; ambos já persistem autoria, mas usam fontes adequadas
  a seus contratos (`process_events` e `comparison_acceptances`).
- Migrar Settings, Communications e CertCadastro para validacao de formulario
  completa com erro por campo e cobertura de teste.
- Criar padrao mobile para tabelas largas e kanban operacional.
- Atendimentos: versionar historico de modelos se a operacao precisar recuperar
  versoes antigas; criar/editar/desativar ja esta implementado.
- Workflow de processos: criar relatorio consolidado das etapas especificas e
  registros de Erros/Custos, caso a operacao precise exportar indicadores.

## P2 - Dados, DW E Observabilidade

- Criar modelo DW/KPIs para importacao, certificacao, SLA e custos.
- Criar dashboard de observabilidade.
- Definir SLOs operacionais.
- Auditar indices e queries lentas.

## P2 - Certificacao

- Agendar revalidacao periodica dos SKUs.
- Definir SLA de frescor para `cert_stock` antes de exportar estoque detalhado.
- Documentar regra de estoque disponivel vs fisico.
