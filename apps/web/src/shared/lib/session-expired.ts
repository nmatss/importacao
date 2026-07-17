/**
 * Tratamento único de sessão expirada (auditoria 2026-07-17): antes os dois
 * clients faziam `window.location='/login'` seco no primeiro 401 — o operador
 * perdia formulário preenchido sem nenhum aviso do porquê. Agora: guarda a
 * rota atual para voltar depois do login e sinaliza o motivo na URL para o
 * LoginPage explicar ("Sessão expirada").
 */

const RETURN_TO_KEY = 'importacao_return_to';

export function redirectToLogin(): void {
  const current = window.location.pathname + window.location.search;
  if (!current.startsWith('/login')) {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, current);
    } catch {
      // sessionStorage indisponível (modo privado antigo) — segue sem returnTo.
    }
  }
  window.location.href = '/login?expired=1';
}

/** Consome (lê e limpa) a rota salva antes da expiração da sessão. */
export function consumeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    if (value) sessionStorage.removeItem(RETURN_TO_KEY);
    return value;
  } catch {
    return null;
  }
}
