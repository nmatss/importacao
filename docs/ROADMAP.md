# Roadmap

Ultima atualizacao: 2026-06-17

## P0 - Operacao E Confiabilidade

- Resolver governanca de secrets com `.env.sops.yaml` em producao.
- Agendar restore test recorrente e alerta de falha. Restore manual validado em
  2026-06-17 com 30 tabelas e 273 processos restaurados em banco temporario.
- Criar fixtures reais de validacao INV/PL/OHBL/Draft BL.
- Formalizar decisao sobre provider de IA para extracao documental.

## P1 - Qualidade De Dados E Validacao

- Usar Draft BL como fonte parcial/fallback quando OHBL nao existe, se aprovado pelo negocio.
- Melhorar checks de incoterm/moeda para variantes comuns.
- Separar semanticamente invoice date, ETD e shipment date nos checks.
- Persistir origem por campo no backend (`source`, `sourceDocumentId`, `sourceVersion`, `generatedAt`).
- Limpar/recalcular `aiExtractedData` por tipo ao deletar ou reprocessar documentos.
- Criar endpoint/filtro de logs de e-mail por processo.

## P1 - UX Operacional

- Consolidar aceite do checklist e aceite do comparativo.
- Melhorar modal de email com focus trap, Escape e leitura robusta do editor.
- Exibir rascunho existente para evitar duplicidade de emails de correcao.
- Melhorar acessibilidade restante em ordenacao de tabelas, switches/toggles e filtros visuais.

## P2 - Dados, DW E Observabilidade

- Criar modelo DW/KPIs para importacao, certificacao, SLA e custos.
- Criar dashboard de observabilidade.
- Definir SLOs operacionais.
- Auditar indices e queries lentas.

## P2 - Certificacao

- Agendar revalidacao periodica dos SKUs.
- Diferenciar prazo de certificacao e prazo de licenciamento se o negocio fornecer fonte.
- Documentar regra de estoque disponivel vs fisico.
