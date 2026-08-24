/**
 * Commit graph data for the review Commits panel.
 *
 * Newest-first DAG (`git log --date-order` over branches/tags/remotes/HEAD),
 * plus refs, optional stashes, and an uncommitted node when the worktree is
 * dirty. Layout is computed here so the client only paints.
 *
 * Runtime-agnostic like commit-history.ts (Pi vendors a copy).
 */

import {
  COMMIT_FIELD_SEP,
  splitCommitFormatFields,
  type ReviewGitRuntime,
} from "./review-core";
import { UNCOMMITTED_HASH, type GraphLayout } from "./git-graph-layout";
import {
  assembleCommitGraph,
  uncommittedCommit,
  type GraphCommit,
  type RepoRefs,
  type StashRecord,
} from "./git-graph-model";

export { UNCOMMITTED_HASH } from "./git-graph-layout";
export type { GraphLayout } from "./git-graph-layout";

const GRAPH_LIMIT_DEFAULT = 50;
const GRAPH_LIMIT_MAX = 500;

export interface CommitGraphEntry {
  /** Full SHA, or `*` for the working-tree node. */
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  authorEmail: string;
  /** Committer time, epoch milliseconds. */
  committedAt: number;
  parents: string[];
  isHead: boolean;
  avatarUrl?: string;
  heads: string[];
  tags: { name: string; annotated: boolean }[];
  remotes: { name: string; remote: string | null }[];
  stash: { selector: string; baseHash: string | null } | null;
}

export interface CommitGraphPage {
  commits: CommitGraphEntry[];
  layout: GraphLayout;
  hasMore: boolean;
  /** Review base ref (echoed; the graph itself is not first-parent-sliced). */
  base: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  remotes: string[];
  branches: string[];
}

export interface CommitGraphOptions {
  limit?: number;
  showRemoteBranches?: boolean;
  showStashes?: boolean;
  showTags?: boolean;
  /** Restrict the log to these local branch names. Empty/omitted = all tips. */
  branches?: string[] | null;
}

function isSafeRev(value: unknown): value is string {
  return Boolean(value) && typeof value === "string" && !value.startsWith("-") && !/[\0\n\r]/.test(value);
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r\n|\r|\n/);
}

async function getRefs(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
): Promise<RepoRefs> {
  const result = await run(["show-ref", "-d", "--head"]);
  if (result.exitCode !== 0) {
    return { head: null, heads: [], tags: [], remotes: [] };
  }
  const refData: RepoRefs = { head: null, heads: [], tags: [], remotes: [] };
  const tagByName = new Map<string, RepoRefs["tags"][number]>();
  for (const line of splitLines(result.stdout)) {
    if (!line) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const hash = line.slice(0, sp);
    const ref = line.slice(sp + 1);
    if (ref.startsWith("refs/heads/")) {
      refData.heads.push({ hash, name: ref.slice(11) });
    } else if (ref.startsWith("refs/tags/")) {
      const annotated = ref.endsWith("^{}");
      const name = annotated ? ref.slice(10, -3) : ref.slice(10);
      const existing = tagByName.get(name);
      if (!existing || annotated) {
        const entry = { hash, name, annotated };
        if (existing) {
          const idx = refData.tags.indexOf(existing);
          if (idx >= 0) refData.tags[idx] = entry;
        } else {
          refData.tags.push(entry);
        }
        tagByName.set(name, entry);
      }
    } else if (ref.startsWith("refs/remotes/")) {
      if (!ref.endsWith("/HEAD")) {
        refData.remotes.push({ hash, name: ref.slice(13) });
      }
    } else if (ref === "HEAD") {
      refData.head = hash;
    }
  }
  return refData;
}

async function countUncommitted(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
): Promise<number> {
  const result = await run(["status", "--untracked-files=all", "--porcelain"]);
  if (result.exitCode !== 0) return 0;
  return splitLines(result.stdout).filter((l) => l !== "").length;
}

async function branchFromSymbolicRef(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
): Promise<string | null> {
  const result = await run(["symbolic-ref", "--quiet", "HEAD"]);
  if (result.exitCode !== 0) return null;
  const ref = result.stdout.trim();
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  return ref || null;
}

async function getHeadBranch(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
): Promise<string | null> {
  const result = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) return branchFromSymbolicRef(run);
  const name = result.stdout.trim();
  if (!name || name === "HEAD") return branchFromSymbolicRef(run);
  return name;
}

export async function listRemotes(
  runtime: ReviewGitRuntime,
  cwd?: string,
): Promise<string[]> {
  const result = await runtime.runGit(["--no-optional-locks", "remote"], {
    cwd,
    interaction: "forbid",
  });
  if (result.exitCode !== 0) return [];
  return splitLines(result.stdout)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function listStashes(
  runtime: ReviewGitRuntime,
  cwd?: string,
): Promise<StashRecord[]> {
  const result = await runtime.runGit(
    [
      "--no-optional-locks",
      "stash",
      "list",
      `--format=%H${COMMIT_FIELD_SEP}%gd${COMMIT_FIELD_SEP}%P${COMMIT_FIELD_SEP}%at${COMMIT_FIELD_SEP}%an${COMMIT_FIELD_SEP}%ae${COMMIT_FIELD_SEP}%s`,
    ],
    { cwd, interaction: "forbid" },
  );
  if (result.exitCode !== 0) return [];
  const stashes: StashRecord[] = [];
  for (const line of splitLines(result.stdout)) {
    if (!line) continue;
    const fields = splitCommitFormatFields(line, 6, 0);
    if (!fields) continue;
    const [hash, selector, parents, date, author, email, message] = fields;
    if (!hash || !selector) continue;
    const parentHashes = parents ? parents.split(" ").filter(Boolean) : [];
    stashes.push({
      hash,
      selector,
      baseHash: parentHashes[0] || null,
      date: parseInt(date, 10) || 0,
      author: author || "",
      email: email || "",
      message: message || selector,
    });
  }
  return stashes;
}

async function headExists(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
): Promise<boolean> {
  const result = await run(["rev-parse", "--verify", "HEAD"]);
  return result.exitCode === 0;
}

async function repoHasCommits(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
): Promise<boolean> {
  const result = await run(["rev-list", "-n", "1", "--all"]);
  return result.exitCode === 0 && result.stdout.trim() !== "";
}

async function readCommitLog(
  run: (args: string[]) => ReturnType<ReviewGitRuntime["runGit"]>,
  options: {
    maxCommits: number;
    branchFilter: string[] | null;
    showRemoteBranches: boolean;
    showTags: boolean;
    hasHead: boolean;
    extraTips?: string[];
  },
): Promise<Array<Partial<GraphCommit> & { hash: string; shortSha: string }>> {
  const { maxCommits, branchFilter, showRemoteBranches, showTags, hasHead, extraTips } = options;
  const fmt = ["%H", "%h", "%P", "%an", "%ae", "%at", "%s"].join(COMMIT_FIELD_SEP);
  const args = [
    "log",
    `--max-count=${maxCommits}`,
    `--pretty=format:${fmt}`,
    "--date-order",
  ];
  if (branchFilter) {
    for (const b of branchFilter) {
      if (isSafeRev(b)) args.push(b);
    }
  } else {
    args.push("--branches");
    if (showTags) args.push("--tags");
    if (showRemoteBranches) args.push("--remotes");
    if (hasHead) args.push("HEAD");
    for (const tip of extraTips || []) {
      if (isSafeRev(tip)) args.push(tip);
    }
  }
  args.push("--");
  const log = await run(args);
  if (log.exitCode !== 0) return [];
  const commits: Array<Partial<GraphCommit> & { hash: string; shortSha: string }> = [];
  for (const line of splitLines(log.stdout)) {
    if (!line) continue;
    const fields = splitCommitFormatFields(line, 6, 0);
    if (!fields) continue;
    const [hash, shortSha, parents, author, email, date, message] = fields;
    if (!hash) continue;
    commits.push({
      hash,
      shortSha,
      parents: parents !== "" ? parents.split(" ").filter(Boolean) : [],
      author,
      email,
      date: parseInt(date, 10) || 0,
      message,
    });
  }
  return commits;
}

function toEntry(commit: GraphCommit, headSha: string | null, shortSha?: string): CommitGraphEntry {
  const isUncommitted = commit.hash === UNCOMMITTED_HASH;
  return {
    sha: commit.hash,
    shortSha: isUncommitted ? "*" : shortSha || commit.hash.slice(0, 7),
    subject: commit.message,
    author: commit.author,
    authorEmail: commit.email,
    committedAt: (commit.date || 0) * 1000,
    parents: commit.parents,
    isHead: !isUncommitted && commit.hash === headSha,
    heads: commit.heads,
    tags: commit.tags,
    remotes: commit.remotes,
    stash: commit.stash,
  };
}

/**
 * Full commit graph for the Commits panel. Returns an empty page (not null)
 * when the repo has no commits yet; null only when git cannot answer at all.
 */
export async function listCommitGraph(
  runtime: ReviewGitRuntime,
  defaultBranch: string,
  cwd?: string,
  options?: CommitGraphOptions,
): Promise<CommitGraphPage | null> {
  const requested = options?.limit ?? GRAPH_LIMIT_DEFAULT;
  const limit = Math.max(1, Math.min(Math.floor(requested), GRAPH_LIMIT_MAX));
  const showRemoteBranches = options?.showRemoteBranches !== false;
  const showStashes = options?.showStashes !== false;
  const showTags = options?.showTags !== false;
  const branchFilter =
    Array.isArray(options?.branches) && options.branches.length ? options.branches : null;
  if (branchFilter && branchFilter.some((b) => !isSafeRev(b))) return null;

  const run = (args: string[]) =>
    runtime.runGit(["--no-optional-locks", ...args], {
      cwd,
      interaction: "forbid",
      config: { "log.showSignature": "false" },
    });

  const [hasHead, hasCommits, refs, stashList, uncommittedCount, branch, remotes] = await Promise.all([
    headExists(run),
    repoHasCommits(run),
    getRefs(run),
    showStashes ? listStashes(runtime, cwd) : Promise.resolve([] as StashRecord[]),
    countUncommitted(run),
    getHeadBranch(run),
    listRemotes(runtime, cwd),
  ]);

  const empty: CommitGraphPage = {
    commits: [],
    layout: assembleCommitGraph({ logCommits: [], refs: { head: null, heads: [], tags: [], remotes: [] } }).layout,
    hasMore: false,
    base: defaultBranch,
    head: refs.head,
    branch,
    detached: branch === null && refs.head !== null,
    remotes,
    branches: refs.heads.map((h) => h.name),
  };

  if (!hasCommits) {
    if (uncommittedCount > 0) {
      const { commits, layout } = assembleCommitGraph({
        logCommits: [],
        stashList: [],
        uncommittedRow: uncommittedCommit(refs.head, uncommittedCount),
        refs,
        showTags,
        showRemoteBranches,
      });
      return {
        ...empty,
        commits: commits.map((c) => toEntry(c, refs.head)),
        layout,
      };
    }
    return empty;
  }

  const stashBaseHashes = [
    ...new Set(
      stashList.map((s) => s.baseHash).filter((h): h is string => typeof h === "string" && h.length > 0),
    ),
  ];
  const logCommits = await readCommitLog(run, {
    maxCommits: limit + 1,
    branchFilter,
    showRemoteBranches,
    showTags,
    hasHead,
    extraTips: stashBaseHashes,
  });
  const hasMore = logCommits.length > limit;
  const window = logCommits.slice(0, limit);
  const shortByHash = new Map(window.map((c) => [c.hash, c.shortSha]));

  const { commits, layout } = assembleCommitGraph({
    logCommits: window,
    stashList,
    uncommittedRow: uncommittedCount > 0 ? uncommittedCommit(refs.head, uncommittedCount) : null,
    refs,
    showTags,
    showRemoteBranches,
  });

  return {
    commits: commits.map((c) => toEntry(c, refs.head, shortByHash.get(c.hash))),
    layout,
    hasMore,
    base: defaultBranch,
    head: refs.head,
    branch,
    detached: branch === null && refs.head !== null,
    remotes,
    branches: refs.heads.map((h) => h.name),
  };
}

export interface TagDetails {
  name: string;
  annotated: boolean;
  tagHash: string;
  commitHash: string;
  tagger: string;
  email: string;
  date: number;
  message: string;
}

export async function getTagDetails(
  runtime: ReviewGitRuntime,
  name: string,
  cwd?: string,
): Promise<TagDetails> {
  if (!isSafeRev(name)) {
    throw new Error("invalid tag name");
  }
  const run = (args: string[]) =>
    runtime.runGit(["--no-optional-locks", ...args], { cwd, interaction: "forbid" });

  const typeResult = await run(["cat-file", "-t", `refs/tags/${name}`]);
  if (typeResult.exitCode !== 0) {
    throw new Error(`tag not found: ${name}`);
  }
  const objectType = typeResult.stdout.trim();
  const commitHash = (await run(["rev-parse", `refs/tags/${name}^{}`])).stdout.trim();
  if (objectType !== "tag") {
    return {
      name,
      annotated: false,
      tagHash: commitHash,
      commitHash,
      tagger: "",
      email: "",
      date: 0,
      message: "",
    };
  }
  const tagHash = (await run(["rev-parse", `refs/tags/${name}`])).stdout.trim();
  const payload = (await run(["cat-file", "-p", `refs/tags/${name}`])).stdout;
  const taggerLine = payload.split(/\r\n|\r|\n/).find((l) => l.startsWith("tagger ")) || "";
  const taggerMatch = taggerLine.match(/^tagger (.+) <([^>]+)> (\d+)/);
  const blank = payload.indexOf("\n\n");
  const message = blank >= 0 ? payload.slice(blank + 2).replace(/\n+$/, "") : "";
  return {
    name,
    annotated: true,
    tagHash,
    commitHash,
    tagger: taggerMatch ? taggerMatch[1] : "",
    email: taggerMatch ? taggerMatch[2] : "",
    date: taggerMatch ? parseInt(taggerMatch[3], 10) : 0,
    message,
  };
}
