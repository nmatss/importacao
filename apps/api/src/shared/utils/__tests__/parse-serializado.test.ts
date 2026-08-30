import { describe, it, expect, beforeEach } from 'vitest';
import { parseSerializado, resetarFilaSerial } from '../parse-serializado.js';

/**
 * A guarda de arquivo compactado tem orcamento POR ARQUIVO. Para xlsx isso ja e
 * o pico, porque `XLSX.read` e sincrono e prende o event loop. Para docx nao:
 * `mammoth.extractRawText` e assincrono, dois parses intercalam e o pico vira a
 * SOMA — o que estoura o container de 512M com dois arquivos no teto.
 */
beforeEach(() => resetarFilaSerial());

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('parseSerializado()', () => {
  it('nao deixa dois parses se sobreporem', async () => {
    const eventos: string[] = [];

    const um = parseSerializado(async () => {
      eventos.push('1:inicio');
      await espera(30);
      eventos.push('1:fim');
    }, 'a');

    const dois = parseSerializado(async () => {
      eventos.push('2:inicio');
      await espera(5);
      eventos.push('2:fim');
    }, 'b');

    await Promise.all([um, dois]);

    // Sem a fila, a ordem seria 1:inicio, 2:inicio, 2:fim, 1:fim.
    expect(eventos).toEqual(['1:inicio', '1:fim', '2:inicio', '2:fim']);
  });

  it('parse que falha nao trava os seguintes', async () => {
    await expect(
      parseSerializado(async () => {
        throw new Error('formato invalido');
      }, 'ruim'),
    ).rejects.toThrow('formato invalido');

    await expect(parseSerializado(async () => 'ok', 'bom')).resolves.toBe('ok');
  });

  it('parse travado libera a fila pelo teto, em vez de segurar todo mundo', async () => {
    const travado = parseSerializado(() => new Promise(() => {}), 'travado', 20);

    await expect(travado).rejects.toThrow(/excedeu 20ms/);
    // A fila seguiu: o proximo entra normalmente.
    await expect(parseSerializado(async () => 'depois', 'ok')).resolves.toBe('depois');
  });

  it('devolve o valor do parse', async () => {
    await expect(parseSerializado(async () => ({ text: 'x' }), 'v')).resolves.toEqual({
      text: 'x',
    });
  });
});
