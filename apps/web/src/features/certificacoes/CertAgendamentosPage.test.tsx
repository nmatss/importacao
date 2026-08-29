import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertSchedules: vi.fn(),
    fetchCertScheduleHistory: vi.fn(),
    fetchCertValidationStatus: vi.fn(),
    runCertScheduleNow: vi.fn(),
    updateCertSchedule: vi.fn(),
    createCertSchedule: vi.fn(),
    deleteCertSchedule: vi.fn(),
  };
});

import {
  fetchCertSchedules,
  fetchCertScheduleHistory,
  type CertSchedule,
} from '@/shared/lib/cert-api-client';
import { cronToHuman } from '@/shared/lib/utils';
import CertAgendamentosPage, {
  FREQUENCY_PRESETS,
  validateCronExpression,
} from './CertAgendamentosPage';

const mockedSchedules = vi.mocked(fetchCertSchedules);
const mockedHistory = vi.mocked(fetchCertScheduleHistory);

function preset(value: string) {
  const found = FREQUENCY_PRESETS.find((p) => p.value === value);
  if (!found) throw new Error(`preset ${value} não existe`);
  return found;
}

// ── Item 2: convenção do dia da semana ────────────────────────────────────
// O backend grava e devolve CRONTAB (0 = domingo, 1 = segunda … 6 = sábado) e
// traduz para o APScheduler (0 = segunda) só na montagem do job. Validação e
// exibição no frontend têm de falar a MESMA convenção — antes `CRON_DOW_ALIASES`
// usava `mon: 0` (APScheduler) e `dayOfWeekNames` usava `0: domingo` (crontab).
describe('convenção crontab de dia da semana', () => {
  it('os quatro presets carregam expressões crontab válidas', () => {
    expect(preset('daily').cron).toBe('0 6 * * *');
    expect(preset('weekly_mon').cron).toBe('0 6 * * 1');
    expect(preset('weekly_fri').cron).toBe('0 6 * * 5');
    expect(preset('monthly').cron).toBe('0 6 1 * *');

    for (const value of ['daily', 'weekly_mon', 'weekly_fri', 'monthly']) {
      expect(validateCronExpression(preset(value).cron)).toBe('');
    }
  });

  it('exibe cada preset no dia que ele realmente dispara', () => {
    expect(cronToHuman(preset('daily').cron)).toBe('Diariamente às 06:00');
    expect(cronToHuman(preset('weekly_mon').cron)).toBe('Toda segunda-feira às 06:00');
    expect(cronToHuman(preset('weekly_fri').cron)).toBe('Toda sexta-feira às 06:00');
    expect(cronToHuman(preset('monthly').cron)).toBe('Todo dia 1 às 06:00');
  });

  it('numera os dias na convenção crontab (0 e 7 = domingo, 6 = sábado)', () => {
    expect(cronToHuman('0 6 * * 0')).toBe('Toda domingo às 06:00');
    expect(cronToHuman('0 6 * * 7')).toBe('Toda domingo às 06:00');
    expect(cronToHuman('0 6 * * 6')).toBe('Toda sábado às 06:00');
    expect(cronToHuman('0 8 * * 1-5')).toBe('segunda-feira a sexta-feira às 08:00');
  });

  it('aceita e exibe alias textual num cron personalizado', () => {
    // `mon` vale segunda nas duas convenções; o que não podia acontecer era a
    // validação tratá-lo como 0 (= domingo em crontab).
    expect(validateCronExpression('0 8 * * mon')).toBe('');
    expect(validateCronExpression('30 7 * * fri')).toBe('');
    expect(validateCronExpression('0 8 * * mon-fri')).toBe('');
    expect(cronToHuman('0 8 * * mon')).toBe('Toda segunda-feira às 08:00');
    expect(cronToHuman('0 8 * * MON')).toBe('Toda segunda-feira às 08:00');
    expect(cronToHuman('0 8 * * mon-fri')).toBe('segunda-feira a sexta-feira às 08:00');
  });

  it('aceita 7 como domingo e rejeita dia da semana fora de 0-7', () => {
    expect(validateCronExpression('0 6 * * 7')).toBe('');
    expect(validateCronExpression('0 6 * * 8')).not.toBe('');
    expect(validateCronExpression('0 6 * * xyz')).not.toBe('');
    expect(validateCronExpression('0 6 * *')).not.toBe('');
  });
});

// ── Item 9: estados do histórico e vazamento entre edições ────────────────
const scheduleFixture: CertSchedule = {
  id: 'sch-1',
  name: 'Validação diária',
  cron_expression: '0 6 * * 1',
  brand_filter: null,
  enabled: true,
  last_run: null,
  next_run: null,
  created_at: '2026-08-01T00:00:00Z',
};

describe('CertAgendamentosPage', () => {
  beforeEach(() => {
    mockedSchedules.mockReset();
    mockedHistory.mockReset();
    mockedSchedules.mockResolvedValue([scheduleFixture]);
    mockedHistory.mockResolvedValue([]);
  });

  it('rotula os três estados do histórico em vez de uma bolinha vermelha muda', async () => {
    mockedHistory.mockResolvedValue([
      {
        id: 'h1',
        schedule_id: 'sch-1',
        run_date: '2026-08-20T09:00:00Z',
        status: 'completed',
        summary: null,
        report_file: null,
      },
      {
        id: 'h2',
        schedule_id: 'sch-1',
        run_date: '2026-08-21T09:00:00Z',
        status: 'running',
        summary: null,
        report_file: null,
      },
      {
        id: 'h3',
        schedule_id: 'sch-1',
        run_date: '2026-08-22T09:00:00Z',
        status: 'failed',
        summary: null,
        report_file: null,
      },
    ]);

    render(<CertAgendamentosPage />);
    await screen.findByText('Validação diária');

    await userEvent.click(
      screen.getByRole('button', { name: /Mostrar historico do agendamento/i }),
    );

    expect(await screen.findByText('Concluído')).toBeInTheDocument();
    expect(screen.getByText('Em execução')).toBeInTheDocument();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('mostra estado vazio distinto (com limpar filtro) quando há filtro de período', async () => {
    mockedSchedules.mockResolvedValue([]);
    render(<CertAgendamentosPage />);

    // Sem filtro: convite a criar.
    expect(await screen.findByText('Nenhum agendamento configurado')).toBeInTheDocument();

    const startInput = document.querySelector<HTMLInputElement>('input[type="date"]');
    expect(startInput).not.toBeNull();
    await userEvent.type(startInput as HTMLInputElement, '2026-01-01');

    await waitFor(() =>
      expect(screen.getByText('Nenhum agendamento no período')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Limpar filtro/i })).toBeInTheDocument();
  });

  it('não vaza o cron personalizado de uma edição para a seguinte', async () => {
    mockedSchedules.mockResolvedValue([
      { ...scheduleFixture, id: 'a', name: 'Custom', cron_expression: '15 3 * * 2,4' },
      { ...scheduleFixture, id: 'b', name: 'Diario', cron_expression: '0 6 * * *' },
    ]);

    render(<CertAgendamentosPage />);
    await screen.findByText('Custom');

    const editButtons = screen.getAllByRole('button', { name: 'Editar agendamento' });

    // 1) abre o custom -> o campo traz a expressão
    await userEvent.click(editButtons[0]);
    expect(await screen.findByLabelText('Expressão Cron')).toHaveValue('15 3 * * 2,4');

    // 2) fecha
    await userEvent.click(screen.getByRole('button', { name: 'Fechar modal' }));

    // 3) abre o NÃO-custom e troca a frequência para "Personalizado"
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar agendamento' })[1]);
    await userEvent.selectOptions(await screen.findByLabelText('Frequência'), 'custom');

    expect(screen.getByLabelText('Expressão Cron')).toHaveValue('');
  });
});
