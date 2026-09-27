import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITES_KEY, readFavorites, saveFavorite } from '../favorites.mjs';

const validIds = ['recipe-001', 'recipe-002'];
const success = (ids) => ({ ok: true, ids });

function memory(initial = {}) {
  const entries = new Map(Object.entries(initial));
  const writes = [];
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); entries.set(key, value); },
  };
  return { entries, writes, storage, getStorage: () => storage };
}

function assertFailure(result, kind) {
  assert.equal(result.ok, false);
  assert.equal(result.kind, kind);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.trim().length > 0);
  assert.equal(Object.hasOwn(result, 'ids'), false, '失败时不能返回成功收藏清单');
}

test('使用项目专用存储名；没有原记录时读取为空且不写入', () => {
  assert.equal(typeof FAVORITES_KEY, 'string');
  assert.ok(FAVORITES_KEY.trim().length > 0);
  assert.notEqual(FAVORITES_KEY, 'favorites');
  const store = memory();
  assert.deepEqual(readFavorites(validIds, store.getStorage), success([]));
  assert.deepEqual(store.writes, []);
  assert.equal(store.entries.has(FAVORITES_KEY), false);
});

test('收藏、重新创建访问入口、取消后再次读取，状态均保留', () => {
  const store = memory();
  assert.deepEqual(saveFavorite(validIds, 'recipe-001', true, store.getStorage), success(['recipe-001']));
  const reopen = () => ({ ...store.storage });
  assert.deepEqual(readFavorites(validIds, reopen), success(['recipe-001']));
  assert.deepEqual(saveFavorite(validIds, 'recipe-001', false, reopen), success([]));
  assert.deepEqual(readFavorites(validIds, () => ({ ...store.storage })), success([]));
  assert.deepEqual(JSON.parse(store.entries.get(FAVORITES_KEY)), []);
  assert.deepEqual(validIds, ['recipe-001', 'recipe-002']);
});

test('读取去重但不主动改原记录，重复收藏不产生重复 ID', () => {
  const raw = '["recipe-001","recipe-001"]';
  const store = memory({ [FAVORITES_KEY]: raw });
  assert.deepEqual(readFavorites(validIds, store.getStorage), success(['recipe-001']));
  assert.equal(store.entries.get(FAVORITES_KEY), raw);
  assert.deepEqual(store.writes, []);
  for (let count = 0; count < 2; count++) {
    assert.deepEqual(saveFavorite(validIds, 'recipe-001', true, store.getStorage), success(['recipe-001']));
  }
  assert.deepEqual(JSON.parse(store.entries.get(FAVORITES_KEY)), ['recipe-001']);
});

test('损坏 JSON、非数组、非字符串元素或未知 ID 均保留原文并禁止写入', () => {
  const invalidRecords = ['{broken', '', 'null', '{}', '42', 'true', '"recipe-001"',
    '[1]', '[null]', '[{}]', '[""]', '["unknown-id"]', '["recipe-001","unknown-id"]'];
  for (const raw of invalidRecords) {
    const store = memory({ [FAVORITES_KEY]: raw });
    assertFailure(readFavorites(validIds, store.getStorage), 'read');
    for (const shouldSave of [true, false]) {
      assertFailure(saveFavorite(validIds, 'recipe-001', shouldSave, store.getStorage), 'read');
    }
    assert.equal(store.entries.get(FAVORITES_KEY), raw);
    assert.deepEqual(store.writes, []);
  }
});

test('访问存储抛错时安全报告读取失败', () => {
  const blocked = () => { throw new Error('浏览器禁止访问存储'); };
  assertFailure(readFavorites(validIds, blocked), 'read');
  assertFailure(saveFavorite(validIds, 'recipe-001', true, blocked), 'read');
});

test('getItem 抛错时不继续 setItem，也不伪装成空收藏', () => {
  let writes = 0;
  const getStorage = () => ({
    getItem() { throw new Error('读取失败'); },
    setItem() { writes++; },
  });
  assertFailure(readFavorites(validIds, getStorage), 'read');
  assertFailure(saveFavorite(validIds, 'recipe-001', false, getStorage), 'read');
  assert.equal(writes, 0);
});

test('收藏或取消写入失败不返回新状态，原记录保留且可重试', () => {
  for (const shouldSave of [true, false]) {
    const initialIds = shouldSave ? [] : ['recipe-001'];
    const original = JSON.stringify(initialIds);
    const store = memory({ [FAVORITES_KEY]: original });
    const workingSetItem = store.storage.setItem;
    store.storage.setItem = () => { throw new Error('保存失败'); };
    assertFailure(saveFavorite(validIds, 'recipe-001', shouldSave, store.getStorage), 'write');
    assert.equal(store.entries.get(FAVORITES_KEY), original);
    assert.deepEqual(readFavorites(validIds, store.getStorage), success(initialIds));
    store.storage.setItem = workingSetItem;
    const expected = shouldSave ? ['recipe-001'] : [];
    assert.deepEqual(saveFavorite(validIds, 'recipe-001', shouldSave, store.getStorage), success(expected));
    assert.deepEqual(readFavorites(validIds, store.getStorage), success(expected));
  }
});

test('每次保存重新读取最新记录，不覆盖其他收藏或其他项目的 key', () => {
  const store = memory({ otherProject: 'keep me', settings: '{"theme":"light"}' });
  readFavorites(validIds, store.getStorage);
  store.entries.set(FAVORITES_KEY, '["recipe-002"]');
  const added = saveFavorite(validIds, 'recipe-001', true, store.getStorage);
  assert.equal(added.ok, true);
  assert.deepEqual([...added.ids].sort(), [...validIds].sort());
  assert.deepEqual(saveFavorite(validIds, 'recipe-001', false, store.getStorage), success(['recipe-002']));
  assert.equal(store.entries.get('otherProject'), 'keep me');
  assert.equal(store.entries.get('settings'), '{"theme":"light"}');
  assert.ok(store.writes.every(([key]) => key === FAVORITES_KEY));
  assert.deepEqual(validIds, ['recipe-001', 'recipe-002']);
});
