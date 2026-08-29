import type { Response } from 'express';

export function sendSuccess(res: Response, data: unknown, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

/**
 * Redacao de detalhe de infraestrutura na mensagem que vai para o cliente.
 *
 * O idioma do repositorio e `catch (error) { sendError(res, error.message) }` —
 * 107 pontos de chamada. Quando o erro vem do driver, e a mensagem do driver que
 * sai na resposta HTTP. Demonstrado por sonda em 2026-08-29, com os tres casos
 * abaixo saindo intactos para um usuario autenticado:
 *
 *   connect ECONNREFUSED 172.19.0.4:5432          -> topologia da rede interna
 *   column "comparison_field_overrides.field_key" -> esquema do banco
 *   value too long for type character varying(500)-> tipo e limite da coluna
 *
 * A redacao mora AQUI, e nao em cada catch, porque e o unico ponto por onde toda
 * mensagem de erro sai. E e por padrao, e nao por lista de rotas: rota nova
 * nasce protegida.
 *
 * Por que redigir em vez de trocar tudo por uma mensagem generica: `AppError`
 * so cobre metade dos lancamentos (82 contra 80 `throw new Error` cru), entao
 * "so AppError passa" apagaria 80 mensagens escritas para o operador ler. A
 * redacao preserva o texto humano e tira so o identificador de maquina.
 *
 * A mensagem integral continua no log do servidor, com o correlation id.
 */
const REDACOES: Array<[RegExp, string]> = [
  // IPv4 com porta opcional: "ECONNREFUSED 172.19.0.4:5432".
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '[endereco interno]'],
  // Identificador de esquema entre aspas que o Postgres devolve.
  [/\b(column|relation|constraint|table|index|type)\s+"[^"]{1,200}"/gi, '$1 [interno]'],
  // Texto cru do driver sobre tipo/limite de coluna.
  // O tipo do Postgres tem espaco e parenteses ("character varying(500)"),
  // entao parar no primeiro espaco deixava "varying(500)" vazando.
  [/value too long for type [^,;]*/gi, 'valor acima do tamanho permitido'],
  // Caminho absoluto do servidor. Restrito as raizes reais do container para
  // nao pegar rota de API ("/api/processes") em mensagem legitima.
  [/\/(?:home|app|uploads|var|usr|etc|tmp|root|opt)(?:\/[\w.@%+-]+)*/g, '[caminho interno]'],
];

/** Aplica a redacao. Exportada para o teste poder exercitar caso a caso. */
export function redactInternalDetail(message: string): string {
  return REDACOES.reduce((texto, [padrao, troca]) => texto.replace(padrao, troca), message);
}

export function sendError(res: Response, message: string, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    error: redactInternalDetail(message),
  });
}

export function sendPaginated(
  res: Response,
  data: unknown,
  total: number,
  page: number,
  limit: number,
) {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}
