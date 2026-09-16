/**
 * ESLint rule: require-org-scope
 *
 * Every row of a tenant-owned Prisma model carries `organizationId`. A query
 * on one of those models whose `where` does not mention the organization is
 * addressing rows by a global id — which is exactly how pentest finding 3.1
 * (a run SQID from another organization being honoured) came about.
 *
 *   BAD:  prisma.runs.findUnique({ where: { id: runId } })
 *   GOOD: prisma.runs.findUnique({ where: { id: runId, organizationId } })
 *   GOOD: prisma.runLogs.findMany({ where: { run: { organizationId } } })   // via relation
 *   GOOD: prisma.apiKey.findMany({ where: liveApiKeyWhere(organizationId) }) // opaque, not analysed
 *   GOOD: prisma.apiKey.findMany({ where: { ...liveApiKeyWhere(orgId), name } })
 *
 * The rule looks for, inside the `where` object literal:
 *   - an `organizationId` key (or a compound-unique key such as
 *     `organizationId_projectId_name`),
 *   - a nested object literal — at any depth, including inside `AND`/`OR`
 *     arrays — that contains one (`run: { organizationId }`,
 *     `project: { organizationId }`),
 *   - a spread of a helper whose name contains `Where` or `Scope`
 *     (`...liveApiKeyWhere(orgId)`), taken on trust.
 *
 * A `where` that is not an object literal (a variable, a call) cannot be
 * analysed and is not reported. A call with no `where` at all on a read
 * (findMany/count/aggregate) IS reported: that reads the whole table.
 *
 * When the row was already ownership-checked earlier in the same function
 * (typically `findUnique({ where: { id } })` right after `resolveRunId`),
 * say which guard covers it:
 *   // eslint-disable-next-line @mlop/require-org-scope -- id came from resolveRunId
 */

/** Prisma client accessors for the models in schema.prisma that carry `organizationId`. */
const TENANT_MODELS = new Set([
  'apiKey',
  'chartsLayout',
  'dashboardView',
  'feedback',
  'integration',
  'invitation',
  'member',
  'notification',
  'organizationSubscription',
  'projectColumnKey',
  'projects',
  'runFieldValue',
  'runTableView',
  'runs',
]);

const OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Receivers we recognise as a Prisma client: `prisma`, `ctx.prisma`, `tx`, `db`. */
const CLIENT_IDENTIFIERS = new Set(['prisma', 'tx', 'db']);

const SCOPE_HELPER = /where|scope/i;

function keyName(property) {
  if (!property.key) {
    return null;
  }
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

function isClientReceiver(node) {
  if (node.type === 'Identifier') {
    return CLIENT_IDENTIFIERS.has(node.name);
  }
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
    return node.property.name === 'prisma';
  }
  return false;
}

/** `prisma.<model>.<op>(...)` → { model, op } or null. */
function prismaCall(callee) {
  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') {
    return null;
  }
  const op = callee.property.name;
  if (!OPERATIONS.has(op)) {
    return null;
  }
  const modelAccess = callee.object;
  if (modelAccess.type !== 'MemberExpression' || modelAccess.property.type !== 'Identifier') {
    return null;
  }
  const model = modelAccess.property.name;
  if (!TENANT_MODELS.has(model) || !isClientReceiver(modelAccess.object)) {
    return null;
  }
  return { model, op };
}

function spreadIsScopeHelper(spread) {
  const argument = spread.argument;
  if (argument.type === 'CallExpression') {
    const callee = argument.callee;
    const name =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
          ? callee.property.name
          : '';
    return SCOPE_HELPER.test(name);
  }
  if (argument.type === 'Identifier') {
    return SCOPE_HELPER.test(argument.name);
  }
  return false;
}

/** Does this object literal (recursively) carry an organization scope? */
function objectIsScoped(objectNode, depth = 0) {
  if (depth > 6) {
    return false;
  }
  for (const property of objectNode.properties) {
    if (property.type === 'SpreadElement') {
      if (spreadIsScopeHelper(property)) {
        return true;
      }
      if (property.argument.type === 'ObjectExpression' && objectIsScoped(property.argument, depth + 1)) {
        return true;
      }
      continue;
    }
    if (property.type !== 'Property') {
      continue;
    }
    const name = keyName(property);
    if (name && (name === 'organizationId' || name.startsWith('organizationId_'))) {
      return true;
    }
    if (valueIsScoped(property.value, depth + 1)) {
      return true;
    }
  }
  return false;
}

function valueIsScoped(valueNode, depth) {
  if (valueNode.type === 'ObjectExpression') {
    return objectIsScoped(valueNode, depth);
  }
  if (valueNode.type === 'ArrayExpression') {
    return valueNode.elements.some((element) => element && valueIsScoped(element, depth + 1));
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require Prisma queries on tenant-owned models to scope their `where` to an organization',
      category: 'Security',
      recommended: true,
    },
    messages: {
      unscopedWhere:
        'Prisma `{{model}}.{{op}}` addresses a tenant-owned row without an organization scope: its `where` has no ' +
        '`organizationId` (directly, through a nested relation such as `run: { organizationId }`, or via a spread ' +
        '`...xxxWhere(...)`). Scope it to the caller\'s organization, or if ownership was already verified in this ' +
        'function, add `// eslint-disable-next-line @mlop/require-org-scope -- <which guard>`.',
      missingWhere:
        'Prisma `{{model}}.{{op}}` has no `where` at all and reads every organization\'s rows. Add ' +
        '`where: { organizationId }`, or an eslint-disable comment naming the reason.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const call = prismaCall(node.callee);
        if (!call) {
          return;
        }
        const [argument] = node.arguments;
        if (!argument || argument.type !== 'ObjectExpression') {
          // `findMany()` with no arguments reads the whole table; an opaque
          // argument (a variable) cannot be analysed.
          if (!argument) {
            context.report({ node, messageId: 'missingWhere', data: call });
          }
          return;
        }
        const where = argument.properties.find(
          (property) => property.type === 'Property' && keyName(property) === 'where',
        );
        if (!where) {
          context.report({ node, messageId: 'missingWhere', data: call });
          return;
        }
        if (where.value.type !== 'ObjectExpression') {
          return; // opaque `where: someVariable` — not analysed
        }
        if (!objectIsScoped(where.value)) {
          context.report({ node: where, messageId: 'unscopedWhere', data: call });
        }
      },
    };
  },
};

export default rule;
