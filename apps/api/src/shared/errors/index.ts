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
