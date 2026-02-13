/**
 * Linear Client Tests
 *
 * Tests the Linear GraphQL client with mocked fetch.
 * Run with: cd web && pnpm --filter @mlop/server exec vitest run tests/linear-client.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateApiKey, searchIssues, createComment, updateComment, getIssueByIdentifier, getIssueComments } from "../lib/linear-client";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockGraphQLResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve({ data }),
  });
}

function mockGraphQLError(message: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ errors: [{ message }] }),
  });
}

describe("Linear Client", () => {
  describe("validateApiKey", () => {
    it("should return viewer info on valid key", async () => {
      mockGraphQLResponse({
        viewer: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          organization: { id: "org-1", name: "Test Org", urlKey: "test-org" },
        },
      });

      const result = await validateApiKey("lin_api_test");

      expect(result).toEqual({
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        organization: { id: "org-1", name: "Test Org", urlKey: "test-org" },
      });

      expect(mockFetch).toHaveBeenCalledWith("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lin_api_test",
        },
        body: expect.any(String),
      });
    });

    it("should throw on GraphQL error", async () => {
      mockGraphQLError("Authentication required");

      await expect(validateApiKey("invalid-key")).rejects.toThrow(
        "Linear GraphQL error: Authentication required"
      );
    });

    it("should throw on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(validateApiKey("invalid-key")).rejects.toThrow(
        "Linear API error: 401 Unauthorized"
      );
    });

    it("should throw when data is null", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ data: null }),
      });

      await expect(validateApiKey("tok")).rejects.toThrow(
        "No data returned from Linear API"
      );
    });
  });

  describe("searchIssues", () => {
    const issues = [
      {
        id: "issue-1",
        identifier: "TRA-1",
        title: "Fix login bug",
        state: { name: "In Progress", color: "#f2c94c" },
        team: { key: "TRA" },
      },
    ];

    it("should return issue list", async () => {
      mockGraphQLResponse({ searchIssues: { nodes: issues } });

      const result = await searchIssues("token", "login", 10);

      expect(result).toEqual(issues);
      expect(result[0].identifier).toBe("TRA-1");
    });

    it("should use searchIssues query with term parameter", async () => {
      mockGraphQLResponse({ searchIssues: { nodes: [] } });

      await searchIssues("token", "my query", 5);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain("searchIssues(term: $term");
      expect(body.variables).toEqual({ term: "my query", limit: 5 });
    });

    it("should default limit to 20", async () => {
      mockGraphQLResponse({ searchIssues: { nodes: [] } });

      await searchIssues("token", "query");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.limit).toBe(20);
    });

    it("should throw on 'deprecated' runtime error (regression)", async () => {
      // Linear's issueSearch returns this runtime error even though schema
      // introspection shows it as valid. This test catches regressions if
      // someone accidentally reverts to the old query.
      mockGraphQLError("deprecated");

      await expect(searchIssues("token", "test")).rejects.toThrow(
        "Linear GraphQL error: deprecated"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

      await expect(searchIssues("token", "test")).rejects.toThrow("fetch failed");
    });
  });

  describe("createComment", () => {
    it("should create a comment and return its ID", async () => {
      mockGraphQLResponse({
        commentCreate: { comment: { id: "comment-1" } },
      });

      const result = await createComment("token", "issue-1", "Hello from Pluto");

      expect(result).toEqual({ id: "comment-1" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.issueId).toBe("issue-1");
      expect(body.variables.body).toBe("Hello from Pluto");
    });

    it("should throw on GraphQL error", async () => {
      mockGraphQLError("Issue not found");

      await expect(createComment("token", "bad-id", "text")).rejects.toThrow(
        "Linear GraphQL error: Issue not found"
      );
    });
  });

  describe("updateComment", () => {
    it("should update a comment and return its ID", async () => {
      mockGraphQLResponse({
        commentUpdate: { comment: { id: "comment-1" } },
      });

      const result = await updateComment("token", "comment-1", "Updated text");

      expect(result).toEqual({ id: "comment-1" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.commentId).toBe("comment-1");
      expect(body.variables.body).toBe("Updated text");
    });
  });

  describe("getIssueComments", () => {
    it("should return IDs of comments containing '## Pluto Experiments'", async () => {
      mockGraphQLResponse({
        issue: {
          comments: {
            nodes: [
              { id: "c-1", body: "## Pluto Experiments\n| Run | Project |..." },
              { id: "c-2", body: "Some unrelated comment" },
              { id: "c-3", body: "## Pluto Experiments\n_No runs linked_" },
            ],
          },
        },
      });

      const result = await getIssueComments("token", "issue-1");

      expect(result).toEqual(["c-1", "c-3"]);
    });

    it("should return empty array when no Pluto comments exist", async () => {
      mockGraphQLResponse({
        issue: {
          comments: {
            nodes: [
              { id: "c-1", body: "A regular comment" },
            ],
          },
        },
      });

      const result = await getIssueComments("token", "issue-1");

      expect(result).toEqual([]);
    });

    it("should return empty array when issue has no comments", async () => {
      mockGraphQLResponse({
        issue: {
          comments: { nodes: [] },
        },
      });

      const result = await getIssueComments("token", "issue-1");

      expect(result).toEqual([]);
    });

    it("should send correct query with issueId variable", async () => {
      mockGraphQLResponse({
        issue: { comments: { nodes: [] } },
      });

      await getIssueComments("token", "issue-42");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain("issue(id: $issueId)");
      expect(body.variables).toEqual({ issueId: "issue-42" });
    });

    it("should throw on GraphQL error", async () => {
      mockGraphQLError("Issue not found");

      await expect(getIssueComments("token", "bad-id")).rejects.toThrow(
        "Linear GraphQL error: Issue not found"
      );
    });
  });

  describe("getIssueByIdentifier", () => {
    it("should return issue when found", async () => {
      mockGraphQLResponse({
        searchIssues: {
          nodes: [{ id: "issue-1", identifier: "TRA-1" }],
        },
      });

      const result = await getIssueByIdentifier("token", "TRA-1");

      expect(result).toEqual({ id: "issue-1", identifier: "TRA-1" });
    });

    it("should use searchIssues query with term parameter", async () => {
      mockGraphQLResponse({ searchIssues: { nodes: [] } });

      await getIssueByIdentifier("token", "TRA-1");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain("searchIssues(term: $identifier");
      expect(body.variables).toEqual({ identifier: "TRA-1" });
    });

    it("should return null when not found", async () => {
      mockGraphQLResponse({
        searchIssues: { nodes: [] },
      });

      const result = await getIssueByIdentifier("token", "TRA-999");

      expect(result).toBeNull();
    });

    it("should return null when identifier doesn't match exactly", async () => {
      mockGraphQLResponse({
        searchIssues: {
          nodes: [{ id: "issue-1", identifier: "TRA-10" }],
        },
      });

      const result = await getIssueByIdentifier("token", "TRA-1");

      expect(result).toBeNull();
    });

    it("should throw on 'deprecated' runtime error (regression)", async () => {
      mockGraphQLError("deprecated");

      await expect(getIssueByIdentifier("token", "TRA-1")).rejects.toThrow(
        "Linear GraphQL error: deprecated"
      );
    });
  });

  describe("request format", () => {
    it("should send correct headers with token", async () => {
      mockGraphQLResponse({ searchIssues: { nodes: [] } });

      await searchIssues("lin_api_mytoken", "test");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.linear.app/graphql");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers.Authorization).toBe("Bearer lin_api_mytoken");
    });
  });
});
