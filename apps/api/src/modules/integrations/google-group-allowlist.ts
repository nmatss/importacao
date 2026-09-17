/**
 * Allowlist de grupos do Workspace no login Google.
 *
 * `GOOGLE_GROUP_ALLOWED` aceita um e-mail de grupo ou uma lista. O grupo
 * operacional do portal e `importacao.aut@grupounico.com` (Portal Importacao);
 * o valor legado `importacao@grupounico.com` pode coexistir para nao
 * desligar quem so esta nesse grupo.
 */

export function parseAllowedGroups(raw: string): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];

  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email.includes('@')) continue;
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!domain.includes('.') || seen.has(email)) continue;
    seen.add(email);
    groups.push(email);
  }

  return groups;
}
