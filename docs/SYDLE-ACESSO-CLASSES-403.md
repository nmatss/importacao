# Pedido de acesso de leitura — classes financeiras (SYDLE One)

Rascunho para enviar ao suporte/admin da SYDLE. **Rascunho criado no Gmail em
2026-06-27 — revisar destinatário e enviar.** Versão pronta na seção
[E-mail pronto](#e-mail-pronto) ao final.

## Contexto

Integramos o relatório **Compras e Pagamentos Internacionais** do portal de
Importação à instância `grupounico.sydle.one` (app `main`), lendo, em modo
**somente leitura** (`signIn` + `_search`), a classe de pagamentos
`68bf1179b042c72f03993928` e as classes vizinhas do fluxo.

Um probe read-only (2026-06-21) confirmou que conseguimos ler: pagamentos,
ticket, ticket_status, currency, brand, recipient, enterprise e as classes de
sistema (usuário/processo). Com isso já trazemos **código do processo, invoice,
marca e fornecedor**.

Faltam os dados **financeiros** (taxa de câmbio, valor em BRL, banco, contrato de
câmbio, proforma/PI e remessa/SWIFT). Eles **não vêm** no payload da classe de
pagamentos — estão em duas classes que retornam **HTTP 403** para o nosso
usuário de integração.

## O que pedimos

Conceder **permissão de leitura (read-only)** ao usuário de integração
`nicolas.matsuda@grupounico.com` (ou a um usuário de serviço dedicado, se
preferirem) sobre as duas classes abaixo — ou, alternativamente, expor uma
**view/relatório/API consolidada** com esses campos:

| Classe (`_classId`)        | Como é referenciada no fluxo            | Suspeita de conter                                 |
| -------------------------- | --------------------------------------- | -------------------------------------------------- |
| `68bf1179b042c72f03995efb` | `_concreteObject` do registro de pagto. | Form detalhado do pagamento (proforma/PI, câmbio?) |
| `64f22b57e85f4a4b92376c43` | `processInstanceControl.activeElements` | Atividade do BPM (câmbio/banco/contrato/remessa?)  |

Campos de destino no nosso relatório: `exchange_rate`, `amount_brl`,
`bank_name`, `contract_number`, `proforma_number`, `remittance_id`.

## Observações

- Uso estritamente **read-only**; não escrevemos nada na SYDLE.
- Se houver restrição a campos sensíveis (dados bancários), uma view só com
  câmbio/BRL/contrato/proforma já resolve a maior parte.
- Assim que o acesso for liberado, rodamos o probe de novo (as classes passam a
  200), mapeamos o caminho dos campos e ligamos o enriquecimento — sem nova
  alteração de contrato de acesso.

## Segurança (nosso lado)

O `signIn` da SYDLE One só aceita **GET com login/senha na query string**
(POST → HTTP 405). Isso expõe a credencial a logs de proxy/WAF. Pedimos também,
se possível, um método de **autenticação por token/header ou POST**, para
eliminarmos esse risco. Enquanto isso, rotacionamos a senha periodicamente.

## E-mail pronto

**Destinatário:** gerente de conta / suporte SYDLE (preencher).
**Assunto:** Grupo Uni.co — pedido de acesso de leitura a 2 classes financeiras (instância grupounico.sydle.one)

> Olá, tudo bem?
>
> Sou o Nicolas, da TI do Grupo Uni.co. Integramos nosso portal de Importação à
> nossa instância `grupounico.sydle.one` (app `main`) para montar um relatório
> de **Compras e Pagamentos Internacionais**, lendo em **modo somente leitura**
> (`signIn` + `_search`) a classe de pagamentos `68bf1179b042c72f03993928` e as
> classes vizinhas do fluxo.
>
> Já conseguimos ler pagamentos, ticket, status, moeda, marca, fornecedor e
> empresa — com isso trazemos código do processo, invoice, marca e fornecedor.
> Porém, os dados **financeiros** (taxa de câmbio, valor em BRL, banco, contrato
> de câmbio, proforma/PI e remessa/SWIFT) retornam **HTTP 403** para o nosso
> usuário de integração, pois vivem em duas classes às quais não temos acesso:
>
> - `68bf1179b042c72f03995efb` (`_concreteObject` do registro de pagamento)
> - `64f22b57e85f4a4b92376c43` (`processInstanceControl.activeElements` do BPM)
>
> **Poderiam conceder permissão de leitura (read-only)** a essas duas classes
> para o nosso usuário de integração — ou, se preferirem, expor uma view/API
> consolidada com os campos `exchange_rate`, `amount_brl`, `bank_name`,
> `contract_number`, `proforma_number` e `remittance_id`? O uso é estritamente
> read-only; não escrevemos nada na SYDLE. Se houver restrição a dados bancários,
> uma view só com câmbio/BRL/contrato/proforma já resolve a maior parte.
>
> Aproveitando: o `signIn` da instância só aceita GET com login/senha na query
> string (POST retorna 405), o que expõe a credencial em logs. Vocês oferecem
> autenticação por **token/header ou POST**? Ajudaria bastante na segurança.
>
> Obrigado!
> Nicolas Matsuda — Tecnologia da Informação — Grupo Uni.co
