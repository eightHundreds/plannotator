import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { CommitGraphEntry, GraphLayout } from '@plannotator/shared/git-graph-history';
import { UNCOMMITTED_HASH } from '@plannotator/shared/git-graph-history';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';
import { useOverlayViewport } from '@plannotator/ui/hooks/useOverlayViewport';
import { formatRelativeTime } from '@plannotator/ui/utils/aiChatFormat';
import { copyTextToClipboard } from '@plannotator/ui/utils/clipboard';
import { PanelViewToggle, type ReviewPanelView } from './PanelViewToggle';
import { Avatar } from './Avatar';
import { GitGraphSvg } from './git-graph/GitGraphSvg';
import { GitGraphRefs } from './git-graph/GitGraphRefs';
import { GitGraphMenu, type GitGraphMenuItem } from './git-graph/GitGraphMenu';
import { GitGraphPrompt, type GitGraphPromptSpec } from './git-graph/GitGraphPrompt';
import {
  commitMenuItems,
  headMenuItems,
  remoteMenuItems,
  tagMenuItems,
  type GraphActionHost,
} from './git-graph/gitGraphMenus';

/**
 * The Commits panel — a gitlane-style commit graph (lanes + ref chips) in the
 * review navigator. Clicking a commit still opens that commit's own diff in
 * the center dock (Plannotator all-files view), not gitlane's inline expander.
 */

interface CommitsPanelProps {
  width?: number;
  commits: CommitGraphEntry[];
  layout: GraphLayout | null;
  branch: string | null;
  remotes: string[];
  branches: string[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  activeCommitSha: string | null;
  /** True when the on-screen diff is the working tree (uncommitted node selected). */
  uncommittedActive?: boolean;
  onSelectCommit: (sha: string) => void;
  onSelectUncommitted: () => void;
  onShowMore: () => void;
  onRetry: () => void;
  onHistoryMutated: () => void;
  onSelectPanelView: (view: ReviewPanelView) => void;
  showSectionsOption: boolean;
  showRemotes: boolean;
  onShowRemotesChange: (value: boolean) => void;
  showStashes: boolean;
  onShowStashesChange: (value: boolean) => void;
  branchFilter: string;
  onBranchFilterChange: (value: string) => void;
}

async function runGraphAction(action: string, params?: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/git-graph/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params: params ?? {} }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok || data.error) throw new Error(data.error || 'Git action failed');
}

const CommitRow: React.FC<{
  commit: CommitGraphEntry;
  isActive: boolean;
  currentBranch: string | null;
  colour: string;
  rowHeight: number;
  onSelect: () => void;
}> = ({ commit, isActive, currentBranch, colour, rowHeight, onSelect }) => {
  const isUncommitted = commit.sha === UNCOMMITTED_HASH;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-hash={commit.sha}
      className={`w-full text-left px-2 box-border flex flex-col justify-center overflow-hidden leading-none shrink-0 transition-colors ${
        isActive ? 'bg-primary/10' : 'hover:bg-muted/50'
      }`}
      style={{ height: rowHeight, minHeight: rowHeight, maxHeight: rowHeight }}
      title={
        isUncommitted
          ? commit.subject
          : `${commit.sha}\n${commit.author} <${commit.authorEmail}>\n${commit.subject}`
      }
    >
      <div className="flex items-center gap-1.5 min-w-0 h-[18px]">
        <GitGraphRefs commit={commit} currentBranch={currentBranch} colour={colour} />
        <span className={`text-xs truncate flex-1 ${isUncommitted ? 'text-muted-foreground italic' : ''}`}>
          {commit.subject}
        </span>
        {commit.isHead && (
          <span className="text-[9px] leading-none px-1 py-0.5 rounded bg-primary/15 text-primary font-medium flex-shrink-0">
            HEAD
          </span>
        )}
        {!isUncommitted && (
          <span className="text-[10px] text-muted-foreground/70 tabular-nums flex-shrink-0">
            {formatRelativeTime(commit.committedAt)}
          </span>
        )}
      </div>
      {!isUncommitted && (
        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
          <Avatar src={commit.avatarUrl} name={commit.author} size={14} />
          <span className="text-[11px] text-muted-foreground truncate">{commit.author}</span>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-muted-foreground/70 flex-shrink-0">{commit.shortSha}</span>
        </div>
      )}
    </button>
  );
};

export const CommitsPanel: React.FC<CommitsPanelProps> = ({
  width,
  commits,
  layout,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  activeCommitSha,
  uncommittedActive,
  onSelectCommit,
  onSelectUncommitted,
  onShowMore,
  onRetry,
  onHistoryMutated,
  onSelectPanelView,
  showSectionsOption,
  showRemotes,
  onShowRemotesChange,
  showStashes,
  onShowStashesChange,
  branchFilter,
  onBranchFilterChange,
  branch,
  remotes,
  branches,
}) => {
  const [menu, setMenu] = useState<{ x: number; y: number; items: GitGraphMenuItem[] } | null>(null);
  const [prompt, setPrompt] = useState<GitGraphPromptSpec | null>(null);
  const [tagDetails, setTagDetails] = useState<string | null>(null);
  const { viewport, onViewportReady } = useOverlayViewport<HTMLDivElement>();

  const tryLoadMore = useCallback(
    (node?: HTMLElement | null) => {
      const el = node ?? viewport;
      if (!el || !hasMore || isLoadingMore) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) onShowMore();
    },
    [viewport, hasMore, isLoadingMore, onShowMore],
  );

  useEffect(() => {
    tryLoadMore();
  }, [tryLoadMore, commits.length]);

  const host: GraphActionHost = useMemo(
    () => ({
      branch,
      remotes,
      run: async (action, params) => {
        await runGraphAction(action, params);
        toast.success('Git action completed');
        onHistoryMutated();
      },
      prompt: setPrompt,
      copy: (text) => {
        void copyTextToClipboard(text).then((ok) => {
          if (ok) toast.success('Copied');
          else toast.error('Failed to copy');
        });
      },
      showTagDetails: (name) => {
        void (async () => {
          try {
            const res = await fetch(`/api/git-graph/tag?name=${encodeURIComponent(name)}`);
            const data = (await res.json()) as {
              error?: string;
              tagHash?: string;
              commitHash?: string;
              tagger?: string;
              email?: string;
              date?: number;
              message?: string;
            };
            if (!res.ok || data.error) throw new Error(data.error || 'Failed to read tag');
            const when = data.date ? new Date(data.date * 1000).toLocaleString() : '';
            setTagDetails(
              [`Object: ${data.tagHash ?? ''}`, `Commit: ${data.commitHash ?? ''}`, `Tagger: ${data.tagger ?? ''} <${data.email ?? ''}>`, `Date: ${when}`, '', data.message ?? ''].join('\n'),
            );
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to read tag');
          }
        })();
      },
    }),
    [branch, remotes, onHistoryMutated],
  );

  const selectRow = useCallback(
    (commit: CommitGraphEntry) => {
      if (commit.sha === UNCOMMITTED_HASH) onSelectUncommitted();
      else onSelectCommit(commit.sha);
    },
    [onSelectCommit, onSelectUncommitted],
  );

  const onContextMenu = useCallback(
    (ev: React.MouseEvent) => {
      const ref = (ev.target as HTMLElement).closest('[data-ref-type]') as HTMLElement | null;
      if (ref) {
        ev.preventDefault();
        ev.stopPropagation();
        const type = ref.dataset.refType;
        const name = ref.dataset.name || '';
        if (type === 'head') setMenu({ x: ev.clientX, y: ev.clientY, items: headMenuItems(name, host) });
        else if (type === 'remote') setMenu({ x: ev.clientX, y: ev.clientY, items: remoteMenuItems(name, host) });
        else if (type === 'tag') setMenu({ x: ev.clientX, y: ev.clientY, items: tagMenuItems(name, ref.dataset.annotated === '1', host) });
        else if (type === 'stash') {
          const row = (ev.target as HTMLElement).closest('[data-hash]') as HTMLElement | null;
          const commit = commits.find((c) => c.sha === row?.dataset.hash);
          if (commit) setMenu({ x: ev.clientX, y: ev.clientY, items: commitMenuItems(commit, host) });
        }
        return;
      }
      const row = (ev.target as HTMLElement).closest('[data-hash]') as HTMLElement | null;
      if (!row?.dataset.hash) return;
      const commit = commits.find((c) => c.sha === row.dataset.hash);
      if (!commit) return;
      ev.preventDefault();
      setMenu({ x: ev.clientX, y: ev.clientY, items: commitMenuItems(commit, host) });
    },
    [commits, host],
  );

  const graphWidth = Math.max(layout?.graphWidth ?? 48, 36);
  const rowHeight = layout?.grid.y ?? 44;
  const colours = layout?.colours ?? [];

  const isRowActive = (commit: CommitGraphEntry) => {
    if (commit.sha === UNCOMMITTED_HASH) return Boolean(uncommittedActive);
    return commit.sha === activeCommitSha;
  };

  return (
    <aside
      className="border-r border-border/50 bg-card/30 flex flex-col flex-shrink-0 overflow-hidden"
      style={{ width: width ?? 256 }}
    >
      <div className="px-3 flex items-center border-b border-border/50 flex-shrink-0" style={{ height: 'var(--panel-header-h)' }}>
        <PanelViewToggle
          view="commits"
          onSelect={onSelectPanelView}
          showSections={showSectionsOption}
          showCommits
        />
      </div>
      <div className="px-3 py-1 border-b border-border/30 flex items-center gap-2 flex-shrink-0 min-w-0">
        <select
          className="min-w-0 flex-1 bg-background border border-border/60 rounded text-[11px] px-1 py-0.5 text-muted-foreground"
          value={branchFilter}
          onChange={(e) => onBranchFilterChange(e.target.value)}
          title="Filter branches"
        >
          <option value="">All branches</option>
          {branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground flex-shrink-0">
          <input
            type="checkbox"
            checked={showRemotes}
            onChange={(e) => onShowRemotesChange(e.target.checked)}
            className="rounded border-border"
          />
          Remotes
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground flex-shrink-0">
          <input
            type="checkbox"
            checked={showStashes}
            onChange={(e) => onShowStashesChange(e.target.checked)}
            className="rounded border-border"
          />
          Stashes
        </label>
        {remotes.length > 0 && (
          <button
            type="button"
            className="text-[11px] text-primary/80 hover:text-primary flex-shrink-0"
            onClick={() => {
              void host.run('fetch', { prune: true }).catch((err) => {
                toast.error(err instanceof Error ? err.message : 'Fetch failed');
              });
            }}
            title="Fetch from remotes"
          >
            Fetch
          </button>
        )}
      </div>
      {commits.length > 0 && (
        <div className="px-3 py-1 border-b border-border/30 flex items-center justify-end flex-shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {commits.filter((c) => c.sha !== UNCOMMITTED_HASH).length}{' '}
            {commits.filter((c) => c.sha !== UNCOMMITTED_HASH).length === 1 ? 'commit' : 'commits'}
          </span>
        </div>
      )}

      <OverlayScrollArea
        className="flex-1 min-h-0"
        overflowX="auto"
        onViewportReady={onViewportReady}
        onScroll={(ev) => tryLoadMore(ev.currentTarget)}
      >
        <div className="relative" onContextMenu={onContextMenu}>
          {layout && commits.length > 0 && (
            <GitGraphSvg
              layout={layout}
              onVertexClick={(id) => {
                const commit = commits[id];
                if (commit) selectRow(commit);
              }}
            />
          )}
          <div className="py-0" style={{ paddingLeft: graphWidth }}>
            {error && commits.length === 0 ? (
              <div className="px-2 py-4 text-center space-y-2">
                <div className="text-xs text-destructive break-words">{error}</div>
                <button
                  onClick={onRetry}
                  className="text-[11px] text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : isLoading && commits.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground/50">Loading commits…</div>
            ) : commits.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground/50">No commits</div>
            ) : (
              <>
                {commits.map((commit, index) => (
                  <CommitRow
                    key={`${commit.sha}:${commit.stash?.selector ?? ''}:${index}`}
                    commit={commit}
                    isActive={isRowActive(commit)}
                    currentBranch={branch}
                    colour={colours[(layout?.vertices[index]?.colour ?? 0) % Math.max(colours.length, 1)] ?? '#2563eb'}
                    rowHeight={rowHeight}
                    onSelect={() => selectRow(commit)}
                  />
                ))}
                {hasMore && isLoadingMore && (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground/50">Loading…</div>
                )}
                {error && (
                  <div className="px-2 py-1.5 flex items-center gap-2 text-[11px] text-destructive">
                    <span className="truncate flex-1" title={error}>{error}</span>
                    <button
                      onClick={onRetry}
                      className="flex-shrink-0 text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </OverlayScrollArea>
      {menu && <GitGraphMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <GitGraphPrompt spec={prompt} onClose={() => setPrompt(null)} />
      {tagDetails && (
        <GitGraphPrompt
          spec={{
            title: 'Tag details',
            fields: [{ id: 'body', type: 'note', text: tagDetails }],
            confirmText: 'Close',
            onConfirm: () => {
              setTagDetails(null);
            },
          }}
          onClose={() => setTagDetails(null)}
        />
      )}
    </aside>
  );
};
