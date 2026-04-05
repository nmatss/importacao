# ADR 0003 — JWT stored in localStorage (known security debt)

**Date**: 2025-01  
**Status**: Accepted with known debt

## Context

The web app needs to store authentication tokens on the client. Options: localStorage, sessionStorage, httpOnly cookies.

## Decision

Store JWT in **localStorage** via a `useAuth()` hook.

## Reasoning

- Fast to implement — no server-side session infrastructure required.
- Works cleanly with the SPA architecture (no need for cookie CSRF protection headers).
- The application is deployed on an internal network with Nginx in front — not publicly internet-facing.

## Known Security Debt

Storing JWT in localStorage is vulnerable to **XSS attacks**: any injected script can read `localStorage` and exfiltrate the token.

The recommended mitigation is to move to **httpOnly cookies** + CSRF tokens. This is a significant architectural change (requires server-side `/api/auth/refresh` endpoint, cookie handling middleware, CSRF middleware).

**This debt is tracked.** Migration to httpOnly cookies should happen before any public-facing deployment. DOMPurify is already applied to all `dangerouslySetInnerHTML` usage as a partial mitigation.

## Consequences

**Positive**:
- Simple implementation, no server session state.
- Works with current Nginx configuration without changes.

**Negative**:
- XSS vulnerability window — token accessible to any JS running on the page.
- Does not work well with browser security policies that restrict localStorage in iframes.
