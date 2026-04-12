import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { aiService } from './service.js';
import { documentService } from '../documents/service.js';
import { processService } from '../processes/service.js';
import { db } from '../../shared/database/connection.js';
import { documents } from '../../shared/database/schema.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export async function extractDocument(req: Request, res: Response) {
  try {
    const { documentId, type } = req.body;

    if (!documentId || !type) {
      return sendError(res, 'documentId e type são obrigatórios', 400);
    }

    const validTypes = ['invoice', 'packing-list', 'bl'];
    if (!validTypes.includes(type)) {
      return sendError(res, `Tipo inválido. Use: ${validTypes.join(', ')}`, 400);
    }

    let { text } = req.body;
    if (!text) {
      const doc = await documentService.getById(documentId);
      text = await documentService.extractText(doc.storagePath, doc.mimeType || '');
    }

    let result;
    switch (type) {
      case 'invoice':
        result = await aiService.extractInvoiceData(text);
        break;
      case 'packing-list':
        result = await aiService.extractPackingListData(text);
        break;
      case 'bl':
        result = await aiService.extractBLData(text);
        break;
      default:
        return sendError(res, `Tipo de documento nao suportado: ${type}`, 400);
    }

    return sendSuccess(res, result);
  } catch (error) {
    logger.error({ error }, 'Error extracting document data');
    return sendError(res, 'Erro ao extrair dados do documento', 500);
  }
}

export async function detectAnomalies(req: Request, res: Response) {
  try {
    const { processId } = req.body;

    if (!processId) {
      return sendError(res, 'processId é obrigatório', 400);
    }

    let { invoiceData, packingListData, blData } = req.body;
    if (!invoiceData || !packingListData || !blData) {
      const processDocs = await db
        .select()
        .from(documents)
        .where(eq(documents.processId, processId));

      const invoiceDoc = processDocs.find((d) => d.type === 'invoice');
      const plDoc = processDocs.find((d) => d.type === 'packing_list');
      const blDoc = processDocs.find((d) => d.type === 'ohbl');

      if (!invoiceDoc?.aiParsedData || !plDoc?.aiParsedData || !blDoc?.aiParsedData) {
        return sendError(res, 'Documentos do processo ainda não foram processados pela IA', 400);
      }

      invoiceData = invoiceDoc.aiParsedData;
      packingListData = plDoc.aiParsedData;
      blData = blDoc.aiParsedData;
    }

    const result = await aiService.detectAnomalies(invoiceData, packingListData, blData);
    return sendSuccess(res, result);
  } catch (error) {
    logger.error({ error }, 'Error detecting anomalies');
    return sendError(res, 'Erro ao detectar anomalias', 500);
  }
}

export async function generateEmailDraft(req: Request, res: Response) {
  try {
    const { processId, recipientType } = req.body;

    if (!processId) {
      return sendError(res, 'processId é obrigatório', 400);
    }

    const validRecipients = ['fenicia', 'isa'];
    if (!recipientType || !validRecipients.includes(recipientType)) {
      return sendError(res, `recipientType inválido. Use: ${validRecipients.join(', ')}`, 400);
    }

    let { processData } = req.body;
    if (!processData) {
      processData = await processService.getById(processId);
    }

    const result = await aiService.generateEmailDraft(processData, recipientType);
    return sendSuccess(res, result);
  } catch (error) {
    logger.error({ error }, 'Error generating email draft');
    return sendError(res, 'Erro ao gerar rascunho de email', 500);
  }
}

export async function validateNcm(req: Request, res: Response) {
  try {
    const { description, ncmCode } = req.body;

    if (!description || !ncmCode) {
      return sendError(res, 'description e ncmCode são obrigatórios', 400);
    }

    const result = await aiService.validateNcm(description, ncmCode);
    return sendSuccess(res, result);
  } catch (error) {
    logger.error({ error }, 'Error validating NCM');
    return sendError(res, 'Erro ao validar NCM', 500);
  }
}
