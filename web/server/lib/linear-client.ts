const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function linearRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as LinearGraphQLResponse<T>;

  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }

  if (!json.data) {
    throw new Error("No data returned from Linear API");
  }

  return json.data;
}

export interface LinearViewer {
  id: string;
  name: string;
  email: string;
  organization: {
    id: string;
    name: string;
    urlKey: string;
  };
}

export async function validateApiKey(token: string): Promise<LinearViewer> {
  const data = await linearRequest<{ viewer: LinearViewer }>(
    token,
    `query { viewer { id name email organization { id name urlKey } } }`
  );
  return data.viewer;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: { name: string; color: string };
  team: { key: string };
}

export async function searchIssues(token: string, query: string, limit = 20): Promise<LinearIssue[]> {
  const data = await linearRequest<{ searchIssues: { nodes: LinearIssue[] } }>(
    token,
    `query SearchIssues($term: String!, $limit: Int!) {
      searchIssues(term: $term, first: $limit) {
        nodes {
          id
          identifier
          title
          state { name color }
          team { key }
        }
      }
    }`,
    { term: query, limit }
  );
  return data.searchIssues.nodes;
}

export interface LinearComment {
  id: string;
}

export async function createComment(token: string, issueId: string, body: string): Promise<LinearComment> {
  const data = await linearRequest<{ commentCreate: { comment: LinearComment } }>(
    token,
    `mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        comment { id }
      }
    }`,
    { issueId, body }
  );
  return data.commentCreate.comment;
}

export async function updateComment(token: string, commentId: string, body: string): Promise<LinearComment> {
  const data = await linearRequest<{ commentUpdate: { comment: LinearComment } }>(
    token,
    `mutation UpdateComment($commentId: String!, $body: String!) {
      commentUpdate(id: $commentId, input: { body: $body }) {
        comment { id }
      }
    }`,
    { commentId, body }
  );
  return data.commentUpdate.comment;
}

/**
 * Resolves an issue identifier (e.g., "TRA-1") to a Linear issue ID.
 */
export async function getIssueByIdentifier(token: string, identifier: string): Promise<{ id: string; identifier: string } | null> {
  // Use search with exact identifier match
  const data = await linearRequest<{ searchIssues: { nodes: Array<{ id: string; identifier: string }> } }>(
    token,
    `query GetIssue($identifier: String!) {
      searchIssues(term: $identifier, first: 1) {
        nodes { id identifier }
      }
    }`,
    { identifier }
  );
  const node = data.searchIssues.nodes.find((n) => n.identifier === identifier);
  return node ?? null;
}
