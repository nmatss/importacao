import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir confirmação
      </button>
      <ConfirmDialog
        isOpen={open}
        title="Confirmar operação"
        message="Revise antes de continuar."
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ModalPortal accessibility contract', () => {
  it('locks background scroll, traps focus and restores the opener on Escape', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const opener = screen.getByRole('button', { name: 'Abrir confirmação' });

    await user.click(opener);
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });
});
