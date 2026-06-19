# Production Readiness - 2026-06-19

## Objetivo

Revisao go-live do projeto de importacao e certificacao apos feedback operacional
de Eduarda/Franciely, cobrindo validacao documental, comparativos, Proformas,
Espelho, e-mail operacional, certificacao e relatorio de estoque WMS.

## Diagnostico

- Importacao: varios pontos ja estavam corrigidos no commit anterior, mas havia
  gaps reais em status logistico persistido, mapeamento da coluna Sistema,
  anomalias deterministicas sem emissao da IA e download XLSX do Espelho.
- Certificacao: status derivados ja estavam limitados aos novos dominios
  (`ATIVO`/`ENCERRADO`, `CONFORME`/`NAO_CONFORME`); faltava teste de rota para
  `license_status` usando a aba `Licenciamentos Vencidos`.
- Relatorios: o erro ao exportar `Estoque Detalhado` tinha causa provavel em
  volume `cert-reports` sem escrita para UID 1001. O filtro por marca tambem
  podia remover WMS por usar `cert_stock.brand` em vez de `COALESCE(cp.brand,
cs.brand)`.
- Go-live: Dockerfiles API/Web falhavam no `npm ci --workspace` por `prepare:
husky`; a imagem API tambem precisava expor os deps do workspace para
  `/app/dist` e remover o CLI `npm` do runtime final para reduzir superficie de
  vulnerabilidade em pacotes globais.
  E2E de documentos tinha timeout local menor que o config global.

## Status De Deploy Em Producao

- SHA implantado operacionalmente:
  `3f36137a697fee9f4f1011bc3eace3417467d5be`.
- Deploy concluido por `scripts/deploy.sh` em 2026-06-19 19:16 BRT com backup
  validado em `/home/nicolas/backups/importacao/importacao_2026-06-19_221502*`,
  migrations aplicadas, `REVISION` remoto gravado e containers internos
  saudaveis.
- Health interno aprovado:
  - API `http://127.0.0.1:3050/health/ready` com DB/Redis OK.
  - Web `http://127.0.0.1:8085/` com HTTP 200.
  - Cert-api `/api/ready` dentro do container com `ready=True`.
- Health publico reprovado: `https://importacao.grupounico.com/` retorna
  `HTTP/2 502` com header `server: nginx`. O bloqueio remanescente esta na
  camada DNS/proxy/TLS externa, nao no container web nem na API.

## Alteracoes

- Docker/CI/deploy:
  - Dockerfiles API/Web usam contexto raiz, manifests dos workspaces e
    `npm ci --ignore-scripts` com `HUSKY=0`.
  - Dockerfile API promove deps de producao do workspace para `/app/node_modules`
    e remove `npm`/`npx` do runtime final, ja que producao executa somente
    `node`.
  - `.dockerignore` e `scripts/deploy.sh` excluem `.claude`/`.codex`.
  - Compose prod adiciona `cert-volumes-init` para `cert-reports` e
    `cert-certs`; `scripts/deploy.sh` agora executa esse init explicitamente
    antes do restart com `--no-deps`.
  - `scripts/deploy.sh` valida a rede externa `ia-local-net` antes de migrations
    e restart.
  - Compose prod exige `CORS_ORIGIN` e `GOOGLE_GROUP_ALLOWED`, define
    `TRUST_PROXY=1`, publica web em `8085:80` para o Nginx/edge externo e repassa
    variaveis `LINX_*` ao `cert-api`.
  - Cert-api readiness valida escrita em `REPORTS_DIR`.

- Importacao:
  - `advanceLogisticStatus` usa `aiExtractedData.espelho.summary` como fallback
    para ETD/ETA/Data Embarque.
  - Barra de ciclo de transporte nao deixa o default `consolidation` esconder
    ETD/embarque passado vindo do BL/Espelho.
  - `ProcessInfoCard` prioriza BL/Espelho para Data Embarque, Frete e Container.
  - `DocumentComparison` mapeia valores de Sistema por check key e labels reais,
    e eleva o status da linha quando o check contra Sistema falha.
  - Linha `Container` mostra numero; linha `Tipo Container` fica alinhada ao
    check `container-type-vs-fup`.
  - Edicao manual do Espelho envia `ncmCode`/`boxQuantity` ao backend.
  - Reconciliação de anomalias sintetiza divergencias deterministicas de itens
    mesmo quando a IA nao emite anomalia de presença.
  - Invoice/PL schemas e prompts aceitam datas logisticas; Invoice item aceita
    peso liquido/bruto.
  - Download do Espelho usa `espelho.id`.

- Certificacao/relatorios:
  - Export `Estoque Detalhado` filtra marca por `COALESCE(cp.brand, cs.brand)`
    normalizado e preserva WMS.
  - XLSX inclui `Sincronizado em`.
  - UI de relatorios esconde acoes JSON/Ver para `.xlsx`, usa helper de download
    em POST e mostra erros reais sem vazar detalhes internos de sync parcial.
  - Rota `/api/reports/{filename}/data` rejeita XLSX com erro claro.

- SYDLE:
  - Conciliacao por PI/invoice/pedido agora busca valores tambem em
    `aiExtractedData` aninhado por documento, incluindo campos
    `{ value, confidence }`.
  - Sync usa advisory lock transacional para nao prender lock em conexao pooled.
  - Fallback de `externalId` usa referencias de negocio estaveis e tipo de
    parcela, sem depender de vencimento/fornecedor/marca, antes de recorrer ao
    hash do payload completo.
  - Rotas API de relatorio/export/sync ganharam cobertura de autorizacao e CSV.
  - Relatorio admin-only esta acessivel em
    `/importacao/compras-pagamentos`, pelo menu `Importacao > Operacional >
Compras/Pagamentos SYDLE` e por atalho no portal para administradores.
  - Tela agora exibe campos financeiros vindos da SYDLE que ja estavam no
    contrato interno: cambio, valor BRL, banco, contrato, remessa, datas de
    pagamento/agendamento, motivo de conciliacao e filtros por atualizacao da
    fonte.
  - `scripts/deploy.sh` bloqueia deploy quando `SYDLE_SYNC_ENABLED=true`,
    exceto rollout aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.

## Testes Direcionados Ja Executados

- `npm test -w apps/api -- src/modules/processes/__tests__/service.test.ts src/modules/validation/__tests__/service.test.ts src/modules/documents/__tests__/build-espelho.test.ts src/modules/documents/__tests__/service.test.ts --run` -> 75 passed.
- `npm test -w apps/web -- src/features/certificacoes/CertRelatoriosPage.test.tsx src/features/documents/DocumentComparison.test.tsx src/features/espelhos/EspelhoPreview.test.tsx src/features/processes/components/ProcessInfoCard.test.tsx --run` -> 22 passed.
- `pytest -q apps/cert-api/tests/test_reports.py apps/cert-api/tests/test_health.py apps/cert-api/tests/test_certificates_routes.py` -> 25 passed.
- `npm test -w apps/web -- src/features/documents/DocumentComparison.test.tsx src/features/processes/components/LogisticStatusBar.test.tsx src/features/espelhos/EspelhoPreview.test.tsx --run` -> 23 passed.
- `npm test -w apps/api -- src/modules/sydle/__tests__/service.test.ts src/modules/sydle/__tests__/normalizer.test.ts --run` -> 19 passed.
- `npm test -w apps/web -- src/features/sydle-payments/SydlePaymentsPage.test.tsx --run` -> 2 passed.

## Bloqueios Para Go-live

- Go-live publico ainda esta bloqueado ate
  `curl -fS https://importacao.grupounico.com/` retornar 200 e uma chamada API
  via dominio publico funcionar. Em 2026-06-19, o dominio publico respondia por
  uma camada `nginx` externa com 502; a causa operacional identificada foi o
  bind do web em `127.0.0.1:8085`, incompatível com o Nginx/edge externo que
  acessa o upstream em `192.168.168.124:8085`.
- SYDLE segue aguardando contrato/API/payload real, identificador estavel de
  pagamento, credenciais em SOPS e UAT financeiro para habilitar sync real.
- Destinatarios operacionais devem ser confirmados/cadastrados na tela, ou
  `COMMUNICATION_ALLOWED_RECIPIENTS` deve ser preenchido como fallback.
- HTTPS publico deve terminar no Nginx/edge externo; o compose publica o web em
  `8085:80` para manter o upstream acessivel ao proxy externo.
- Estoque WMS/e-commerce ainda precisa de SLA de frescor para bloquear relatorio
  quando o sync estiver velho ou parcial.

## Gates Globais Executados

- `git diff --check` -> passed.
- `npm run typecheck` -> passed.
- `npm run lint` -> passed.
- `npm test` -> API 688 passed / 1 skipped; Web 94 passed.
- `npm run build` -> passed.
- `CI=true npm run test:e2e -w apps/api -- --reporter=dot` -> 44 passed.
- `pytest -q apps/cert-api` -> 332 passed.
- `python3 -m compileall -q apps/cert-api/app apps/cert-api/tests` -> passed.
- `bash -n scripts/deploy.sh && bash -n scripts/apply-pending-migrations.sh && bash -n scripts/backup-db.sh` -> passed.
- `docker compose -f docker-compose.prod.yml config --quiet` com env dummy obrigatorio -> passed.
- `npm audit --audit-level=high && npm audit --omit=dev --audit-level=high` -> passed sem HIGH/CRITICAL; residuais moderados registrados em `docs/TECH_DEBT.md`.
- `pip-audit -r apps/cert-api/requirements.txt` -> no known vulnerabilities.
- Docker builds sem cache:
  - `apps/api/Dockerfile` -> passed.
  - `apps/web/Dockerfile` -> passed.
  - `apps/cert-api/Dockerfile` -> passed.
- Runtime API image:
  - `drizzle-orm` resolve a partir de `/app/dist`.
  - `npm`/`npx` ausentes do runtime final.
- Trivy HIGH/CRITICAL:
  - `importacao-api:go-live` -> clean.
  - `importacao-web:go-live` -> clean.
  - `importacao-cert-api:go-live` -> clean.
