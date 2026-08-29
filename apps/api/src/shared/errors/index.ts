export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: number | string) {
    super(id ? `${entity} #${id} nao encontrado` : `${entity} nao encontrado`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  readonly details: Array<{ field: string; message: string }>;
  constructor(message: string, details: Array<{ field: string; message: string }> = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Credencial invalida ou ausente — 401 de PRODUTO, escrito para a pessoa ler.
 *
 * Existe para separar "a senha esta errada" de "o banco caiu". Sem esta classe
 * o controller de login colapsava os dois no mesmo fallback 401 "Credenciais
 * invalidas": uma queda do Postgres durante o `login` respondia como se a
 * pessoa tivesse digitado errado, e quem estava na tela repetia a senha em vez
 * de acionar a infraestrutura. Agora so o que e credencial de verdade lanca
 * 401; qualquer outra excecao volta a sair como 500 generico.
 */
export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Dependencia externa indisponivel (rede, timeout, 5xx do provedor). Existe
 * para nao devolver 401 quando o Google esta fora do ar: 401 faz o front tratar
 * como sessao expirada e o usuario fica em loop de login sem saber o motivo.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

export class IntegrationError extends AppError {
  readonly service: string;
  constructor(service: string, message: string) {
    super(`${service}: ${message}`, 502, 'INTEGRATION_ERROR');
    this.service = service;
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(`Transicao invalida: ${from} -> ${to}`, 400, 'INVALID_TRANSITION');
  }
}
