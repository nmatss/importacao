import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TabErrorBoundary } from './ComparisonTab';

function Boom(): JSX.Element {
  throw new Error('explosao na aba');
}

describe('TabErrorBoundary', () => {
  // React logs the caught error to the console during the error path; silence it
  // so the test output stays readable without hiding real failures.
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the localized fallback instead of crashing when a child throws', () => {
    render(
      <TabErrorBoundary label="Validação">
        <Boom />
      </TabErrorBoundary>,
    );

    // Localized fallback, NOT a white screen / app-wide reload prompt.
    expect(screen.getByRole('alert')).toHaveTextContent(/Algo deu errado nesta aba/i);
    expect(screen.getByText(/explosao na aba/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument();
  });

  it('renders its children unchanged when nothing throws', () => {
    render(
      <TabErrorBoundary>
        <p>conteudo saudavel</p>
      </TabErrorBoundary>,
    );

    expect(screen.getByText('conteudo saudavel')).toBeInTheDocument();
    expect(screen.queryByText(/Algo deu errado nesta aba/i)).not.toBeInTheDocument();
  });

  it('retry resets the boundary so a recovered child can render', () => {
    let shouldThrow = true;
    function Flaky(): JSX.Element {
      if (shouldThrow) throw new Error('falha temporaria');
      return <p>recuperado</p>;
    }

    render(
      <TabErrorBoundary>
        <Flaky />
      </TabErrorBoundary>,
    );

    expect(screen.getByText(/Algo deu errado nesta aba/i)).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/i }));

    expect(screen.getByText('recuperado')).toBeInTheDocument();
  });
});
