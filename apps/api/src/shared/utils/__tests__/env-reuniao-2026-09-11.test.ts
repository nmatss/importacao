import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guarda ESTATICA das variaveis criadas para a reuniao de 2026-09-11.
 *
 * `env-repassado-ao-container.test.ts` so enxerga variavel que o codigo LE
 * com `process.env.X`. Estas cinco nascem declaradas em `config/env.ts` antes
 * de qualquer leitura (os times que as consomem trabalham em paralelo), entao
 * aquela guarda nao as cobre ainda. Sem esta, uma delas poderia ficar fora da
 * lista explicita do servico `api` e o defeito seria mudo: definida no `.env`
 * de producao, sem efeito nenhum no container.
 */
const RAIZ = path.resolve(process.cwd(), '../..');

const NOVAS: Record<string, { padraoCompose: string }> = {
  GOOGLE_DRIVE_PENDENTES_FOLDER_ID: { padraoCompose: '' },
  GOOGLE_DRIVE_ESPELHOS_FOLDER_ID: { padraoCompose: '' },
  // Vazio de proposito: o padrao depende de DOCUMENT_SOURCE e mora no codigo.
  DRIVE_WRITE_MODE: { padraoCompose: '' },
  MANUAL_UPLOAD_ENABLED: { padraoCompose: 'true' },
  FOLLOW_UP_SYNC_MODE: { padraoCompose: 'dry_run' },
};

function ler(arquivo: string): string {
  return fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
}

function blocoApi(compose: string): string {
  // O servico seguinte ao `api` difere entre os dois arquivos; o bloco termina
  // no proximo servico de primeiro nivel.
  const depois = compose.split('\n  api:')[1] ?? '';
  return depois.split(/\n {2}[a-z][a-z0-9-]*:\n/)[0] ?? '';
}

describe('variaveis da reuniao 2026-09-11 chegam ao container', () => {
  it.each(['docker-compose.yml', 'docker-compose.prod.yml'])(
    '%s: todas na lista explicita do servico api, com o padrao certo',
    (arquivo) => {
      const bloco = blocoApi(ler(arquivo));
      expect(bloco).toContain('DATABASE_URL');

      for (const [nome, { padraoCompose }] of Object.entries(NOVAS)) {
        expect(bloco, `${nome} ausente do servico api em ${arquivo}`).toContain(
          `      ${nome}: \${${nome}:-${padraoCompose}}\n`,
        );
      }
    },
  );

  it('todas declaradas no env.ts', () => {
    const envTs = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/config/env.ts'), 'utf8');
    for (const nome of Object.keys(NOVAS)) {
      expect(envTs, `${nome} ausente do env.ts`).toMatch(new RegExp(`^\\s{4}${nome}: z\\.`, 'm'));
    }
  });

  it('todas documentadas no .env.example e no .env.sops.yaml.example', () => {
    const exemplo = ler('.env.example');
    const sops = ler('.env.sops.yaml.example');
    for (const nome of Object.keys(NOVAS)) {
      expect(exemplo, `${nome} ausente do .env.example`).toMatch(new RegExp(`^${nome}=`, 'm'));
      expect(sops, `${nome} ausente do .env.sops.yaml.example`).toMatch(
        new RegExp(`^${nome}:`, 'm'),
      );
    }
  });
});
