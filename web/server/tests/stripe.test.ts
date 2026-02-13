/**
 * Stripe Utility Tests
 *
 * Tests for Stripe checkout session creation and payment configuration.
 * Run with: npx vitest run tests/stripe.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSessionsCreate = vi.fn().mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.com/test' });

// Mock Stripe constructor - must support `new Stripe()`
vi.mock('stripe', () => {
  return {
    default: function FakeStripe() {
      return {
        checkout: {
          sessions: {
            create: mockSessionsCreate,
          },
        },
      };
    },
  };
});

// Mock env module to avoid requiring actual environment variables
vi.mock('../lib/env', () => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_fake_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
    STRIPE_PRO_PRICE_ID: 'price_test_fake',
  },
}));

import { createCheckoutSession } from '../lib/stripe';

describe('Checkout Session Creation', () => {
  const defaultParams = {
    organizationId: 'org_test_123',
    organizationName: 'Test Org',
    customerEmail: 'user@example.com',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    seatCount: 3,
  };

  let sessionParams: any;

  beforeEach(async () => {
    mockSessionsCreate.mockClear();
    await createCheckoutSession(defaultParams);
    sessionParams = mockSessionsCreate.mock.calls[0][0];
  });

  it('sets payment_method_collection to if_required so 100% off promo codes skip card entry', () => {
    expect(sessionParams.payment_method_collection).toBe('if_required');
  });

  it('does not hardcode payment_method_types so Stripe can skip payment for free checkouts', () => {
    expect(sessionParams.payment_method_types).toBeUndefined();
  });

  it('enables promotion codes on checkout', () => {
    expect(sessionParams.allow_promotion_codes).toBe(true);
  });

  it('creates a subscription-mode session with correct line items', () => {
    expect(sessionParams.mode).toBe('subscription');
    expect(sessionParams.line_items).toEqual([
      { price: 'price_test_fake', quantity: 3 },
    ]);
  });
});
