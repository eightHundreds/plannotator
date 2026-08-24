/**
 * Git write actions for the commit-graph context menus.
 *
 * Ported from gitlane's actions.ts, adapted to ReviewGitRuntime (exit-code
 * results instead of thrown subprocess errors). Callers must confirm
 * destructive actions in the UI before invoking them.
 */

import type { ReviewGitRuntime } from "./review-core";
import { UNCOMMITTED_HASH } from "./git-graph-layout";

export type GitGraphActionParams = Record<string, unknown>;

export class GitGraphActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitGraphActionError";
  }
}

export function assertSafeText(value: unknown, label: string): asserts value is string {
  if (!value || typeof value !== "string") throw new GitGraphActionError(`${label} is required`);
  if (/[\0\n\r]/.test(value)) throw new GitGraphActionError(`invalid ${label}`);
}

export function assertSafeRef(value: unknown, label: string): asserts value is string {
  assertSafeText(value, label);
  if (value.startsWith("-")) throw new GitGraphActionError(`invalid ${label}`);
}

const EDITOR_CONFIG = {
  "core.editor": "true",
  "sequence.editor": "true",
};

type Run = ReviewGitRuntime["runGit"];

async function git(
  run: Run,
  cwd: string | undefined,
  args: string[],
  opts?: { edit?: boolean; allowPrompt?: boolean; timeoutMs?: number },
): Promise<string> {
  const result = await run(args, {
    cwd,
    interaction: opts?.allowPrompt ? "allow" : "forbid",
    timeoutMs: opts?.timeoutMs,
    ...(opts?.edit ? { config: EDITOR_CONFIG } : {}),
  });
  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new GitGraphActionError(detail || `git ${args[0] ?? "command"} failed`);
  }
  return result.stdout;
}

export async function checkout(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  const target = params.target || params.hash || params.branch;
  assertSafeRef(target, "checkout target");
  await git(run, cwd, ["checkout", target]);
}

export async function createBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  const name = params.name;
  const commitHash = params.commitHash || params.hash;
  assertSafeRef(name, "branch name");
  assertSafeRef(commitHash, "commit hash");
  if (commitHash === UNCOMMITTED_HASH) throw new GitGraphActionError("commit hash is required");
  const checkoutAfter = Boolean(params.checkout);
  const force = Boolean(params.force);
  if (checkoutAfter && !force) {
    await git(run, cwd, ["checkout", "-b", name, commitHash]);
  } else {
    const args = ["branch"];
    if (force) args.push("-f");
    args.push(name, commitHash);
    await git(run, cwd, args);
    if (checkoutAfter) await git(run, cwd, ["checkout", name]);
  }
}

export async function deleteBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.name, "branch name");
  await git(run, cwd, ["branch", params.force ? "-D" : "-d", params.name]);
}

export async function renameBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.oldName, "old branch name");
  assertSafeRef(params.newName, "new branch name");
  await git(run, cwd, ["branch", "-m", params.oldName, params.newName]);
}

export async function mergeRef(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  const ref = params.ref || params.hash;
  assertSafeRef(ref, "merge ref");
  const dirtyBefore =
    (await git(run, cwd, ["status", "--untracked-files=all", "--porcelain"])).trim() !== "";
  const args = ["merge", "--no-edit"];
  if (params.noFastForward) args.push("--no-ff");
  if (params.squash) args.push("--squash");
  args.push(ref);
  await git(run, cwd, args, { edit: true });
  if (!params.squash) return;
  try {
    await git(run, cwd, ["commit", "--no-edit", "-m", `Squash merge ${ref}`], { edit: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/nothing to commit/i.test(message)) return;
    try {
      await git(run, cwd, ["reset", dirtyBefore ? "--mixed" : "--hard", "HEAD"]);
    } catch {
      /* Reset is best-effort; the commit error is what callers should see. */
    }
    throw err;
  }
}

export async function rebaseOnto(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  const ref = params.ref || params.hash;
  assertSafeRef(ref, "rebase ref");
  await git(run, cwd, ["rebase", ref], { edit: true });
}

export async function resetTo(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  const target = params.hash || params.commit || "HEAD";
  assertSafeRef(target, "reset target");
  const mode = params.mode || "mixed";
  const flag = mode === "soft" ? "--soft" : mode === "hard" ? "--hard" : "--mixed";
  await git(run, cwd, ["reset", flag, target]);
}

export async function cherryPick(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.hash, "commit hash");
  const args = ["cherry-pick"];
  if (params.recordOrigin) args.push("-x");
  if (params.noCommit) args.push("-n");
  if (params.parentIndex) args.push("-m", String(params.parentIndex));
  args.push(params.hash);
  await git(run, cwd, args, { edit: true });
}

export async function revertCommit(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.hash, "commit hash");
  const args = ["revert", "--no-edit"];
  if (params.parentIndex) args.push("-m", String(params.parentIndex));
  args.push(params.hash);
  await git(run, cwd, args, { edit: true });
}

export async function dropCommit(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.hash, "commit hash");
  // `rebase --onto hash^ hash` with an empty `hash..HEAD` still checks out
  // `hash^` and moves the current branch there. The graph is a full DAG, so
  // refuse anything that is not already on HEAD's history.
  const ancestor = await run(["merge-base", "--is-ancestor", params.hash, "HEAD"], {
    cwd,
    interaction: "forbid",
  });
  if (ancestor.exitCode !== 0) {
    throw new GitGraphActionError("cannot drop a commit that is not on the current branch");
  }
  const line = (await git(run, cwd, ["rev-list", "--parents", "-n", "1", params.hash])).trim();
  const parts = line.split(" ").filter(Boolean);
  if (parts.length > 2) throw new GitGraphActionError("cannot drop a merge commit");
  if (parts.length < 2) throw new GitGraphActionError("cannot drop a root commit");
  await git(run, cwd, ["rebase", "--onto", `${params.hash}^`, params.hash], { edit: true });
}

export async function addTag(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.name, "tag name");
  assertSafeRef(params.hash, "commit hash");
  const args = ["tag"];
  if (params.annotated !== false) {
    const message = typeof params.message === "string" ? params.message : "";
    args.push("-a", "-m", message || params.name);
  }
  args.push(params.name, params.hash);
  await git(run, cwd, args);
}

export async function deleteTag(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.name, "tag name");
  await git(run, cwd, ["tag", "-d", params.name]);
  if (params.remote) {
    assertSafeRef(params.remote, "remote");
    await git(run, cwd, ["push", params.remote, `:refs/tags/${params.name}`], {
      allowPrompt: true,
      timeoutMs: 60_000,
    });
  }
}

export async function pushTag(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.name, "tag name");
  assertSafeRef(params.remote, "remote");
  await git(run, cwd, ["push", params.remote, `refs/tags/${params.name}`], {
    allowPrompt: true,
    timeoutMs: 60_000,
  });
}

export async function pushBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.name, "branch name");
  assertSafeRef(params.remote, "remote");
  const args = ["push"];
  if (params.setUpstream) args.push("-u");
  if (params.forceWithLease) args.push("--force-with-lease");
  else if (params.force) args.push("--force");
  args.push(params.remote, params.name);
  await git(run, cwd, args, { allowPrompt: true, timeoutMs: 60_000 });
}

export async function fetchRemotes(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams = {},
): Promise<void> {
  const args = ["fetch"];
  if (params.prune) args.push("--prune");
  if (params.remote) {
    assertSafeRef(params.remote, "remote");
    args.push(params.remote);
  } else {
    args.push("--all");
  }
  await git(run, cwd, args, { allowPrompt: true, timeoutMs: 60_000 });
}

export async function pullBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.remote, "remote");
  assertSafeRef(params.branch, "branch name");
  const args = ["pull", "--no-edit"];
  if (params.noFastForward) args.push("--no-ff");
  if (params.squash) args.push("--squash");
  args.push(params.remote, params.branch);
  await git(run, cwd, args, { edit: true, allowPrompt: true, timeoutMs: 60_000 });
}

export async function deleteRemoteBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.remote, "remote");
  assertSafeRef(params.name, "branch name");
  await git(run, cwd, ["push", params.remote, "--delete", params.name], {
    allowPrompt: true,
    timeoutMs: 60_000,
  });
}

export async function fetchIntoLocal(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.remote, "remote");
  assertSafeRef(params.remoteBranch, "remote branch");
  assertSafeRef(params.localBranch, "local branch");
  const spec = `refs/heads/${params.remoteBranch}:refs/heads/${params.localBranch}`;
  const args = ["fetch"];
  if (params.force) args.push("--force");
  args.push(params.remote, spec);
  await git(run, cwd, args, { allowPrompt: true, timeoutMs: 60_000 });
}

export async function stashPush(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams = {},
): Promise<void> {
  const args = ["stash", "push"];
  if (params.includeUntracked) args.push("-u");
  if (params.message) {
    assertSafeText(params.message, "stash message");
    args.push("-m", params.message);
  }
  await git(run, cwd, args);
}

export async function stashApply(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams = {},
): Promise<void> {
  const selector = params.selector || "stash@{0}";
  assertSafeRef(selector, "stash selector");
  const args = ["stash", "apply"];
  if (params.reinstateIndex) args.push("--index");
  args.push(selector);
  await git(run, cwd, args);
}

export async function stashPop(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams = {},
): Promise<void> {
  const selector = params.selector || "stash@{0}";
  assertSafeRef(selector, "stash selector");
  const args = ["stash", "pop"];
  if (params.reinstateIndex) args.push("--index");
  args.push(selector);
  await git(run, cwd, args);
}

export async function stashDrop(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams = {},
): Promise<void> {
  const selector = params.selector || "stash@{0}";
  assertSafeRef(selector, "stash selector");
  await git(run, cwd, ["stash", "drop", selector]);
}

export async function stashBranch(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams,
): Promise<void> {
  assertSafeRef(params.name, "branch name");
  const selector = params.selector || "stash@{0}";
  assertSafeRef(selector, "stash selector");
  await git(run, cwd, ["stash", "branch", params.name, selector]);
}

export async function cleanUntracked(
  run: Run,
  cwd: string | undefined,
  params: GitGraphActionParams = {},
): Promise<void> {
  const args = ["clean", "-f"];
  if (params.directories !== false) args.push("-d");
  await git(run, cwd, args);
}

const ACTION_MAP: Record<
  string,
  (run: Run, cwd: string | undefined, params: GitGraphActionParams) => Promise<void>
> = {
  checkout,
  createBranch,
  deleteBranch,
  renameBranch,
  merge: mergeRef,
  rebase: rebaseOnto,
  reset: resetTo,
  cherryPick,
  revert: revertCommit,
  dropCommit,
  addTag,
  deleteTag,
  pushTag,
  pushBranch,
  fetch: fetchRemotes,
  pull: pullBranch,
  deleteRemoteBranch,
  fetchIntoLocal,
  stash: stashPush,
  stashApply,
  stashPop,
  stashDrop,
  stashBranch,
  clean: cleanUntracked,
  resetUncommitted: (run, cwd, params) => resetTo(run, cwd, { hash: "HEAD", mode: params.mode || "mixed" }),
};

export const GIT_GRAPH_ACTION_NAMES = Object.keys(ACTION_MAP);

export async function runGitGraphAction(
  runtime: ReviewGitRuntime,
  action: string,
  params: GitGraphActionParams = {},
  cwd?: string,
): Promise<void> {
  const fn = ACTION_MAP[action];
  if (!fn) throw new GitGraphActionError(`unknown action: ${action}`);
  await fn(runtime.runGit, cwd, params);
}
