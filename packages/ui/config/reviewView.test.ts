import { afterEach, describe, expect, test } from 'bun:test';
import { resetStorageBackend, setStorageBackend } from '../utils/storage';
import { ConfigStoreForTest } from './configStore';
import { setReviewDefaultDiffType, setReviewPanelView } from './reviewView';

function installMemoryBackend(): Map<string, string> {
  const values = new Map<string, string>();
  setStorageBackend({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  });
  return values;
}

function makeStore() {
  const store = new ConfigStoreForTest();
  store.setServerSync(() => {});
  return store;
}

afterEach(() => {
  resetStorageBackend();
});

describe('review view preference writers', () => {
  test('setReviewDefaultDiffType does not snap a Git status panel preference to Tree', () => {
    installMemoryBackend();
    const store = makeStore();

    setReviewPanelView('sections', undefined, store);
    setReviewDefaultDiffType('uncommitted', store);

    expect(store.get('defaultDiffType')).toBe('uncommitted');
    expect(store.get('reviewPanelView')).toBe('sections');
    expect(store.get('reviewPanelViewLastUsed')).toBe('sections');
  });

  test('setReviewPanelView(sections) does not overwrite a classic Default Diff', () => {
    installMemoryBackend();
    const store = makeStore();

    setReviewDefaultDiffType('uncommitted', store);
    setReviewPanelView('sections', undefined, store);

    expect(store.get('reviewPanelView')).toBe('sections');
    expect(store.get('defaultDiffType')).toBe('uncommitted');
  });
});
