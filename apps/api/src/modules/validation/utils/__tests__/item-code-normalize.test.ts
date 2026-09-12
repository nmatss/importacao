import { describe, it, expect } from 'vitest';
import {
  normalizeItemCode,
  itemCodesMatch,
  itemCodesMatchLoose,
  extractBracketItemCode,
  extractCanonicalItemCode,
  cleanItemCodesInAiData,
  itemMatchKey,
  primaryItemCode,
  stripPurchaseOrderAndCollection,
} from '../item-code-normalize.js';
import {
  PK220_INVOICE_ITEMS,
  PK220_PACKING_LIST_ITEMS,
} from '../../../../__tests__/fixtures/pk220-itens.js';

describe('normalizeItemCode', () => {
  it('strips whitespace', () => {
    expect(normalizeItemCode('PI 7752Y')).toBe('PI7752Y');
  });

  it('strips dashes', () => {
    expect(normalizeItemCode('PI-7752Y')).toBe('PI7752Y');
  });

  it('strips dots and slashes', () => {
    expect(normalizeItemCode('PI.7752Y')).toBe('PI7752Y');
    expect(normalizeItemCode('PI/7752Y')).toBe('PI7752Y');
  });

  it('uppercases', () => {
    expect(normalizeItemCode('pi7752y')).toBe('PI7752Y');
  });

  it('strips FAT invoice/packing-list prefixes before item codes', () => {
    expect(normalizeItemCode('FAT03PI7765Y')).toBe('PI7765Y');
    expect(normalizeItemCode('FAT02 AC 2285Y')).toBe('AC2285Y');
  });

  it('returns empty string for null', () => {
    expect(normalizeItemCode(null)).toBe('');
    expect(normalizeItemCode(undefined)).toBe('');
  });
});

describe('itemCodesMatch', () => {
  it('resolves the PI7752Y mismatch reported by Nicolas', () => {
    expect(itemCodesMatch('PI7752Y', 'PI 7752Y')).toBe(true);
    expect(itemCodesMatch('PI7752Y', 'PI-7752Y')).toBe(true);
    expect(itemCodesMatch('pi7752y', 'PI7752Y')).toBe(true);
  });

  it('returns false for genuinely different codes', () => {
    expect(itemCodesMatch('PI7752Y', 'PI7753Y')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(itemCodesMatch('', 'PI7752Y')).toBe(false);
    expect(itemCodesMatch(null, 'PI7752Y')).toBe(false);
  });
});

describe('extractCanonicalItemCode', () => {
  it('strips collection/season column bleed (the Nicolas bug)', () => {
    expect(extractCanonicalItemCode('FALL/24 PI7752Y')).toBe('PI7752Y');
    expect(extractCanonicalItemCode('SS25 AC2285Y')).toBe('AC2285Y');
  });

  it('strips packaging column bleed', () => {
    expect(extractCanonicalItemCode('WHITE BOX PI7752Y')).toBe('PI7752Y');
    expect(extractCanonicalItemCode('PI7752Y POLYBAG')).toBe('PI7752Y');
  });

  it('strips FAT prefixes from compact packing-list codes', () => {
    expect(extractCanonicalItemCode('FAT03PI7765Y')).toBe('PI7765Y');
  });

  it('leaves plain canonical codes alone', () => {
    expect(extractCanonicalItemCode('PI7752Y')).toBe('PI7752Y');
    expect(extractCanonicalItemCode('AC2285Y')).toBe('AC2285Y');
  });

  it('leaves unrecognized codes alone (no false strip)', () => {
    expect(extractCanonicalItemCode('SOMETHING_WEIRD')).toBe('SOMETHING_WEIRD');
    expect(extractCanonicalItemCode('12345')).toBe('12345');
  });

  it('does not arbitrarily pick when multiple canonical codes appear', () => {
    expect(extractCanonicalItemCode('PI7752Y PI7753Y')).toBe('PI7752Y PI7753Y');
  });

  it('returns empty for null/empty', () => {
    expect(extractCanonicalItemCode(null)).toBe('');
    expect(extractCanonicalItemCode('')).toBe('');
  });
});

describe('cleanItemCodesInAiData', () => {
  it('cleans wrapped {value, confidence} item codes', () => {
    const data = {
      items: [
        { itemCode: { value: 'FALL/24 PI7752Y', confidence: 0.7 } },
        { itemCode: { value: 'AC2285Y', confidence: 0.9 } },
      ],
    };
    cleanItemCodesInAiData(data);
    expect(data.items[0].itemCode.value).toBe('PI7752Y');
    expect(data.items[1].itemCode.value).toBe('AC2285Y');
  });

  it('cleans plain string item codes', () => {
    const data = { items: [{ itemCode: 'WHITE BOX PI7752Y' }] };
    cleanItemCodesInAiData(data);
    expect(data.items[0].itemCode).toBe('PI7752Y');
  });

  it('is a noop when items is missing', () => {
    const data = { foo: 'bar' };
    expect(cleanItemCodesInAiData(data)).toBe(data);
  });
});

describe('codigo composto do layout Puket (PI + colecao + codigo)', () => {
  it('le o codigo entre colchetes no inicio da descricao', () => {
    expect(extractBracketItemCode('[050404509] BACKPACK KIDS A')).toBe('050404509');
    expect(extractBracketItemCode('[27.01.0007] STICKER YELLOW')).toBe('27.01.0007');
  });

  it('ignora rotulo entre colchetes que nao tem cara de codigo', () => {
    expect(extractBracketItemCode('[SET] KIT ESCOLAR')).toBe('');
    expect(extractBracketItemCode('BACKPACK [050404509]')).toBe('');
    expect(extractBracketItemCode(null)).toBe('');
  });

  it('separa PI e colecao do codigo do item', () => {
    expect(stripPurchaseOrderAndCollection('PK2062607BXIS2750404509')).toBe('50404509');
    expect(stripPurchaseOrderAndCollection('PK2102606BSZS27050404637')).toBe('050404637');
    expect(stripPurchaseOrderAndCollection('PK2272607BXIHS2727010007')).toBe('27010007');
  });

  it('nao mutila um codigo comum', () => {
    expect(stripPurchaseOrderAndCollection('PI7752Y')).toBe('');
    expect(stripPurchaseOrderAndCollection('050404509')).toBe('');
  });

  it('casa os 14 pares reais do PK220 (invoice x packing list)', () => {
    // Antes da correcao os 14 itens da invoice e os 14 da PL apareciam como
    // "sem correspondencia" nos DOIS sentidos (reuniao 11/09 [17:29]).
    for (const [index, invoiceItem] of PK220_INVOICE_ITEMS.entries()) {
      const plItem = PK220_PACKING_LIST_ITEMS[index];
      expect(itemMatchKey(invoiceItem)).toBe(itemMatchKey(plItem));
      expect(itemCodesMatchLoose(invoiceItem.itemCode, plItem.itemCode)).toBe(true);
    }
  });

  it('casa mesmo quando o zero a esquerda se perdeu na concatenacao', () => {
    expect(itemCodesMatchLoose('PK2102606BSZS2750404638', '050404638')).toBe(true);
    expect(itemCodesMatchLoose('27.01.0007', 'PK2272607BXIHS2727.01.0007')).toBe(true);
  });

  it('nao casa codigos diferentes por acidente', () => {
    expect(itemCodesMatchLoose('PK2062607BXIS2750404509', '050404510')).toBe(false);
    expect(itemCodesMatchLoose('PI7752Y', 'PI7753Y')).toBe(false);
    // Sufixo curto demais nao basta: '04509' tem 5 caracteres.
    expect(itemCodesMatchLoose('PK2062607BXIS2750404509', '04509')).toBe(false);
  });

  it('mantem o casamento exato que ja funcionava', () => {
    expect(itemCodesMatchLoose('PI7752Y', 'PI 7752Y')).toBe(true);
    expect(itemCodesMatchLoose('PI7765Y', 'FAT03PI7765Y')).toBe(true);
  });

  it('exibe o SKU real, nao a string composta', () => {
    expect(primaryItemCode(PK220_INVOICE_ITEMS[0])).toBe('050404509');
    expect(primaryItemCode(PK220_INVOICE_ITEMS[13])).toBe('27.01.0007');
    expect(primaryItemCode(PK220_PACKING_LIST_ITEMS[0])).toBe('050404509');
    expect(primaryItemCode({ itemCode: 'PI7752Y', description: 'MEIA KIDS' })).toBe('PI7752Y');
  });

  it('linha sem codigo nao ganha chave de casamento', () => {
    expect(itemMatchKey({ description: 'FRETE INTERNO', quantity: 1 })).toBe('');
    expect(itemMatchKey(null)).toBe('');
  });
});
