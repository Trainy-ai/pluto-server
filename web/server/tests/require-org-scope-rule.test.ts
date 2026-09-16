/**
 * Unit tests for eslint-rules/require-org-scope.js.
 *
 * The rule is the compile-time half of tenant isolation: it must fire on an
 * unscoped query and stay quiet on every scoped form the codebase uses,
 * otherwise it either misses the next pentest finding or gets disabled.
 * (The `eslint-disable-next-line` escape hatch is ESLint's own; the 40
 * annotated sites in trpc/ and routes/ exercise it on every lint run.)
 */
import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';
import tseslint from 'typescript-eslint';

import rule from '../eslint-rules/require-org-scope.js';

(RuleTester as unknown as { afterAll: typeof afterAll }).afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run('@mlop/require-org-scope', rule as never, {
  valid: [
    { name: 'direct organizationId', code: 'prisma.runs.findUnique({ where: { id: runId, organizationId } })' },
    { name: 'explicit organizationId value', code: 'ctx.prisma.runs.findFirst({ where: { id, organizationId: input.organizationId } })' },
    { name: 'compound unique key', code: 'prisma.projects.findUnique({ where: { organizationId_name: { organizationId, name } } })' },
    { name: 'nested relation', code: 'prisma.runs.findMany({ where: { project: { name, organizationId } } })' },
    { name: 'nested inside AND array', code: 'prisma.runs.findMany({ where: { AND: [{ status: "RUNNING" }, { organizationId }] } })' },
    { name: 'spread of a *Where helper', code: 'prisma.apiKey.findMany({ where: { ...liveApiKeyWhere(orgId), name } })' },
    { name: 'spread of a *Scope identifier', code: 'tx.member.findMany({ where: { ...orgScope, role } })' },
    { name: 'opaque where is not analysed', code: 'prisma.runs.findMany({ where: whereClause })' },
    { name: 'model that is not tenant-owned', code: 'prisma.user.findUnique({ where: { id } })' },
    { name: 'operation outside the list', code: 'prisma.runs.create({ data: { organizationId } })' },
    { name: 'receiver that is not a prisma client', code: 'cache.runs.findMany({ where: { id } })' },
    { name: 'transaction client scoped', code: 'tx.runs.updateMany({ where: { id, organizationId }, data: {} })' },
    { name: 'upsert on a compound key that carries organizationId', code: 'ctx.prisma.chartsLayout.upsert({ where: { organizationId_projectId_userId: { organizationId, projectId, userId } }, create: {}, update: {} })' },
    { name: 'findUniqueOrThrow scoped', code: 'prisma.runs.findUniqueOrThrow({ where: { id: runId, organizationId } })' },
  ],
  invalid: [
    {
      name: 'id only',
      code: 'prisma.runs.findUnique({ where: { id: runId } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'ctx.prisma receiver',
      code: 'ctx.prisma.dashboardView.delete({ where: { id: existingView.id } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'transaction client',
      code: 'tx.member.update({ where: { id: memberId }, data: { role } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'nested object without organizationId',
      code: 'prisma.runFieldValue.findMany({ where: { runId: { in: ids }, run: { status: "RUNNING" } } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'spread of an unrelated helper',
      code: 'prisma.runs.findMany({ where: { ...pagination(), id } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'upsert keyed by id only',
      code: 'ctx.prisma.chartsLayout.upsert({ where: { id }, create: {}, update: {} })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'findUniqueOrThrow by id only',
      code: 'prisma.runs.findUniqueOrThrow({ where: { id: runId } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'findFirstOrThrow by id only',
      code: 'tx.dashboardView.findFirstOrThrow({ where: { id: viewId } })',
      errors: [{ messageId: 'unscopedWhere' }],
    },
    {
      name: 'no where at all on a read',
      code: 'prisma.invitation.findMany({ select: { id: true } })',
      errors: [{ messageId: 'missingWhere' }],
    },
    {
      name: 'no arguments',
      code: 'prisma.projects.count()',
      errors: [{ messageId: 'missingWhere' }],
    },
  ],
});
