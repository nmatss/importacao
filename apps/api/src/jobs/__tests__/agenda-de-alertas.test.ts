import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guarda ESTATICA do agendamento do digest de inatividade.
 *
 * O cron rodava sete dias por semana ('0 9 * * *') e o resumo saia no sabado e
 * no domingo com a contagem da sexta — o alerta 6509 foi criado em 06/09 e
 * entregue no domingo 07/09. A regra "nada em fim de semana" vive em dois
 * lugares (o cron e a guarda dentro do job) e nenhum teste de comportamento
 * pega uma expressao de cron errada: montar o scheduler de verdade exigiria
 * banco, Gmail e Drive.
 */
const SCHEDULER = path.resolve(process.cwd(), 'src/jobs/scheduler.ts');

const fonte = fs.readFileSync(SCHEDULER, 'utf8');

describe('agenda do digest de processos parados', () => {
  it('roda de segunda a sexta, as 9h', () => {
    const bloco = /cron\.schedule\(\s*'([^']+)',[\s\S]{0,400}?checkStalledProcesses/.exec(fonte);

    expect(bloco, 'nao achei o agendamento de checkStalledProcesses').not.toBeNull();
    expect(bloco![1]).toBe('0 9 * * 1-5');
  });

  it('o fuso do agendamento e o do operador', () => {
    expect(fonte).toContain("timezone: 'America/Sao_Paulo'");
  });
});
