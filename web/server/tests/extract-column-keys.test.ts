/**
 * Unit tests for extract-column-keys.ts
 *
 * Tests the extractAndUpsertColumnKeys function which populates both
 * project_column_keys and run_field_values tables from config/systemMetadata JSON.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractAndUpsertColumnKeys } from '../lib/extract-column-keys';

// Mock Prisma client
function createMockPrisma() {
  const prisma = {
    projectColumnKey: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    runFieldValue: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation((args: unknown[]) => Promise.all(args)),
  };
  return prisma;
}

describe('extractAndUpsertColumnKeys', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  it('should insert config keys into project_column_keys', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { batch_size: 32, lr: 0.001, model: 'transformer' },
      null,
    );

    expect(mockPrisma.projectColumnKey.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: BigInt(1),
          source: 'config',
          key: 'batch_size',
          dataType: 'number',
        }),
        expect.objectContaining({
          source: 'config',
          key: 'lr',
          dataType: 'number',
        }),
        expect.objectContaining({
          source: 'config',
          key: 'model',
          dataType: 'text',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('should insert systemMetadata keys into project_column_keys', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      null,
      { hostname: 'gpu-node-1', python_version: '3.11', gpu_count: 8 },
    );

    expect(mockPrisma.projectColumnKey.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          source: 'systemMetadata',
          key: 'hostname',
          dataType: 'text',
        }),
        expect.objectContaining({
          source: 'systemMetadata',
          key: 'gpu_count',
          dataType: 'number',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('should flatten nested config keys with dot notation', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { optimizer: { type: 'adam', lr: 0.001, betas: [0.9, 0.999] } },
      null,
    );

    const callArgs = mockPrisma.projectColumnKey.createMany.mock.calls[0][0];
    const keys = callArgs.data.map((r: any) => r.key);
    expect(keys).toContain('optimizer.type');
    expect(keys).toContain('optimizer.lr');
    // Arrays are leaf values, so betas should be a single key
    expect(keys).toContain('optimizer.betas');
  });

  it('should skip imported key prefixes (sys/, source_code/)', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { 'sys/hostname': 'test', 'source_code/git_hash': 'abc123', batch_size: 32 },
      null,
    );

    const callArgs = mockPrisma.projectColumnKey.createMany.mock.calls[0][0];
    const keys = callArgs.data.map((r: any) => r.key);
    expect(keys).not.toContain('sys/hostname');
    expect(keys).not.toContain('source_code/git_hash');
    expect(keys).toContain('batch_size');
  });

  it('should infer date type for ISO 8601 strings', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { created: '2026-01-15T10:30:00Z', name: 'test' },
      null,
    );

    const callArgs = mockPrisma.projectColumnKey.createMany.mock.calls[0][0];
    const dateRecord = callArgs.data.find((r: any) => r.key === 'created');
    expect(dateRecord.dataType).toBe('date');

    const textRecord = callArgs.data.find((r: any) => r.key === 'name');
    expect(textRecord.dataType).toBe('text');
  });

  it('should populate run_field_values when runId is provided', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { batch_size: 32, model: 'gpt-4' },
      null,
      BigInt(100),
    );

    // Should delete existing values for this run first
    expect(mockPrisma.runFieldValue.deleteMany).toHaveBeenCalledWith({
      where: { runId: BigInt(100) },
    });

    // Should insert new values
    expect(mockPrisma.runFieldValue.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          runId: BigInt(100),
          organizationId: 'org-1',
          projectId: BigInt(1),
          source: 'config',
          key: 'batch_size',
          textValue: '32',
          numericValue: 32,
        }),
        expect.objectContaining({
          runId: BigInt(100),
          source: 'config',
          key: 'model',
          textValue: 'gpt-4',
          numericValue: null,
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('should NOT populate run_field_values when runId is omitted', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { batch_size: 32 },
      null,
      // no runId
    );

    expect(mockPrisma.runFieldValue.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.runFieldValue.createMany).not.toHaveBeenCalled();
  });

  it('should handle both config and systemMetadata together', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { batch_size: 32 },
      { hostname: 'gpu-1' },
      BigInt(100),
    );

    const keyCallArgs = mockPrisma.projectColumnKey.createMany.mock.calls[0][0];
    const keySources = keyCallArgs.data.map((r: any) => `${r.source}:${r.key}`);
    expect(keySources).toContain('config:batch_size');
    expect(keySources).toContain('systemMetadata:hostname');

    const valCallArgs = mockPrisma.runFieldValue.createMany.mock.calls[0][0];
    const valSources = valCallArgs.data.map((r: any) => `${r.source}:${r.key}`);
    expect(valSources).toContain('config:batch_size');
    expect(valSources).toContain('systemMetadata:hostname');
  });

  it('should do nothing when both config and systemMetadata are null', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      null,
      null,
    );

    expect(mockPrisma.projectColumnKey.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.runFieldValue.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.runFieldValue.createMany).not.toHaveBeenCalled();
  });

  it('should do nothing when both config and systemMetadata are empty objects', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      {},
      {},
    );

    expect(mockPrisma.projectColumnKey.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.runFieldValue.deleteMany).not.toHaveBeenCalled();
  });

  it('should store numericValue as number and textValue as string for numbers', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { lr: 0.001, epochs: 100, name: 'test' },
      null,
      BigInt(100),
    );

    const valCallArgs = mockPrisma.runFieldValue.createMany.mock.calls[0][0];

    const lrRecord = valCallArgs.data.find((r: any) => r.key === 'lr');
    expect(lrRecord.numericValue).toBe(0.001);
    expect(lrRecord.textValue).toBe('0.001');

    const epochsRecord = valCallArgs.data.find((r: any) => r.key === 'epochs');
    expect(epochsRecord.numericValue).toBe(100);
    expect(epochsRecord.textValue).toBe('100');

    const nameRecord = valCallArgs.data.find((r: any) => r.key === 'name');
    expect(nameRecord.numericValue).toBeNull();
    expect(nameRecord.textValue).toBe('test');
  });

  it('should handle null leaf values in config', async () => {
    await extractAndUpsertColumnKeys(
      mockPrisma as any,
      'org-1',
      BigInt(1),
      { batch_size: 32, optional_param: null },
      null,
      BigInt(100),
    );

    const valCallArgs = mockPrisma.runFieldValue.createMany.mock.calls[0][0];
    const nullRecord = valCallArgs.data.find((r: any) => r.key === 'optional_param');
    expect(nullRecord.textValue).toBeNull();
    expect(nullRecord.numericValue).toBeNull();
  });
});
