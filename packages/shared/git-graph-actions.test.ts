import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { assertSafeRef, GitGraphActionError, runGitGraphAction } from "./git-graph-actions";
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

function initRepo(): string {
  const repoDir = makeTempDir("plannotator-git-graph-actions-");
  git(repoDir, ["init"]);
  git(repoDir, ["branch", "-M", "main"]);
  git(repoDir, ["config", "user.email", "graph@example.com"]);
  git(repoDir, ["config", "user.name", "Graph User"]);
  git(repoDir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repoDir, "tracked.txt"), "a\n", "utf-8");
  git(repoDir, ["add", "tracked.txt"]);
  git(repoDir, ["commit", "-m", "initial"]);
  return repoDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runGitGraphAction", () => {
  test("rejects dash-prefixed refs so they cannot become git flags", () => {
    expect(() => assertSafeRef("-evil", "checkout target")).toThrow(GitGraphActionError);
  });

  test("createBranch then checkout moves HEAD onto the new branch", async () => {
    const repoDir = initRepo();
    const sha = git(repoDir, ["rev-parse", "HEAD"]);
    const runtime = makeRuntime(repoDir);
    await runGitGraphAction(runtime, "createBranch", { name: "topic", commitHash: sha, checkout: true }, repoDir);
    expect(git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("topic");
  });

  test("addTag writes a lightweight-or-annotated tag on the given commit", async () => {
    const repoDir = initRepo();
    const sha = git(repoDir, ["rev-parse", "HEAD"]);
    await runGitGraphAction(makeRuntime(repoDir), "addTag", { name: "v-test", hash: sha, annotated: true, message: "hi" }, repoDir);
    expect(git(repoDir, ["rev-parse", "v-test^{}"])).toBe(sha);
  });

  test("unknown action fails closed", async () => {
    const repoDir = initRepo();
    await expect(runGitGraphAction(makeRuntime(repoDir), "not-an-action", {}, repoDir)).rejects.toThrow(
      /unknown action/,
    );
  });

  test("dropCommit removes a tip of the current branch", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "tracked.txt"), "b\n", "utf-8");
    git(repoDir, ["add", "tracked.txt"]);
    git(repoDir, ["commit", "-m", "second"]);
    const tip = git(repoDir, ["rev-parse", "HEAD"]);
    const parent = git(repoDir, ["rev-parse", "HEAD^"]);
    await runGitGraphAction(makeRuntime(repoDir), "dropCommit", { hash: tip }, repoDir);
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(parent);
  });

  test("dropCommit refuses a commit that is only on another branch", async () => {
    const repoDir = initRepo();
    const root = git(repoDir, ["rev-parse", "HEAD"]);
    git(repoDir, ["checkout", "-b", "feature"]);
    writeFileSync(join(repoDir, "feature.txt"), "f\n", "utf-8");
    git(repoDir, ["add", "feature.txt"]);
    git(repoDir, ["commit", "-m", "feature work"]);
    const featureTip = git(repoDir, ["rev-parse", "HEAD"]);
    git(repoDir, ["checkout", "main"]);
    writeFileSync(join(repoDir, "tracked.txt"), "main\n", "utf-8");
    git(repoDir, ["add", "tracked.txt"]);
    git(repoDir, ["commit", "-m", "main continuation"]);
    const mainTip = git(repoDir, ["rev-parse", "HEAD"]);

    await expect(
      runGitGraphAction(makeRuntime(repoDir), "dropCommit", { hash: featureTip }, repoDir),
    ).rejects.toThrow(/not on the current branch/);
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(mainTip);
    expect(git(repoDir, ["rev-parse", "feature"])).toBe(featureTip);
    expect(git(repoDir, ["merge-base", root, "HEAD"])).toBe(root);
  });
});
