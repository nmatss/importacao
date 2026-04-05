export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) return String((err as Record<string, unknown>).message);
  return 'Erro desconhecido';
}

export function isApiError(err: unknown): err is { response?: { data?: { error?: string } } } {
  return (
    err !== null &&
    typeof err === 'object' &&
    'response' in err
  );
}
