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
