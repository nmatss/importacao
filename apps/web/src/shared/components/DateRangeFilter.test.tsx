import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateRangeFilter } from './DateRangeFilter';

describe('DateRangeFilter', () => {
  it('holds an inverted interval until both dates form a valid range', () => {
    const start = vi.fn();
    const end = vi.fn();
    render(
      <DateRangeFilter
        startDate="2026-09-01"
        endDate="2026-09-18"
        onStartDateChange={start}
        onEndDateChange={end}
      />,
    );
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-09-20' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-09-22' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(start).toHaveBeenCalledWith('2026-09-20');
    expect(end).toHaveBeenCalledWith('2026-09-22');
  });

  it('allows clearing a bound and accepts equal dates', () => {
    const end = vi.fn();
    render(
      <DateRangeFilter
        startDate="2026-09-18"
        endDate="2026-09-20"
        onStartDateChange={vi.fn()}
        onEndDateChange={end}
      />,
    );
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-09-18' } });
    expect(end).toHaveBeenCalledWith('2026-09-18');
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '' } });
    expect(end).toHaveBeenCalledWith('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
