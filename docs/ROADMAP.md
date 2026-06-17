# Roadmap

Ultima atualizacao: 2026-06-17

## P0 - Operacao E Confiabilidade

- Adicionar PDFs ou extracoes reais anonimizadas de validacao INV/PL/OHBL/Draft
  BL. Existe fixture representativa sem mock de `allChecks` desde 2026-06-17.
- Configurar `KIOM_EMAIL`, `FENICIA_EMAIL` e `ISA_EMAIL` reais no SOPS de
  producao.
- Formalizar decisao sobre provider de IA para extracao documental.
- Adicionar alerta externo para falha do restore test recorrente e medir RTO.

## P1 - Qualidade De Dados E Validacao

- Usar Draft BL como fonte parcial/fallback quando OHBL nao existe, se aprovado pelo negocio.
- Persistir origem por campo no backend (`source`, `sourceDocumentId`, `sourceVersion`, `generatedAt`).

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
