import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommitGraphEntry, CommitGraphPage, GraphLayout } from '@plannotator/shared/git-graph-history';
import { UNCOMMITTED_HASH } from '@plannotator/shared/git-graph-history';

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 10_000;

interface UseCommitsViewOptions {
  /** Fetch only while the Commits view is visible in an API-mode session. */
  enabled: boolean;
  /** History identity — refetch from page one when it changes (worktree
   * switch, base switch). A commit CLICK must not be part of this key: paging
   * state has to survive selecting commits from a deep page. */
  contextKey: string;
  /** Full sha of the commit whose diff is on screen (null in other modes). */
  activeCommitSha: string | null;
  /** Any diff switch in flight — auto-select defers to it; the veil covers. */
  isLoadingDiff: boolean;
  /** A diff switch failed — the veil drops so the error state is visible. */
  diffError: string | null;
  /** Open a commit's diff — App's handleSelectCommit, the same path user
   * clicks take, so auto- and user-selection can never diverge. */
  onOpenCommit: (sha: string) => void;
}

interface UseCommitsViewReturn {
  commits: CommitGraphEntry[];
  layout: GraphLayout | null;
  /** Base ref echoed from the review session. */
  base: string | null;
  head: string | null;
  branch: string | null;
  detached: boolean;
  remotes: string[];
  branches: string[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  showMore: () => void;
  refresh: () => void;
  veilActive: boolean;
  /** Pin auto-select as done so a user click (Uncommitted) cannot lose a race
   * against the HEAD-open effect that runs after the graph paints. */
  dismissAutoSelect: () => void;
  showRemotes: boolean;
  setShowRemotes: (value: boolean) => void;
  showStashes: boolean;
  setShowStashes: (value: boolean) => void;
  branchFilter: string;
  setBranchFilter: (value: string) => void;
}

function fingerprint(page: Pick<CommitGraphPage, 'commits' | 'head' | 'branch' | 'base'>): string {
  return `${page.head ?? ''}|${page.branch ?? ''}|${page.base}|${page.commits.map((c) => c.sha).join(',')}`;
}

/**
 * The Commits-view session machine: pages `GET /api/commits` as a graph,
 * keeps the rail fresh (quiet poll), auto-opens HEAD once per entry, and
 * derives the center-dock veil.
 */
export function useCommitsView({
  enabled,
  contextKey,
  activeCommitSha,
  isLoadingDiff,
  diffError,
  onOpenCommit,
}: UseCommitsViewOptions): UseCommitsViewReturn {
  const [commits, setCommits] = useState<CommitGraphEntry[]>([]);
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [detached, setDetached] = useState(false);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showRemotes, setShowRemotes] = useState(true);
  const [showStashes, setShowStashes] = useState(true);
  const [branchFilter, setBranchFilter] = useState('');
  const [railSettled, setRailSettled] = useState(false);
  const generationRef = useRef(0);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const fingerprintRef = useRef('');
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef(false);
  const queryRef = useRef({ showRemotes, showStashes, branchFilter });
  queryRef.current = { showRemotes, showStashes, branchFilter };

  const applyPage = (data: CommitGraphPage) => {
    setCommits(data.commits);
    setLayout(data.layout);
    setBase(data.base || null);
    setHead(data.head || null);
    setBranch(data.branch || null);
    setDetached(Boolean(data.detached));
    setRemotes(data.remotes || []);
    setBranches(data.branches || []);
    setHasMore(data.hasMore);
    fingerprintRef.current = fingerprint(data);
  };

  const fetchGraph = useCallback(async (opts?: { more?: boolean; silent?: boolean }) => {
    if (opts?.more && (loadingMoreRef.current || !hasMoreRef.current)) return;
    const generation = ++generationRef.current;
    const nextLimit = opts?.more ? limitRef.current + PAGE_SIZE : limitRef.current;
    if (opts?.more) {
      loadingMoreRef.current = true;
      setLimit(nextLimit);
    } else {
      loadingMoreRef.current = false;
    }
    if (!opts?.silent) {
      if (opts?.more) setIsLoadingMore(true);
      else setIsLoading(true);
    }
    if (!opts?.more) setIsLoadingMore(false);
    if (!opts?.silent) setError(null);
    try {
      const q = queryRef.current;
      const params = new URLSearchParams({ limit: String(nextLimit) });
      if (!q.showRemotes) params.set('remotes', '0');
      if (!q.showStashes) params.set('stashes', '0');
      if (q.branchFilter) params.set('branch', q.branchFilter);
      const res = await fetch(`/api/commits?${params}`);
      const data = (await res.json()) as CommitGraphPage & { error?: string };
      if (generation !== generationRef.current) return;
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load commits');
      const prevCount = commitsRef.current.length;
      applyPage(data);
      if (opts?.more) {
        limitRef.current = nextLimit;
        // Server caps the window (GRAPH_LIMIT_MAX); a no-growth page must
        // not keep the infinite-scroll sentinel firing forever.
        if (data.commits.length <= prevCount) setHasMore(false);
      }
    } catch (err) {
      if (generation !== generationRef.current) return;
      if (!opts?.silent) {
        setError(err instanceof Error ? err.message : 'Failed to load commits');
      }
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, []);

  const loadedContextKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (loadedContextKeyRef.current !== contextKey) {
      loadedContextKeyRef.current = contextKey;
      setCommits([]);
      setLayout(null);
      setBase(null);
      setHasMore(false);
      setLimit(PAGE_SIZE);
      limitRef.current = PAGE_SIZE;
      loadingMoreRef.current = false;
      fingerprintRef.current = '';
    }
    void fetchGraph();
    return () => {
      generationRef.current++;
      setIsLoading(false);
      setIsLoadingMore(false);
    };
  }, [enabled, contextKey, fetchGraph, showRemotes, showStashes, branchFilter]);

  const checkForNewCommits = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const q = queryRef.current;
      const params = new URLSearchParams({ limit: String(limitRef.current) });
      if (!q.showRemotes) params.set('remotes', '0');
      if (!q.showStashes) params.set('stashes', '0');
      if (q.branchFilter) params.set('branch', q.branchFilter);
      const res = await fetch(`/api/commits?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as CommitGraphPage & { error?: string };
      if (data.error) return;
      if (generation !== generationRef.current) return;
      if (fingerprint(data) === fingerprintRef.current) return;
      generationRef.current++;
      applyPage(data);
      setIsLoading(false);
      setIsLoadingMore(false);
      setError(null);
    } catch {
      /* transient — next poll tries again */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      void checkForNewCommits();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, checkForNewCommits]);

  const showMore = useCallback(() => {
    void fetchGraph({ more: true });
  }, [fetchGraph]);

  const refresh = useCallback(() => {
    void fetchGraph();
  }, [fetchGraph]);

  const autoSelectDone = useRef(false);
  useEffect(() => {
    if (!enabled) {
      autoSelectDone.current = false;
      setRailSettled(false);
      return;
    }
    if (activeCommitSha && activeCommitSha !== UNCOMMITTED_HASH) {
      autoSelectDone.current = true;
      setRailSettled(true);
      return;
    }
    if (autoSelectDone.current) return;
    if (isLoadingDiff) return;
    const headCommit = commits.find((c) => c.isHead) ?? commits.find((c) => c.sha !== UNCOMMITTED_HASH);
    if (!headCommit) {
      // Only the uncommitted node (or a truly empty graph) — nothing to auto-open.
      if (!isLoading && commits.length > 0) {
        autoSelectDone.current = true;
        setRailSettled(true);
      }
      return;
    }
    autoSelectDone.current = true;
    setRailSettled(true);
    onOpenCommit(headCommit.sha);
  }, [enabled, activeCommitSha, isLoadingDiff, isLoading, commits, onOpenCommit]);

  const dismissAutoSelect = useCallback(() => {
    autoSelectDone.current = true;
    setRailSettled(true);
  }, []);

  const veilActive =
    enabled && !diffError && !error &&
    (isLoadingDiff || (!railSettled && (isLoading || commits.length > 0)));

  return {
    commits,
    layout,
    base,
    head,
    branch,
    detached,
    remotes,
    branches,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    showMore,
    refresh,
    veilActive,
    dismissAutoSelect,
    showRemotes,
    setShowRemotes,
    showStashes,
    setShowStashes,
    branchFilter,
    setBranchFilter,
  };
}
