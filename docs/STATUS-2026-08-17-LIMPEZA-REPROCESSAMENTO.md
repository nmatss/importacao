# Status — Limpeza E Reprocessamento Da Importacao — 2026-08-17

## Objetivo

Atender ao pedido da Odett: remover dados historicos anteriores a maio de
2025, manter o processo DEMO e reprocessar os documentos remanescentes com a
versao atual do fluxo.

## Resultado

- Backup custom-format do PostgreSQL e snapshot do volume de uploads criados e
  validados antes da exclusao. O dump foi restaurado integralmente em um banco
  temporario (40 tabelas e 274 processos) antes de executar a limpeza.
- 170 processos com `etd < 2025-05-01` foram removidos em uma unica transacao
  serializavel. Restaram 104 processos: 86 a partir do corte, 17 sem ETD e o
  DEMO.
- O DEMO `264 / DEMO-IM0712602NB-E227210` permaneceu com seus 11 documentos e
  nao recebeu extracao nem historico novo durante o lote.
- O snapshot de replay continha 37 documentos canonicos de 19 processos. O
  resultado foi 32 concluidos e 5 invoices em falha terminal, sem candidato em
  processamento.
- Tres documentos foram enviados por usuarios enquanto a janela estava ativa.
  Entraram pela fila normal: dois concluiram e uma invoice adicional falhou.
  O estado final corrente e 34 concluidos e 6 invoices em quarentena entre 40
  documentos canonicos.
- Os 19 processos foram reconciliados e revalidados; todos responderam HTTP 200
  e cada validacao executou 29 checks.
- Fila sem job nao terminal, zero leases documentais, zero FKs orfas, zero
  codigo de processo duplicado e zero alerta enviado ao Chat durante a janela.
- A configuracao normal da API foi restaurada. API, banco, Redis e proxy
  responderam saudaveis.

## Documentos Em Quarentena

| Documento |          Processo | Tipo    | Origem                          |
| --------: | ----------------: | ------- | ------------------------------- |
|        28 | 261 / PK2072602NB | invoice | replay                          |
|        76 |       146 / PK189 | invoice | replay                          |
|        88 | 257 / PK2062602NB | invoice | replay                          |
|        92 |       269 / IM237 | invoice | replay                          |
|       151 | 259 / PK2052602TJ | invoice | replay e uma tentativa limitada |
|       154 | 277 / PK2112606NB | invoice | upload concorrente              |

Cinco falhas retornaram resposta invalida/nao parseavel do extrator; o
documento 28 nao continha dados significativos legiveis. Nenhum deles foi
projetado como dado confiavel. Uma nova tentativa em massa nao e recomendada:
revisar classificacao e legibilidade e entao reprocessar individualmente.

## Evidencias E Rollback

- Plano: `docs/operations/backfill-plan-2026-08-17-process-cleanup-reprocess.yaml`.
- Gate final: `docs/operations/release-gate-evidence-2026-08-17-process-cleanup-reprocess.yaml`.
- Dump: `/home/nicolas/backups/importacao/importacao_2026-08-17_183610.pgdump`.
- Uploads: `/home/nicolas/backups/importacao/importacao_2026-08-17_183610_uploads.tar.gz`.
- Logs JSONL do piloto, retry e lote ficam no mesmo diretorio de backup.

O rollback integral exige janela de incidente, pois restaura banco e uploads
ao estado anterior e substitui alteracoes legitimas feitas depois do snapshot.

## Riscos Residuais

- `GOOGLE_DRIVE_ROOT_FOLDER_ID` voltou ao valor normal do ambiente, mas esse
  valor e o placeholder `your-root-folder-id`. Portanto, a integracao Drive ja
  estava inativa antes da limpeza e continua inativa; nao houve perda de
  configuracao causada pela janela.
- O lease normal de extracao e 600 segundos. A janela usou 1.500 segundos para
  evitar duplicacao durante extracoes lentas. Persistir um valor maior deve ser
  uma mudanca de configuracao revisada e publicada separadamente.
