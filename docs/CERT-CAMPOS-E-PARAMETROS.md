# Certificação — auditoria de campos e parâmetros

Revisão local em 18/09/2026, base `0e3434b` com alterações locais integradas.
Escopo: cadastro, itens/lote, Sheets, snapshot de produtos, leitura e escrita Linx.
Não é uma consulta ao estado atual de produção. Nenhum dado real foi alterado.

## Regra confirmada pelo usuário

**A propriedade de certificação no Linx recebe a data de fim de vendas do certificado,
nunca a validade do certificado.** Havendo restrição individual, usa o fim de venda efetivo do SKU;
sem override, herda o fim de venda do certificado. Não usa a menor data de licenciamento para
sobrescrever essa propriedade: licenciamento possui propriedade própria, somente para leitura.

| Marca                   | Propriedade de certificação (escrita de fim de venda) | Licenciamento (só leitura) |
| ----------------------- | ----------------------------------------------------- | -------------------------- |
| Imaginarium             | `00106`                                               | `00107`                    |
| Puket                   | `00224`                                               | `00225`                    |
| Puket Escolares, legado | `00224`, mesma integração Puket                       | `00225`                    |

Exemplo sintético: validade `2028-07-27`, fim de venda `2026-10-29`, situação Encerrado.
O valor elegível para `PROP_PRODUTOS.VALOR_PROPRIEDADE` é **`29/10/2026`**, nunca `27/07/2028`.

`config.py` conserva o nome técnico legado `prop_validade_certificado`, mas o writer usa
`fim_venda` como valor. O lookup conserva `validade_certificado` como alias legado dessa leitura
e fornece `fim_venda_certificacao`; a UI não usa esse alias para preencher a validade cadastral.

## Cadastro e itens: parâmetros recebidos

| Campo/parâmetro                       | Origem e destino                                                           | Validação e atualização efetiva                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sku`, `skus`                         | Formulário → vínculos `cert_certificate_items`; primeiro SKU no pai legado | Ao menos um, deduplicação, até 500, datas/controles recusados; chave não é convertida em data                          |
| `brand`                               | Seleção → certificado, itens e escolha da conexão/propriedades             | Marca suportada; não enviada como valor de propriedade                                                                 |
| `validade_certificado`                | Formulário/consulta do portal → `cert_certificates`                        | Data ISO; salva no portal, nunca escrita no Linx                                                                       |
| `situacao`                            | Formulário → certificado pai                                               | ATIVO/ENCERRADO; ativo com fim de venda é rejeitado                                                                    |
| `fim_venda`                           | Formulário → certificado pai → herança dos itens                           | Única data elegível para propriedade de certificação; não deriva da validade                                           |
| `numero_certificado`                  | Formulário/consulta do portal → pai                                        | Até 255 caracteres; duplicata marca/número retorna 409; não escrita no Linx                                            |
| `ocp`                                 | Formulário → pai                                                           | Até 255 caracteres, não escrita no Linx                                                                                |
| `orgao_certificador`                  | Formulário → pai                                                           | Até 255 caracteres, não escrito no Linx                                                                                |
| `vencimento_licenciamento`            | Lookup Linx → exibição                                                     | Cliente aceita campo legado, mas cadastro não envia e servidor recusa preenchimento com 400; novo cadastro mantém NULL |
| `created_by`                          | Identidade do gateway, com fallback legado                                 | Identidade autenticada prevalece; gravada para auditoria, não vai ao Linx                                              |
| `pdf` / `pdf_filename`                | Upload → arquivo com UUID / referência no pai                              | Até 15 MB, extensão `.pdf` e assinatura inicial `%PDF-`; validado antes do INSERT; não vai ao Linx                     |
| `linhas`                              | Lote `SKU` ou `SKU;data` → vínculos/restrições                             | 500 úteis, 2.000 brutas, 200 caracteres/linha; datas/duplicatas validadas                                              |
| `encerrar_itens_com_data`             | Confirmação explícita do operador                                          | Autoriza tratar a data da linha como fim de venda do item                                                              |
| Restrição `situacao`, `fim_venda`     | PATCH de item → `cert_certificate_items`                                   | NULL herda pai; não reativa filho de pai encerrado; ativo com data rejeitado                                           |
| `motivo`                              | Lote/restrição → eventos de auditoria                                      | Obrigatório, até 1.000 caracteres; antes/depois persistidos                                                            |
| `dry_run`                             | Prévia/vínculo/lote, padrão true                                           | Não escreve; confirmação false revalida sob lock                                                                       |
| `id`, `certificate_id`                | Identidades geradas pelo banco/servidor                                    | Relação pai/itens, não números de certificado do ERP                                                                   |
| `produto_codigo`                      | Resolução do SKU no Linx → pai/item                                        | Identifica produto alvo da propriedade; não é o número do certificado                                                  |
| `linx_status/error/detail/applied_at` | Resultado da integração → pai/item                                         | Rastreiam disabled/skipped/pending/error/applied; não garantem alteração de valor quando upsert é unchanged            |
| `added_at/by`, `removed_at/by`        | Vinculação/remoção → item                                                  | Remoção lógica preserva histórico; não limpa propriedade Linx                                                          |
| `restriction_updated_at/by`           | Alteração de restrição → item                                              | Marca nova restrição e envio pendente                                                                                  |
| `created_at`, `updated_at`            | Relógio do banco → cadastro                                                | Metadados locais; não escritos no ERP                                                                                  |

O cadastro **cria** o certificado pai; não existe PUT/PATCH do pai para editar número, validade,
OCP, órgão ou PDF. Existem operações de vínculos, restrições individuais e retry Linx.
`cert_certificates`/`cert_certificate_items` agora compõem a leitura efetiva de Produtos, filtros,
validação e relatórios. O usuário aprovou cadastro validado como fonte dos novos certificados e
conflitos explícitos. O snapshot original da planilha não é sobrescrito: número/marca divergentes
e contradições de encerramento aparecem como Pendente de vínculo. Remover o vínculo restaura
a fonte original. Novos SKUs ganham registro de suporte para futuras observações Linx/site.
Implementação local, ainda não publicada; evidências em
[correções do aceite](STATUS-2026-09-18-CORRECOES-ACEITE.md).

## Sheets e snapshot `cert_products`

| Campo                             | Fonte                                                      | Tratamento no sync                                                                          |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `sku`                             | CÓDIGO da marca / SKU de Encerramentos                     | Chave do upsert; multilinha separado; EAN tenta resolução antes da escrita                  |
| `name`                            | NOME                                                       | Marca atualiza se não vazio; Encerramentos só preenche ausente                              |
| `brand`                           | Nome da aba oficial / MARCA em Encerramentos               | Aba oficial prevalece; Encerramentos só preenche ausente; grafia normalizada                |
| `supplier`                        | FORNECEDOR                                                 | Transitório, detecta ambiguidade; não persistido no produto                                 |
| `certification_type`              | TIPO DE CERTIFICAÇÃO                                       | Atribuição direta, vazio limpa; encerramento só limpa lixo legado conhecido                 |
| `numero_certificado`              | NÚMERO CERTIFICADO da marca / CERTIFICADO de Encerramentos | Marca substitui inclusive por vazio; Encerramentos só preenche quando o banco está vazio    |
| `situacao`                        | SITUAÇÃO da marca                                          | Substituição direta, vazio limpa; encerramento não a altera                                 |
| `sheet_status`                    | STATUS da marca                                            | Histórico/texto direto; subordinado à situação reconhecida                                  |
| `ecommerce_description`           | DESCRIÇÃO E-COMMERCE                                       | Substituição direta, vazio limpa                                                            |
| `expected_cert_text`              | Mesma DESCRIÇÃO E-COMMERCE                                 | Mesmo texto, sem fallback para tipo ou prazo                                                |
| `validade_certificado_raw`        | VALIDADE DA CERTIFICAÇÃO                                   | Texto original; vazio NULL                                                                  |
| `validade_certificado`            | Mesma célula interpretada                                  | Data real; ausente/sentinela/ilegível NULL; não escrita no Linx                             |
| `sale_deadline`                   | PRAZO FINAL VENDA                                          | Texto original, vazio NULL                                                                  |
| `sale_deadline_date`              | Mesma célula interpretada                                  | Data real ou NULL, substitui valor anterior                                                 |
| `encerramento_status`             | STATUS de Encerramentos                                    | Texto original ou NULL; não vem do status da marca                                          |
| `encerramento_numero_certificado` | CERTIFICADO de Encerramentos                               | Proveniência interna direta; removida da resposta pública, sem coluna nova no Excel         |
| `is_expired`                      | Veredito/data de Encerramentos                             | Bloqueio textual true; permissão/fim lote false; caso contrário data/texto; ressalva abaixo |
| `dupla_certificacao_raw`          | DUPLA CERTIFICAÇÃO?                                        | Transitório; não substitui a identidade dos certificados no painel                          |
| `updated_at`                      | Relógio do banco                                           | Atualizado por upsert/limpeza                                                               |

Número do certificado vindo da aba Imaginarium/Puket **é atualizado** pelo sync. SKU existente
apenas em Encerramentos conserva número/nome/marca já preenchidos; não se deve afirmar atualização
completa desses campos nesse caminho. A proveniência do encerramento é atualizada separadamente.

Linhas identificadas por SKU+certificado, mesmo sem prazo/status, são agora preservadas.
Se correspondem ao certificado ativo, ficam pendentes e protegidas da limpeza; se são de certificado
antigo, continuam históricas. Linhas sem certificado, prazo e status continuam ignoradas.

## Leitura Linx, validação e campos calculados

| Campo(s)                                                               | Fonte / atualização                                                  | Escrita no ERP                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `grife`                                                                | `PRODUTOS.IMG_LICENCIAMENTO` Imaginarium / `GRIFFE` Puket → snapshot | Não                                                                                |
| `linx_fim_licenciamento`                                               | Propriedade 00107/00225 → data real, sentinela NULL                  | Não                                                                                |
| `linx_prop_certificacao`                                               | Propriedade 00106/00224 → data real, sentinela NULL                  | Esta rotina só lê                                                                  |
| `linx_fim_vendas`                                                      | Menor data real de `PRODUTO_CORES.FIM_VENDAS` entre cores            | Não                                                                                |
| `linx_synced_at`                                                       | Relógio do banco ao atualizar snapshot lido                          | Não                                                                                |
| `actual_cert_text`, `last_validation_status/score/url/date/error`      | Rotina de consulta/validação do site                                 | Não; Sheets não sobrescreve esses campos                                           |
| `cert_status`, `cert_status_reason`                                    | Situação/validade/histórico → cálculo em runtime                     | Não                                                                                |
| `site_status`, `site_status_reason`                                    | Validação do site + restrições comerciais                            | Não                                                                                |
| `license_status`, `license_status_reason`, `license_deadline`          | Snapshot licenciamento/grife → cálculo                               | Não                                                                                |
| `comercializacao_status`, `venda_encerramento`, `within_sale_deadline` | Situação/prazo/veredito → cálculo                                    | Não                                                                                |
| `trava_venda`, `trava_origem`, `status_venda`, `status_venda_reason`   | Datas aplicáveis/pendências → cálculo                                | Não são usados como valor genérico para sobrescrever a propriedade de certificação |

O sync de leitura grava NULL para campos ausentes no resultado lido com sucesso; erro de conexão
não é prova de ausência. Campos calculados do produto são recomputados na serialização e no
relatório; a existência de colunas legadas com esses nomes não as torna a fonte atual do painel.

## Escrita e limites operacionais

- `_write_item_to_linx` encaminha validade e licenciamento como `None`; passa apenas `fim_venda`
  efetivo e situação. O writer também ignora os dois campos legados mesmo se recebidos diretamente.
- `LINX_WRITE_ENABLED=false` retorna disabled antes da resolução. Consulta pré-deploy em
  18/09/2026 confirmou false tanto no container produtivo quanto no SOPS.
- Ativo/sem data retorna skipped: **não apaga uma data antiga no ERP**. Encerrado sem prazo válido
  fica pending na camada de itens. Alterar restrição não implica que o retry tenha sido executado.
- Upsert lê sob lock e recusa múltiplas linhas/item inesperado. INSERT/UPDATE e confirmação
  usam produto/propriedade/item e parâmetros SQL. Outra conexão confirma o valor após commit;
  ausência de confirmação exige reconciliação antes de reenviar, sem promessa de rollback.
  Se o valor já coincide, retorna unchanged após confirmar; não dispara UPDATE desnecessário.
- Número, emissão, validade, situação, OCP, órgão e PDF não são gravados no Linx.
- `PRODUTO_CORES.FIM_VENDAS` é lido, nunca atualizado diretamente pelo portal. Propagação interna
  a partir da propriedade depende do ERP e não foi homologada nesta sessão.
- Carga conciliada `sync_prazo_venda_to_linx(dry_run=False)` permanece bloqueada. A CLI agora
  informa isso corretamente e apresenta ambos os formatos de ambiguidades sem `KeyError`.

## Achados remanescentes e decisões de escopo

- **MEDIO:** somente Encerramentos não substitui número/nome/marca existentes; atualizar a
  proveniência não atualiza automaticamente esses campos públicos. Política preservada nesta auditoria.
- **MEDIO:** STATUS permissivo com prazo passado pode guardar `is_expired=false`, embora a venda
  derivada fique bloqueada. `/expired` e contadores baseados nessa flag não equivalem ao eixo de venda.
- Datas sentinelas com ano até 1900 agora são recusadas na entrada do cadastro (HTTP 400);
  campo vazio continua representando ausência.
- Edição do certificado pai continua fora desta implementação. Cadastro→Produtos foi integrado
  após autorização expressa; conflitos permanecem pendentes, sem resolução automática.
- Ausência de remoção automática de data antiga no Linx é uma proteção existente, não autorização
  para limpar a propriedade durante esta revisão.

## Evidências e fontes

Rastreio: `app/routes/certificates.py`, `app/services/erp_service.py`, `linx_service.py`,
`linx_attributes.py`, `app/db/sqlserver.py`, `config.py`, `CertCadastroPage.tsx` e
`shared/lib/cert-api-client.ts`. Contrato operacional: [CERT-LINX-WRITE](CERT-LINX-WRITE.md).

Testes de regra de fim de venda, guardas e cadastro executados com mocks; reprodução de CLI com
serviço real e fontes simuladas. Testes PostgreSQL usam container descartável, dados sintéticos e
reader real de Encerramentos alimentado por planilha simulada. Na preparação de release, o teste
opt-in `test_linx_sqlserver_integration.py` também passou em SQL Server 2022 real isolado, com
INSERT/UPDATE, confirmação pós-commit, licenciamento intacto, duplicidade e trigger divergente.
Isso comprova o writer nesse ambiente sintético, não uma gravação no ERP de produção. Resultados finais e checkpoint na seção 13 do
[STATUS certificação](STATUS-2026-09-18-CERTIFICACAO-SYNC-PARADO.md).
