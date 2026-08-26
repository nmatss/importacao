import sanitizeHtml from 'sanitize-html';

const CSS_LENGTH =
  /^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))){0,3}$/;
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d.%\s,]+\))$/i;

/**
 * Sanitizes untrusted rich text before it is persisted or sent by e-mail.
 *
 * E-mail templates intentionally use a small amount of inline CSS because many
 * mail clients do not reliably load stylesheets. Keep the allow-list narrow and
 * add a regression test whenever a new template needs another element/property.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'a',
      'b',
      'blockquote',
      'br',
      'div',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'hr',
      'i',
      'img',
      'li',
      'ol',
      'p',
      'span',
      'strong',
      'table',
      'tbody',
      'td',
      'tfoot',
      'th',
      'thead',
      'tr',
      'u',
      'ul',
    ],
    allowedAttributes: {
      '*': ['style'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'cid'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'cid'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'background-color': [CSS_COLOR],
        border: [/^\d+(?:\.\d+)?px\s+solid\s+(?:#[0-9a-f]{3,8}|[a-z]+)$/i],
        'border-collapse': [/^collapse$/],
        color: [CSS_COLOR],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'font-style': [/^(?:normal|italic)$/],
        'font-weight': [/^(?:normal|bold|[1-9]00)$/],
        'line-height': [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/],
        margin: [CSS_LENGTH],
        'margin-bottom': [CSS_LENGTH],
        'margin-left': [CSS_LENGTH],
        'margin-right': [CSS_LENGTH],
        'margin-top': [CSS_LENGTH],
        padding: [CSS_LENGTH],
        'padding-bottom': [CSS_LENGTH],
        'padding-left': [CSS_LENGTH],
        'padding-right': [CSS_LENGTH],
        'padding-top': [CSS_LENGTH],
        'text-align': [/^(?:left|right|center|justify)$/],
        'text-decoration': [/^(?:none|underline)$/],
        width: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
      },
    },
    parseStyleAttributes: true,
  });
}
