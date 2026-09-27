import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAVORITES_KEY } from '../favorites.mjs';

const data = JSON.parse(readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));

// 只模拟本应用用到的 DOM；不验证浏览器布局、可访问性或实际网络。
class MemoryNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.listeners = {}; this.className = ''; this.checked = false; this.disabled = false;
  }
  get textContent() { return (this.text ?? '') + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...nodes) {
    for (let node of nodes) {
      if (typeof node === 'string') { const text = node; node = new MemoryNode('#text'); node.textContent = text; }
      node.parentNode = this; this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.text = ''; this.children = []; this.append(...nodes); }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  emit(type, target = this) {
    for (const listener of this.listeners[type] ?? []) listener({ type, target, currentTarget: this });
    this.parentNode?.emit(type, target);
  }
  click() { if (!this.disabled) this.emit('click'); }
  focus() { globalThis.document.activeElement = this; }
  scrollIntoView() {}
  setAttribute(name, value) { this[name === 'class' ? 'className' : name] = String(value); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.descendants()]);
    return descendants.filter((node) => {
      if (selector.startsWith('#')) return node.id === selector.slice(1);
      if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
      const match = selector.match(/^(\w+)(?:\[name="([^"]+)"\])?(:checked)?$/);
      assert.ok(match, `模拟 DOM 不支持的选择器：${selector}`);
      return node.tagName === match[1].toUpperCase() && (!match[2] || node.name === match[2]) && (!match[3] || node.checked);
    });
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
}

function makeDocument() {
  const document = new MemoryNode('document');
  document.createElement = (tag) => new MemoryNode(tag);
  document.createTextNode = (text) => { const node = new MemoryNode('#text'); node.textContent = text; return node; };
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const add = (tag, id, parent = document) => { const node = new MemoryNode(tag); node.id = id; parent.append(node); return node; };
  const filters = add('section', 'recipe-filters');
  for (const id of ['main-ingredients', 'seasonings']) {
    const group = add('fieldset', '', filters); group.disabled = true; add('div', id, group);
  }
  const difficulty = add('fieldset', '', filters); difficulty.disabled = true;
  for (const value of ['all', '简单', '普通']) {
    const input = add('input', '', difficulty);
    Object.assign(input, { type: 'radio', name: 'difficulty', value, checked: value === 'all' });
  }
  add('button', 'recommend-button', filters).disabled = true;
  for (const id of ['recipe-list', 'results-note', 'results-heading', 'preview-notice']) add('div', id);
  const section = add('section', 'recipe-detail');
  add('h2', 'detail-heading', section); add('div', 'recipe-detail-content', section);
  const favorites = add('section', 'favorites');
  add('h2', 'favorites-heading', favorites);
  add('p', 'favorites-status', favorites);
  add('button', 'favorites-retry', favorites).hidden = true;
  add('div', 'favorites-list', favorites);
  return document;
}

function makeStorage(raw = null) {
  const entries = new Map(raw === null ? [] : [[FAVORITES_KEY, raw]]);
  return {
    entries, failWrite: false,
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) {
      if (this.failWrite) throw new Error('模拟保存失败');
      entries.set(key, value);
    },
  };
}

test('真实 app.js 的详情与收藏连接（仅内存 DOM 和存储）', async (t) => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    Object.assign(globalThis, previous);
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });
  let bootCount = 0;
  const boot = async (storage) => {
    const document = makeDocument();
    globalThis.document = document;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(data) });
    await import(`../app.js?test=${++bootCount}`);
    await new Promise(setImmediate);
    const byId = (id) => document.getElementById(id);
    assert.equal(byId('recommend-button').disabled, false);
    const choose = (names) => {
      for (const input of byId('recipe-filters').querySelectorAll('input[name="main-ingredient"]')) input.checked = names.includes(input.value);
      byId('recipe-filters').emit('change');
    };
    const open = (recipe) => {
      byId('recommend-button').click();
      const card = byId('recipe-list').children.find((node) => node.dataset.recipeId === recipe.id);
      assert.ok(card, `应推荐 ${recipe.name}`);
      const button = card.querySelector('button'); assert.equal(button.disabled, false); button.click();
      return card;
    };
    return { byId, choose, open };
  };
  const storage = makeStorage();
  const { byId, choose, open } = await boot(storage);
  const detail = byId('recipe-detail-content');
  assert.match(byId('favorites-list').textContent, /还没有收藏的菜/);
  const assertCleared = () => {
    assert.ok(detail.textContent.trim(), '清空详情后仍应有占位提示');
    assert.equal(detail.dataset.recipeId, undefined);
    for (const recipe of data.recipes) assert.ok(!detail.textContent.includes(recipe.steps[0]));
    assert.equal(detail.querySelector('button'), null);
  };

  for (const recipe of data.recipes) await t.test(`${recipe.name}：完整原文资料、缺料和收藏入口`, () => {
    choose(recipe.mainIngredients.slice(0, Math.max(1, recipe.mainIngredients.length - 2)).map(({ name }) => name));
    const card = open(recipe);
    const text = detail.textContent;
    assert.equal(detail.dataset.recipeId, recipe.id);
    assert.deepEqual(detail.querySelector('ol').children.map((step) => step.textContent), recipe.steps);
    for (const value of [recipe.name, recipe.difficulty, '主要食材', '调料', ...recipe.steps, ...data.notes, ...data.safetyNotes]) {
      assert.ok(text.includes(value), `详情应包含：${value}`);
    }
    for (const material of [...recipe.mainIngredients, ...recipe.seasonings]) {
      assert.ok(text.includes(`${material.name}：${material.amount}`), `缺少材料及用量 ${material.name}`);
    }
    if (recipe.difficultyReason) assert.ok(text.includes(recipe.difficultyReason));
    for (const line of card.querySelector('.missing-summary').children) assert.ok(text.includes(line.textContent));
    const favorite = detail.querySelector('button');
    assert.equal(favorite.textContent, '收藏'); assert.equal(favorite.disabled, false);
  });

  await t.test('主要食材全有但调料不足时，详情不混淆两组状态', () => {
    choose(data.recipes[0].mainIngredients.map(({ name }) => name)); open(data.recipes[0]);
    assert.match(detail.textContent, /主要食材齐全/);
    assert.match(detail.textContent, /缺少调料/);
    assert.ok(!detail.textContent.includes('调料齐全'));
  });
  await t.test('修改条件清空旧详情和旧推荐', () => {
    choose(['番茄']);
    assertCleared(); assert.equal(byId('recipe-list').children.length, 0);
  });
  await t.test('重新推荐也清空旧详情', () => {
    open(data.recipes[0]); byId('recommend-button').click(); assertCleared();
  });
  await t.test('无主要食材时不保留上一次详情', () => {
    open(data.recipes[0]); choose([]); byId('recommend-button').click(); assertCleared();
    assert.equal(byId('recipe-list').children.length, 0);
  });

  await t.test('收藏成功后列表与详情同步，多次查看不重复添加', () => {
    choose(['番茄']); open(data.recipes[0]); detail.querySelector('button').click();
    assert.deepEqual(JSON.parse(storage.entries.get(FAVORITES_KEY)), ['recipe-001']);
    assert.equal(detail.querySelector('button').textContent, '取消收藏');
    open(data.recipes[0]); open(data.recipes[0]);
    assert.equal(byId('favorites-list').querySelectorAll('article').length, 1);
  });
  await t.test('筛选不隐藏收藏；无有效条件时从收藏查看不虚构齐全或缺料', () => {
    choose(['土豆']); byId('recommend-button').click();
    assert.equal(byId('favorites-list').querySelectorAll('article').length, 1);
    byId('favorites-list').querySelector('button').click();
    assert.match(detail.querySelector('.missing-summary').textContent, /缺少 2 种主要食材：番茄、鸡蛋/);
    choose([]); byId('favorites-list').querySelector('button').click();
    assert.equal(detail.querySelector('.missing-summary'), null);
    assert.ok(!detail.textContent.includes('齐全'));
    assert.equal(detail.dataset.recipeId, 'recipe-001');
  });
  await t.test('从收藏列表取消时同步详情，原菜品仍可推荐', () => {
    byId('favorites-list').querySelectorAll('button')[1].click();
    assert.equal(detail.querySelector('button').textContent, '收藏');
    assert.match(byId('favorites-list').textContent, /还没有收藏的菜/);
    assert.deepEqual(JSON.parse(storage.entries.get(FAVORITES_KEY)), []);
    choose(['番茄']); assert.ok(open(data.recipes[0]));
  });
  await t.test('模拟重新打开后保留收藏，取消后再次打开仍为空', async () => {
    detail.querySelector('button').click();
    const reopened = await boot(storage);
    assert.equal(reopened.byId('favorites-list').querySelectorAll('article').length, 1);
    reopened.byId('favorites-list').querySelector('button').click();
    const reopenedDetail = reopened.byId('recipe-detail-content');
    assert.equal(reopenedDetail.querySelector('.missing-summary'), null);
    assert.equal(reopenedDetail.querySelector('button').textContent, '取消收藏');
    reopenedDetail.querySelector('button').click();
    const again = await boot(storage);
    assert.match(again.byId('favorites-list').textContent, /还没有收藏的菜/);
  });
  await t.test('收藏和取消保存失败保留原状态，重试成功后才同步', async () => {
    const failing = makeStorage(); failing.failWrite = true;
    const page = await boot(failing);
    page.choose(['番茄']); page.open(data.recipes[0]);
    const button = page.byId('recipe-detail-content').querySelector('button');
    const retry = page.byId('favorites-retry');
    button.click();
    assert.equal(button.textContent, '收藏');
    assert.equal(failing.getItem(FAVORITES_KEY), null);
    assert.match(page.byId('favorites-status').textContent, /保存失败/);
    assert.equal(retry.hidden, false);
    failing.failWrite = false; retry.click();
    assert.equal(button.textContent, '取消收藏');
    assert.equal(retry.hidden, true);
    failing.failWrite = true; button.click();
    assert.equal(button.textContent, '取消收藏');
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 1);
    assert.match(page.byId('favorites-status').textContent, /保存失败/);
    failing.failWrite = false; retry.click();
    assert.equal(button.textContent, '收藏');
    assert.deepEqual(JSON.parse(failing.getItem(FAVORITES_KEY)), []);
    assert.match(page.byId('favorites-list').textContent, /还没有收藏的菜/);
  });
  await t.test('原记录损坏时不当成空收藏；恢复记录后可重试读取', async () => {
    const damaged = makeStorage('{broken');
    const page = await boot(damaged);
    assert.match(page.byId('favorites-status').textContent, /读取失败/);
    assert.ok(!page.byId('favorites-list').textContent.includes('还没有收藏'));
    page.choose(['番茄']); page.open(data.recipes[0]);
    assert.equal(page.byId('recipe-detail-content').querySelector('button').disabled, true);
    assert.equal(damaged.getItem(FAVORITES_KEY), '{broken');
    damaged.entries.set(FAVORITES_KEY, '["recipe-001"]');
    page.byId('favorites-retry').click();
    assert.equal(page.byId('recipe-detail-content').querySelector('button').textContent, '取消收藏');
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 1);
    assert.equal(page.byId('favorites-retry').hidden, true);
  });
});

test('菜品加载失败时食材区不再停留在加载中', async (t) => {
  const scenarios = [
    { name: '请求被拒绝', id: 'rejected', fetch: async () => { throw new Error('模拟网络失败'); } },
    { name: 'HTTP 返回失败', id: 'http', fetch: async () => ({ ok: false, status: 503 }) },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    const descriptors = Object.fromEntries(['document', 'fetch', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const previousConsoleError = console.error;
    t.after(() => {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      console.error = previousConsoleError;
    });
    const document = makeDocument();
    const byId = (id) => document.getElementById(id);
    byId('main-ingredients').textContent = '正在加载主要食材……';
    byId('seasonings').textContent = '正在加载调料……';
    globalThis.document = document;
    globalThis.fetch = scenario.fetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: makeStorage() });
    console.error = () => {};

    await import(`../app.js?day8-load-error=${scenario.id}`);
    await new Promise(setImmediate);

    assert.equal(byId('main-ingredients').textContent, '主要食材未能加载，请刷新页面重试。');
    assert.equal(byId('seasonings').textContent, '调料未能加载，请刷新页面重试。');
    for (const id of ['main-ingredients', 'seasonings']) assert.ok(!byId(id).textContent.includes('正在加载'));
    assert.equal(byId('preview-notice').hidden, false);
    assert.match(byId('preview-notice').textContent, /菜品资料未能加载/);
    assert.ok(byId('recipe-filters').querySelectorAll('fieldset').every((fieldset) => fieldset.disabled));
    assert.equal(byId('recommend-button').disabled, true);
  });
});
