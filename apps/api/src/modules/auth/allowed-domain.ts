/**
 * Allowlist de organizacao no login Google.
 *
 * `ALLOWED_DOMAIN` aceita um dominio ou uma lista separada por virgula/espaco.
 * Precisa cobrir o dominio primario do Workspace e os secundarios de marca
 * (ex.: @imaginarium.com no Grupo Unico). O claim `hd`, quando presente, tambem
 * tem de estar nessa lista — continua sendo a barreira contra outra empresa.
 */

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : 'desconhecido';
}

export function parseAllowedDomains(raw: string): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const part of raw.split(/[,;\s]+/)) {
    const domain = part.trim().toLowerCase().replace(/^@+/, '');
    if (!domain || domain.includes('/') || !domain.includes('.') || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }

  return domains;
}

export function evaluateCorporateAccount(
  email: string,
  hd: string | undefined | null,
  allowedDomains: string[],
): { allowed: boolean; hostedDomainOk: boolean; emailSuffixOk: boolean } {
  // Deny by default. An empty allowlist used to admit any Google account;
  // production must set ALLOWED_DOMAIN, and local/test without it must not
  // silently open the tenant.
  if (allowedDomains.length === 0) {
    return { allowed: false, hostedDomainOk: false, emailSuffixOk: false };
  }

  const hostedDomainOk = hd == null || hd === '' || allowedDomains.includes(hd.toLowerCase());
  const emailSuffixOk = allowedDomains.includes(domainOf(email));

  return {
    allowed: hostedDomainOk && emailSuffixOk,
    hostedDomainOk,
    emailSuffixOk,
  };
}

export function formatAllowedDomainsMessage(allowedDomains: string[]): string {
  if (allowedDomains.length === 0) {
    return 'Acesso restrito a contas corporativas do Grupo Unico';
  }
  if (allowedDomains.length === 1) {
    return `Acesso restrito a contas @${allowedDomains[0]}`;
  }

  const labels = allowedDomains.map((domain) => `@${domain}`);
  const last = labels.pop();
  return `Acesso restrito a contas ${labels.join(', ')} ou ${last}`;
}
