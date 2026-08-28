# Roadmap

Plano mestre operacional e técnico: `docs/PLANO-MESTRE-SISTEMA-2026-07-10.md`.

Ultima atualizacao: 2026-08-28

## P0 - Operacao E Confiabilidade

- Concluir o rollout Drive-only: Follow Up já está cadastrado e legível; falta
  compartilhar a pasta operacional de 2026 com a conta de serviço, cadastrar a
  raiz no SOPS e exigir `health/integrations` + smoke sem avisos antes de trocar
  o override temporário `DOCUMENT_SOURCE=email` para `drive`.
- Homologar Invoice, Packing List, BL e XLSX de Espelho vindos exclusivamente da
  pasta de um processo listado no Follow Up; provar também os negativos de
  código de item, referência incompleta e upload manual 409.

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
