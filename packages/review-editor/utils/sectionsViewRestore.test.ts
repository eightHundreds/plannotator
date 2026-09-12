import { describe, expect, test } from 'bun:test';
import {
  isSinceBaseDiffType,
  shouldCaptureSectionsRestore,
  shouldRestoreSectionsDiff,
} from './sectionsViewRestore';

describe('isSinceBaseDiffType', () => {
  test('matches plain and worktree-composed since-base', () => {
    expect(isSinceBaseDiffType('since-base')).toBe(true);
    expect(isSinceBaseDiffType('worktree:/tmp/wt:since-base')).toBe(true);
    expect(isSinceBaseDiffType('worktree:C:/work/tree:since-base')).toBe(true);
  });

  test('rejects classic diffs', () => {
    expect(isSinceBaseDiffType('uncommitted')).toBe(false);
    expect(isSinceBaseDiffType('worktree:/tmp/wt:uncommitted')).toBe(false);
    expect(isSinceBaseDiffType('all')).toBe(false);
  });
});

describe('shouldCaptureSectionsRestore', () => {
  test('captures when Tree is showing a classic diff', () => {
    expect(shouldCaptureSectionsRestore('tree', 'uncommitted')).toBe(true);
    expect(shouldCaptureSectionsRestore('tree', 'staged')).toBe(true);
  });

  test('skips when already since-base, already in Git status, or in Commits', () => {
    expect(shouldCaptureSectionsRestore('tree', 'since-base')).toBe(false);
    expect(shouldCaptureSectionsRestore('sections', 'uncommitted')).toBe(false);
    expect(shouldCaptureSectionsRestore('commits', 'uncommitted')).toBe(false);
  });
});

describe('shouldRestoreSectionsDiff', () => {
  test('restores Tree exit from Git status while live since-base and a memo exists', () => {
    expect(shouldRestoreSectionsDiff('tree', 'sections', 'since-base', true)).toBe(true);
  });

  test('restores while the forced since-base switch is still in flight', () => {
    expect(shouldRestoreSectionsDiff('tree', 'sections', 'uncommitted', true, true)).toBe(true);
  });

  test('does not restore if the reviewer already left since-base, or there is no memo', () => {
    expect(shouldRestoreSectionsDiff('tree', 'sections', 'uncommitted', true)).toBe(false);
    expect(shouldRestoreSectionsDiff('tree', 'sections', 'since-base', false)).toBe(false);
    expect(shouldRestoreSectionsDiff('commits', 'sections', 'since-base', true)).toBe(false);
    expect(shouldRestoreSectionsDiff('tree', 'commits', 'since-base', true)).toBe(false);
  });
});
