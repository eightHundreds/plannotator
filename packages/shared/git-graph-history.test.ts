import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { UNCOMMITTED_HASH } from "./git-graph-layout";
import { layoutHasParentEdge } from "./git-graph-layout";
import { listCommitGraph } from "./git-graph-history";
import type { ReviewGitRuntime } from "./review-core";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function makeRuntime(baseCwd: string): ReviewGitRuntime {
  return {
    async getFileInfo() {
      return null;
    },
    async readLink() {
      return null;
    },
    async runGit(args: string[], options?: { cwd?: string }) {
      const result = spawnSync("git", args, {
        cwd: options?.cwd ?? baseCwd,
        encoding: "utf-8",
      });
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.status ?? (result.error ? 1 : 0),
      };
    },
    async readTextFile(path: string) {
      try {
        const fullPath = path.startsWith("/") ? path : resolvePath(baseCwd, path);
        return readFileSync(fullPath, "utf-8");
      } catch {
        return null;
      }
    },
  };
}

function initFixture(): { repoDir: string; hashes: Record<string, string> } {
  const repoDir = makeTempDir("plannotator-git-graph-");
  git(repoDir, ["init"]);
  git(repoDir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(repoDir, ["config", "user.email", "graph@example.com"]);
  git(repoDir, ["config", "user.name", "Graph User"]);
  git(repoDir, ["config", "commit.gpgsign", "false"]);
  git(repoDir, ["config", "tag.gpgsign", "false"]);
  writeFileSync(join(repoDir, "README.md"), "hello world\n", "utf-8");
  git(repoDir, ["add", "README.md"]);
  git(repoDir, ["commit", "-m", "initial commit"]);
  const initial = git(repoDir, ["rev-parse", "HEAD"]);

  git(repoDir, ["checkout", "-b", "feature"]);
  writeFileSync(join(repoDir, "README.md"), "hello feature\n", "utf-8");
  writeFileSync(join(repoDir, "feature.txt"), "feature file\n", "utf-8");
  git(repoDir, ["add", "README.md", "feature.txt"]);
  git(repoDir, ["commit", "-m", "add feature work"]);
  const feature = git(repoDir, ["rev-parse", "HEAD"]);

  git(repoDir, ["checkout", "main"]);
  writeFileSync(join(repoDir, "main-only.txt"), "on main\n", "utf-8");
  git(repoDir, ["add", "main-only.txt"]);
  git(repoDir, ["commit", "-m", "main continuation"]);
  const mainTip = git(repoDir, ["rev-parse", "HEAD"]);

  git(repoDir, ["merge", "--no-ff", "feature", "-m", "merge feature into main"]);
  const merge = git(repoDir, ["rev-parse", "HEAD"]);
  git(repoDir, ["tag", "-a", "v1.0", "-m", "release 1.0"]);
  git(repoDir, ["remote", "add", "origin", "https://example.com/fixture.git"]);
  git(repoDir, ["update-ref", "refs/remotes/origin/main", merge]);
  writeFileSync(join(repoDir, "uncommitted.txt"), "dirty\n", "utf-8");

  return { repoDir, hashes: { initial, feature, mainTip, merge } };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("listCommitGraph", () => {
  test("loads a branch+merge DAG with refs, uncommitted node, and multi-lane layout", async () => {
    const { repoDir, hashes } = initFixture();
    const page = await listCommitGraph(makeRuntime(repoDir), "main", repoDir);

    expect(page).not.toBeNull();
    const bySha = Object.fromEntries(page!.commits.filter((c) => c.sha !== UNCOMMITTED_HASH).map((c) => [c.sha, c]));
    expect(bySha[hashes.merge].subject).toBe("merge feature into main");
    expect(bySha[hashes.feature].subject).toBe("add feature work");
    expect(bySha[hashes.merge].heads).toContain("main");
    expect(bySha[hashes.merge].tags.some((t) => t.name === "v1.0")).toBe(true);
    expect(bySha[hashes.feature].heads).toContain("feature");
    expect(bySha[hashes.merge].remotes.some((r) => r.name === "origin/main")).toBe(true);

    const uncommitted = page!.commits.find((c) => c.sha === UNCOMMITTED_HASH);
    expect(uncommitted).toBeDefined();
    expect(uncommitted!.parents).toEqual([hashes.merge]);
    expect(page!.head).toBe(hashes.merge);
    expect(page!.branch).toBe("main");
    expect(page!.layout.laneCount).toBeGreaterThan(1);

    const mergeId = page!.commits.findIndex((c) => c.sha === hashes.merge);
    const featureId = page!.commits.findIndex((c) => c.sha === hashes.feature);
    const mainTipId = page!.commits.findIndex((c) => c.sha === hashes.mainTip);
    expect(layoutHasParentEdge(page!.layout, mergeId, featureId)).toBe(true);
    expect(layoutHasParentEdge(page!.layout, mergeId, mainTipId)).toBe(true);
  });

  test("omits the uncommitted node when the working tree is clean", async () => {
    const { repoDir } = initFixture();
    const runtime = makeRuntime(repoDir);
    expect((await listCommitGraph(runtime, "main", repoDir))!.commits.some((c) => c.sha === UNCOMMITTED_HASH)).toBe(true);
    rmSync(join(repoDir, "uncommitted.txt"));
    expect((await listCommitGraph(runtime, "main", repoDir))!.commits.some((c) => c.sha === UNCOMMITTED_HASH)).toBe(false);
  });

  test("reports hasMore when the log is capped", async () => {
    const { repoDir } = initFixture();
    const page = await listCommitGraph(makeRuntime(repoDir), "main", repoDir, { limit: 2 });
    expect(page!.hasMore).toBe(true);
    expect(page!.commits.filter((c) => c.sha !== UNCOMMITTED_HASH).length).toBe(2);
  });

  test("a repo with no commits yet yields an empty page, not an error", async () => {
    const repoDir = makeTempDir("plannotator-git-graph-empty-");
    git(repoDir, ["init"]);
    const page = await listCommitGraph(makeRuntime(repoDir), "main", repoDir);
    expect(page!.commits).toEqual([]);
    expect(page!.hasMore).toBe(false);
  });
});
