/**
 * Unit tests for subscription plan limits.
 *
 * Each organization has a subscription plan (FREE or PRO) that determines
 * their data usage and training hour limits. These limits are enforced
 * when ingesting data and tracked in the usage dashboard.
 */

import { describe, it, expect } from 'vitest';
import { getLimits, limitsSchema } from '../lib/limits';

describe('getLimits', () => {
  it('FREE plan has 2 GB data limit', () => {
    const limits = getLimits('FREE');
    expect(limits.dataUsageGB).toBe(2);
  });

  it('FREE plan has 50 training hours per month', () => {
    const limits = getLimits('FREE');
    expect(limits.trainingHoursPerMonth).toBe(50);
  });

  it('PRO plan has 10 TB (10000 GB) data limit', () => {
    const limits = getLimits('PRO');
    expect(limits.dataUsageGB).toBe(10000);
  });

  it('PRO plan has effectively unlimited training hours', () => {
    const limits = getLimits('PRO');
    expect(limits.trainingHoursPerMonth).toBe(999999);
  });

  it('PRO limits are strictly greater than FREE limits', () => {
    const free = getLimits('FREE');
    const pro = getLimits('PRO');
    expect(pro.dataUsageGB).toBeGreaterThan(free.dataUsageGB);
    expect(pro.trainingHoursPerMonth).toBeGreaterThan(free.trainingHoursPerMonth);
  });
});

describe('limitsSchema', () => {
  it('validates correct limits object', () => {
    const result = limitsSchema.safeParse({ dataUsageGB: 10, trainingHoursPerMonth: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects negative dataUsageGB', () => {
    const result = limitsSchema.safeParse({ dataUsageGB: -1, trainingHoursPerMonth: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects negative trainingHoursPerMonth', () => {
    const result = limitsSchema.safeParse({ dataUsageGB: 10, trainingHoursPerMonth: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts zero values', () => {
    const result = limitsSchema.safeParse({ dataUsageGB: 0, trainingHoursPerMonth: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(limitsSchema.safeParse({}).success).toBe(false);
    expect(limitsSchema.safeParse({ dataUsageGB: 10 }).success).toBe(false);
    expect(limitsSchema.safeParse({ trainingHoursPerMonth: 10 }).success).toBe(false);
  });
});
