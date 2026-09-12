import type { CommitViewRestoreTarget } from './commitViewRestore';

/** Same shape as the Commits restore memo: full diff type + optional base. */
export type SectionsViewRestoreTarget = CommitViewRestoreTarget;

export function isSinceBaseDiffType(fullDiffType: string): boolean {
  return fullDiffType === 'since-base' || fullDiffType.endsWith(':since-base');
}

/**
 * Capture the Tree (or other non-sections) live diff when entering Git status
 * from a classic diff. Skip when already on sections (re-click) or already on
 * since-base (nothing to restore). Skip Commits: that view has its own memo.
 */
export function shouldCaptureSectionsRestore(
  currentPanelView: 'sections' | 'commits' | 'tree',
  activeDiffBase: string,
): boolean {
  return currentPanelView === 'tree' && activeDiffBase !== 'since-base';
}

/**
 * Leaving Git status for Tree should restore the captured Tree diff only while
 * the live session is still the since-base we forced (or that switch is still
 * in flight). A picker change away from since-base is the reviewer's new
 * choice — do not overwrite it.
 */
export function shouldRestoreSectionsDiff(
  nextView: 'sections' | 'commits' | 'tree',
  currentPanelView: 'sections' | 'commits' | 'tree',
  activeDiffBase: string,
  hasMemo: boolean,
  isLoadingDiff = false,
): boolean {
  return nextView === 'tree'
    && currentPanelView === 'sections'
    && hasMemo
    && (activeDiffBase === 'since-base' || isLoadingDiff);
}
