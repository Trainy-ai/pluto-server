import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GitStatus } from "../git-status";

// jsdom has no pointer events / portals, so render the tooltip parts inline.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}));

const SHA = "513f4c220ea700c39652c50ed5ac8763452f1d38";

// Shape recorded by the Pluto SDK (pluto/sys.py get_git): `diff` holds
// `git diff` output, not commit hashes.
function systemMetadata(url: string, commit = SHA) {
  return {
    git: {
      root: "/home/runner/work/server-private",
      dirty: false,
      branch: "main",
      commit,
      url,
      diff: { remote: "" },
    },
  };
}

function commitLink(): HTMLAnchorElement | null {
  return screen.getByText(SHA).closest("a");
}

describe("GitStatus commit link", () => {
  afterEach(cleanup);

  it.each([
    [
      "https://github.com/Trainy-ai/server-private",
      `https://github.com/Trainy-ai/server-private/commit/${SHA}`,
    ],
    [
      "https://github.com/Trainy-ai/server-private.git",
      `https://github.com/Trainy-ai/server-private/commit/${SHA}`,
    ],
    [
      "git@github.com:Trainy-ai/server-private.git",
      `https://github.com/Trainy-ai/server-private/commit/${SHA}`,
    ],
    [
      "https://gitlab.com/group/repo.git",
      `https://gitlab.com/group/repo/-/commit/${SHA}`,
    ],
    [
      "https://bitbucket.org/ws/repo.git",
      `https://bitbucket.org/ws/repo/commits/${SHA}`,
    ],
    [
      "https://dev.azure.com/org/proj/_git/repo",
      `https://dev.azure.com/org/proj/_git/repo/commit/${SHA}`,
    ],
    [
      "https://org.visualstudio.com/proj/_git/repo",
      `https://org.visualstudio.com/proj/_git/repo/commit/${SHA}`,
    ],
    // SSH remotes link to the web host, not the transport URL
    [
      "ssh://git@github.com/Trainy-ai/server-private.git",
      `https://github.com/Trainy-ai/server-private/commit/${SHA}`,
    ],
    [
      "ssh://git@github.com:22/Trainy-ai/server-private.git",
      `https://github.com/Trainy-ai/server-private/commit/${SHA}`,
    ],
    [
      "git@ssh.dev.azure.com:v3/org/proj/repo",
      `https://dev.azure.com/org/proj/_git/repo/commit/${SHA}`,
    ],
    [
      "ssh://git@ssh.dev.azure.com/v3/org/proj/repo",
      `https://dev.azure.com/org/proj/_git/repo/commit/${SHA}`,
    ],
  ])("links the commit for %s", (url, expected) => {
    render(<GitStatus systemMetadata={systemMetadata(url)} />);
    const link = commitLink();
    expect(link?.getAttribute("href")).toBe(expected);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves the commit as plain text for an unknown host", () => {
    render(
      <GitStatus
        systemMetadata={systemMetadata(
          "https://git.internal.example/team/repo.git",
        )}
      />,
    );
    expect(commitLink()).toBeNull();
  });

  it("does not treat a lookalike host as Azure DevOps", () => {
    render(
      <GitStatus
        systemMetadata={systemMetadata(
          "https://dev.azure.com.attacker.example/org/proj/_git/repo",
        )}
      />,
    );
    expect(commitLink()).toBeNull();
  });

  it("links the branch to the web host for an ssh:// remote", () => {
    render(
      <GitStatus
        systemMetadata={systemMetadata(
          "ssh://git@github.com/Trainy-ai/server-private.git",
        )}
      />,
    );
    expect(screen.getByText("main").closest("a")?.getAttribute("href")).toBe(
      "https://github.com/Trainy-ai/server-private/tree/main",
    );
  });

  it("leaves the commit as plain text when it is not a hex hash", () => {
    render(
      <GitStatus
        systemMetadata={systemMetadata("https://github.com/o/r", "not-a-sha")}
      />,
    );
    expect(screen.getByText("not-a-sha").closest("a")).toBeNull();
  });

  it("still links the repository row to the repo itself", () => {
    render(
      <GitStatus
        systemMetadata={systemMetadata(
          "https://github.com/Trainy-ai/server-private.git",
        )}
      />,
    );
    const repoLink = screen.getByText("Trainy-ai/server-private").closest("a");
    expect(repoLink?.getAttribute("href")).toBe(
      "https://github.com/Trainy-ai/server-private",
    );
  });
});
