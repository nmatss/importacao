/**
 * Extracts a human-readable error message from various error types.
 * Used throughout the frontend to display consistent error feedback.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return 'Ocorreu um erro inesperado';
}

export function isApiError(
  err: unknown,
): err is { response?: { data?: { error?: string } } } {
  return err !== null && typeof err === 'object' && 'response' in err;
}
