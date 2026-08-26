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

import {
  buildBootstrapScript,
  renderDocsPage,
  renderSignInPage,
} from '../routes/docs-page';

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

  it('still offers a usable key when the CDN assets do not load', () => {
    // Air-gapped / egress-filtered networks never get the Swagger bundle. The
    // page must still say how to get a key rather than sitting on "Loading…".
    expect(html).toContain('typeof SwaggerUIBundle === "undefined"');
    expect(html).toContain('Swagger UI could not be');
    expect(html).toContain('Create a temporary key above');
  });

  it('keeps the short-lived key out of browser storage', () => {
    expect(html).toContain('persistAuthorization: false');
    expect(html).not.toContain('localStorage');
  });

  it('exposes the banner controls the script binds to', () => {
    for (const id of ['mlop-key', 'mlop-copy', 'mlop-create', 'mlop-revoke', 'mlop-org', 'mlop-status']) {
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

/**
 * Behavioural tests for the client bootstrap.
 *
 * The script is a self-contained IIFE, so it can be executed against a hand
 * rolled DOM without pulling in jsdom. What is worth pinning here is a
 * security property rather than a rendering detail: opening the docs page must
 * NOT mint an API key. A credential is created only when a signed-in human
 * explicitly asks for one, so merely reading the docs never leaves a live org
 * key behind in the account's key list.
 */
describe('Swagger UI docs page bootstrap', () => {
  interface FakeElement {
    id: string;
    textContent: string;
    className: string;
    innerHTML: string;
    value: string;
    selected: boolean;
    style: Record<string, string>;
    children: FakeElement[];
    attributes: Record<string, string>;
    addEventListener: (type: string, fn: (event: unknown) => void) => void;
    appendChild: (child: FakeElement) => void;
    getAttribute: (name: string) => string | null;
    fire: (type: string) => void;
  }

  interface FetchCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  }

  function makeElement(id: string, attributes: Record<string, string> = {}): FakeElement {
    const listeners: Record<string, Array<(event: unknown) => void>> = {};
    const element: FakeElement = {
      id,
      textContent: '',
      className: '',
      innerHTML: '',
      value: '',
      selected: false,
      style: {},
      children: [],
      attributes,
      addEventListener(type, fn) {
        (listeners[type] ||= []).push(fn);
      },
      appendChild(child) {
        element.children.push(child);
      },
      getAttribute(name) {
        return attributes[name] ?? null;
      },
      fire(type) {
        for (const fn of listeners[type] || []) {
          fn({ currentTarget: element });
        }
      },
    };
    return element;
  }

  /** Let the bootstrap's promise chains settle. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function run(options: { organizations?: Array<Record<string, unknown>> } = {}) {
    const organizations = options.organizations ?? [
      { id: 'org1', name: 'Org One', slug: 'org-one', role: 'OWNER' },
    ];
    const ids = [
      'mlop-status',
      'mlop-key',
      'mlop-org',
      'mlop-create',
      'mlop-revoke',
      'mlop-copy',
      'swagger-ui',
    ];
    const elements: Record<string, FakeElement> = {};
    for (const id of ids) {
      elements[id] = makeElement(id);
    }
    const specButtons = [
      makeElement('', { 'data-spec': 'rest' }),
      makeElement('', { 'data-spec': 'trpc' }),
    ];

    const calls: FetchCall[] = [];
    const fetchStub = (url: string, init: Record<string, unknown> = {}) => {
      calls.push({
        url,
        method: (init.method as string) || 'GET',
        headers: (init.headers as Record<string, string>) || {},
        body: init.body ? JSON.parse(init.body as string) : null,
      });

      if (url.startsWith('/api/docs/session')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              user: { email: 'dev@example.com', name: 'Dev' },
              organizations,
              activeOrganizationId: organizations[0]?.id ?? null,
              tempKeysEnabled: true,
              ttlMinutes: 15,
            }),
        });
      }
      if (url === '/api/docs/key') {
        const orgId = (init.body ? JSON.parse(init.body as string).organizationId : null) ?? 'org1';
        const org = organizations.find((o) => o.id === orgId) ?? organizations[0];
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              apiKey: 'mlps_testkey_0123456789',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              ttlMinutes: 15,
              organization: { id: org.id, name: org.name, slug: org.slug },
              user: { email: 'dev@example.com' },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ revoked: 1 }) });
    };

    const loadHandlers: Array<() => void> = [];
    const fakeWindow = {
      addEventListener(type: string, fn: () => void) {
        if (type === 'load') {
          loadHandlers.push(fn);
        }
      },
      ui: null,
    };
    const fakeDocument = {
      getElementById: (id: string) => elements[id] ?? null,
      querySelectorAll: (selector: string) => (selector === '[data-spec]' ? specButtons : []),
      createElement: () => makeElement(''),
    };
    const navigator = { clipboard: { writeText: () => Promise.resolve() } };

    // SwaggerUIBundle is left undefined on purpose: the script's no-CDN path
    // keeps `ui` null, which exercises the mint wiring without a real Swagger.
    const factory = new Function(
      'window',
      'document',
      'fetch',
      'navigator',
      'SwaggerUIBundle',
      buildBootstrapScript(),
    );
    factory(fakeWindow, fakeDocument, fetchStub, navigator, undefined);

    return {
      calls,
      elements,
      boot: () => loadHandlers.forEach((fn) => fn()),
      mintCalls: () => calls.filter((call) => call.url === '/api/docs/key'),
    };
  }

  it('does not mint an API key just because the page was opened', async () => {
    const harness = run();
    harness.boot();
    await flush();

    // The session probe is expected — it drives the org picker.
    expect(harness.calls.some((call) => call.url.startsWith('/api/docs/session'))).toBe(true);
    // The credential is not.
    expect(harness.mintCalls()).toHaveLength(0);
  });

  it('tells the reader a key has to be asked for', async () => {
    const harness = run();
    harness.boot();
    await flush();

    expect(harness.elements['mlop-key'].textContent).toBe('not authorized');
    expect(harness.elements['mlop-status'].textContent.toLowerCase()).toContain('create key');
  });

  it('mints exactly one key when the reader clicks Create key', async () => {
    const harness = run();
    harness.boot();
    await flush();

    harness.elements['mlop-create'].fire('click');
    await flush();

    const mints = harness.mintCalls();
    expect(mints).toHaveLength(1);
    expect(mints[0].method).toBe('POST');
    expect(mints[0].headers['x-mlop-docs']).toBe('1');
    expect(harness.elements['mlop-key'].textContent).toContain('mlps_test');
  });

  it('does not mint when the org picker changes before a key exists', async () => {
    const harness = run({
      organizations: [
        { id: 'org1', name: 'Org One', slug: 'org-one', role: 'OWNER' },
        { id: 'org2', name: 'Org Two', slug: 'org-two', role: 'MEMBER' },
      ],
    });
    harness.boot();
    await flush();

    harness.elements['mlop-org'].value = 'org2';
    harness.elements['mlop-org'].fire('change');
    await flush();

    expect(harness.mintCalls()).toHaveLength(0);
  });

  it('re-mints on an org change once the reader has opted in', async () => {
    const harness = run({
      organizations: [
        { id: 'org1', name: 'Org One', slug: 'org-one', role: 'OWNER' },
        { id: 'org2', name: 'Org Two', slug: 'org-two', role: 'MEMBER' },
      ],
    });
    harness.boot();
    await flush();

    harness.elements['mlop-create'].fire('click');
    await flush();
    harness.elements['mlop-org'].value = 'org2';
    harness.elements['mlop-org'].fire('change');
    await flush();

    const mints = harness.mintCalls();
    expect(mints).toHaveLength(2);
    expect(mints[1].body).toEqual({ organizationId: 'org2' });
  });
});
