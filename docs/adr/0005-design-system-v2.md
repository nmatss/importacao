# ADR 0005 — Design System v2: Semantic Tokens + Inter Font

**Date**: 2026-04  
**Status**: Accepted

## Context

The original UI used ad-hoc Tailwind utility classes with raw color names (blue-500, red-600, gray-700). This created inconsistency across components and made theme changes tedious — updating one "primary" color required finding all uses of `blue-*`.

## Decision

Adopt a **semantic design token system** built on Tailwind CSS 4 custom properties:

- **primary-\*** → indigo scale (buttons, links, active states)
- **danger-\*** → rose scale (errors, destructive actions)
- **sidebar-\*** → navy scale (navigation sidebar)
- **success/warning** → semantic green/amber
- **Accent palettes**: violet-\* (AI features), orange-\* (Fenicia imports), cyan-\* (logistics)

Use **Inter** font with `font-feature-settings: "cv02","cv03","cv04","cv11"` for improved legibility of numbers (important for import volumes and financial data).

**Banned raw classes**: `blue-*`, `red-*`, `gray-*`, `green-*`, `yellow-*`, `purple-*`, `indigo-*` — all uses replaced with semantic token variants.

## Consequences

**Positive**:
- Theme changes require editing the token definition only — all components update automatically.
- Consistent visual language — designers and developers share the same vocabulary.
- Semantic names communicate intent (`danger-600` vs `red-600`).

**Negative**:
- Learning curve for new contributors used to raw Tailwind classes.
- Required a full UI audit to replace all raw color class usages.
- Custom tokens require Tailwind CSS 4 (`@theme` directive) — not backwards compatible with v3.
