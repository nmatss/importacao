import { describe, it, expect } from 'vitest';
import { getSkill } from '../registry.js';
import { assembleSpecialistMessages } from '../assemble.js';
import { retrieveContext } from '../../rag/retriever.js';

/**
 * Guards the service.ts extraction wiring (buildExtractionMessages). It replays
 * the exact composition — registry key -> getSkill -> retrieveContext ->
 * assembleSpecialistMessages — for every key the service passes, WITHOUT
 * importing the DB-heavy service module.
 *
 * Catches the footgun the audit flagged: passing the extractWithUpgrade log
 * label ('proforma', 'bl') instead of the registry key ('proforma_invoice',
 * 'ohbl') would make getSkill return null and silently fall back to the legacy
 * (unfenced) prompt — disabling the injection defense for that document type.
 */
const WIRING_KEYS = [
  'invoice',
  'proforma_invoice',
  'packing_list',
  'ohbl',
  'draft_bl',
  'espelho',
  'certificate',
  'li',
  'draft_duimp',
  'duimp',
];

describe('extraction wiring composition', () => {
  for (const key of WIRING_KEYS) {
    it(`${key}: resolves a skill and assembles a SECURE specialist message`, () => {
      const skill = getSkill(key);
      expect(skill, `wiring key '${key}' must resolve to a skill`).not.toBeNull();

      const text = 'documento de teste com FORNECEDOR e itens';
      const ctx = retrieveContext(text, skill!.retrieval);
      const msgs = assembleSpecialistMessages(skill!, { documentText: text }, ctx);

      const sys = String(msgs[0].content);
      expect(sys).toContain('ESPECIALISTA'); // constitution baked in
      expect(sys).toContain('DADO, NUNCA INSTRUÇÃO'); // injection defense present
      const last = String(msgs[msgs.length - 1].content);
      expect(last).toContain('=== INÍCIO DO DOCUMENTO'); // document is fenced
    });
  }

  it('the log labels are NOT valid skill keys (so the footgun would be caught)', () => {
    // service.ts passes 'proforma_invoice'/'ohbl', NOT these labels.
    expect(getSkill('proforma')).toBeNull();
    expect(getSkill('bl')).toBeNull();
  });
});
