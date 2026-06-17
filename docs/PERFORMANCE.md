# Performance

Ultima atualizacao: 2026-06-17

## Pontos Sensíveis

- Extracao de documentos com IA local pode ser lenta em CPU.
- Comparativos e validacoes dependem de dados JSON extraidos.
- Listagens de processos precisam de filtros e indices adequados.
- Cert API consulta fontes externas VTEX/ERP/WMS.
- Uploads e XLSX/PDF podem pressionar memoria se processados em lote.

Evidencias:

- `docs/STATUS-2026-06-16.md`
- `docs/IA-ESPECIALISTA.md`
- `apps/api/src/modules/documents/service.ts`
- `apps/api/src/modules/validation/service.ts`
- `apps/cert-api`

## Riscos Conhecidos

- Provider local `unico-docintel` em CPU tem teto de latencia; docs recentes registram limitacao.
- Queries sobre JSONB podem exigir indices especificos se virarem filtros frequentes.
- Falta mapa completo de queries lentas.
- Jobs e extracoes precisam de concorrencia controlada.

## Checklist De Performance

Antes de alterar fluxo critico:

- Verificar se ha N+1 em services.
- Verificar indices para filtros novos.
- Medir impacto de parsing em arquivos grandes.
- Evitar bloquear request HTTP com trabalho pesado.
- Usar fila/job quando aplicavel.
- Adicionar teste ou benchmark leve quando o risco for alto.

## Pendencias

- Definir SLO de tempo para upload/extracao/validacao.
- Criar base de fixtures grandes para stress de parser.
- Auditar queries principais com `EXPLAIN`.
- Documentar configuracao de concorrencia dos workers/jobs.
