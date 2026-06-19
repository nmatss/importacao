# Roadmap

Ultima atualizacao: 2026-06-19

## P0 - Operacao E Confiabilidade

- Adicionar PDFs ou extracoes reais anonimizadas de validacao INV/PL/OHBL/Draft
  BL. Existe fixture representativa sem mock de `allChecks` desde 2026-06-17.
- Cadastrar destinatarios KIOM, Fenicia e ISA em
  `Configuracoes > Destinatarios operacionais` na producao.
- Formalizar decisao sobre provider de IA para extracao documental.
- Adicionar alerta externo para falha do restore test recorrente e medir RTO.

## P1 - Qualidade De Dados E Validacao

- Persistir origem por campo no backend (`source`, `sourceDocumentId`, `sourceVersion`, `generatedAt`).

## P1 - UX Operacional

- Consolidar aceite do checklist e aceite do comparativo.
- Decidir se o checklist de Draft BL vira entidade auditavel ou permanece como
  anotacao local.
- Migrar Settings, Communications e CertCadastro para validacao de formulario
  completa com erro por campo e cobertura de teste.
- Criar padrao mobile para tabelas largas e kanban operacional.

## P2 - Dados, DW E Observabilidade

- Criar modelo DW/KPIs para importacao, certificacao, SLA e custos.
- Criar dashboard de observabilidade.
- Definir SLOs operacionais.
- Auditar indices e queries lentas.

## P2 - Certificacao

- Agendar revalidacao periodica dos SKUs.
- Definir SLA de frescor para `cert_stock` antes de exportar estoque detalhado.
- Documentar regra de estoque disponivel vs fisico.
