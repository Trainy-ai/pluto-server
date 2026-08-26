/**
 * Unit tests for the authenticated Swagger UI page (routes/docs.ts).
 *
 * The page ships a hand-written bootstrap script embedded in a template
 * literal, so the things most likely to break are silent: an unreplaced
 * placeholder, a lost script tag, or the auth wiring being dropped. These
 * assertions pin the contract of the rendered HTML without needing a server.
 *
 * The behavioural half (session gate, key minting, revocation) lives in
 * smoke.test.ts Suite 43, which exercises it against a running backend.
 */
import { describe, expect, it } from 'vitest';

import { renderDocsPage, renderSignInPage } from '../routes/docs-page';

describe('Swagger UI docs page', () => {
  const html = renderDocsPage();

  it('renders Swagger UI against the published spec', () => {
    expect(html).toContain('<div id="swagger-ui"></div>');
    expect(html).toContain('SwaggerUIBundle({');
    expect(html).toContain('url: "/api/openapi.json"');
    expect(html).toContain('url: SPECS.rest.url');
  });

  it('loads the Swagger assets and the bootstrap script', () => {
    expect(html).toMatch(/<link rel="stylesheet" href="https:\/\/[^"]+swagger-ui\.css" \/>/);
    expect(html).toMatch(/<script src="https:\/\/[^"]+swagger-ui-bundle\.js"/);
    // The placeholder in the bootstrap script must have been substituted.
    expect(html).not.toContain('__SPEC_URL__');
    // No stray template-literal interpolation leaked into the client script.
    expect(html).not.toContain('${');
  });

  it('authorizes Swagger UI with the minted key', () => {
    // Preferred path (matches what the Authorize dialog does) plus fallback.
    expect(html).toContain('ui.authActions.authorize({');
    expect(html).toContain('ui.preauthorizeApiKey("bearerAuth", key)');
    // Belt and braces, so the printed curl always carries the header.
    expect(html).toContain('req.headers.Authorization = "Bearer " + state.key');
  });

  it('offers both surfaces and switches specs without reloading', () => {
    expect(html).toContain('data-spec="rest"');
    expect(html).toContain('data-spec="trpc"');
    expect(html).toContain('/api/docs/openapi-trpc.json');
    expect(html).toContain('ui.specActions.updateUrl');
  });

  it('sends cookies so tRPC try-it-out carries the session', () => {
    // tRPC accepts only the better-auth session; without credentials every
    // /trpc/* call from this page would 401.
    expect(html).toContain('withCredentials: true');
  });

  it('never attaches the bearer key to tRPC requests', () => {
    // tRPC rejects API keys, so attaching one would print a curl that cannot
    // work and imply a credential that surface does not honour.
    expect(html).toContain('indexOf("/trpc/")');
  });

  it('mints through the CSRF-protected endpoints', () => {
    expect(html).toContain('"x-mlop-docs": "1"');
    expect(html).toContain('/api/docs/key');
    expect(html).toContain('/api/docs/key/revoke');
    expect(html).toContain('credentials: "same-origin"');
  });

  it('still hands over a usable key when the CDN assets do not load', () => {
    // Air-gapped / egress-filtered networks never get the Swagger bundle. The
    // page must still mint and show the key rather than sitting on "Loading…".
    expect(html).toContain('typeof SwaggerUIBundle === "undefined"');
    expect(html).toContain('Swagger UI could not be');
  });

  it('keeps the short-lived key out of browser storage', () => {
    expect(html).toContain('persistAuthorization: false');
    expect(html).not.toContain('localStorage');
  });

  it('exposes the banner controls the script binds to', () => {
    for (const id of ['mlop-key', 'mlop-copy', 'mlop-refresh', 'mlop-revoke', 'mlop-org', 'mlop-status']) {
      expect(html, `missing #${id}`).toContain(`id="${id}"`);
    }
  });
});

describe('Swagger UI sign-in page', () => {
  const html = renderSignInPage();

  it('offers a way in without exposing the UI', () => {
    expect(html).not.toContain('SwaggerUIBundle');
    expect(html.toLowerCase()).toContain('sign in');
    expect(html).toContain('/auth/sign-in');
  });
});
