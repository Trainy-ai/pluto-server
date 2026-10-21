/**
 * Platform admin gate + admin billing procedures.
 *
 * The admin page lets an operator open a PRO checkout for an organization they
 * are not a member of (to apply a promotion code on the customer's behalf).
 * These tests pin who gets through the gate and what the checkout is opened
 * with, against mocked Prisma and Stripe. The HTTP-level gate (401/403 on the
 * real server) is covered by smoke.test.ts Suite 45.
 *
 * Run with: npx vitest run tests/platform-admin.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_fake_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
    STRIPE_PRO_PRICE_ID: 'price_test_fake',
    BETTER_AUTH_URL: 'https://app.example.com',
    PLATFORM_ADMIN_EMAILS: 'admin@trainy.ai' as string | undefined,
  },
  sessionsCreate: vi.fn(),
  prisma: {
    member: { findFirst: vi.fn(), count: vi.fn() },
    organization: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('../lib/env', () => ({ env: mocks.env }));
vi.mock('../lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('stripe', () => ({
  default: function FakeStripe() {
    return { checkout: { sessions: { create: mocks.sessionsCreate } } };
  },
}));

import { isPlatformAdmin } from '../lib/platform-admin';
import { adminRouter } from '../trpc/routers/admin/router';
import { billingRouter } from '../trpc/routers/organization/routers/billing/router';

const ADMIN = { id: 'u_admin', email: 'admin@trainy.ai', emailVerified: true };
const CUSTOMER = { id: 'u_customer', email: 'owner@customer.com', emailVerified: true };

function callerFor(user: typeof ADMIN, activeOrganizationId: string | null = 'org_admin') {
  const ctx = {
    session: { session: { activeOrganizationId }, user },
    user,
    prisma: mocks.prisma,
  };
  return {
    admin: adminRouter.createCaller(ctx as any),
    billing: billingRouter.createCaller(ctx as any),
  };
}

/** Organization lookups: the admin's own org (for the return URL) and the target. */
function mockOrganizations(targetPlan: 'FREE' | 'PRO' = 'FREE') {
  mocks.prisma.organization.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === 'org_admin') {
      return { slug: 'trainy' };
    }
    if (where.id === 'org_customer') {
      return {
        id: 'org_customer',
        name: 'Customer Inc',
        slug: 'customer-inc',
        OrganizationSubscription: { plan: targetPlan, stripeCustomerId: '' },
      };
    }
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.PLATFORM_ADMIN_EMAILS = 'admin@trainy.ai';
  mocks.sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/test' });
  mocks.prisma.member.count.mockResolvedValue(3);
});

describe('isPlatformAdmin', () => {
  it('accepts a verified email on the allowlist', () => {
    expect(isPlatformAdmin(ADMIN)).toBe(true);
  });

  it('matches case-insensitively and ignores whitespace in the list', () => {
    mocks.env.PLATFORM_ADMIN_EMAILS = ' someone@else.com , Admin@Trainy.AI ';
    expect(isPlatformAdmin({ ...ADMIN, email: 'ADMIN@trainy.ai' })).toBe(true);
  });

  it('rejects an unverified email even when it is listed', () => {
    expect(isPlatformAdmin({ ...ADMIN, emailVerified: false })).toBe(false);
  });

  it('rejects an email that is not listed', () => {
    expect(isPlatformAdmin(CUSTOMER)).toBe(false);
  });

  it('admits nobody when the allowlist is unset or empty', () => {
    mocks.env.PLATFORM_ADMIN_EMAILS = undefined;
    expect(isPlatformAdmin(ADMIN)).toBe(false);
    mocks.env.PLATFORM_ADMIN_EMAILS = ' , ';
    expect(isPlatformAdmin(ADMIN)).toBe(false);
  });

  it('rejects a missing user', () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});

describe('admin.status', () => {
  it('reports whether the caller is a platform admin', async () => {
    expect(await callerFor(ADMIN).admin.status()).toEqual({ isPlatformAdmin: true });
    expect(await callerFor(CUSTOMER).admin.status()).toEqual({ isPlatformAdmin: false });
  });
});

describe('admin gate', () => {
  it('forbids listOrganizations for a non-admin without touching the database', async () => {
    await expect(callerFor(CUSTOMER).admin.listOrganizations({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.prisma.organization.findMany).not.toHaveBeenCalled();
  });

  it('forbids createCheckoutSession for a non-admin without opening a checkout', async () => {
    mockOrganizations();
    await expect(
      callerFor(CUSTOMER).admin.createCheckoutSession({ organizationId: 'org_customer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe('admin.listOrganizations', () => {
  it('returns orgs with owner, member count and plan', async () => {
    mocks.prisma.organization.findMany.mockResolvedValue([
      {
        id: 'org_customer',
        name: 'Customer Inc',
        slug: 'customer-inc',
        createdAt: new Date('2026-01-01'),
        _count: { members: 3 },
        members: [{ user: { name: 'Owner', email: 'owner@customer.com' } }],
        OrganizationSubscription: { plan: 'PRO', stripeSubscriptionId: 'edu' },
      },
      {
        id: 'org_orphan',
        name: 'Orphan',
        slug: 'orphan',
        createdAt: new Date('2026-01-02'),
        _count: { members: 0 },
        members: [],
        OrganizationSubscription: null,
      },
    ]);

    const result = await callerFor(ADMIN).admin.listOrganizations({});

    expect(result).toEqual([
      {
        id: 'org_customer',
        name: 'Customer Inc',
        slug: 'customer-inc',
        createdAt: new Date('2026-01-01'),
        memberCount: 3,
        owner: { name: 'Owner', email: 'owner@customer.com' },
        plan: 'PRO',
        isEducationPlan: true,
      },
      {
        id: 'org_orphan',
        name: 'Orphan',
        slug: 'orphan',
        createdAt: new Date('2026-01-02'),
        memberCount: 0,
        owner: null,
        plan: null,
        isEducationPlan: false,
      },
    ]);
  });

  it('searches name, slug, id and member email, and caps the page', async () => {
    mocks.prisma.organization.findMany.mockResolvedValue([]);

    await callerFor(ADMIN).admin.listOrganizations({ search: '  customer.com ' });

    const args = mocks.prisma.organization.findMany.mock.calls[0][0];
    expect(args.take).toBe(50);
    expect(args.where.OR).toEqual([
      { id: 'customer.com' },
      { name: { contains: 'customer.com', mode: 'insensitive' } },
      { slug: { contains: 'customer.com', mode: 'insensitive' } },
      { members: { some: { user: { email: { contains: 'customer.com', mode: 'insensitive' } } } } },
    ]);
  });

  it('lists everything when the search is blank', async () => {
    mocks.prisma.organization.findMany.mockResolvedValue([]);
    await callerFor(ADMIN).admin.listOrganizations({ search: '   ' });
    expect(mocks.prisma.organization.findMany.mock.calls[0][0].where).toBeUndefined();
  });
});

describe('admin.createCheckoutSession', () => {
  beforeEach(() => {
    mocks.prisma.member.findFirst.mockResolvedValue({ user: { email: 'owner@customer.com' } });
  });

  it("opens a checkout for the org with the owner's email and the real member count", async () => {
    mockOrganizations();

    const result = await callerFor(ADMIN).admin.createCheckoutSession({
      organizationId: 'org_customer',
    });

    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/c/test' });
    const params = mocks.sessionsCreate.mock.calls[0][0];
    // The customer, not the admin, becomes the Stripe customer.
    expect(params.customer_email).toBe('owner@customer.com');
    // Seats are the org's own members; the admin is never one of them.
    expect(params.line_items).toEqual([{ price: 'price_test_fake', quantity: 3 }]);
    expect(mocks.prisma.member.count).toHaveBeenCalledWith({
      where: { organizationId: 'org_customer' },
    });
    // The webhook upgrades whichever org the metadata names.
    expect(params.metadata).toEqual({ organizationId: 'org_customer' });
    expect(params.subscription_data.metadata).toEqual({ organizationId: 'org_customer' });
    // Promotion codes are entered on the Stripe page, as before.
    expect(params.allow_promotion_codes).toBe(true);
  });

  it('returns to the admin page under the org the admin is viewing it from', async () => {
    mockOrganizations();

    await callerFor(ADMIN).admin.createCheckoutSession({ organizationId: 'org_customer' });

    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.success_url).toBe(
      'https://app.example.com/o/trainy/settings/admin?upgraded=customer-inc',
    );
    expect(params.cancel_url).toBe('https://app.example.com/o/trainy/settings/admin');
  });

  it('falls back to the org picker when the admin has no active org', async () => {
    mockOrganizations();

    await callerFor(ADMIN, null).admin.createCheckoutSession({ organizationId: 'org_customer' });

    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.success_url).toBe('https://app.example.com/o?upgraded=customer-inc');
  });

  it('refuses an org that is already on PRO', async () => {
    mockOrganizations('PRO');
    await expect(
      callerFor(ADMIN).admin.createCheckoutSession({ organizationId: 'org_customer' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('refuses an org with no owner (or that does not exist)', async () => {
    mockOrganizations();
    mocks.prisma.member.findFirst.mockResolvedValue(null);
    await expect(
      callerFor(ADMIN).admin.createCheckoutSession({ organizationId: 'org_missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('reports billing as unconfigured when Stripe is not set up', async () => {
    mockOrganizations();
    const priceId = mocks.env.STRIPE_PRO_PRICE_ID;
    (mocks.env as any).STRIPE_PRO_PRICE_ID = undefined;
    try {
      await expect(
        callerFor(ADMIN).admin.createCheckoutSession({ organizationId: 'org_customer' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    } finally {
      mocks.env.STRIPE_PRO_PRICE_ID = priceId;
    }
  });
});

describe('organization.billing.createCheckoutSession (shares the checkout helper)', () => {
  it("still uses the caller's email and the org's own billing page", async () => {
    mockOrganizations();
    mocks.prisma.member.findFirst.mockResolvedValue({ role: 'OWNER' });

    await callerFor(CUSTOMER).billing.createCheckoutSession({ organizationId: 'org_customer' });

    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.customer_email).toBe('owner@customer.com');
    expect(params.success_url).toBe(
      'https://app.example.com/o/customer-inc/settings/org/billing?success=true',
    );
    expect(params.cancel_url).toBe(
      'https://app.example.com/o/customer-inc/settings/org/billing?cancelled=true',
    );
  });

  it('still forbids plain members', async () => {
    mockOrganizations();
    mocks.prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });

    await expect(
      callerFor(CUSTOMER).billing.createCheckoutSession({ organizationId: 'org_customer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
