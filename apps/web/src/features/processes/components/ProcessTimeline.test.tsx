import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcessTimeline } from './ProcessTimeline';

describe('ProcessTimeline', () => {
  it('names the mobile carousel controls for assistive technologies', () => {
    render(<ProcessTimeline currentStatus="validated" followUp={null} />);

    expect(screen.getByRole('button', { name: 'Etapa anterior do processo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Próxima etapa do processo' })).toBeEnabled();
  });
});
