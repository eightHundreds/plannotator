/**
 * Commit-graph endpoints on the review server (Bun + Pi).
 *
 * Guards: local git sessions serve a layouted DAG; write actions run; the
 * same gate that hides the Commits panel rejects the routes otherwise.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer as startBunReviewServer } from "./review";
import { startReviewServer as startPiReviewServer } from "../../apps/pi-extension/server";
import { getVcsContext } from "./vcs";
import { UNCOMMITTED_HASH } from "@plannotator/shared/git-graph-history";

const originalDataDir = process.env.PLANNOTATOR_DATA_DIR;
const originalPort = process.env.PLANNOTATOR_PORT;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function initMergeRepo(): string {
  const repoDir = makeTempDir("plannotator-git-graph-ep-");
  git(repoDir, ["init", "-q"]);
  git(repoDir, ["branch", "-M", "main"]);
  git(repoDir, ["config", "user.email", "test@example.com"]);
  git(repoDir, ["config", "user.name", "Test"]);
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, ["add", "README.md"]);
  git(repoDir, ["commit", "-q", "-m", "initial"]);
  git(repoDir, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(join(repoDir, "feat.txt"), "f\n");
  git(repoDir, ["add", "feat.txt"]);
  git(repoDir, ["commit", "-q", "-m", "feature work"]);
  git(repoDir, ["checkout", "-q", "main"]);
  writeFileSync(join(repoDir, "main.txt"), "m\n");
  git(repoDir, ["add", "main.txt"]);
  git(repoDir, ["commit", "-q", "-m", "main work"]);
  git(repoDir, ["merge", "-q", "--no-ff", "feature", "-m", "merge feature"]);
  writeFileSync(join(repoDir, "dirty.txt"), "x\n");
  return repoDir;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PLANNOTATOR_DATA_DIR;
  else process.env.PLANNOTATOR_DATA_DIR = originalDataDir;
  if (originalPort === undefined) delete process.env.PLANNOTATOR_PORT;
  else process.env.PLANNOTATOR_PORT = originalPort;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("commit graph endpoints", () => {
  for (const [runtime, startServer] of [
    ["Bun", startBunReviewServer],
    ["Pi", startPiReviewServer],
  ] as const) {
    test(`${runtime} serves a layouted graph with refs and an uncommitted node`, async () => {
      process.env.PLANNOTATOR_DATA_DIR = makeTempDir("plannotator-git-graph-data-");
      process.env.PLANNOTATOR_PORT = String(await reservePort());
      const repoDir = initMergeRepo();
      const gitContext = await getVcsContext(repoDir, "git");
      const server = await startServer({
        rawPatch: "",
        gitRef: "Working tree",
        diffType: "uncommitted",
        gitContext,
        origin: runtime === "Pi" ? "pi" : "claude-code",
        htmlContent: "<!doctype html><html><body>review</body></html>",
      });
      try {
        const res = await fetch(`${server.url}/api/commits?limit=50`);
        expect(res.ok).toBe(true);
        const data = (await res.json()) as {
          commits: Array<{ sha: string; subject: string; heads: string[] }>;
          layout: { laneCount: number; vertices: unknown[] };
          branch: string;
        };
        expect(data.branch).toBe("main");
        expect(data.layout.laneCount).toBeGreaterThan(1);
        expect(data.layout.vertices.length).toBe(data.commits.length);
        expect(data.commits.some((c) => c.sha === UNCOMMITTED_HASH)).toBe(true);
        expect(data.commits.some((c) => c.heads?.includes("main"))).toBe(true);
        expect(data.commits.some((c) => c.heads?.includes("feature"))).toBe(true);

        const head = data.commits.find((c) => c.heads?.includes("main"));
        const create = await fetch(`${server.url}/api/git-graph/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "createBranch",
            params: { name: "from-graph", commitHash: head!.sha },
          }),
        });
        expect(create.ok).toBe(true);
        expect(git(repoDir, ["rev-parse", "--abbrev-ref", "from-graph"])).toBe("from-graph");
      } finally {
        server.stop();
      }
    });

    test(`${runtime} rejects graph routes without a local git session`, async () => {
      process.env.PLANNOTATOR_DATA_DIR = makeTempDir("plannotator-git-graph-data-");
      process.env.PLANNOTATOR_PORT = String(await reservePort());
      const server = await startServer({
        rawPatch: "diff --git a/a b/a\n",
        gitRef: "Piped diff",
        diffType: "uncommitted",
        origin: runtime === "Pi" ? "pi" : "claude-code",
        htmlContent: "<!doctype html><html><body>review</body></html>",
      });
      try {
        const res = await fetch(`${server.url}/api/commits`);
        expect(res.status).toBe(400);
        const action = await fetch(`${server.url}/api/git-graph/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "fetch", params: {} }),
        });
        expect(action.status).toBe(400);
      } finally {
        server.stop();
      }
    });
  }
});
