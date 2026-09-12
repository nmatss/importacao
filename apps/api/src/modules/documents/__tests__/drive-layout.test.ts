import { describe, expect, it } from 'vitest';
import fixture from './fixtures/drive-tree.fixture.json' with { type: 'json' };
import {
  classifyDriveFile,
  isTypeSubfolder,
  isVersionamentoSubfolder,
  matchDriveArea,
  matchEspelhoFileName,
  matchProcessCodeInName,
  nameReferencesCode,
  selectByDocumentTypePriority,
} from '../drive-layout.js';
import { normalizeReference } from '../../follow-up/reference-registry.js';

/**
 * Gabarito: arvore real lida pela conta de servico em 11/09/2026. Os nomes
 * abaixo sao os formatos reais; a fixture que alimenta o indice e sintetica.
 */
const referencias = new Set(fixture.referencias.map((code) => normalizeReference(code)));

describe('matchDriveArea', () => {
  it.each([
    ['04. PENDENTES DE CORREÇÃO', 'pendentes'],
    ['04. PENDENTES DE CORRECAO', 'pendentes'],
    ['PENDENTES DE CORREÇÃO', 'pendentes'],
    ['01. ESPELHOS', 'espelhos'],
    ['02. IMAGINARIUM', 'imaginarium'],
    ['03. PUKET', 'puket'],
  ])('reconhece %s', (nome, esperado) => {
    expect(matchDriveArea(nome)).toBe(esperado);
  });

  it.each([['Controle de Documentos Físicos'], ['00. SISTEMA AUTOMATICO'], ['PENDENTES']])(
    'nao confunde %s com uma area',
    (nome) => {
      expect(matchDriveArea(nome)).toBeNull();
    },
  );
});

describe('matchProcessCodeInName', () => {
  it.each([
    ['PK2192607SZ', 'PK2192607SZ'],
    // Espaco no fim: a pasta real 'IM0302409NB ' existe assim.
    ['IM0802611NB ', 'IM0802611NB'],
    // Sufixo depois do codigo.
    ['IM0112407NB - Licença de importação', 'IM0112407NB'],
    // Codigo com hifen: vence o prefixo MAIS LONGO reconhecido.
    ['PKT-0032-BD-SEA', 'PKT0032BDSEA'],
  ])('%s -> %s', (nome, esperado) => {
    expect(matchProcessCodeInName(nome, referencias)).toBe(esperado);
  });

  it.each([
    // Nomes legados curtos de ate 2023/2024: nenhum processo do sistema usa
    // esse padrao, entao a pasta e simplesmente ignorada.
    ['2080_SZ'],
    ['2066_SZB'],
    ['2070_SZ_AIR'],
    // Grupos (colecao e faturamento) nao sao processo.
    ['HIGH SUMMER - 26'],
    ['SUMMER - 26 '],
    ['FAT - 08'],
    ['Fat - 03'],
    ['Arquivo Morto'],
  ])('%s nao e pasta de processo', (nome) => {
    expect(matchProcessCodeInName(nome, referencias)).toBeNull();
  });

  it('exige fronteira: o codigo nao pode continuar em outro alfanumerico', () => {
    expect(matchProcessCodeInName('PK2192607SZX', referencias)).toBeNull();
    expect(matchProcessCodeInName('PK2192607SZ_corrigido', referencias)).toBe('PK2192607SZ');
  });
});

describe('matchEspelhoFileName', () => {
  it.each([
    ['PK2202608SZ - Espelho', 'PK2202608SZ'],
    ['PK2202608SZ - ESPELHO.xlsx', 'PK2202608SZ'],
    ['IM0752606NB Espelho', 'IM0752606NB'],
  ])('%s -> %s', (nome, esperado) => {
    expect(matchEspelhoFileName(nome, referencias)).toBe(esperado);
  });

  it.each([
    ['PK2202608SZ (antigo com erro) - Espelho'],
    ['ESPELHO CONSOLIDADO PUKET'],
    ['ESPELHO CONSOLIDADO IMAGINARIUM'],
    // Codigo que nao esta na lista de referencias nao vira espelho de ninguem.
    ['PK9999999ZZ - Espelho'],
    ['Modelo de Espelho'],
  ])('%s nao casa', (nome) => {
    expect(matchEspelhoFileName(nome, referencias)).toBeNull();
  });
});

describe('subpastas dentro da pasta do processo', () => {
  it.each([['Backup'], ['backup 2025'], ['Antigo'], ['Versao anterior'], ['OLD']])(
    '%s e versionamento e nao e lida',
    (nome) => {
      expect(isVersionamentoSubfolder(nome)).toBe(true);
    },
  );

  it.each([['Invoice'], ['Packing List'], ['BL'], ['Espelho'], ['Outros']])(
    '%s e subpasta de tipo do layout antigo',
    (nome) => {
      expect(isTypeSubfolder(nome)).toBe(true);
      expect(isVersionamentoSubfolder(nome)).toBe(false);
    },
  );
});

describe('classifyDriveFile', () => {
  const codigo = normalizeReference('PK2192607SZ');
  const comCodigo = (nome: string) => ({
    hasKnownProcessCode: nameReferencesCode(nome, codigo),
  });

  it.each([
    ['2026.08.07 KIOM INV - PK2192607SZ.pdf', 'invoice'],
    ['KIOM CI - PK2192607SZ.xlsx', 'invoice'],
    ['KIOM PL - PK2192607SZ.pdf', 'packing_list'],
    ['PK2192607SZ OHBL COPY.pdf', 'ohbl'],
    ['Puket - 439 - OHBL COLORIDO.pdf', 'ohbl'],
    ['Extrato-DUIMP-26BR00016608802-Versao-0001 - PUK032-26 - PK2192607SZ.pdf', 'duimp'],
    ['RASCUNHO DUIMP - PK2192607SZ.pdf', 'draft_duimp'],
  ])('%s entra como %s', (nome, docType) => {
    expect(classifyDriveFile(nome, comCodigo(nome))).toEqual({ docType });
  });

  it.each([
    ['manistesto cte 5462.pdf'],
    ['2026.09.10 - CTE - 4226 - PUKET.pdf'],
    ['2026.09.10 - FATURA2103.pdf'],
    ['fat_138902_73839.pdf'],
  ])('%s nao e documento do fluxo e nao vira `other`', (nome) => {
    const decisao = classifyDriveFile(nome, comCodigo(nome));
    expect(decisao.docType).toBeUndefined();
    expect(decisao.ignoredReason).toBeTruthy();
  });

  it('arquivo que o classificador nao reconhece fica de fora com motivo', () => {
    // Antes qualquer nome desconhecido virava documento `other` e abria um
    // alerta de operador — a primeira varredura de uma pasta antiga abriria
    // dezenas de uma vez.
    const decisao = classifyDriveFile('anotacoes da reuniao.pdf');
    expect(decisao.docType).toBeUndefined();
    expect(decisao.ignoredReason).toBe('tipo de documento nao reconhecido pelo nome');
  });

  it('espelho solto na pasta do processo nao disputa com 01. ESPELHOS', () => {
    expect(classifyDriveFile('PK2192607SZ - Espelho.xlsx').ignoredReason).toBe(
      'espelho so e lido de 01. ESPELHOS',
    );
  });

  it('extensao fora da lista nao e baixada', () => {
    expect(classifyDriveFile('invoice PK2192607SZ.zip').ignoredReason).toBe(
      'extensao nao suportada',
    );
  });
});

describe('selectByDocumentTypePriority', () => {
  const candidato = (area: 'pendentes' | 'puket', docType: string, id: string) => ({
    area,
    docType,
    file: id,
  });

  it('PENDENTES vence POR TIPO e os tipos ausentes vem da marca', () => {
    const selecionados = selectByDocumentTypePriority([
      candidato('pendentes', 'invoice', 'inv-corrigida'),
      candidato('puket', 'invoice', 'inv-antiga'),
      candidato('puket', 'ohbl', 'bl-da-marca'),
    ]);

    expect(selecionados.map((c) => c.file)).toEqual(['inv-corrigida', 'bl-da-marca']);
  });

  it('sem nada em PENDENTES a pasta da marca entrega tudo', () => {
    const selecionados = selectByDocumentTypePriority([
      candidato('puket', 'invoice', 'inv'),
      candidato('puket', 'packing_list', 'pl'),
    ]);

    expect(selecionados).toHaveLength(2);
  });
});
