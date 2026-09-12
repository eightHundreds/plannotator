import { configStore } from './configStore';
import { SETTINGS } from './settings';

/**
 * Writers for the review opening preferences (reviewPanelView,
 * defaultDiffType).
 *
 * Persistence is independent: Settings / ReviewSetup may store any combination
 * of panel view and default diff. Runtime is what gates Git status:
 *   - SectionsPanel only mounts when the LIVE diff is since-base
 *     (`sectionsAvailable`); otherwise resolvePanelView falls back to Tree
 *   - the header toggle's handleSwitchToSections switches the LIVE diff to
 *     since-base for the session without rewriting Default Diff
 *
 * Never write either setting by hand at call sites — always go through these
 * setters so last-used memo syncing stays in one place.
 */

/** Store seam for tests (fresh ConfigStoreForTest); production always uses the singleton. */
type PanelViewConfigStore = typeof configStore;

export function setReviewPanelView(
  view: 'sections' | 'tree',
  options?: { recordLastUsed?: boolean },
  store: PanelViewConfigStore = configStore,
): void {
  store.set('reviewPanelView', view);
  // An explicit persisted choice also becomes the last-used view — otherwise
  // a stale last-used cookie would immediately shadow what the user just
  // picked in Settings / the setup dialog. recordLastUsed: false is for
  // non-choice writes that must not overwrite the user's memo.
  if (options?.recordLastUsed !== false) {
    store.set('reviewPanelViewLastUsed', view);
  }
}

/**
 * The panel view the reviewer has actually persisted, or `undefined` when they
 * never chose one. Distinct from `configStore.get('reviewPanelView')`, which
 * cannot tell a stored choice apart from the built-in default, which is the
 * difference first-run seeding has to respect before it writes over anything.
 */
export function getPersistedReviewPanelView(): 'sections' | 'tree' | undefined {
  return SETTINGS.reviewPanelView.fromCookie();
}

export type ReviewDefaultDiffType =
  | 'since-base'
  | 'uncommitted'
  | 'unstaged'
  | 'staged'
  | 'merge-base'
  | 'all';

export function setReviewDefaultDiffType(
  value: ReviewDefaultDiffType,
  store: PanelViewConfigStore = configStore,
): void {
  store.set('defaultDiffType', value);
}
