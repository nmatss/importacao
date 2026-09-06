# Revisao de certificacao — 2026-09-06

Revisao com correcoes pontuais sobre a base `5dc17ec`, preservando as alteracoes
anteriores no diretorio original. Abrange dashboard, validacao, produtos, detalhe
do produto, cadastro, relatorios, detalhe do relatorio, agendamentos e configuracoes.
Estado operacional, release e deploy ficam na sessao dotcontext
`142282d9-7495-4a36-a16f-12ffe22fdbaa`.

## Achados e correcoes

| ID       | Severidade | Localizacao                                                                     | Cenario e evidencia                                                                                                                                                                                      | Correcao                                                                                                                                        |
| -------- | ---------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CERT-F01 | MEDIO      | `CertProdutosPage.tsx`, `loadProducts`                                          | Ao trocar a marca, a resposta anterior podia chegar depois e substituir a lista do filtro atual. Teste com promises resolvidas em ordem inversa falhou antes da correcao.                                | Somente a requisicao atual publica dados, erro e estado de carregamento; desmontagem invalida a requisicao pendente.                            |
| CERT-F02 | MEDIO      | `CertConfiguracoesPage.tsx`, status da fonte                                    | A UI mostrava Google Sheets conectado quando `/api/stats` retornava dados. Esse endpoint consulta PostgreSQL, sem testar Sheets. Regressao reproduziu o rotulo incorreto.                                | Indicador descreve a base de produtos e a disponibilidade dos dados sincronizados. Zero continua sendo um total valido; falha continua visivel. |
| CERT-F03 | BAIXO      | `CertProdutoDetailPage.tsx` e `CertRelatorioDetailPage.tsx`, parametros de rota | `useParams` ja entrega parametros decodificados. A segunda decodificacao alterava `%25` e podia gerar URIError para percentuais incompletos. Dois testes provaram a alteracao indevida do identificador. | Usar diretamente o parametro do roteador; codificacao HTTP e autorizacao permanecem nos clientes/gateway existentes.                            |
| CERT-F04 | BAIXO      | `CertProdutoDetailPage.tsx`, resumo de status                                   | Captura de 320 px mostrou rotulos Cert./Site/Lic./Comerc. separados dos respectivos badges, apesar de nao existir overflow.                                                                              | Agrupar rotulo e indicador, empilhar grupos em mobile e ajustar contraste/separadores no tema escuro.                                           |
| CERT-F05 | BAIXO      | `CertProdutosPage.tsx` e `CertRelatorioDetailPage.tsx`, tema escuro             | Rodape do relatorio manteve superficie clara sob texto claro; linhas vencidas e badges de prazo tambem nao tinham variantes escuras.                                                                     | Aplicar superficies e cores de texto adequadas ao tema escuro.                                                                                  |
| CERT-F06 | BAIXO      | `CertRelatorioDetailPage.tsx`, link de retorno                                  | Link continha apenas icone, sem nome acessivel.                                                                                                                                                          | Nome acessivel explicito: Voltar aos relatorios.                                                                                                |

**CERT-F07 — MEDIO, `CertProdutosPage.tsx`, barra de busca:** captura em 1280 px
mostrou o campo comprimido pelos filtros na mesma linha, com sobreposicao visual
proxima ao botao, sem overflow global. Corrigido com quebra de linha dos grupos,
largura flexivel da busca e botao sem encolhimento. O auditor exige pelo menos
120 px no campo e separacao geometrica entre campo e botao nas cinco larguras.

Os testes de regressao estao junto das quatro paginas em
`apps/web/src/features/certificacoes/`. Nao houve mudanca em endpoints, contratos
persistidos, migrations ou regras de certificacao/Linx.

## Validacao

- Baseline: 48 testes do frontend de certificacao e 595 testes Python passaram.
- Novas regressoes: quatro testes falharam no codigo anterior e passaram apos as
  correcoes; um quinto protege a exibicao de falha ao consultar estatisticas.
- Suite Node: 1.608 testes da API passaram, um ignorado; frontend completo com
  245 testes passou, incluindo 53 de certificacao.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` e
  `python3 -m ruff check apps/cert-api/` executados. Apos ajustes visuais finais,
  typecheck, lint, testes e build do frontend foram repetidos.
- Auditoria responsiva: 12 cenarios em 116 combinacoes, sem overflow ou erros
  de navegador. Larguras de 320, 375, 768, 1280 e 1920 px, temas claro e escuro,
  ponteiro de toque nas larguras configuradas. Dados preenchidos por fixtures;
  capturas inspecionadas visualmente alem das medicoes de overflow.
- Auditor responsivo ampliado para verificar foco inicial, Shift+Tab, acesso ao
  botao final, Escape e restauracao de foco no formulario de agendamento, sem
  submeter o formulario.
- Smoke de rotas com dados vazios/erros: 20 testes passaram em desktop e mobile.
- Producao, somente leitura: cert-api retornou `status=ok` e banco conectado;
  acesso publico sem autenticacao a produtos retornou HTTP 401.

Comandos para reproduzir a cobertura de navegador:

```bash
AUDIT_ONLY='^cert-' AUDIT_VIEWPORTS=320,375,768,1280,1920 AUDIT_ASSERT=1 AUDIT_OUT=output/playwright/cert-review npx playwright test apps/web/e2e/responsive-audit.spec.ts --project=chromium-desktop
npx playwright test apps/web/e2e/route-smoke.spec.ts --grep 'renders /certificacoes'
```

Resultados JSON e capturas ficam em `output/playwright/cert-review/`; saidas
geradas nao sao versionadas. As verificacoes dos cenarios alterados substituem
as capturas anteriores desses mesmos cenarios.

## Limites e pendencias

- Chromium com emulacao nao comprova todos os navegadores, dispositivos fisicos,
  leitores de tela ou tamanhos intermediarios. Ausencia de overflow nao comprova
  por si so boa legibilidade; a revisao visual identificou defeitos adicionais.
- Testes Python usam dependencias externas simuladas. Nao foi executada escrita
  de homologacao no Linx, nem sincronizacao real de planilha, estoque ou VTEX.
- `sheets_configured=true` no health comprova configuracao, nao acesso atual a
  planilha nem completude dos certificados.
- Permanece o risco ALTO ja documentado de identidades pessoais e privilegios
  amplos no Linx. Esta rodada nao alterou nem recertificou os grants SQL.
- O aceite fiscal dos certificados/datas e um caso aprovado para validar a
  escrita no ERP continuam necessarios. Ver [procedimento Linx](CERT-LINX-WRITE.md),
  [pendencias](KNOWN_ISSUES.md) e [divida tecnica](TECH_DEBT.md).
