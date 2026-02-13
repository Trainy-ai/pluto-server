/**
 * Education Email Tests
 *
 * Tests for .edu email detection and related subscription logic.
 * Run with: npx vitest run tests/edu.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { isEduEmail } from '../lib/edu';

// Mock env module to avoid requiring actual environment variables
vi.mock('../lib/env', () => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_fake_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
    STRIPE_PRO_PRICE_ID: 'price_test_fake',
  },
}));

import {
  isActiveStripeSubscription,
  EDU_SUBSCRIPTION_ID,
  CANCELLED_SUBSCRIPTION_ID,
} from '../lib/stripe';

describe('Education Email Detection', () => {
  describe('isEduEmail', () => {
    it('returns true for standard .edu emails', () => {
      expect(isEduEmail('student@stanford.edu')).toBe(true);
      expect(isEduEmail('professor@mit.edu')).toBe(true);
      expect(isEduEmail('admin@berkeley.edu')).toBe(true);
    });

    it('returns true for subdomain .edu emails', () => {
      expect(isEduEmail('user@cs.stanford.edu')).toBe(true);
      expect(isEduEmail('user@dept.school.edu')).toBe(true);
    });

    it('returns true regardless of email casing', () => {
      expect(isEduEmail('User@Stanford.EDU')).toBe(true);
      expect(isEduEmail('USER@MIT.Edu')).toBe(true);
    });

    it('returns true with leading/trailing whitespace', () => {
      expect(isEduEmail(' student@stanford.edu ')).toBe(true);
    });

    it('returns false for non-.edu emails', () => {
      expect(isEduEmail('user@gmail.com')).toBe(false);
      expect(isEduEmail('user@company.org')).toBe(false);
      expect(isEduEmail('user@example.net')).toBe(false);
    });

    it('returns false for .edu.XX country-code subdomains', () => {
      expect(isEduEmail('user@university.edu.au')).toBe(false);
      expect(isEduEmail('user@school.edu.cn')).toBe(false);
      expect(isEduEmail('user@uni.edu.br')).toBe(false);
    });

    it('returns false for domains containing "edu" but not as TLD', () => {
      expect(isEduEmail('user@education.com')).toBe(false);
      expect(isEduEmail('user@edu-platform.io')).toBe(false);
    });

    it('returns false for invalid emails', () => {
      expect(isEduEmail('')).toBe(false);
      expect(isEduEmail('notanemail')).toBe(false);
      expect(isEduEmail('@stanford.edu')).toBe(false);
    });
  });
});

describe('Active Stripe Subscription Detection', () => {
  describe('isActiveStripeSubscription', () => {
    it('returns true for real Stripe subscription IDs', () => {
      expect(isActiveStripeSubscription('sub_1234567890')).toBe(true);
      expect(isActiveStripeSubscription('sub_abc123')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(isActiveStripeSubscription('')).toBe(false);
    });

    it('returns false for cancelled sentinel', () => {
      expect(isActiveStripeSubscription(CANCELLED_SUBSCRIPTION_ID)).toBe(false);
    });

    it('returns false for edu sentinel', () => {
      expect(isActiveStripeSubscription(EDU_SUBSCRIPTION_ID)).toBe(false);
    });
  });
});

