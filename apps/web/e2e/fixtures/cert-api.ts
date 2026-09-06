/**
 * Fixtures do cert-api (FastAPI) para a auditoria visual responsiva.
 *
 * O cert-api responde objetos CRUS — sem envelope `{ success, data }`. Os
 * shapes abaixo foram conferidos contra `apps/cert-api/app/routes/*.py` e
 * contra os tipos de `src/shared/lib/cert-api-client.ts`.
 *
 * Todos os dados sao ficticios e foram escolhidos para estressar o layout:
 * nomes e SKUs longos, todos os status possiveis, datas vencidas/a vencer/
 * validas, estoque desconhecido vs. zerado, 120 produtos (5 paginas de 25).
 */
import type { FixtureHandler } from './types';
import type {
  CertCertificate,
  CertCertificatesResponse,
  CertHealthResponse,
  CertLinxLookup,
  CertProduct,
  CertProductsResponse,
  CertReport,
  CertReportData,
  CertReportResult,
  CertSchedule,
  CertScheduleHistoryEntry,
  CertStats,
  CertStatusKind,
  CertValidationEvent,
  CertValidationRun,
  CertVerifyResult,
  ComercializacaoStatusKind,
  LicenseStatusKind,
  LinxStatus,
  SiteStatusKind,
} from '../../src/shared/lib/cert-api-client';

// ── Constantes ─────────────────────────────────────────────────────────

/** Referencia fixa de "agora" para as datas relativas ficarem estaveis. */
const NOW_ISO = '2026-09-06T09:30:00-03:00';

/** run_id devolvido por POST /api/validate e /schedules/:id/run. */
export const CERT_RUN_ID_RUNNING = 'e2e-run-4f1c9b2a-running';
/** Qualquer run_id contendo "completed" responde como concluido. */
export const CERT_RUN_ID_COMPLETED = 'e2e-run-4f1c9b2a-completed';

/** Marcas como o banco guarda (nome de exibicao, nao slug). */
type BrandName = 'Imaginarium' | 'Puket' | 'Puket Escolares';

/** Igual a `normalize_brand_filter` do backend: slug -> "puket escolares". */
function normalizeBrand(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').trim();
}

function ceilPages(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

function readPage(url: URL, defaultPerPage: number): { page: number; perPage: number } {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const perPage = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get('per_page') ?? defaultPerPage) || defaultPerPage),
  );
  return { page, perPage };
}

function csv(raw: string | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ── Cenarios de status ─────────────────────────────────────────────────

type Scenario =
  | 'ok'
  | 'ok_prazo'
  | 'inconsistent'
  | 'not_found'
  | 'api_error'
  | 'no_expected'
  | 'expired_bloqueado'
  | 'expired_lote'
  | 'never_validated'
  | 'sem_estoque_sync'
  | 'encerramento_sem_data';

interface ScenarioFields {
  last_validation_status: string | null;
  last_validation_score: number | null;
  last_validation_error: string | null;
  last_validation_date: string | null;
  is_expired: boolean;
  sheet_status: string;
  sale_deadline: string;
  sale_deadline_date: string | null;
  encerramento_status: string | null;
  cert_status: CertStatusKind;
  site_status: SiteStatusKind;
  site_status_reason: string | null;
  license_status: LicenseStatusKind;
  license_deadline: string | null;
  comercializacao_status: ComercializacaoStatusKind;
  /** false = SKU sem linha em cert_stock (estoque DESCONHECIDO, nao zero). */
  stockKnown: boolean;
}

const LAST_RUN_DATE = '2026-09-05T06:14:52-03:00';

const SCENARIOS: Record<Scenario, ScenarioFields> = {
  ok: {
    last_validation_status: 'OK',
    last_validation_score: 0.97,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '02/03/2028',
    sale_deadline_date: '2028-03-02',
    encerramento_status: null,
    cert_status: 'ATIVO',
    site_status: 'CONFORME',
    site_status_reason: null,
    license_status: 'VALIDO',
    license_deadline: '15/11/2027',
    comercializacao_status: 'LIBERADA',
    stockKnown: true,
  },
  ok_prazo: {
    last_validation_status: 'OK',
    last_validation_score: 0.91,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '29/10/2026',
    sale_deadline_date: '2026-10-29',
    encerramento_status: 'Comerciação Permitida',
    cert_status: 'ATIVO',
    site_status: 'CONFORME',
    site_status_reason: null,
    license_status: 'VALIDO',
    license_deadline: '30/09/2026',
    comercializacao_status: 'DENTRO_PRAZO',
    stockKnown: true,
  },
  inconsistent: {
    last_validation_status: 'INCONSISTENT',
    last_validation_score: 0.58,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '24/04/2027',
    sale_deadline_date: '2027-04-24',
    encerramento_status: null,
    cert_status: 'ATIVO',
    site_status: 'NAO_CONFORME',
    site_status_reason: 'Frase de certificacao obrigatoria ausente no cadastro',
    license_status: 'VENCIDO',
    license_deadline: '13/08/2023',
    comercializacao_status: 'LIBERADA',
    stockKnown: true,
  },
  not_found: {
    last_validation_status: 'URL_NOT_FOUND',
    last_validation_score: 0,
    last_validation_error: 'VTEX: produto nao retornado pela busca por referencia (HTTP 404)',
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '24/07/2026',
    sale_deadline_date: '2026-07-24',
    encerramento_status: 'Comerciação Permitida',
    cert_status: 'ATIVO',
    site_status: 'NAO_CONFORME',
    site_status_reason: 'Certificacao encerrada / fora do prazo com produto no site',
    license_status: 'NAO_APLICAVEL',
    license_deadline: null,
    comercializacao_status: 'DENTRO_PRAZO',
    stockKnown: true,
  },
  api_error: {
    last_validation_status: 'API_ERROR',
    last_validation_score: null,
    last_validation_error:
      'HTTPSConnectionPool(host=loja.imaginarium.com.br, port=443): Read timed out. (read timeout=15)',
    last_validation_date: '2026-09-04T06:11:03-03:00',
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: 'a definir',
    sale_deadline_date: null,
    encerramento_status: null,
    cert_status: 'ATIVO',
    site_status: 'NAO_CONFORME',
    site_status_reason: 'Verificacao pendente - revisar',
    license_status: 'VALIDO',
    license_deadline: '01/01/2030',
    comercializacao_status: 'LIBERADA',
    stockKnown: true,
  },
  no_expected: {
    last_validation_status: 'NO_EXPECTED',
    last_validation_score: 0,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: '',
    sale_deadline: '',
    sale_deadline_date: null,
    encerramento_status: null,
    cert_status: 'ATIVO',
    site_status: 'CONFORME',
    site_status_reason: null,
    license_status: 'NAO_APLICAVEL',
    license_deadline: null,
    comercializacao_status: 'NAO_APLICA',
    stockKnown: true,
  },
  expired_bloqueado: {
    last_validation_status: 'OK',
    last_validation_score: 0.95,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: true,
    sheet_status: 'ENCERRADO',
    sale_deadline: '26/01/2025',
    sale_deadline_date: '2025-01-26',
    encerramento_status: 'Vencido - Venda Bloqueada',
    cert_status: 'ENCERRADO',
    site_status: 'NAO_CONFORME',
    site_status_reason: 'Certificacao vencida no site',
    license_status: 'VENCIDO',
    license_deadline: '07/12/2025',
    comercializacao_status: 'ENCERRADA',
    stockKnown: true,
  },
  expired_lote: {
    last_validation_status: 'INCONSISTENT',
    last_validation_score: 0.42,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: true,
    sheet_status: 'ENCERRADO',
    sale_deadline: 'VENDA ATÉ FIM DO LOTE',
    sale_deadline_date: null,
    encerramento_status: 'Venda até fim do lote',
    cert_status: 'ENCERRADO',
    site_status: 'NAO_CONFORME',
    site_status_reason: 'Certificacao encerrada / fora do prazo com produto no site',
    license_status: 'NAO_APLICAVEL',
    license_deadline: null,
    comercializacao_status: 'DENTRO_PRAZO',
    stockKnown: true,
  },
  never_validated: {
    last_validation_status: null,
    last_validation_score: null,
    last_validation_error: null,
    last_validation_date: null,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '2030-01-01',
    sale_deadline_date: '2030-01-01',
    encerramento_status: null,
    cert_status: 'ATIVO',
    site_status: 'NAO_CONFORME',
    site_status_reason: 'Verificacao pendente - revisar',
    license_status: 'VALIDO',
    license_deadline: '31/12/2029',
    comercializacao_status: 'LIBERADA',
    stockKnown: true,
  },
  sem_estoque_sync: {
    last_validation_status: 'OK',
    last_validation_score: 0.99,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '2026-12-31',
    sale_deadline_date: '2026-12-31',
    encerramento_status: null,
    cert_status: 'ATIVO',
    site_status: 'CONFORME',
    site_status_reason: null,
    license_status: 'VALIDO',
    license_deadline: '20/06/2028',
    comercializacao_status: 'LIBERADA',
    stockKnown: false,
  },
  encerramento_sem_data: {
    last_validation_status: 'OK',
    last_validation_score: 0.88,
    last_validation_error: null,
    last_validation_date: LAST_RUN_DATE,
    is_expired: false,
    sheet_status: 'ATIVO',
    sale_deadline: '',
    sale_deadline_date: null,
    encerramento_status: 'Comerciação Permitida',
    cert_status: 'ATIVO',
    site_status: 'CONFORME',
    site_status_reason: null,
    license_status: 'NAO_APLICAVEL',
    license_deadline: null,
    comercializacao_status: 'LIBERADA',
    stockKnown: true,
  },
};

// ── Catalogo base (30 produtos) ────────────────────────────────────────

interface BaseProduct {
  sku: string;
  name: string;
  brand: BrandName;
  scenario: Scenario;
  certification_type: string;
  numero_certificado: string | null;
}

const CERT_INMETRO_BRINQUEDO =
  'INMETRO - Portaria nº 563/2016 - Segurança de Brinquedos - OCP 0004 - Registro 006083/2024';
const CERT_INMETRO_ESCOLAR =
  'INMETRO - Portaria nº 481/2010 - Artigos Escolares - OCP 0011 - Registro 012345/2025';
const CERT_ANATEL = 'ANATEL - Homologação nº 12345-20-01234 - Produto para telecomunicações';
const CERT_ANVISA = 'ANVISA - Registro nº 80145890012 - Cosmético grau 1';

const BASE_PRODUCTS: BaseProduct[] = [
  {
    sku: 'PI7223Y',
    name: 'Luminária de Mesa Abajur Lua Cheia 3D Touch com Controle Remoto e 16 Cores RGB Recarregável USB',
    brand: 'Imaginarium',
    scenario: 'ok',
    certification_type: CERT_ANATEL,
    numero_certificado: '12345-20-01234',
  },
  {
    sku: '110045-0033-PP-AZUL-MARINHO-LOTE2026B',
    name: 'Meia Infantil Cano Médio Puket Dinossauro Glow in the Dark Kit com 3 Pares Tamanho 23 a 26',
    brand: 'Puket',
    scenario: 'ok_prazo',
    certification_type: CERT_INMETRO_BRINQUEDO,
    numero_certificado: '006083/2024',
  },
  {
    sku: 'PKE-LNC-2026-DINO-GLOW-0007L-AZ',
    name: 'Lancheira Térmica Infantil Puket Escolares Dinossauros com Alça Ajustável e Compartimento Duplo 7 Litros',
    brand: 'Puket Escolares',
    scenario: 'inconsistent',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '012345/2025',
  },
  {
    sku: 'IMG-CAN-0921',
    name: 'Caneca Cerâmica Star Wars Darth Vader Preta 350ml',
    brand: 'Imaginarium',
    scenario: 'not_found',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'IMG-FON-BT-2026-NEON-PINK-XL',
    name: 'Fone de Ouvido Bluetooth Over-Ear Neon Pink com Cancelamento de Ruído Ativo e Microfone Embutido',
    brand: 'Imaginarium',
    scenario: 'api_error',
    certification_type: CERT_ANATEL,
    numero_certificado: '09876-24-05678',
  },
  {
    sku: 'PK-PIJ-ADT-M-CINZA',
    name: 'Pijama Adulto Longo Puket Algodão Cinza Mescla Tamanho M',
    brand: 'Puket',
    scenario: 'no_expected',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'PK-CHOC-BB-0001-VERMELHO-LOTE2023A',
    name: 'Chocalho Bebê Puket Ursinho Vermelho com Mordedor de Silicone Livre de BPA',
    brand: 'Puket',
    scenario: 'expired_bloqueado',
    certification_type: CERT_INMETRO_BRINQUEDO,
    numero_certificado: '004411/2021',
  },
  {
    sku: 'PKE-EST-2024-UNIC-ROSA',
    name: 'Estojo Escolar Duplo Puket Escolares Unicórnio Rosa com Zíper Reforçado e Divisórias Internas',
    brand: 'Puket Escolares',
    scenario: 'expired_lote',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '008820/2022',
  },
  {
    sku: 'IMG-NOVO-2026-09-AAA-BBB-CCC-DDD-EEE-FFF',
    name: 'Kit Organizador de Mesa Home Office Bambu 5 Peças com Porta-Canetas, Porta-Clipes e Suporte para Celular',
    brand: 'Imaginarium',
    scenario: 'never_validated',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'PK-MOC-INF-30-PRETO',
    name: 'Mochila Infantil Puket Astronauta Preta 30cm',
    brand: 'Puket',
    scenario: 'sem_estoque_sync',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '015002/2025',
  },
  {
    sku: 'PK-MAM-BB-240ML',
    name: 'Mamadeira Puket Baby 240ml Anticólica com Bico de Silicone Fluxo Médio',
    brand: 'Puket',
    scenario: 'encerramento_sem_data',
    certification_type: CERT_INMETRO_BRINQUEDO,
    numero_certificado: '007710/2024',
  },
  {
    sku: 'IMG-UMD-LED-2026',
    name: 'Umidificador de Ar Ultrassônico Astronauta com Luz LED 7 Cores e Timer 300ml',
    brand: 'Imaginarium',
    scenario: 'ok',
    certification_type: CERT_ANATEL,
    numero_certificado: '11223-25-00987',
  },
  {
    sku: 'IMG-CXS-BT-DINO-VERDE-2025',
    name: 'Caixa de Som Bluetooth Portátil Dinossauro Verde à Prova d’Água IPX7 com 12h de Bateria',
    brand: 'Imaginarium',
    scenario: 'inconsistent',
    certification_type: CERT_ANATEL,
    numero_certificado: '33445-24-01122',
  },
  {
    sku: 'PKE-GAR-500-AZUL',
    name: 'Garrafa Térmica Escolar Puket Escolares 500ml Azul com Canudo Retrátil e Alça de Transporte',
    brand: 'Puket Escolares',
    scenario: 'ok_prazo',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '012346/2025',
  },
  {
    sku: 'PK-MEIA-BB-0-6M-BRANCO-KIT3',
    name: 'Kit 3 Meias Bebê Puket Recém-Nascido 0 a 6 Meses Branco Algodão Orgânico',
    brand: 'Puket',
    scenario: 'never_validated',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'IMG-HID-LAB-ROSA',
    name: 'Hidratante Labial Imaginarium Morango com Glitter FPS 15',
    brand: 'Imaginarium',
    scenario: 'not_found',
    certification_type: CERT_ANVISA,
    numero_certificado: '80145890012',
  },
  {
    sku: 'PK-CUE-INF-KIT5-COLORIDO',
    name: 'Kit 5 Cuecas Infantil Puket Boxer Coloridas Estampa Super-Heróis Tamanho 8',
    brand: 'Puket',
    scenario: 'ok',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'PKE-CAD-A5-PAUTADO-LILAS',
    name: 'Caderno Universitário Puket Escolares A5 Pautado 96 Folhas Capa Dura Lilás Holográfica',
    brand: 'Puket Escolares',
    scenario: 'api_error',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '019900/2026',
  },
  {
    sku: 'IMG-RLG-PAR-GATO',
    name: 'Relógio de Parede Gato Preto Silencioso 30cm',
    brand: 'Imaginarium',
    scenario: 'expired_bloqueado',
    certification_type: CERT_INMETRO_BRINQUEDO,
    numero_certificado: '002210/2019',
  },
  {
    sku: 'PK-TOU-BB-CAPUZ-URSO',
    name: 'Toalha de Banho Bebê Puket com Capuz Urso Felpuda 100% Algodão 70x90cm',
    brand: 'Puket',
    scenario: 'expired_lote',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'IMG-TEC-MEC-RGB-60',
    name: 'Teclado Mecânico Gamer 60% Switch Red Iluminação RGB ABNT2 com Cabo USB-C Destacável',
    brand: 'Imaginarium',
    scenario: 'ok',
    certification_type: CERT_ANATEL,
    numero_certificado: '55667-25-04433',
  },
  {
    sku: 'PKE-APO-1L-VERDE',
    name: 'Apontador com Depósito Puket Escolares Verde Dinossauro',
    brand: 'Puket Escolares',
    scenario: 'no_expected',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'PK-BOD-BB-ML-KIT2-ROSA',
    name: 'Kit 2 Bodies Bebê Puket Manga Longa Rosa Estampa Coração 100% Algodão Tamanho P',
    brand: 'Puket',
    scenario: 'inconsistent',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'IMG-MOU-SF-PINK',
    name: 'Mouse Sem Fio Rosa Silencioso 1600 DPI Receptor USB Nano',
    brand: 'Imaginarium',
    scenario: 'sem_estoque_sync',
    certification_type: CERT_ANATEL,
    numero_certificado: '77889-26-00011',
  },
  {
    sku: 'PKE-MOC-ROD-2026-ESPACO-AZUL-ESCURO-GRANDE',
    name: 'Mochila com Rodinhas Puket Escolares Espaço Azul Escuro Grande com Alça Telescópica e Compartimento para Notebook 15"',
    brand: 'Puket Escolares',
    scenario: 'ok',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '012347/2025',
  },
  {
    sku: 'PK-PANT-INF-CALCA-JEANS-10',
    name: 'Calça Jeans Infantil Puket Skinny com Elastano Tamanho 10',
    brand: 'Puket',
    scenario: 'encerramento_sem_data',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'IMG-VEL-ARO-LAV',
    name: 'Vela Aromática Lavanda e Baunilha 180g Pote de Vidro',
    brand: 'Imaginarium',
    scenario: 'never_validated',
    certification_type: '',
    numero_certificado: null,
  },
  {
    sku: 'PK-BAB-SIL-VERDE',
    name: 'Babador de Silicone Puket Baby Verde com Bolso Coletor',
    brand: 'Puket',
    scenario: 'not_found',
    certification_type: CERT_INMETRO_BRINQUEDO,
    numero_certificado: '009901/2024',
  },
  {
    sku: 'IMG-CAR-POW-20K',
    name: 'Carregador Portátil Power Bank 20.000mAh 2 Portas USB + USB-C Carregamento Rápido 22.5W Preto Fosco',
    brand: 'Imaginarium',
    scenario: 'ok_prazo',
    certification_type: CERT_ANATEL,
    numero_certificado: '99001-26-03322',
  },
  {
    sku: 'PKE-KIT-VOLTA-AULAS-2027-COMPLETO-UNICORNIO',
    name: 'Kit Volta às Aulas Puket Escolares 2027 Completo Unicórnio: Mochila, Lancheira, Estojo, Garrafa e Caderno',
    brand: 'Puket Escolares',
    scenario: 'expired_bloqueado',
    certification_type: CERT_INMETRO_ESCOLAR,
    numero_certificado: '003300/2020',
  },
];

// ── Estoque ────────────────────────────────────────────────────────────

type StockDetail = NonNullable<CertProduct['stock_detail']>[number];

const STOCK_SYNCED_AT = '2026-09-06T04:02:17-03:00';

function buildStock(seed: number, brand: BrandName, known: boolean) {
  if (!known) {
    return {
      stock_cd: 0,
      stock_ecommerce: 0,
      stock_total: 0,
      stock_detail: [] as StockDetail[],
      stock_synced_at: null,
    };
  }
  const picking = (seed * 37) % 1200;
  const armazem = (seed * 91) % 4800;
  const avaria = seed % 3 === 0 ? 18 : 0;
  const extrema = seed % 4 === 0 ? (seed * 13) % 900 : 0;
  const ecomSource = brand === 'Imaginarium' ? 'ecommerce_imaginarium' : 'ecommerce_puket';
  const ecomWarehouse =
    brand === 'Imaginarium' ? 'VTEX loja.imaginarium.com.br' : 'VTEX puket.com.br';
  const ecommerce = seed % 5 === 0 ? 0 : (seed * 7) % 350;

  const detail: StockDetail[] = [
    {
      source: 'wms_biguacu',
      warehouse: 'CD Picking',
      quantity: picking + 12,
      available: picking,
      synced_at: STOCK_SYNCED_AT,
    },
    {
      source: 'wms_biguacu',
      warehouse: 'CD Armazém Vertical Mezanino Bloco B',
      quantity: armazem + 40,
      available: armazem,
      synced_at: STOCK_SYNCED_AT,
    },
    // Tudo reservado: quantity > 0 e available = 0.
    {
      source: 'wms_biguacu',
      warehouse: 'CD Avaria',
      quantity: avaria,
      available: 0,
      synced_at: STOCK_SYNCED_AT,
    },
    {
      source: 'wms_biguacu',
      warehouse: 'CD Extrema MG',
      quantity: extrema,
      available: extrema,
      synced_at: STOCK_SYNCED_AT,
    },
    {
      source: ecomSource,
      warehouse: ecomWarehouse,
      quantity: ecommerce,
      available: ecommerce,
      synced_at: '2026-09-06T03:45:00-03:00',
    },
  ];
  const stock_cd = picking + armazem + extrema;
  return {
    stock_cd,
    stock_ecommerce: ecommerce,
    stock_total: stock_cd + ecommerce,
    stock_detail: detail,
    stock_synced_at: STOCK_SYNCED_AT,
  };
}

// ── Montagem dos produtos ──────────────────────────────────────────────

const ECOMMERCE_DESCRIPTION =
  'Produto certificado pelo INMETRO sob o registro nº 006083/2024, conforme Portaria nº 563/2016. ' +
  'Certificado emitido pelo OCP 0004 - Instituto de Qualidade Brasil. ' +
  'ATENÇÃO: não recomendado para menores de 3 anos — contém peças pequenas que podem ser engolidas ou inaladas. ' +
  'Mantenha a embalagem para referência futura. Selo de Identificação da Conformidade obrigatório na etiqueta.';

const ACTUAL_TEXT_OK =
  'Produto certificado pelo INMETRO sob o registro nº 006083/2024, conforme Portaria nº 563/2016. ' +
  'Certificado emitido pelo OCP 0004 - Instituto de Qualidade Brasil. Não recomendado para menores de 3 anos.';

const ACTUAL_TEXT_INCONSISTENT =
  'Produto certificado pelo INMETRO. Registro 006083/2023. Recomendado para todas as idades.';

function storeUrl(brand: BrandName, sku: string): string {
  const host =
    brand === 'Imaginarium' ? 'https://loja.imaginarium.com.br' : 'https://www.puket.com.br';
  return `${host}/${sku.toLowerCase()}/p?skuId=${encodeURIComponent(sku)}`;
}

function actualTextFor(status: string | null): string | null {
  if (status === 'OK') return ACTUAL_TEXT_OK;
  if (status === 'INCONSISTENT') return ACTUAL_TEXT_INCONSISTENT;
  return null;
}

function buildProduct(base: BaseProduct, index: number): CertProduct {
  const s = SCENARIOS[base.scenario];
  const hasEcommerce = base.certification_type !== '' && base.scenario !== 'no_expected';
  const hasUrl = s.last_validation_status === 'OK' || s.last_validation_status === 'INCONSISTENT';
  return {
    sku: base.sku,
    brand: base.brand,
    name: base.name,
    description: base.name,
    status: s.sheet_status,
    sheet_status: s.sheet_status,
    certification_type: base.certification_type,
    expected_cert_text: base.certification_type,
    ecommerce_description: hasEcommerce ? ECOMMERCE_DESCRIPTION : '',
    actual_cert_text: actualTextFor(s.last_validation_status),
    last_validation_status: s.last_validation_status,
    last_validation_score: s.last_validation_score,
    last_validation_url: hasUrl ? storeUrl(base.brand, base.sku) : null,
    last_validation_date: s.last_validation_date,
    last_validation_error: s.last_validation_error,
    is_expired: s.is_expired,
    sale_deadline: s.sale_deadline,
    sale_deadline_date: s.sale_deadline_date,
    numero_certificado: base.numero_certificado,
    situacao: s.is_expired ? 'ENCERRADO' : 'ATIVO',
    encerramento_status: s.encerramento_status,
    license_deadline: s.license_deadline,
    license_deadline_date: s.license_deadline
      ? s.license_deadline.split('/').reverse().join('-')
      : null,
    cert_status: s.cert_status,
    site_status: s.site_status,
    site_status_reason: s.site_status_reason,
    license_status: s.license_status,
    comercializacao_status: s.comercializacao_status,
    venda_encerramento: s.encerramento_status,
    within_sale_deadline: s.comercializacao_status !== 'ENCERRADA',
    created_at: '2026-03-23T14:01:00-03:00',
    updated_at: s.last_validation_date ?? '2026-09-01T08:00:00-03:00',
    ...buildStock(index + 1, base.brand, s.stockKnown),
  };
}

/** Sufixos de variante (cor) para multiplicar o catalogo em 4x. */
const VARIANTS: Array<{ sku: string; name: string }> = [
  { sku: '', name: '' },
  { sku: '-AZ', name: ' - Azul' },
  { sku: '-RS', name: ' - Rosa' },
  { sku: '-VD-FLUOR', name: ' - Verde Fluorescente' },
];

/** 120 produtos deterministas, ordenados por SKU como o backend faz. */
export const certProducts: CertProduct[] = BASE_PRODUCTS.flatMap((base, i) =>
  VARIANTS.map((v, j) =>
    buildProduct({ ...base, sku: `${base.sku}${v.sku}`, name: `${base.name}${v.name}` }, i * 4 + j),
  ),
).sort((a, b) => a.sku.localeCompare(b.sku));

function matchesStatusFilter(p: CertProduct, raw: string | null): boolean {
  const statuses = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statuses.length === 0) return true;
  const wantsExpired = statuses.includes('EXPIRED');
  const others = statuses.filter((s) => s !== 'EXPIRED');
  if (wantsExpired && p.is_expired) return true;
  return others.length > 0 && others.includes(p.last_validation_status ?? '');
}

function matchesDerived(p: CertProduct, url: URL): boolean {
  const axes: Array<[keyof CertProduct, string]> = [
    ['cert_status', 'cert_status'],
    ['site_status', 'site_status'],
    ['license_status', 'license_status'],
    ['comercializacao_status', 'comercializacao_status'],
  ];
  return axes.every(([field, param]) => {
    const wanted = csv(url.searchParams.get(param));
    if (wanted.size === 0) return true;
    return wanted.has(String(p[field] ?? '').toLowerCase());
  });
}

function matchesSearchAndBrand(p: CertProduct, url: URL): boolean {
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  if (
    search &&
    !p.sku.toLowerCase().includes(search) &&
    !(p.name ?? '').toLowerCase().includes(search)
  ) {
    return false;
  }
  const brand = url.searchParams.get('brand');
  if (brand && normalizeBrand(p.brand) !== normalizeBrand(brand)) return false;
  return true;
}

function matchesDateRange(p: CertProduct, url: URL): boolean {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  if (!start && !end) return true;
  const day = (p.last_validation_date ?? '').slice(0, 10);
  if (!day) return false;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

const LAST_VALIDATION_DATE = certProducts
  .map((p) => p.last_validation_date ?? '')
  .reduce((max, d) => (d > max ? d : max), '');

function productsResponse(items: CertProduct[], url: URL): CertProductsResponse {
  const { page, perPage } = readPage(url, 25);
  const start = (page - 1) * perPage;
  return {
    products: items.slice(start, start + perPage),
    total: items.length,
    page,
    per_page: perPage,
    total_pages: ceilPages(items.length, perPage),
    last_validation_date: LAST_VALIDATION_DATE || null,
  };
}

function listProducts(url: URL): CertProductsResponse {
  const filtered = certProducts.filter(
    (p) =>
      matchesSearchAndBrand(p, url) &&
      matchesStatusFilter(p, url.searchParams.get('status')) &&
      matchesDateRange(p, url) &&
      matchesDerived(p, url),
  );
  return productsResponse(filtered, url);
}

function listExpired(url: URL): CertProductsResponse {
  const filtered = certProducts
    .filter((p) => p.is_expired && matchesSearchAndBrand(p, url) && matchesDerived(p, url))
    // Backend: ORDER BY sale_deadline_date ASC NULLS LAST.
    .sort((a, b) => {
      const da = a.sale_deadline_date ?? '';
      const db = b.sale_deadline_date ?? '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  return productsResponse(filtered, url);
}

/** Detalhe: mesmo objeto da lista + `last_validation` aninhado (rota get_product). */
function productDetail(sku: string): CertProduct {
  // SKU desconhecido (ex.: /produtos/SKU-E2E do smoke) cai no produto mais
  // rico, com o SKU pedido, para a tela sempre renderizar cheia.
  const found = certProducts.find((p) => p.sku === sku);
  const source = found ?? certProducts.find((p) => p.sku === 'PKE-LNC-2026-DINO-GLOW-0007L-AZ')!;
  const product: CertProduct = { ...source, sku };
  if (product.last_validation_status) {
    product.last_validation = {
      status: product.last_validation_status,
      score: product.last_validation_score,
      url: product.last_validation_url,
      actual_cert_text: product.actual_cert_text,
      error: product.last_validation_error,
      date: product.last_validation_date,
    };
  }
  return product;
}

const verifyResult: CertVerifyResult = {
  sku: 'PKE-LNC-2026-DINO-GLOW-0007L-AZ',
  brand: 'puket_escolares',
  status: 'INCONSISTENT',
  score: 0.61,
  url: storeUrl('Puket Escolares', 'PKE-LNC-2026-DINO-GLOW-0007L-AZ'),
  actual_cert_text: ACTUAL_TEXT_INCONSISTENT,
  expected_cert_text: CERT_INMETRO_ESCOLAR,
  ecommerce_description: ECOMMERCE_DESCRIPTION,
  error: 'Registro do certificado no site (006083/2023) diverge do esperado (012345/2025)',
  verified_at: NOW_ISO,
};

// ── Stats ──────────────────────────────────────────────────────────────

function countBy(products: CertProduct[], pred: (p: CertProduct) => boolean): number {
  return products.filter(pred).length;
}

const BRANDS: BrandName[] = ['Imaginarium', 'Puket', 'Puket Escolares'];

export const certStats: CertStats = {
  total_products: certProducts.length,
  total_expired: countBy(certProducts, (p) => p.is_expired === true),
  last_run: {
    date: LAST_RUN_DATE,
    total: certProducts.length,
    ok: countBy(certProducts, (p) => p.last_validation_status === 'OK'),
    inconsistent: countBy(certProducts, (p) => p.last_validation_status === 'INCONSISTENT'),
    not_found: countBy(
      certProducts,
      (p) =>
        p.last_validation_status != null &&
        !['OK', 'INCONSISTENT'].includes(p.last_validation_status),
    ),
  },
  by_brand: BRANDS.map((brand) => {
    const rows = certProducts.filter((p) => p.brand === brand);
    return {
      brand,
      ok: countBy(rows, (p) => p.last_validation_status === 'OK'),
      inconsistent: countBy(rows, (p) => p.last_validation_status === 'INCONSISTENT'),
      not_found: countBy(
        rows,
        (p) =>
          p.last_validation_status != null &&
          !['OK', 'INCONSISTENT'].includes(p.last_validation_status),
      ),
      never_validated: countBy(rows, (p) => p.last_validation_status == null),
      expired: countBy(rows, (p) => p.is_expired === true),
    };
  }),
};

const certHealth: CertHealthResponse = {
  status: 'ok',
  timestamp: NOW_ISO,
  database: 'connected',
  sheets_configured: true,
  vtex_stores: ['puket', 'imaginarium'],
};

// ── Certificados (cadastro) ────────────────────────────────────────────

interface BaseCertificate {
  sku: string;
  brand: 'imaginarium' | 'puket' | 'puket_escolares';
  linx_status: LinxStatus;
  validade: string | null;
  vencimento: string | null;
  pdf: boolean;
  orgao: string;
}

const BASE_CERTIFICATES: BaseCertificate[] = [
  {
    sku: 'PKE-LNC-2026-DINO-GLOW-0007L-AZ',
    brand: 'puket_escolares',
    linx_status: 'applied',
    validade: '2027-03-31',
    vencimento: '2026-09-30',
    pdf: true,
    orgao: 'INMETRO',
  },
  {
    sku: 'PI7223Y',
    brand: 'imaginarium',
    linx_status: 'error',
    validade: '2028-03-02',
    vencimento: null,
    pdf: true,
    orgao: 'ANATEL',
  },
  {
    sku: '110045-0033-PP-AZUL-MARINHO-LOTE2026B',
    brand: 'puket',
    linx_status: 'pending',
    validade: null,
    vencimento: '2026-10-29',
    pdf: false,
    orgao: 'INMETRO',
  },
  {
    sku: 'IMG-FON-BT-2026-NEON-PINK-XL',
    brand: 'imaginarium',
    linx_status: 'disabled',
    validade: '2025-01-26',
    vencimento: '2025-12-07',
    pdf: true,
    orgao: 'ANATEL',
  },
  {
    sku: 'PK-CHOC-BB-0001-VERMELHO-LOTE2023A',
    brand: 'puket',
    linx_status: 'applied',
    validade: '2023-08-13',
    vencimento: '2023-08-13',
    pdf: false,
    orgao: 'INMETRO',
  },
  {
    sku: 'PKE-KIT-VOLTA-AULAS-2027-COMPLETO-UNICORNIO',
    brand: 'puket_escolares',
    linx_status: 'error',
    validade: '2030-01-01',
    vencimento: '2029-12-31',
    pdf: true,
    orgao: 'INMETRO',
  },
  {
    sku: 'IMG-HID-LAB-ROSA',
    brand: 'imaginarium',
    linx_status: 'applied',
    validade: '2026-09-06',
    vencimento: null,
    pdf: true,
    orgao: 'ANVISA',
  },
  {
    sku: 'PK-MAM-BB-240ML',
    brand: 'puket',
    linx_status: 'pending',
    validade: '2026-09-15',
    vencimento: '2026-09-15',
    pdf: false,
    orgao: 'INMETRO',
  },
];

const LINX_ERRORS = [
  'Linx: produto 000123456 sem propriedade 1024 cadastrada no grupo CERTIFICACAO (SQL Server: Invalid column name)',
  'Linx indisponivel para consulta (timeout 30s ao conectar em SRV-LINX-PUKET\\ERP)',
];

export const certCertificates: CertCertificate[] = Array.from({ length: 24 }, (_, i) => {
  const base = BASE_CERTIFICATES[i % BASE_CERTIFICATES.length];
  const day = String(1 + (i % 28)).padStart(2, '0');
  const created = `2026-08-${day}T1${i % 10}:2${i % 6}:00-03:00`;
  const isError = base.linx_status === 'error';
  return {
    id: `c${(i + 1).toString().padStart(3, '0')}b9d2-4e1a-4c7f-9a${(i + 10).toString(16)}-e2e0000000${i % 10}`,
    sku: i >= BASE_CERTIFICATES.length ? `${base.sku}-${i}` : base.sku,
    brand: base.brand,
    produto_codigo: base.linx_status === 'disabled' ? null : String(100000 + i * 731),
    validade_certificado: base.validade,
    vencimento_licenciamento: base.vencimento,
    numero_certificado: i % 3 === 0 ? `0${6083 + i}/2024` : null,
    ocp: i % 2 === 0 ? 'OCP 0004' : 'OCP 0011',
    orgao_certificador: base.orgao,
    pdf_filename: base.pdf ? `${base.sku}-certificado-${base.orgao.toLowerCase()}-2026.pdf` : null,
    linx_status: base.linx_status,
    linx_error: isError ? LINX_ERRORS[i % LINX_ERRORS.length] : null,
    linx_detail:
      base.linx_status === 'applied'
        ? [
            { field: 'validade_certificado', prop: '1023', valor: '31/03/2027', action: 'updated' },
            base.vencimento
              ? {
                  field: 'vencimento_licenciamento',
                  prop: '1024',
                  valor: '30/09/2026',
                  action: 'inserted',
                }
              : { field: 'vencimento_licenciamento', prop: '1024', action: 'skipped (sem valor)' },
          ]
        : null,
    linx_applied_at: base.linx_status === 'applied' ? created : null,
    created_by: i % 4 === 0 ? 'eduarda.fiscal@grupounico.com' : 'nicolas.matsuda@grupounico.com',
    created_at: created,
    updated_at: created,
  };
});

function listCertificates(url: URL): CertCertificatesResponse {
  const { page, perPage } = readPage(url, 10);
  const sku = (url.searchParams.get('sku') ?? '').toLowerCase();
  const brand = url.searchParams.get('brand') ?? '';
  const linxStatus = url.searchParams.get('linx_status') ?? '';
  const filtered = certCertificates.filter(
    (c) =>
      (!sku || c.sku.toLowerCase().includes(sku)) &&
      (!brand || c.brand === brand) &&
      (!linxStatus || c.linx_status === linxStatus),
  );
  const start = (page - 1) * perPage;
  return {
    items: filtered.slice(start, start + perPage),
    total: filtered.length,
    page,
    per_page: perPage,
    total_pages: ceilPages(filtered.length, perPage),
  };
}

function linxLookup(url: URL): CertLinxLookup {
  return {
    status: 'found',
    sku: url.searchParams.get('sku') ?? 'PKE-LNC-2026-DINO-GLOW-0007L-AZ',
    brand: url.searchParams.get('brand') ?? 'puket_escolares',
    produto_codigo: '000123456',
    validade_certificado: '2027-03-31',
    // Data invalida no Linx: exercita o rotulo "Valor inválido: ...".
    vencimento_licenciamento: null,
    properties: {
      validade_certificado: { property_code: '1023', raw_value: '31/03/2027', state: 'found' },
      vencimento_licenciamento: {
        property_code: '1024',
        raw_value: '31/02/2026',
        state: 'invalid',
      },
    },
  };
}

// ── Relatorios ─────────────────────────────────────────────────────────

const REPORT_JSON_MAIN = 'validation_4f1c9b2a_20260905_061452.json';

export const certReports: CertReport[] = [
  {
    filename: REPORT_JSON_MAIN,
    format: 'json',
    date: '2026-09-05T09:14:52+00:00',
    size_bytes: 1_482_331,
  },
  {
    filename:
      'relatorio_estoque_detalhado_wms_biguacu_picking_armazem_extrema_ecommerce_puket_imaginarium_20260905_082211.xlsx',
    format: 'xlsx',
    date: '2026-09-05T11:22:11+00:00',
    size_bytes: 23_901_774,
  },
  {
    filename:
      'relatorio_produtos_todas_as_marcas_status_URL_NOT_FOUND-INCONSISTENT_20260904_143011.xlsx',
    format: 'xlsx',
    date: '2026-09-04T17:30:11+00:00',
    size_bytes: 412_006,
  },
  {
    filename: 'validation_9a77e0c3_20260904_061103.json',
    format: 'json',
    date: '2026-09-04T09:11:03+00:00',
    size_bytes: 1_471_920,
  },
  {
    filename: 'relatorio_produtos_puket_escolares_EXPIRED_20260903_180245.xlsx',
    format: 'xlsx',
    date: '2026-09-03T21:02:45+00:00',
    size_bytes: 88_120,
  },
  {
    filename: 'validation_b2c4d6e8_20260903_060958.json',
    format: 'json',
    date: '2026-09-03T09:09:58+00:00',
    size_bytes: 1_466_004,
  },
  {
    filename: 'validation_c0ffee11_20260902_061201.json',
    format: 'json',
    date: '2026-09-02T09:12:01+00:00',
    size_bytes: 1_460_882,
  },
  {
    filename: 'relatorio_produtos_imaginarium_20260901_093344.xlsx',
    format: 'xlsx',
    date: '2026-09-01T12:33:44+00:00',
    size_bytes: 1_020_449,
  },
  {
    filename: 'validation_d1e2f3a4_20260901_060740.json',
    format: 'json',
    date: '2026-09-01T09:07:40+00:00',
    size_bytes: 1_455_310,
  },
  {
    filename: 'validation_e5f6a7b8_20260831_061520.json',
    format: 'json',
    date: '2026-08-31T09:15:20+00:00',
    size_bytes: 1_449_918,
  },
  {
    filename:
      'validation_manual_puket_limite_50_produtos_teste_de_regressao_pos_deploy_ce70f41_20260830_154402.json',
    format: 'json',
    date: '2026-08-30T18:44:02+00:00',
    size_bytes: 61_233,
  },
  {
    filename: 'relatorio_estoque_detalhado_20260829_070005.xlsx',
    format: 'xlsx',
    date: '2026-08-29T10:00:05+00:00',
    size_bytes: 22_884_101,
  },
  {
    filename: 'validation_f9e8d7c6_20260829_060633.json',
    format: 'json',
    date: '2026-08-29T09:06:33+00:00',
    size_bytes: 1_441_776,
  },
  {
    filename: 'validation_00aa11bb_20260828_060915.json',
    format: 'json',
    date: '2026-08-28T09:09:15+00:00',
    size_bytes: 1_438_002,
  },
];

const REPORT_STATUSES = [
  'OK',
  'OK',
  'INCONSISTENT',
  'URL_NOT_FOUND',
  'OK',
  'API_ERROR',
  'NO_EXPECTED',
  'OK',
];

const certReportResults: CertReportResult[] = certProducts.slice(0, 26).map((p, i) => {
  const status = REPORT_STATUSES[i % REPORT_STATUSES.length];
  const hasUrl = status === 'OK' || status === 'INCONSISTENT';
  return {
    sku: p.sku,
    name: p.name ?? '',
    brand: p.brand,
    status,
    score: status === 'API_ERROR' ? null : status === 'OK' ? 0.9 + (i % 10) / 100 : (i % 7) / 10,
    url: hasUrl ? storeUrl(p.brand as BrandName, p.sku) : null,
    actual_cert_text: actualTextFor(status),
    certification_type: p.certification_type ?? '',
    expected_cert_text: String(p.ecommerce_description ?? ''),
    error: status === 'API_ERROR' ? SCENARIOS.api_error.last_validation_error : null,
  };
});

function reportSummary(results: CertReportResult[]) {
  return {
    total: results.length,
    ok: results.filter((r) => r.status === 'OK').length,
    missing: 0,
    inconsistent: results.filter((r) => r.status === 'INCONSISTENT').length,
    not_found: results.filter((r) => !['OK', 'INCONSISTENT'].includes(r.status)).length,
  };
}

/**
 * O backend grava as linhas em `products`; o frontend le `results`. Ambas as
 * chaves vao juntas para a fixture valer para os dois lados.
 */
export const certReportData: CertReportData = {
  run_id: '4f1c9b2a-7d3e-4b8f-9c1a-2e5d6f7a8b9c',
  date: '2026-09-05T09:14:52+00:00',
  summary: reportSummary(certReportResults),
  results: certReportResults,
  products: certReportResults,
};

// ── Agendamentos ───────────────────────────────────────────────────────

export const certSchedules: CertSchedule[] = [
  {
    id: 'a1b2c3d4-0001-4e5f-8a9b-000000000001',
    name: 'Validação diária completa (planilha + estoque + VTEX)',
    cron_expression: '0 6 * * *',
    brand_filter: null,
    enabled: true,
    last_run: LAST_RUN_DATE,
    next_run: '2026-09-07T06:00:00-03:00',
    created_at: '2026-03-23T14:05:00-03:00',
  },
  {
    id: 'a1b2c3d4-0002-4e5f-8a9b-000000000002',
    name: 'Semanal Puket',
    cron_expression: '30 7 * * 1',
    brand_filter: 'puket',
    enabled: true,
    last_run: '2026-08-31T07:30:41-03:00',
    next_run: '2026-09-07T07:30:00-03:00',
    created_at: '2026-04-02T10:12:00-03:00',
  },
  {
    id: 'a1b2c3d4-0003-4e5f-8a9b-000000000003',
    name: 'Semanal Imaginarium (sexta) — pausado até o fim da migração VTEX IO',
    cron_expression: '0 18 * * 5',
    brand_filter: 'imaginarium',
    enabled: false,
    last_run: '2026-07-17T18:00:12-03:00',
    next_run: null,
    created_at: '2026-04-02T10:15:00-03:00',
  },
  {
    id: 'a1b2c3d4-0004-4e5f-8a9b-000000000004',
    name: 'Mensal Puket Escolares (dia 1)',
    cron_expression: '15 5 1 * *',
    brand_filter: 'puket_escolares',
    enabled: true,
    last_run: '2026-09-01T05:15:09-03:00',
    next_run: '2026-10-01T05:15:00-03:00',
    created_at: '2026-05-10T09:00:00-03:00',
  },
  {
    id: 'a1b2c3d4-0005-4e5f-8a9b-000000000005',
    name: 'Dias úteis 08:00 (personalizado)',
    cron_expression: '0 8 * * 1-5',
    brand_filter: null,
    enabled: true,
    last_run: '2026-09-04T08:00:03-03:00',
    next_run: '2026-09-07T08:00:00-03:00',
    created_at: '2026-06-20T16:40:00-03:00',
  },
  {
    id: 'a1b2c3d4-0006-4e5f-8a9b-000000000006',
    name: 'Teste a cada 30 minutos (desativado, nunca executado)',
    cron_expression: '*/30 * * * *',
    brand_filter: 'puket',
    enabled: false,
    last_run: null,
    next_run: null,
    created_at: '2026-08-29T11:00:00-03:00',
  },
  {
    id: 'a1b2c3d4-0007-4e5f-8a9b-000000000007',
    name: 'Recém-criado — Imaginarium quinzenal, dias 1 e 15 às 04:45, apenas em meses de campanha (mar, jun, set, dez)',
    cron_expression: '45 4 1,15 3,6,9,12 *',
    brand_filter: 'imaginarium',
    enabled: true,
    last_run: null,
    next_run: '2026-09-15T04:45:00-03:00',
    created_at: '2026-09-05T17:22:00-03:00',
  },
];

function scheduleHistory(scheduleId: string): CertScheduleHistoryEntry[] {
  const entry = (
    n: number,
    runDate: string,
    status: string,
    summary: CertScheduleHistoryEntry['summary'],
    reportFile: string | null,
  ): CertScheduleHistoryEntry => ({
    id: `h${n}-${scheduleId.slice(-4)}-4c7f-9a1b-e2e00000000${n}`,
    schedule_id: scheduleId,
    run_date: runDate,
    status,
    summary,
    report_file: reportFile,
  });
  return [
    entry(1, '2026-09-06T06:00:02-03:00', 'running', null, null),
    entry(2, LAST_RUN_DATE, 'completed', certStats.last_run ?? null, REPORT_JSON_MAIN),
    entry(
      3,
      '2026-09-04T06:11:03-03:00',
      'failed',
      { total: 120, ok: 37, inconsistent: 4, not_found: 9 },
      null,
    ),
    entry(
      4,
      '2026-09-03T06:09:58-03:00',
      'completed',
      { total: 118, ok: 71, missing: 2, inconsistent: 19, not_found: 26 },
      'validation_b2c4d6e8_20260903_060958.json',
    ),
    entry(
      5,
      '2026-09-02T06:12:01-03:00',
      'completed',
      { total: 118, ok: 118, missing: 0, inconsistent: 0, not_found: 0 },
      'validation_c0ffee11_20260902_061201.json',
    ),
    entry(
      6,
      '2026-09-01T06:07:40-03:00',
      'completed',
      { total: 0, ok: 0, missing: 0, inconsistent: 0, not_found: 0 },
      null,
    ),
  ];
}

// ── Validacao ──────────────────────────────────────────────────────────

function validationRun(runId: string): CertValidationRun {
  if (runId.includes('completed')) {
    return {
      run_id: runId,
      status: 'completed',
      processed: certProducts.length,
      total: certProducts.length,
    };
  }
  return { run_id: runId, status: 'running', processed: 47, total: certProducts.length };
}

/**
 * Eventos do SSE `/api/validate/:id/stream`. O contrato de fixture so responde
 * JSON, entao o stream nao entra em `certApiHandlers`; quem precisar do
 * progresso ao vivo usa `certValidationStreamBody` com `text/event-stream`.
 */
export const certValidationStreamEvents: CertValidationEvent[] = [
  ...certProducts.slice(0, 47).map<CertValidationEvent>((p, i) => ({
    type: 'progress',
    current: i + 1,
    total: certProducts.length,
    product: {
      sku: p.sku,
      name: p.name ?? '',
      status: REPORT_STATUSES[i % REPORT_STATUSES.length],
      score: REPORT_STATUSES[i % REPORT_STATUSES.length] === 'OK' ? 0.94 : 0.3,
    },
  })),
];

export const certValidationStreamBody: string = certValidationStreamEvents
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join('');

// ── Handlers ───────────────────────────────────────────────────────────

const lastSegment = (url: URL, offsetFromEnd = 1): string =>
  decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-offsetFromEnd) ?? '');

export const certApiHandlers: FixtureHandler[] = [
  { path: '/cert-api/api/health', method: 'GET', body: certHealth },
  { path: '/cert-api/api/ready', method: 'GET', body: { ready: true } },
  { path: '/cert-api/api/stats', method: 'GET', body: certStats },

  // Produtos
  { path: '/cert-api/api/products', method: 'GET', body: (url: URL) => listProducts(url) },
  { path: '/cert-api/api/products/verify', method: 'POST', body: verifyResult },
  {
    path: /^\/cert-api\/api\/products\/(?!verify$)[^/]+$/,
    method: 'GET',
    body: (url: URL) => productDetail(lastSegment(url)),
  },
  { path: '/cert-api/api/expired', method: 'GET', body: (url: URL) => listExpired(url) },

  // Certificados (cadastro + Linx)
  { path: '/cert-api/api/certificates', method: 'GET', body: (url: URL) => listCertificates(url) },
  { path: '/cert-api/api/certificates', method: 'POST', body: certCertificates[0] },
  {
    path: '/cert-api/api/certificates/linx-lookup',
    method: 'GET',
    body: (url: URL) => linxLookup(url),
  },
  {
    path: /^\/cert-api\/api\/certificates\/[^/]+\/retry-linx$/,
    method: 'POST',
    body: (url: URL) => ({
      ...certCertificates[0],
      id: lastSegment(url, 2),
      linx_status: 'applied' as LinxStatus,
      linx_error: null,
    }),
  },
  {
    path: /^\/cert-api\/api\/certificates\/(?!linx-lookup$)[^/]+$/,
    method: 'GET',
    body: (url: URL) =>
      certCertificates.find((c) => c.id === lastSegment(url)) ?? certCertificates[0],
  },

  // Relatorios
  { path: '/cert-api/api/reports', method: 'GET', body: certReports },
  { path: /^\/cert-api\/api\/reports\/[^/]+\/data$/, method: 'GET', body: certReportData },

  // Agendamentos
  { path: '/cert-api/api/schedules', method: 'GET', body: certSchedules },
  { path: '/cert-api/api/schedules', method: 'POST', body: certSchedules[6] },
  {
    path: /^\/cert-api\/api\/schedules\/[^/]+\/history$/,
    method: 'GET',
    body: (url: URL) => scheduleHistory(lastSegment(url, 2)),
  },
  {
    path: /^\/cert-api\/api\/schedules\/[^/]+\/run$/,
    method: 'POST',
    body: { run_id: CERT_RUN_ID_RUNNING, status: 'running' } satisfies CertValidationRun,
  },
  {
    path: /^\/cert-api\/api\/schedules\/[^/]+$/,
    method: 'PUT',
    body: (url: URL) => ({
      ...(certSchedules.find((s) => s.id === lastSegment(url)) ?? certSchedules[0]),
      id: lastSegment(url),
    }),
  },
  { path: /^\/cert-api\/api\/schedules\/[^/]+$/, method: 'DELETE', body: { ok: true } },

  // Validacao
  {
    path: '/cert-api/api/validate',
    method: 'POST',
    body: { run_id: CERT_RUN_ID_RUNNING, status: 'running' } satisfies CertValidationRun,
  },
  {
    path: /^\/cert-api\/api\/validate\/[^/]+$/,
    method: 'GET',
    body: (url: URL) => validationRun(lastSegment(url)),
  },

  // Sync manual de estoque (botao "Sync Estoque" em Relatorios, admin)
  {
    path: '/cert-api/api/sync-stock',
    method: 'POST',
    body: { wms: 33416, ecommerce_puket: 9812, ecommerce_imaginarium: 6240, errors: [] },
  },
];
