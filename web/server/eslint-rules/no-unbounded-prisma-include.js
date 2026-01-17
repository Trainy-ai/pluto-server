/**
 * ESLint rule: no-unbounded-prisma-include
 *
 * Prevents loading unbounded relations in Prisma queries which can cause OOM
 * under high load. This catches patterns like:
 *
 *   BAD:  findUnique({ include: { logs: true } })      // Loads ALL related records
 *   BAD:  findUnique({ include: { members: true } })   // Loads ALL members
 *   GOOD: findUnique({ select: { id: true } })         // Only selects specific fields
 *   GOOD: findMany({ where: { id: { in: [...] } } })   // Bounded query
 *
 * To explicitly allow an unbounded include (when you're sure it's safe),
 * add an eslint-disable comment:
 *   // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- pagination handled at API layer
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow unbounded include in Prisma queries to prevent OOM',
      category: 'Performance',
      recommended: true,
    },
    messages: {
      unboundedInclude:
        'Unbounded Prisma include detected: `include: { {{relation}}: true }` loads ALL related records into memory. ' +
        'This can cause OOM under high load. Use `select` with specific fields, or query the relation separately with a `where` clause. ' +
        'If this is intentional (e.g., small bounded relation), add an eslint-disable comment with justification.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Relations that are always safe to include (e.g., 1:1 relations)
          allowedRelations: {
            type: 'array',
            items: { type: 'string' },
            default: [],
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedRelations = new Set(options.allowedRelations || []);

    return {
      // Match: { include: { someRelation: true } }
      Property(node) {
        // Check if this is an 'include' property
        if (
          node.key &&
          node.key.type === 'Identifier' &&
          node.key.name === 'include' &&
          node.value &&
          node.value.type === 'ObjectExpression'
        ) {
          // Check each property inside the include object
          for (const prop of node.value.properties) {
            if (
              prop.type === 'Property' &&
              prop.key &&
              prop.key.type === 'Identifier' &&
              prop.value &&
              prop.value.type === 'Literal' &&
              prop.value.value === true
            ) {
              const relationName = prop.key.name;

              // Skip if this relation is explicitly allowed
              if (allowedRelations.has(relationName)) {
                continue;
              }

              context.report({
                node: prop,
                messageId: 'unboundedInclude',
                data: {
                  relation: relationName,
                },
              });
            }
          }
        }
      },
    };
  },
};

export default rule;
