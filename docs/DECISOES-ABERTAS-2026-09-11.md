# Decisoes abertas com Eduarda/Odett — reuniao 11/09/2026

Cada item abaixo ja tem uma opcao implementada como padrao reversivel (marcada "Padrao adotado"). Basta confirmar ou pedir a troca.

## Leitura de documentos (Drive)

1. **PENDENTES x pasta da marca** — Padrao adotado: prioridade POR TIPO de documento (se a invoice estiver em PENDENTES, vale a de PENDENTES; se o BL so estiver na pasta da marca, ele e lido de la). Alternativa literal: se PENDENTES tiver qualquer arquivo, ignorar a pasta da marca inteira.
2. **Duas pastas com o mesmo codigo em PENDENTES** (ex.: PK2122607NB criada em 04/09 e 09/09) — Padrao: le as duas, sem duplicar arquivo igual, e avisa "pasta duplicada".
3. **Espelho editado depois de lido** — Padrao: o sistema relê a nova versao e o comparativo usa a mais recente.
4. **Upload manual pela tela** — Padrao: continua permitido, sem duplicar quando o mesmo arquivo aparecer no Drive.
5. **Pasta em PENDENTES de um codigo que ainda nao existe no sistema** — Padrao: so avisar; nao cria processo sozinho.

## Comparativo e leitura

6. **Regra dos 90% do BL** — Padrao: o BL continua sendo usado a partir de 40% (como hoje), mas abaixo de 90% aparece como "revisar", com o motivo. Alternativa literal: abaixo de 90% = nao utilizavel (hoje isso descartaria praticamente todos os BLs).
7. **Linhas "Nao verificado"** — Padrao: quando a integracao nao responde (ex.: Odoo) ou a Follow Up nao tem o dado (ex.: frete), a linha fica visivel como "Nao verificado — motivo", sem contar como atencao.
8. **Divergencia de FOB Follow Up x invoice** (PK220: 101.346,01 x 101.246,01) — Padrao: a capa mostra o valor da Follow Up e sinaliza a divergencia; a decisao fica no comparativo. Confirmar se os USD 100 do certificado de origem deveriam estar na invoice.
9. **Fornecedor da Follow Up (UNITED/CHUYANG) x exportador (KIOM)** — Padrao: fornecedor aparece como informativo, fora do status, porque nao e o mesmo papel.

## Checklist e documentos

10. **Etapas padrao** — Padrao: saem do catalogo "Coletar Assinaturas" e "Enviar Docs Assinados"; fica "Enviar Invoice Fenicia". Cada processo tambem pode ocultar etapas e incluir etapas proprias na posicao desejada.
11. **Exclusao de documento pelas analistas** — Padrao: qualquer documento, com motivo obrigatorio e historico; documento excluido nao volta pelo Drive.

## Registro / DUIMP

12. **Tolerancia DUIMP x invoice/espelho** (FOB, pesos) — Padrao: as mesmas tolerancias do comparativo de documentos.
13. **Data de registro** — Padrao: exibida a partir da Follow Up e da DUIMP, sem gravar no processo automaticamente.

## Certificacao e licenciamento

14. **U = "SKU excluido"** — Padrao: tratado como ENCERRADO.
15. **SKU que so existe em Encerramentos** — Padrao: ENCERRADO.
16. **Encerrado com "Comercializacao Permitida" mas prazo ja vencido** (050403179, 050403180, PI6014Y) — Padrao: vale a data (bloqueado).
17. **"Zerar" propriedade no Linx** — Padrao: gravar 01/01/1900 (convencao atual). Execucao da carga so depois do aceite de voces sobre o relatorio antes/depois.
18. **Licenciamento na carga do zero** — Padrao: NAO zerar licenciamento (quem mantem e o time de produto no Linx); recarregar so a certificacao.
19. **Dono da gravacao do FIM_VENDAS no Linx** (sistema ou rotina do time Linx/Eli/Tiago) — em aberto.
20. **Dupla certificacao** — Padrao: um unico certificado ativo por SKU; o anterior vira encerrado com fim de venda proprio. Coluna N "Dupla certificacao" usada so como confirmacao.
21. **Quebra-cabecas do marketplace** — Padrao: menos de 500 pecas exige certificacao; 500 ou mais nao exige; sem numero de pecas = "revisar".
22. **Sincronizacao da planilha** — Padrao: botao "Sincronizar agora" liberado para as analistas e sincronizacao automatica a cada 1 hora.
23. **Grife para filtro de licenciamento** — Padrao: Puket = GRIFFE do Linx; Imaginarium = IMG_LICENCIAMENTO (preenchido hoje em poucos produtos — o time de produto vai manter?).

## Alertas no Chat

24. **Cadencia do aviso de processo parado** — Padrao: um resumo por dia util as 09:00, so quando muda; cada processo no maximo a cada 5 dias uteis; processos em transito ficam quietos ate 30 dias uteis sem atualizacao.
