import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from '../html-sanitizer.js';

describe('sanitizeEmailHtml', () => {
  it('removes executable markup, event handlers and dangerous URL schemes', () => {
    const dirty = `
      <script>alert('script')</script>
      <style>body { background-image: url(https://attacker.invalid/pixel) }</style>
      <svg onload="alert(1)"><circle /></svg>
      <iframe src="https://attacker.invalid"></iframe>
      <img src="javascript:alert(1)" onerror="alert(2)" alt="invoice">
      <a href="data:text/html,attack" onclick="alert(3)">open</a>
      <p>Conteúdo legítimo</p>
    `;

    const clean = sanitizeEmailHtml(dirty);

    expect(clean).toContain('<p>Conteúdo legítimo</p>');
    expect(clean).toContain('<img alt="invoice" />');
    expect(clean).not.toMatch(/script|style|svg|iframe|onerror|onclick|javascript:|data:/i);
  });

  it('preserves the table markup and safe inline styles used by templates', () => {
    const clean = sanitizeEmailHtml(`
      <div style="font-family: Arial, sans-serif; color: #333; margin: 20px 0">
        <table style="width: 100%; border-collapse: collapse">
          <thead><tr><th scope="col" style="background-color: #f5f5f5; padding: 8px">Campo</th></tr></thead>
          <tbody><tr><td colspan="2" style="border: 1px solid #ddd; text-align: center">Valor</td></tr></tbody>
        </table>
        <a href="https://example.com" target="_blank" rel="noopener">Detalhes</a>
      </div>
    `);

    expect(clean).toContain('font-family:Arial, sans-serif');
    expect(clean).toContain('border-collapse:collapse');
    expect(clean).toContain('background-color:#f5f5f5');
    expect(clean).toContain('border:1px solid #ddd');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('colspan="2"');
  });

  it('drops CSS properties and values outside the allow-list', () => {
    const clean = sanitizeEmailHtml(
      '<p style="position: fixed; background-image: url(https://attacker.invalid); color: expression(alert(1)); padding: 8px">Texto</p>',
    );

    expect(clean).toContain('style="padding:8px"');
    expect(clean).not.toMatch(/position|background-image|attacker|expression/i);
  });
});
