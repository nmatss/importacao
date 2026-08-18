import { describe, it, expect, beforeEach, vi } from 'vitest';

// O modulo importa a conexao real so para a consulta do job; as regras aqui
// sao puras. Sem estes stubs o import exige DATABASE_URL.
vi.mock('../../shared/database/connection.js', () => ({ db: {} }));
vi.mock('../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../modules/alerts/service.js', () => ({
  alertService: { create: vi.fn(), hasDuplicateRecent: vi.fn() },
}));

const { daysSince, highestMilestoneReached, dedupeWindowHours } =
  await import('../stalled-process.js');

/**
 * O job emitia um alerta por processo parado A CADA execucao diaria. Como
 * "parado ha mais de 3 dias" nunca deixa de ser verdade, viraram 74 alertas por
 * dia util numa base de 104 processos — 97% de tudo que existe na tabela
 * `alerts`, afogando os criticos de falha de extracao.
 */
describe('regra de marcos do processo parado', () => {
  beforeEach(() => {
    delete process.env.STALLED_PROCESS_MILESTONE_DAYS;
  });

  describe('daysSince()', () => {
    it('conta dias inteiros', () => {
      const agora = new Date('2026-08-17T12:00:00Z').getTime();
      expect(daysSince('2026-08-14T12:00:00Z', agora)).toBe(3);
      expect(daysSince('2026-08-17T11:00:00Z', agora)).toBe(0);
    });
  });

  describe('highestMilestoneReached()', () => {
    it('devolve o marco no dia em que o processo o cruza', () => {
      expect(highestMilestoneReached(3)).toBe(3);
      expect(highestMilestoneReached(7)).toBe(7);
      expect(highestMilestoneReached(60)).toBe(60);
    });

    it('nao alerta antes do primeiro marco', () => {
      expect(highestMilestoneReached(0)).toBeNull();
      expect(highestMilestoneReached(2)).toBeNull();
    });

    it('mantem o marco anterior enquanto o proximo nao chega', () => {
      // Aqui esta a diferenca em relacao a casar o dia exato: nos dias 4, 5 e 6
      // o marco continua sendo o 3, e quem impede a repeticao e a janela de
      // deduplicacao — nao o silencio da funcao.
      expect(highestMilestoneReached(4)).toBe(3);
      expect(highestMilestoneReached(6)).toBe(3);
      expect(highestMilestoneReached(13)).toBe(7);
      expect(highestMilestoneReached(29)).toBe(14);
    });

    it('SOBREVIVE a uma execucao perdida do cron', () => {
      // Casar o dia exato perderia o marco de vez quando o job nao roda — e ele
      // nao roda em dia de deploy, porque o container e recriado. No dia 8 o
      // marco 7 ainda e alcancavel.
      expect(highestMilestoneReached(8)).toBe(7);
      expect(highestMilestoneReached(35)).toBe(30);
    });

    it('nao passa do ultimo marco', () => {
      expect(highestMilestoneReached(500)).toBe(60);
    });

    it('respeita marcos configurados', () => {
      expect(highestMilestoneReached(6, [5, 10])).toBe(5);
      expect(highestMilestoneReached(3, [5, 10])).toBeNull();
    });
  });

  describe('dedupeWindowHours()', () => {
    it('a janela e o espaco ate o proximo marco', () => {
      expect(dedupeWindowHours(3)).toBe(4 * 24);
      expect(dedupeWindowHours(7)).toBe(7 * 24);
      expect(dedupeWindowHours(14)).toBe(16 * 24);
      expect(dedupeWindowHours(30)).toBe(30 * 24);
    });

    it('o ultimo marco lembra a cada 30 dias em vez de sumir', () => {
      // Um processo parado ha mais de 60 dias merece ser lembrado de vez em
      // quando; deduplicar "para sempre" o transformaria em esquecimento.
      expect(dedupeWindowHours(60)).toBe(30 * 24);
    });

    it('a janela nunca cobre o marco seguinte', () => {
      // Se cobrisse, o alerta do marco maior seria engolido pelo do menor.
      const marcos = [3, 7, 14, 30, 60];
      for (let i = 0; i < marcos.length - 1; i++) {
        const janelaDias = dedupeWindowHours(marcos[i], marcos) / 24;
        expect(marcos[i] + janelaDias).toBeLessThanOrEqual(marcos[i + 1]);
      }
    });
  });

  describe('volume resultante', () => {
    it('um processo parado por 90 dias gera 5 alertas, nao 88', () => {
      const marcos = [3, 7, 14, 30, 60];
      const emitidos: number[] = [];
      let ultimoEmitidoEm: Record<number, number> = {};

      for (let dia = 0; dia <= 90; dia++) {
        const marco = highestMilestoneReached(dia, marcos);
        if (marco === null) continue;
        const janelaDias = dedupeWindowHours(marco, marcos) / 24;
        const anterior = ultimoEmitidoEm[marco];
        if (anterior !== undefined && dia - anterior < janelaDias) continue;
        ultimoEmitidoEm = { ...ultimoEmitidoEm, [marco]: dia };
        emitidos.push(marco);
      }

      expect(emitidos).toEqual([3, 7, 14, 30, 60, 60]);
    });

    it('74 processos parados ha muito tempo nao geram enxurrada diaria', () => {
      // Cenario real medido em producao: 74 processos parados, quase todos ha
      // muito mais que o ultimo marco. Todos caem no marco 60, cuja janela e de
      // 30 dias — ou seja, no maximo uma lembranca mensal por processo, nao 74
      // mensagens por dia.
      const diasDosProcessos = Array.from({ length: 74 }, (_, i) => 100 + i);
      const marcosAtingidos = diasDosProcessos.map((d) => highestMilestoneReached(d));

      expect(new Set(marcosAtingidos)).toEqual(new Set([60]));
      expect(dedupeWindowHours(60) / 24).toBe(30);
    });
  });
});
