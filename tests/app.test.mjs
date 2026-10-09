import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { recommendRecipes, getRecipeAvailability } from '../recommendations.mjs';
import { FAVORITES_KEY, readFavorites, saveFavorite } from '../favorites.mjs';
import { API_BASE_URL, loadRecipeData } from '../recipe-data.mjs';

// 原四道已审核资料只作回归测试 fixture，应用加载仍经过真实的两读接口适配器。
const data = JSON.parse(readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appUrl = new URL('../app.js', import.meta.url);

function makeApiData(source) {
  const recipes = source.recipes.map((recipe) => ({
    id: recipe.id, name: recipe.name, difficulty: recipe.difficulty, steps: recipe.steps,
    difficulty_reason: recipe.difficultyReason ?? null,
    notes: recipe.notes ?? source.notes, safety_notes: recipe.safetyNotes ?? source.safetyNotes,
  }));
  const materials = source.recipes.flatMap((recipe) => [
    ...recipe.mainIngredients.map((material, index) => ({
      recipe_id: recipe.id, ...material, material_type: 'main', position: index + 1,
    })),
    ...recipe.seasonings.map((material, index) => ({
      recipe_id: recipe.id, ...material, material_type: 'seasoning', position: index + 1,
    })),
  ]);
  return { recipes, materials };
}

const apiData = makeApiData(data);
const apiPaths = ['/api/recipes', '/api/recipe-materials'];
const apiUrls = apiPaths.map((path) => `${API_BASE_URL}${path}`);
const requestUrl = (request) => new URL(String(request));
const responseRows = (request, fixture = apiData) => {
  const path = requestUrl(request).pathname;
  assert.ok(apiPaths.includes(path), `只应请求两条读接口，实际请求：${path}`);
  return path === '/api/recipes' ? fixture.recipes : fixture.materials;
};
const successfulResponse = (request, fixture = apiData) => ({
  ok: true, json: async () => ({ ok: true, data: structuredClone(responseRows(request, fixture)) }),
});
const successfulFetch = async (request) => successfulResponse(request);

// 从已审核且已入库的 SQL 提取五道原文；测试不新增或修改菜品资料。
function readSeedFixture() {
  const sql = readFileSync(new URL('../seed.sql', import.meta.url), 'utf8');
  const notes = sql.match(/SELECT '(\[[^']*\])'::jsonb AS notes,/);
  const safetyNotes = sql.match(/'(\[[^']*\])'::jsonb AS safety_notes/);
  assert.ok(notes && safetyNotes, 'seed.sql 应有原文说明和安全提醒');
  const recipes = [...sql.matchAll(/\('(recipe-\d+)', '([^']+)', '(简单|普通)', '(\[[^']*\])'::jsonb, (NULL::text|'([^']*)')\)/g)]
    .map(([, id, name, difficulty, steps, , reason]) => ({
      id, name, difficulty, steps: JSON.parse(steps), difficulty_reason: reason ?? null,
      notes: JSON.parse(notes[1]), safety_notes: JSON.parse(safetyNotes[1]),
    }));
  const materials = [...sql.matchAll(/^\s*\('(recipe-\d+)', '([^']+)', '(main|seasoning)', '([^']+)', (\d+)\)[,;]?\s*$/gm)]
    .map(([, recipe_id, name, material_type, amount, position]) => ({
      recipe_id, name, material_type, amount, position: Number(position),
    }));
  assert.equal(recipes.length, 5, '本板块使用已审核的五道 seed 菜品');
  assert.equal(materials.length, 25, '五道 seed 菜品应包含全部原材料与调料');
  return { recipes, materials };
}

const seedApiData = readSeedFixture();

function applicationScript(dev = false) {
  const script = readFileSync(appUrl, 'utf8')
    .replace(/^import \{ recommendRecipes, getRecipeAvailability \} from "\.\/recommendations\.mjs";\r?\n/m, '')
    .replace(/^import \{ readFavorites, saveFavorite \} from "\.\/favorites\.mjs";\r?\n/m, '')
    .replace(/^import \{ loadRecipeData \} from "\.\/recipe-data\.mjs";\r?\n/m, '')
    .replaceAll('import.meta.env?.DEV', String(dev))
    .replaceAll('import.meta.url', JSON.stringify(appUrl.href));
  assert.ok(!/^import /m.test(script), '模拟执行只应移除三条已知模块 import');
  return script;
}

// 加载占位内容取自真实 HTML，避免模拟页面自行填对文案而漏掉页面错误。
function initialHtmlElement(id) {
  const match = indexHtml.match(new RegExp(`<([a-z][a-z0-9]*)\\b([^>]*\\bid="${id}"[^>]*)>([\\s\\S]*?)<\\/\\1>`, 'i'));
  assert.ok(match, `index.html 应包含 #${id}`);
  return { tag: match[1], attributes: match[2], text: match[3].replace(/<[^>]*>/g, '').trim() };
}

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
  emit(type, target = this, init = {}) {
    const event = {
      type, target, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init,
    };
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const listener of node.listeners[type] ?? []) listener(event);
    }
    return event;
  }
  click(init = {}) {
    if (this.disabled) return;
    const event = this.emit('click', this, init);
    if (this.tagName === 'A' && this.href?.startsWith('#') && !event.defaultPrevented
      && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      globalThis.window.location.hash = this.href;
    }
    return event;
  }
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
  add('a', 'skip-link').href = '#main';
  add('a', 'nav-home').href = '#home';
  add('a', 'nav-favorites').href = '#favorites';
  const main = add('main', 'main');
  add('p', 'route-note', main).hidden = true;
  add('div', 'preview-notice', main).textContent = initialHtmlElement('preview-notice').text;
  add('p', 'data-source-note', main).textContent = initialHtmlElement('data-source-note').text;
  const statePreview = add('div', 'state-preview-notice', main);
  statePreview.hidden = /\bhidden(?:\s|=|$)/.test(initialHtmlElement('state-preview-notice').attributes);
  const stateTextHtml = initialHtmlElement('state-preview-text');
  add(stateTextHtml.tag, 'state-preview-text', statePreview).textContent = stateTextHtml.text;
  const exitPreview = add('a', 'exit-state-preview', statePreview);
  const exitHtml = initialHtmlElement('exit-state-preview');
  exitPreview.textContent = exitHtml.text;
  exitPreview.href = exitHtml.attributes.match(/\bhref="([^"]*)"/)?.[1] ?? '';
  const home = add('section', 'home-view', main);
  add('h1', 'page-title', home);
  const filters = add('section', 'recipe-filters', home);
  for (const id of ['main-ingredients', 'seasonings']) {
    const group = add('fieldset', '', filters); group.disabled = true;
    add('div', id, group).textContent = initialHtmlElement(id).text;
  }
  const difficulty = add('fieldset', '', filters); difficulty.disabled = true;
  for (const value of ['all', '简单', '普通']) {
    const input = add('input', '', difficulty);
    Object.assign(input, { type: 'radio', name: 'difficulty', value, checked: value === 'all' });
  }
  add('button', 'recommend-button', filters).disabled = true;
  add('button', 'clear-filters-button', filters).disabled = true;
  for (const id of ['recipe-list', 'results-note', 'results-heading']) add('div', id, home);
  document.getElementById('results-note').textContent = initialHtmlElement('results-note').text;
  const section = add('section', 'recipe-detail', main); section.hidden = true;
  add('button', 'detail-back', section);
  add('h2', 'detail-heading', section);
  add('div', 'recipe-detail-content', section).textContent = initialHtmlElement('recipe-detail-content').text;
  add('p', 'detail-favorites-status', section);
  add('button', 'detail-favorites-retry', section).hidden = true;
  const favorites = add('section', 'favorites', main); favorites.hidden = true;
  add('h2', 'favorites-heading', favorites);
  add('p', 'favorites-status', favorites).textContent = initialHtmlElement('favorites-status').text;
  add('button', 'favorites-retry', favorites).hidden = true;
  add('div', 'favorites-list', favorites);
  return document;
}

// hash 赋值创建历史条目，replaceState 只替换当前条目；回退/前进恢复该条目的来源。
// hashchange 与浏览器一样延后派发，让同步导航和随后的地址事件都经过真实 app.js。
function makeWindow(initialHash = '', initialState = null, initialUrl = 'http://localhost/') {
  const address = new URL(initialUrl);
  const normalize = (value) => value ? `#${String(value).replace(/^#/, '')}` : '';
  const entries = [{ hash: normalize(initialHash), state: structuredClone(initialState) }];
  const listeners = new Map();
  let index = 0;
  const dispatchHashChange = (oldHash, newHash) => {
    if (oldHash === newHash) return;
    queueMicrotask(() => {
      const event = { type: 'hashchange', oldURL: `http://localhost/${oldHash}`, newURL: `http://localhost/${newHash}` };
      for (const listener of listeners.get('hashchange') ?? []) listener(event);
    });
  };
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    location: {
      hostname: address.hostname,
      origin: address.origin,
      pathname: address.pathname,
      search: address.search,
      get href() { return `${address.origin}${address.pathname}${address.search}${entries[index].hash}`; },
      get hash() { return entries[index].hash; },
      set hash(value) {
        const hash = normalize(value);
        const previous = entries[index].hash;
        if (hash === previous) return;
        entries.splice(index + 1, entries.length, { hash, state: null });
        index++;
        dispatchHashChange(previous, hash);
      },
    },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      replaceState(state, _title, hash = entries[index].hash) {
        entries[index] = { hash: normalize(hash), state: structuredClone(state) };
      },
      go(delta) {
        const target = index + delta;
        if (target < 0 || target >= entries.length || target === index) return;
        const previous = entries[index].hash;
        index = target;
        dispatchHashChange(previous, entries[index].hash);
      },
      back() { this.go(-1); },
      forward() { this.go(1); },
    },
  };
  return window;
}

function assertView(page, expected) {
  const views = ['home-view', 'recipe-detail', 'favorites'];
  assert.deepEqual(views.filter((id) => page.byId(id).hidden !== true), [expected]);
}

function assertVisible(node) {
  assert.ok(node, '应存在可见节点');
  for (let current = node; current; current = current.parentNode) {
    assert.notEqual(current.hidden, true, `${current.id || current.tagName} 不应被隐藏`);
  }
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

// 实际执行 app.js 与加载适配器；只把外部 HTTP 换成可观测的两 API 模拟。
async function bootApiPage(storage, {
  dev = false, url = 'http://localhost/', fixture = apiData, respond,
} = {}) {
  await new Promise(setImmediate);
  const address = new URL(url);
  const document = makeDocument();
  const window = makeWindow(address.hash, null, address.href);
  globalThis.document = document;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  const calls = { requests: [], reads: [], writes: [] };
  const observedStorage = {
    getItem(key) { calls.reads.push(key); return storage.getItem(key); },
    setItem(key, value) { calls.writes.push([key, value]); storage.setItem(key, value); },
  };
  const mockFetch = async (request, options) => {
    const requestHref = requestUrl(request).href;
    assert.ok(apiUrls.includes(requestHref), `应用只可读取已知云端接口：${requestHref}`);
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.body, undefined);
    calls.requests.push(requestHref);
    return respond ? respond(request, options) : successfulResponse(request, fixture);
  };
  await runInNewContext(applicationScript(dev), {
    document, window, URL, URLSearchParams, recommendRecipes, getRecipeAvailability,
    readFavorites: (validIds) => readFavorites(validIds, () => observedStorage),
    saveFavorite: (validIds, id, shouldSave) => saveFavorite(validIds, id, shouldSave, () => observedStorage),
    loadRecipeData: () => loadRecipeData(mockFetch), fetch: mockFetch,
    console: { error() {} },
  }, { filename: appUrl.pathname });
  await new Promise(setImmediate);
  const byId = (id) => document.getElementById(id);
  const choose = (names) => {
    for (const input of byId('recipe-filters').querySelectorAll('input[name="main-ingredient"]')) input.checked = names.includes(input.value);
    byId('recipe-filters').emit('change');
  };
  return { document, window, calls, choose, byId };
}

test('真实 app.js 的详情与收藏连接（仅内存 DOM 和存储）', async (t) => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    Object.assign(globalThis, previous);
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else delete globalThis.window;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });
  let bootCount = 0;
  const boot = async (storage, { hash = '', state = null } = {}) => {
    // 换全局页面前排空旧页面排队的地址事件，避免旧监听器读取到新 window。
    await new Promise(setImmediate);
    const document = makeDocument();
    const window = makeWindow(hash, state);
    globalThis.document = document;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    globalThis.fetch = successfulFetch;
    await import(`../app.js?test=${++bootCount}`);
    await new Promise(setImmediate);
    const byId = (id) => document.getElementById(id);
    assert.equal(byId('recommend-button').disabled, false);
    assert.equal(byId('clear-filters-button').disabled, false);
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
    return { byId, choose, open, document, window };
  };
  const assertTomatoResults = (page) => {
    const cards = page.byId('recipe-list').children;
    assert.deepEqual(cards.map((card) => card.querySelector('h3').textContent), ['番茄炒蛋', '番茄鸡蛋炖豆腐']);
    assert.deepEqual(cards.map((card) => card.querySelector('.missing-summary').children.map((line) => line.textContent)), [
      ['缺少 1 种主要食材：鸡蛋', '缺少调料：食用油、盐'],
      ['缺少 2 种主要食材：北豆腐、鸡蛋', '缺少调料：食用油、盐、生抽'],
    ]);
    assert.match(page.byId('results-note').textContent, /^找到 2 道菜：/);
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
    const favorite = detail.querySelector('.detail-favorite');
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
    choose(['番茄']); open(data.recipes[0]); detail.querySelector('.detail-favorite').click();
    assert.deepEqual(JSON.parse(storage.entries.get(FAVORITES_KEY)), ['recipe-001']);
    assert.equal(detail.querySelector('.detail-favorite').textContent, '取消收藏');
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
    assert.equal(detail.querySelector('.detail-favorite').textContent, '收藏');
    assert.match(byId('favorites-list').textContent, /还没有收藏的菜/);
    assert.deepEqual(JSON.parse(storage.entries.get(FAVORITES_KEY)), []);
    choose(['番茄']); assert.ok(open(data.recipes[0]));
  });
  await t.test('模拟重新打开后保留收藏，取消后再次打开仍为空', async () => {
    detail.querySelector('.detail-favorite').click();
    const reopened = await boot(storage);
    assert.equal(reopened.byId('favorites-list').querySelectorAll('article').length, 1);
    reopened.byId('favorites-list').querySelector('button').click();
    const reopenedDetail = reopened.byId('recipe-detail-content');
    assert.equal(reopenedDetail.querySelector('.missing-summary'), null);
    assert.equal(reopenedDetail.querySelector('.detail-favorite').textContent, '取消收藏');
    reopenedDetail.querySelector('.detail-favorite').click();
    const again = await boot(storage);
    assert.match(again.byId('favorites-list').textContent, /还没有收藏的菜/);
  });
  await t.test('收藏和取消保存失败保留原状态，重试成功后才同步', async () => {
    const failing = makeStorage(); failing.failWrite = true;
    const page = await boot(failing);
    page.choose(['番茄']); page.open(data.recipes[0]);
    const button = page.byId('recipe-detail-content').querySelector('.detail-favorite');
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
    assert.equal(page.byId('recipe-detail-content').querySelector('.detail-favorite').disabled, true);
    assert.equal(damaged.getItem(FAVORITES_KEY), '{broken');
    damaged.entries.set(FAVORITES_KEY, '["recipe-001"]');
    page.byId('favorites-retry').click();
    assert.equal(page.byId('recipe-detail-content').querySelector('.detail-favorite').textContent, '取消收藏');
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 1);
    assert.equal(page.byId('favorites-retry').hidden, true);
  });
  await t.test('仅勾选盐就提醒缺少主要食材，推荐按钮仍可点击', async () => {
    const page = await boot(makeStorage());
    const salt = page.byId('seasonings').querySelectorAll('input').find((input) => input.value === '盐');
    assert.ok(salt);
    salt.checked = true; salt.emit('change');

    assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材；只选择调料还不能推荐。');
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(page.byId('recommend-button').disabled, false);
    page.byId('recommend-button').click();
    assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材；只选择调料还不能推荐。');
    assert.equal(page.byId('recipe-list').children.length, 0);
  });
  await t.test('仅选盐后再选番茄恢复重新推荐提示，推荐和详情仍正常', async () => {
    const page = await boot(makeStorage());
    const salt = page.byId('seasonings').querySelectorAll('input').find((input) => input.value === '盐');
    assert.ok(salt);
    salt.checked = true; salt.emit('change');
    assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材；只选择调料还不能推荐。');

    page.choose(['番茄']);
    assert.equal(page.byId('results-note').textContent, '条件已修改，请点击“看看能做什么”重新推荐。');
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(page.byId('recommend-button').disabled, false);
    page.open(data.recipes[0]);
    assert.match(page.byId('results-note').textContent, /找到 \d+ 道菜/);
    assert.equal(page.byId('recipe-detail-content').dataset.recipeId, data.recipes[0].id);
    assert.deepEqual(page.byId('recipe-detail-content').querySelector('ol').children.map((step) => step.textContent), data.recipes[0].steps);
  });
  await t.test('取消最后一个主要食材立即提醒，并清空旧推荐和详情', async () => {
    const page = await boot(makeStorage());
    page.choose(['番茄']); page.open(data.recipes[0]);
    assert.ok(page.byId('recipe-list').children.length > 0);
    const currentDetail = page.byId('recipe-detail-content');
    assert.equal(currentDetail.dataset.recipeId, data.recipes[0].id);

    page.choose([]);
    assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材；只选择调料还不能推荐。');
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(currentDetail.dataset.recipeId, undefined);
    assert.equal(currentDetail.textContent, '条件已修改，请重新推荐后查看菜品详情。');
    assert.equal(currentDetail.querySelector('button'), null);
    assert.equal(page.byId('recommend-button').disabled, false);
  });
  await t.test('无主要食材时只修改难度也立即显示选材提醒', async () => {
    const page = await boot(makeStorage());
    const choices = page.byId('recipe-filters').querySelectorAll('input[name="difficulty"]');
    for (const input of choices) input.checked = input.value === '简单';
    choices.find((input) => input.checked).emit('change');

    assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材；只选择调料还不能推荐。');
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(page.byId('recommend-button').disabled, false);
  });
  await t.test('筛选有结果：只选番茄时按顺序显示两道菜及各自缺料', async () => {
    const page = await boot(makeStorage());
    page.choose(['番茄']);
    assert.equal(page.byId('recipe-list').children.length, 0, '修改条件本身不生成推荐');
    page.byId('recommend-button').click();
    assertTomatoResults(page);
  });
  await t.test('筛选无结果：土豆与普通组合有明确提示且不残留旧结果和详情', async () => {
    const page = await boot(makeStorage());
    page.choose(['番茄']); page.open(data.recipes[0]);
    assert.equal(page.byId('recipe-detail-content').dataset.recipeId, 'recipe-001');

    page.choose(['土豆']);
    const difficulty = page.byId('recipe-filters').querySelectorAll('input[name="difficulty"]');
    for (const input of difficulty) input.checked = input.value === '普通';
    difficulty.find((input) => input.checked).emit('change');
    assert.equal(page.byId('recipe-list').children.length, 0);
    page.byId('recommend-button').click();

    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(page.byId('results-note').textContent, '当前条件没有符合的菜，请调整主要食材或制作难度。');
    const currentDetail = page.byId('recipe-detail-content');
    assert.equal(currentDetail.dataset.recipeId, undefined);
    assert.equal(currentDetail.textContent, '请从推荐结果或收藏中选择一道菜，查看完整材料和做法。');
    assert.equal(currentDetail.querySelector('button'), null);
    assert.equal(currentDetail.querySelector('.missing-summary'), null);
  });
  await t.test('一键清空恢复：重置全部条件和详情，保留收藏，重复清空后仍可重新推荐', async () => {
    const isolatedStorage = makeStorage('["recipe-003"]');
    isolatedStorage.entries.set('unrelated-site-setting', 'keep');
    const writes = [];
    const setItem = isolatedStorage.setItem;
    isolatedStorage.setItem = function (key, value) { writes.push([key, value]); setItem.call(this, key, value); };
    const page = await boot(isolatedStorage);
    const recipe = data.recipes.find((item) => item.id === 'recipe-003');
    page.choose(['番茄']);
    const salt = page.byId('seasonings').querySelectorAll('input').find((input) => input.value === '盐');
    salt.checked = true; salt.emit('change');
    const difficulty = page.byId('recipe-filters').querySelectorAll('input[name="difficulty"]');
    for (const input of difficulty) input.checked = input.value === '普通';
    difficulty.find((input) => input.checked).emit('change');
    page.open(recipe);
    assert.deepEqual(page.byId('recipe-list').children.map((card) => card.dataset.recipeId), ['recipe-003']);
    const currentDetail = page.byId('recipe-detail-content');
    assert.equal(currentDetail.dataset.recipeId, 'recipe-003');
    assert.match(currentDetail.querySelector('.missing-summary').textContent, /缺少 2 种主要食材：北豆腐、鸡蛋/);

    const savedEntries = [...isolatedStorage.entries];
    const favoriteNodes = page.byId('favorites-list').descendants();
    const favoriteStatus = page.byId('favorites-status').textContent;
    const retryHidden = page.byId('favorites-retry').hidden;
    for (let click = 0; click < 3; click++) {
      page.byId('clear-filters-button').click();
      for (const name of ['main-ingredient', 'seasoning']) {
        assert.equal(page.byId('recipe-filters').querySelectorAll(`input[name="${name}"]:checked`).length, 0);
      }
      assert.deepEqual(difficulty.filter((input) => input.checked).map((input) => input.value), ['all']);
      assert.equal(page.byId('recipe-list').children.length, 0);
      assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材，再点击“看看能做什么”。');
      assert.equal(currentDetail.dataset.recipeId, undefined);
      assert.equal(currentDetail.textContent, '请从推荐结果或收藏中选择一道菜，查看完整材料和做法。');
      assert.equal(currentDetail.querySelector('button'), null);
      assert.deepEqual(page.byId('favorites-list').descendants(), favoriteNodes);
      assert.equal(page.byId('favorites-status').textContent, favoriteStatus);
      assert.equal(page.byId('favorites-retry').hidden, retryHidden);
      assert.deepEqual([...isolatedStorage.entries], savedEntries);
      assert.deepEqual(writes, []);
    }

    page.byId('favorites-list').querySelector('button').click();
    assert.equal(currentDetail.dataset.recipeId, recipe.id);
    assert.equal(currentDetail.querySelector('.missing-summary'), null, '清空后从收藏打开不得沿用旧选材的缺料结论');
    assert.match(currentDetail.textContent, /尚无有效选材条件/);
    assert.deepEqual(currentDetail.querySelector('ol').children.map((step) => step.textContent), recipe.steps);
    assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '取消收藏');
    page.byId('clear-filters-button').click();
    page.choose(['番茄']);
    page.byId('recommend-button').click();
    assertTomatoResults(page);
    assert.deepEqual([...isolatedStorage.entries], savedEntries);
    assert.deepEqual(writes, []);
  });
  await t.test('做法默认完整展开，按钮文字与关联状态一致', async () => {
    const page = await boot(makeStorage());
    const recipe = data.recipes[0];
    page.choose(recipe.mainIngredients.map(({ name }) => name)); page.open(recipe);
    const currentDetail = page.byId('recipe-detail-content');
    const steps = currentDetail.querySelector('#recipe-steps');
    const toggle = currentDetail.querySelector('.steps-toggle');

    assert.equal(steps.tagName, 'OL');
    assert.equal(steps.hidden, false);
    assert.deepEqual(steps.children.map((step) => step.textContent), recipe.steps);
    assert.equal(toggle.tagName, 'BUTTON');
    assert.equal(toggle.className, 'button button-secondary steps-toggle');
    assert.equal(toggle.type, 'button');
    assert.equal(toggle.textContent, '收起做法');
    assert.equal(toggle['aria-expanded'], 'true');
    assert.equal(toggle['aria-controls'], steps.id);
    assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '收藏');
  });
  await t.test('收起只隐藏做法列表，材料、说明、安全提醒和收藏入口保留', async () => {
    const page = await boot(makeStorage());
    const recipe = data.recipes[0];
    page.choose(recipe.mainIngredients.map(({ name }) => name)); page.open(recipe);
    const currentDetail = page.byId('recipe-detail-content');
    const steps = currentDetail.querySelector('#recipe-steps');
    const toggle = currentDetail.querySelector('.steps-toggle');
    const originalNodes = currentDetail.descendants();
    const originalText = currentDetail.textContent;

    toggle.click();
    assert.equal(steps.hidden, true);
    assert.equal(toggle.textContent, '展开做法');
    assert.equal(toggle['aria-expanded'], 'false');
    assert.equal(toggle['aria-controls'], steps.id);
    assert.deepEqual(currentDetail.descendants(), originalNodes);
    assert.equal(currentDetail.textContent, originalText.replace('收起做法', '展开做法'));
    assert.deepEqual(steps.children.map((step) => step.textContent), recipe.steps);
    for (const node of [currentDetail, ...originalNodes.filter((node) => node !== steps)]) {
      assert.notEqual(node.hidden, true, '仅做法列表本身可被隐藏');
    }
    for (const material of [...recipe.mainIngredients, ...recipe.seasonings]) {
      assert.ok(currentDetail.textContent.includes(`${material.name}：${material.amount}`));
    }
    for (const note of [...data.notes, ...data.safetyNotes]) assert.ok(currentDetail.textContent.includes(note));
    assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '收藏');
    assert.equal(currentDetail.querySelector('.detail-favorite').disabled, false);
  });
  await t.test('连续点击十次开合不重复创建节点，文字和展开状态同步', async () => {
    const page = await boot(makeStorage());
    const recipe = data.recipes[0];
    page.choose(recipe.mainIngredients.map(({ name }) => name)); page.open(recipe);
    const currentDetail = page.byId('recipe-detail-content');
    const steps = currentDetail.querySelector('#recipe-steps');
    const toggle = currentDetail.querySelector('.steps-toggle');
    const originalNodes = currentDetail.descendants();

    for (let click = 1; click <= 10; click++) {
      toggle.click();
      const collapsed = click % 2 === 1;
      assert.equal(steps.hidden, collapsed);
      assert.equal(toggle.textContent, collapsed ? '展开做法' : '收起做法');
      assert.equal(toggle['aria-expanded'], String(!collapsed));
      assert.equal(toggle['aria-controls'], steps.id);
      assert.deepEqual(currentDetail.descendants(), originalNodes);
      assert.equal(currentDetail.querySelectorAll('#recipe-steps').length, 1);
      assert.equal(currentDetail.querySelectorAll('.steps-toggle').length, 1);
      assert.equal(currentDetail.querySelectorAll('button').length, 2);
      assert.deepEqual(steps.children.map((step) => step.textContent), recipe.steps);
    }
  });
  await t.test('直接切换推荐菜和重新打开详情恢复展开，筛选后清空开合入口', async () => {
    const page = await boot(makeStorage());
    const [first, second] = data.recipes;
    page.choose([...new Set(data.recipes.flatMap((recipe) => recipe.mainIngredients.map(({ name }) => name)))]);
    page.byId('recommend-button').click();
    const cards = page.byId('recipe-list').children;
    const currentDetail = page.byId('recipe-detail-content');
    for (const recipe of [first, second, first, first]) {
      const card = cards.find((node) => node.dataset.recipeId === recipe.id);
      assert.ok(card, `应推荐 ${recipe.name}`);
      card.querySelector('button').click();
      const steps = currentDetail.querySelector('#recipe-steps');
      const toggle = currentDetail.querySelector('.steps-toggle');
      assert.equal(currentDetail.dataset.recipeId, recipe.id);
      assert.equal(steps.hidden, false);
      assert.deepEqual(steps.children.map((step) => step.textContent), recipe.steps);
      assert.equal(toggle.textContent, '收起做法');
      assert.equal(toggle['aria-expanded'], 'true');
      toggle.click();
      assert.equal(steps.hidden, true);
    }

    page.choose(['番茄']);
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(currentDetail.dataset.recipeId, undefined);
    assert.equal(currentDetail.textContent, '条件已修改，请重新推荐后查看菜品详情。');
    assert.equal(currentDetail.querySelector('#recipe-steps'), null);
    assert.equal(currentDetail.querySelector('button'), null);
  });
  await t.test('收起时收藏和取消仍同步，开合本身不写入本地存储', async () => {
    const isolatedStorage = makeStorage();
    const writes = [];
    const setItem = isolatedStorage.setItem;
    isolatedStorage.setItem = function (key, value) { writes.push([key, value]); setItem.call(this, key, value); };
    const page = await boot(isolatedStorage);
    const recipe = data.recipes[0];
    page.choose(recipe.mainIngredients.map(({ name }) => name)); page.open(recipe);
    const currentDetail = page.byId('recipe-detail-content');
    let steps = currentDetail.querySelector('#recipe-steps');
    let toggle = currentDetail.querySelector('.steps-toggle');
    assert.deepEqual(writes, []);

    toggle.click();
    assert.equal(steps.hidden, true);
    assert.deepEqual(writes, []);
    assert.equal(isolatedStorage.getItem(FAVORITES_KEY), null);
    currentDetail.querySelector('.detail-favorite').click();
    assert.equal(steps.hidden, true);
    assert.equal(toggle.textContent, '展开做法');
    assert.equal(toggle['aria-expanded'], 'false');
    assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '取消收藏');
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 1);
    assert.deepEqual(writes, [[FAVORITES_KEY, JSON.stringify([recipe.id])]]);

    toggle.click(); toggle.click();
    assert.equal(steps.hidden, true);
    assert.deepEqual(writes, [[FAVORITES_KEY, JSON.stringify([recipe.id])]]);
    page.byId('favorites-list').querySelector('button').click();
    steps = currentDetail.querySelector('#recipe-steps');
    toggle = currentDetail.querySelector('.steps-toggle');
    assert.equal(steps.hidden, false);
    assert.equal(toggle.textContent, '收起做法');
    assert.equal(toggle['aria-expanded'], 'true');
    toggle.click();
    currentDetail.querySelector('.detail-favorite').click();
    assert.equal(steps.hidden, true);
    assert.equal(toggle.textContent, '展开做法');
    assert.equal(toggle['aria-expanded'], 'false');
    assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '收藏');
    assert.match(page.byId('favorites-list').textContent, /还没有收藏的菜/);
    assert.deepEqual(writes, [[FAVORITES_KEY, JSON.stringify([recipe.id])], [FAVORITES_KEY, '[]']]);
    assert.deepEqual(JSON.parse(isolatedStorage.getItem(FAVORITES_KEY)), []);
  });

  await t.test('Day 13：空地址进入选菜，顶部导航每次只显示一个视图', async () => {
    const page = await boot(makeStorage());
    assert.equal(page.window.location.hash, '#home');
    assert.equal(page.window.history.length, 1, '默认地址应替换当前历史条目');
    assertView(page, 'home-view');
    page.byId('nav-favorites').click();
    assert.equal(page.window.location.hash, '#favorites');
    assertView(page, 'favorites');
    assert.match(page.byId('favorites-list').textContent, /还没有收藏的菜/);
    await new Promise(setImmediate);
    assertView(page, 'favorites');
    page.byId('nav-home').click();
    assert.equal(page.window.location.hash, '#home');
    assertView(page, 'home-view');
    const historyLength = page.window.history.length;
    page.byId('nav-home').click();
    assert.equal(page.window.history.length, historyLength, '重复进入当前地址不增加历史');
  });

  await t.test('Day 13：推荐进入详情再返回，选材、调料、难度和推荐卡片保持原样', async () => {
    const page = await boot(makeStorage());
    const recipe = data.recipes.find((item) => item.id === 'recipe-003');
    page.choose(['番茄']);
    const salt = page.byId('seasonings').querySelectorAll('input').find((input) => input.value === '盐');
    salt.checked = true; salt.emit('change');
    const difficulty = page.byId('recipe-filters').querySelectorAll('input[name="difficulty"]');
    for (const input of difficulty) input.checked = input.value === '普通';
    difficulty.find((input) => input.checked).emit('change');
    page.byId('recommend-button').click();
    const cards = [...page.byId('recipe-list').children];
    const note = page.byId('results-note').textContent;
    const selections = page.byId('recipe-filters').querySelectorAll('input').map(({ name, value, checked }) => ({ name, value, checked }));
    const card = cards.find((node) => node.dataset.recipeId === recipe.id);
    assert.ok(card);
    card.querySelector('button').click();
    assert.equal(page.window.location.hash, `#recipe/${recipe.id}`);
    assert.equal(page.window.history.state.nextMealDetailFrom, 'home');
    assertView(page, 'recipe-detail');
    assert.equal(page.byId('detail-back').textContent, '返回选菜');
    const steps = page.byId('recipe-detail-content').querySelector('#recipe-steps');
    const toggle = page.byId('recipe-detail-content').querySelector('.steps-toggle');
    toggle.click();
    await new Promise(setImmediate);
    assert.equal(page.byId('recipe-detail-content').querySelector('#recipe-steps'), steps, '同步导航后的 hashchange 不应重复创建详情');
    assert.equal(steps.hidden, true, '稍后的同地址事件不应重置刚收起的做法');
    page.byId('detail-back').click();
    assert.equal(page.window.location.hash, '#home');
    assertView(page, 'home-view');
    assert.deepEqual(page.byId('recipe-filters').querySelectorAll('input').map(({ name, value, checked }) => ({ name, value, checked })), selections);
    assert.deepEqual(page.byId('recipe-list').children, cards);
    assert.equal(page.byId('results-note').textContent, note);
    assertVisible(page.byId('recipe-list'));
  });

  await t.test('Day 13：从收藏进入详情，取消最后一道后仍可返回收藏空列表', async () => {
    const storage = makeStorage('["recipe-001"]');
    const page = await boot(storage);
    page.byId('nav-favorites').click();
    page.byId('favorites-list').querySelector('button').click();
    assertView(page, 'recipe-detail');
    assert.equal(page.window.history.state.nextMealDetailFrom, 'favorites');
    assert.equal(page.byId('detail-back').textContent, '返回收藏');
    page.byId('recipe-detail-content').querySelector('.detail-favorite').click();
    assert.equal(page.byId('recipe-detail-content').dataset.recipeId, 'recipe-001');
    assertView(page, 'recipe-detail');
    assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), []);
    page.byId('detail-back').click();
    assert.equal(page.window.location.hash, '#favorites');
    assertView(page, 'favorites');
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 0);
    assert.match(page.byId('favorites-list').textContent, /还没有收藏的菜/);
  });

  await t.test('Day 13：浏览器后退与前进恢复地址、视图及各次详情的返回来源', async () => {
    const page = await boot(makeStorage('["recipe-001"]'));
    page.choose(['番茄']); page.open(data.recipes[0]);
    await new Promise(setImmediate);
    page.byId('nav-favorites').click();
    await new Promise(setImmediate);
    page.byId('favorites-list').querySelector('button').click();
    await new Promise(setImmediate);
    const journey = [
      ['back', '#favorites', 'favorites'],
      ['back', '#recipe/recipe-001', 'recipe-detail', 'home', '返回选菜'],
      ['back', '#home', 'home-view'],
      ['forward', '#recipe/recipe-001', 'recipe-detail', 'home', '返回选菜'],
      ['forward', '#favorites', 'favorites'],
      ['forward', '#recipe/recipe-001', 'recipe-detail', 'favorites', '返回收藏'],
    ];
    for (const [direction, hash, view, source, label] of journey) {
      page.window.history[direction]();
      await new Promise(setImmediate);
      assert.equal(page.window.location.hash, hash, `${direction} 应恢复地址 ${hash}`);
      assertView(page, view);
      if (source) {
        assert.equal(page.window.history.state.nextMealDetailFrom, source);
        assert.equal(page.byId('detail-back').textContent, label);
        assert.equal(page.byId('recipe-detail-content').dataset.recipeId, 'recipe-001');
      }
    }
    page.byId('detail-back').click();
    assertView(page, 'favorites');
    assert.equal(page.window.location.hash, '#favorites');
  });

  await t.test('Day 13：直接打开有效详情地址，不虚构选材或缺料结论并可返回选菜', async () => {
    const page = await boot(makeStorage(), { hash: '#recipe/recipe-001' });
    const currentDetail = page.byId('recipe-detail-content');
    assertView(page, 'recipe-detail');
    assert.equal(currentDetail.dataset.recipeId, 'recipe-001');
    assert.deepEqual(currentDetail.querySelector('ol').children.map((step) => step.textContent), data.recipes[0].steps);
    assert.equal(currentDetail.querySelector('.missing-summary'), null);
    assert.match(currentDetail.textContent, /尚无有效选材条件/);
    assert.equal(page.byId('recipe-filters').querySelectorAll('input[name="main-ingredient"]:checked').length, 0);
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(page.byId('detail-back').textContent, '返回选菜');
    page.byId('detail-back').click();
    assertView(page, 'home-view');
    assert.equal(page.window.location.hash, '#home');
  });

  await t.test('Day 13：模拟刷新详情保留收藏来源，选材条件不被恢复为虚构状态', async () => {
    const storage = makeStorage('["recipe-001"]');
    const page = await boot(storage);
    page.choose(['番茄']); page.byId('recommend-button').click();
    page.byId('nav-favorites').click();
    page.byId('favorites-list').querySelector('button').click();
    const refreshed = await boot(storage, {
      hash: page.window.location.hash,
      state: structuredClone(page.window.history.state),
    });
    assertView(refreshed, 'recipe-detail');
    assert.equal(refreshed.window.location.hash, '#recipe/recipe-001');
    assert.equal(refreshed.byId('detail-back').textContent, '返回收藏');
    assert.equal(refreshed.byId('recipe-detail-content').querySelector('.missing-summary'), null);
    assert.match(refreshed.byId('recipe-detail-content').textContent, /尚无有效选材条件/);
    assert.equal(refreshed.byId('recipe-detail-content').querySelector('.detail-favorite').textContent, '取消收藏');
    refreshed.byId('detail-back').click();
    assertView(refreshed, 'favorites');
    assert.equal(refreshed.byId('favorites-list').querySelectorAll('article').length, 1);
  });

  await t.test('Day 13：不存在的菜品地址有提示和安全返回入口', async () => {
    const page = await boot(makeStorage(), { hash: '#recipe/recipe-does-not-exist' });
    const currentDetail = page.byId('recipe-detail-content');
    assertView(page, 'recipe-detail');
    assert.equal(currentDetail.dataset.recipeId, undefined);
    assert.equal(currentDetail.querySelector('ol'), null);
    assert.equal(currentDetail.querySelector('.detail-favorite'), null);
    assert.match(currentDetail.textContent, /不存在|找不到|未找到|没有找到|无效/);
    assertVisible(page.byId('detail-back'));
    page.byId('detail-back').click();
    assertView(page, 'home-view');
    assert.equal(page.window.location.hash, '#home');
  });

  await t.test('Day 13：未知地址替换为选菜并提示，地址事件同样可以安全恢复', async () => {
    const page = await boot(makeStorage(), { hash: '#unknown-view' });
    assertView(page, 'home-view');
    assert.equal(page.window.location.hash, '#home');
    assert.equal(page.window.history.length, 1, '纠正错误地址不应新增一条历史');
    assertVisible(page.byId('route-note'));
    assert.ok(page.byId('route-note').textContent.trim());
    page.byId('nav-favorites').click();
    await new Promise(setImmediate);
    page.window.location.hash = '#still-unknown';
    await new Promise(setImmediate);
    assertView(page, 'home-view');
    assert.equal(page.window.location.hash, '#home');
    assertVisible(page.byId('route-note'));
    assert.ok(page.byId('route-note').textContent.trim());
  });

  await t.test('Day 13：没有菜品编号的详情地址显示空详情并可返回', async () => {
    const page = await boot(makeStorage(), { hash: '#recipe' });
    const currentDetail = page.byId('recipe-detail-content');
    assertView(page, 'recipe-detail');
    assert.equal(currentDetail.dataset.recipeId, undefined);
    assert.ok(currentDetail.textContent.trim());
    assert.equal(currentDetail.querySelector('.detail-favorite'), null);
    assertVisible(page.byId('detail-back'));
    page.byId('detail-back').click();
    assertView(page, 'home-view');
  });

  await t.test('Day 13：详情内收藏和取消的成功提示位于当前可见视图', async () => {
    const storage = makeStorage();
    const page = await boot(storage);
    page.choose(['番茄']); page.open(data.recipes[0]);
    const currentDetail = page.byId('recipe-detail-content');
    const status = page.byId('detail-favorites-status');
    assert.equal(status.parentNode, page.byId('recipe-detail'));
    assert.ok(!currentDetail.descendants().includes(status));
    currentDetail.querySelector('.detail-favorite').click();
    assertView(page, 'recipe-detail');
    assertVisible(status);
    assert.match(status.textContent, /已收藏.*番茄炒蛋/);
    assert.equal(status.textContent, page.byId('favorites-status').textContent);
    assert.equal(page.byId('detail-favorites-retry').hidden, true);
    assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ['recipe-001']);
    currentDetail.querySelector('.detail-favorite').click();
    assertVisible(status);
    assert.match(status.textContent, /已取消收藏.*番茄炒蛋/);
    assert.equal(status.textContent, page.byId('favorites-status').textContent);
    assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '收藏');
  });

  await t.test('Day 13：详情内保存失败与重试入口可见，重试成功前保留原收藏状态', async () => {
    const storage = makeStorage(); storage.failWrite = true;
    const page = await boot(storage);
    page.choose(['番茄']); page.open(data.recipes[0]);
    const currentDetail = page.byId('recipe-detail-content');
    const status = page.byId('detail-favorites-status');
    const retry = page.byId('detail-favorites-retry');
    assert.equal(retry.parentNode, page.byId('recipe-detail'));
    for (const shouldSave of [true, false]) {
      const before = shouldSave ? '收藏' : '取消收藏';
      const after = shouldSave ? '取消收藏' : '收藏';
      storage.failWrite = true;
      currentDetail.querySelector('.detail-favorite').click();
      assertView(page, 'recipe-detail');
      assert.equal(currentDetail.querySelector('.detail-favorite').textContent, before);
      assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY) ?? '[]'), shouldSave ? [] : ['recipe-001']);
      assertVisible(status); assertVisible(retry);
      assert.match(status.textContent, /保存失败/);
      assert.equal(status.textContent, page.byId('favorites-status').textContent);
      assert.equal(retry.textContent, '重试保存');
      storage.failWrite = false; retry.click();
      assertView(page, 'recipe-detail');
      assert.equal(currentDetail.querySelector('.detail-favorite').textContent, after);
      assert.equal(retry.hidden, true);
      assertVisible(status);
      assert.ok(!status.textContent.includes('保存失败'));
      assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), shouldSave ? ['recipe-001'] : []);
    }
  });

  await t.test('Day 13：跳到主要内容阻止锚点默认动作，不改变当前路由', async () => {
    const page = await boot(makeStorage('["recipe-001"]'));
    const checkSkip = async (view) => {
      const hash = page.window.location.hash;
      const historyLength = page.window.history.length;
      const event = page.byId('skip-link').click();
      assert.equal(event.defaultPrevented, true);
      await new Promise(setImmediate);
      assert.equal(page.window.location.hash, hash);
      assert.equal(page.window.history.length, historyLength);
      assertView(page, view);
      assertVisible(page.document.activeElement);
    };
    await checkSkip('home-view');
    page.byId('nav-favorites').click();
    await checkSkip('favorites');
    page.byId('favorites-list').querySelector('button').click();
    await checkSkip('recipe-detail');
  });
});

test('Day 13：本地开发状态演示（真实应用脚本与 HTML，内存 DOM 和存储）', async (t) => {
  const descriptors = Object.fromEntries(['document', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const boot = (storage, options = {}) => bootApiPage(storage, {
    dev: true, url: 'http://localhost/?state-preview=loading', ...options,
  });
  const assertDisabled = (page) => {
    assert.equal(page.byId('recommend-button').disabled, true);
    assert.equal(page.byId('clear-filters-button').disabled, true);
    assert.ok(page.byId('recipe-filters').querySelectorAll('fieldset').every((fieldset) => fieldset.disabled));
    assert.equal(page.byId('recipe-list').children.length, 0);
  };
  const assertNormalLoad = (page) => {
    assert.deepEqual([...page.calls.requests].sort(), [...apiUrls].sort());
    assert.deepEqual(page.calls.reads, [FAVORITES_KEY]);
    assert.deepEqual(page.calls.writes, []);
    assert.equal(page.byId('state-preview-notice').hidden, true);
    assert.equal(page.byId('preview-notice').hidden, true);
    assert.equal(page.byId('recommend-button').disabled, false);
    assert.equal(page.byId('clear-filters-button').disabled, false);
    assert.equal(page.byId('results-note').textContent, '请至少选择一种主要食材，再点击“看看能做什么”。');
    assert.equal(page.byId('data-source-note').textContent, '数据来源：云端读接口；本次加载 4 道菜。');
    assert.ok(page.byId('main-ingredients').querySelectorAll('input').length > 0);
  };

  await t.test('加载演示在三种本机地址停留于真实初始 UI，阻止操作且不读取或改动收藏', async () => {
    assert.equal(initialHtmlElement('results-note').text, '正在加载菜品资料……');
    assert.match(initialHtmlElement('state-preview-notice').attributes, /\bhidden(?:\s|=|$)/);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const storage = makeStorage('["recipe-001"]');
      storage.entries.set('unrelated-site-setting', 'keep');
      const saved = [...storage.entries];
      const page = await boot(storage, { url: `http://${host}:5173/?state-preview=loading#home` });
      assertView(page, 'home-view');
      assertDisabled(page);
      assertVisible(page.byId('state-preview-notice'));
      assert.match(page.byId('state-preview-text').textContent, /状态演示.*加载中/);
      for (const id of ['main-ingredients', 'seasonings', 'results-note', 'preview-notice', 'data-source-note']) {
        assert.equal(page.byId(id).textContent, initialHtmlElement(id).text, `${host} 的 ${id} 应保持 HTML 初始提示`);
      }
      for (const id of ['recommend-button', 'clear-filters-button']) page.byId(id).emit('click');
      page.byId('recipe-filters').emit('change');
      assert.equal(page.byId('results-note').textContent, '正在加载菜品资料……');
      page.byId('nav-favorites').click();
      assertView(page, 'favorites');
      assert.equal(page.byId('favorites-status').textContent, initialHtmlElement('favorites-status').text);
      assert.ok(!page.byId('favorites-list').textContent.includes('还没有收藏'));
      page.window.location.hash = '#recipe/recipe-001';
      await new Promise(setImmediate);
      assertView(page, 'recipe-detail');
      assert.match(page.byId('recipe-detail-content').textContent, /正在加载菜品资料/);
      assert.equal(page.byId('recipe-detail-content').querySelector('.detail-favorite'), null);
      assertDisabled(page);
      assert.deepEqual(page.calls, { requests: [], reads: [], writes: [] });
      assert.deepEqual([...storage.entries], saved);
    }
  });

  await t.test('错误演示走真实加载失败提示，退出地址重新打开后恢复菜品和原收藏', async () => {
    const storage = makeStorage('["recipe-001"]');
    const saved = [...storage.entries];
    const page = await boot(storage, { url: 'http://localhost:5173/?state-preview=error#recipe/recipe-001' });
    assertView(page, 'recipe-detail');
    assertVisible(page.byId('state-preview-notice'));
    assert.match(page.byId('state-preview-text').textContent, /状态演示.*加载失败/);
    assert.equal(page.byId('preview-notice').hidden, false);
    assert.match(page.byId('preview-notice').textContent, /菜品资料未能加载/);
    assert.equal(page.byId('main-ingredients').textContent, '主要食材未能加载，请刷新页面重试。');
    assert.equal(page.byId('seasonings').textContent, '调料未能加载，请刷新页面重试。');
    assert.equal(page.byId('results-note').textContent, '资料未加载，暂时无法生成推荐。');
    assert.equal(page.byId('favorites-status').textContent, '菜品资料未加载，暂时无法显示收藏。');
    assert.equal(page.byId('recipe-detail-content').textContent, '菜品资料未加载，暂时无法查看详情。');
    assertDisabled(page);
    for (const id of ['recommend-button', 'clear-filters-button']) page.byId(id).emit('click');
    assert.equal(page.byId('results-note').textContent, '资料未加载，暂时无法生成推荐。');
    assert.deepEqual(page.calls, { requests: [], reads: [], writes: [] });
    assert.deepEqual([...storage.entries], saved);
    const exit = page.byId('exit-state-preview');
    assertVisible(exit);
    assert.equal(initialHtmlElement('exit-state-preview').tag, 'a', '退出入口应通过普通链接重新加载');
    const recovered = await boot(storage, { url: exit.href });
    assertNormalLoad(recovered);
    assertView(recovered, 'recipe-detail');
    assert.equal(recovered.byId('recipe-detail-content').dataset.recipeId, 'recipe-001');
    assert.equal(recovered.byId('recipe-detail-content').querySelector('.detail-favorite').textContent, '取消收藏');
    assert.deepEqual([...storage.entries], saved);
  });

  await t.test('两种演示的退出地址只移除演示参数，保留其他参数和导航后的当前 hash', async () => {
    for (const mode of ['loading', 'error']) {
      const page = await boot(makeStorage(), {
        url: `http://localhost:5173/demo/?state-preview=${mode}&theme=light&tag=a&tag=b#favorites`,
      });
      const assertExit = (hash) => {
        const exit = new URL(page.byId('exit-state-preview').href);
        assert.equal(exit.origin, 'http://localhost:5173');
        assert.equal(exit.pathname, '/demo/');
        assert.deepEqual([...exit.searchParams], [['theme', 'light'], ['tag', 'a'], ['tag', 'b']]);
        assert.equal(exit.hash, hash);
      };
      assertExit('#favorites');
      page.byId('nav-home').click();
      assertExit('#home');
      await new Promise(setImmediate);
      page.window.location.hash = '#recipe/recipe-001';
      await new Promise(setImmediate);
      assertExit('#recipe/recipe-001');
    }
  });

  await t.test('非开发环境或非本机地址忽略两种演示参数，仍读取两读接口和原收藏', async () => {
    for (const [dev, host] of [[false, 'localhost'], [true, 'example.test']]) {
      for (const mode of ['loading', 'error']) {
        const storage = makeStorage('["recipe-001"]');
        const saved = [...storage.entries];
        const page = await boot(storage, { dev, url: `http://${host}/?state-preview=${mode}#favorites` });
        assertNormalLoad(page);
        assertView(page, 'favorites');
        assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 1);
        assert.deepEqual([...storage.entries], saved);
      }
    }
  });

  await t.test('空值、未知值和大小写不同的演示参数均正常加载', async () => {
    for (const mode of ['', 'unknown', 'Loading']) {
      const page = await boot(makeStorage(), { url: `http://localhost/?state-preview=${mode}#home` });
      assertNormalLoad(page);
      assertView(page, 'home-view');
      assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 0);
      assert.match(page.byId('favorites-list').textContent, /还没有收藏的菜/);
    }
  });
});

test('Day 13：直接进入详情等待两接口 JSON 完成后显示菜品，不提前虚构详情或选材', async (t) => {
  const descriptors = Object.fromEntries(['document', 'fetch', 'localStorage', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const document = makeDocument();
  const window = makeWindow('#recipe/recipe-001', { nextMealDetailFrom: 'favorites' });
  const byId = (id) => document.getElementById(id);
  globalThis.document = document;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: makeStorage('["recipe-001"]') });
  const resolveJson = new Map();
  globalThis.fetch = async (request) => ({
    ok: true,
    json: () => new Promise((resolve) => { resolveJson.set(requestUrl(request).pathname, resolve); }),
  });
  await import('../app.js?day13-direct-detail-pending-json');

  assert.deepEqual([...resolveJson.keys()].sort(), [...apiPaths].sort());
  assert.equal(window.location.hash, '#recipe/recipe-001');
  assertView({ byId }, 'recipe-detail');
  assert.equal(byId('recipe-detail-content').dataset.recipeId, undefined);
  assert.equal(byId('recipe-detail-content').querySelector('ol'), null);
  assert.equal(byId('recipe-detail-content').querySelector('.detail-favorite'), null);
  assert.equal(byId('recommend-button').disabled, true);
  assert.equal(byId('detail-back').textContent, '返回收藏');

  resolveJson.get('/api/recipes')({ ok: true, data: structuredClone(apiData.recipes) });
  await new Promise(setImmediate);
  assert.equal(byId('recipe-detail-content').dataset.recipeId, undefined);
  assert.equal(byId('recipe-detail-content').querySelector('ol'), null);
  assert.equal(byId('recommend-button').disabled, true, '仅菜品 API 完成时仍等待材料 API');
  resolveJson.get('/api/recipe-materials')({ ok: true, data: structuredClone(apiData.materials) });
  await new Promise(setImmediate);
  assertView({ byId }, 'recipe-detail');
  const currentDetail = byId('recipe-detail-content');
  assert.equal(window.location.hash, '#recipe/recipe-001');
  assert.equal(currentDetail.dataset.recipeId, 'recipe-001');
  assert.deepEqual(currentDetail.querySelector('ol').children.map((step) => step.textContent), data.recipes[0].steps);
  assert.equal(currentDetail.querySelector('.missing-summary'), null);
  assert.match(currentDetail.textContent, /尚无有效选材条件/);
  assert.equal(currentDetail.querySelector('.detail-favorite').textContent, '取消收藏');
  assert.equal(byId('recipe-filters').querySelectorAll('input[name="main-ingredient"]:checked').length, 0);
  assert.equal(byId('recipe-list').children.length, 0);
  assert.equal(byId('detail-back').textContent, '返回收藏');
  byId('detail-back').click();
  await new Promise(setImmediate);
  assertView({ byId }, 'favorites');
  assert.equal(window.location.hash, '#favorites');
});

test('菜品加载中清空按钮禁用，直接派发点击也不掩盖加载状态', async (t) => {
  const descriptors = Object.fromEntries(['document', 'fetch', 'localStorage', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const document = makeDocument();
  const byId = (id) => document.getElementById(id);
  const initialDetail = byId('recipe-detail-content').textContent;
  globalThis.document = document;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: makeWindow() });
  const resolveResponse = new Map();
  globalThis.fetch = (request) => new Promise((resolve) => { resolveResponse.set(requestUrl(request).pathname, resolve); });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: makeStorage() });
  await import('../app.js?day12-load-pending');

  assert.deepEqual([...resolveResponse.keys()].sort(), [...apiPaths].sort());
  assert.equal(byId('clear-filters-button').disabled, true);
  byId('clear-filters-button').emit('click');
  assert.equal(byId('main-ingredients').textContent, '正在加载主要食材……');
  assert.equal(byId('seasonings').textContent, '正在加载调料……');
  assert.equal(byId('results-note').textContent, '正在加载菜品资料……');
  assert.equal(byId('recipe-detail-content').textContent, initialDetail);
  assert.equal(byId('recommend-button').disabled, true);
  assert.ok(byId('recipe-filters').querySelectorAll('fieldset').every((fieldset) => fieldset.disabled));

  resolveResponse.get('/api/recipes')(successfulResponse(apiUrls[0]));
  await new Promise(setImmediate);
  assert.equal(byId('clear-filters-button').disabled, true);
  assert.equal(byId('recommend-button').disabled, true);
  assert.equal(byId('results-note').textContent, '正在加载菜品资料……');
  resolveResponse.get('/api/recipe-materials')(successfulResponse(apiUrls[1]));
  await new Promise(setImmediate);
  assert.equal(byId('clear-filters-button').disabled, false);
  assert.equal(byId('recommend-button').disabled, false);
  assert.equal(byId('results-note').textContent, '请至少选择一种主要食材，再点击“看看能做什么”。');
});

test('菜品加载失败时食材区不再停留在加载中', async (t) => {
  const scenarios = [
    { name: '请求被拒绝', id: 'rejected', fetch: async () => { throw new Error('模拟网络失败'); } },
    { name: 'HTTP 返回失败', id: 'http', fetch: async () => ({ ok: false, status: 503 }) },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    const descriptors = Object.fromEntries(['document', 'fetch', 'localStorage', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
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
    globalThis.document = document;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: makeWindow() });
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
    assert.equal(byId('clear-filters-button').disabled, true);
    byId('clear-filters-button').emit('click');
    assert.equal(byId('results-note').textContent, '资料未加载，暂时无法生成推荐。');
    assert.equal(byId('recipe-detail-content').textContent, '菜品资料未加载，暂时无法查看详情。');
    assert.equal(byId('favorites-status').textContent, '菜品资料未加载，暂时无法显示收藏。');
    assert.equal(byId('clear-filters-button').disabled, true);
    assert.equal(byId('recipe-list').children.length, 0);
  });
});

test('Day 17：页面从两云端读接口获取资料，保留原推荐与本地收藏行为', async (t) => {
  const descriptors = Object.fromEntries(['document', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const assertTwoReads = (page) => assert.deepEqual([...page.calls.requests].sort(), [...apiUrls].sort());
  const assertBlocked = (page) => {
    assert.equal(page.byId('recommend-button').disabled, true);
    assert.equal(page.byId('clear-filters-button').disabled, true);
    assert.ok(page.byId('recipe-filters').querySelectorAll('fieldset').every((fieldset) => fieldset.disabled));
    assert.equal(page.byId('recipe-list').children.length, 0);
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 0);
    assert.equal(page.byId('recipe-detail-content').querySelector('ol'), null);
    assert.equal(page.byId('recipe-detail-content').querySelector('.detail-favorite'), null);
    assert.deepEqual(page.calls.reads, []);
    assert.deepEqual(page.calls.writes, []);
  };

  await t.test('已审核的五道 seed 菜品均可推荐和查看原文；第五道收藏仍只存浏览器', async () => {
    const storage = makeStorage('["recipe-003"]');
    storage.entries.set('unrelated-site-setting', 'keep');
    const page = await bootApiPage(storage, { fixture: seedApiData });
    assertTwoReads(page);
    assert.equal(page.byId('data-source-note').textContent, '数据来源：云端读接口；本次加载 5 道菜。');
    assert.deepEqual(page.calls.reads, [FAVORITES_KEY]);
    assert.deepEqual(page.calls.writes, []);
    assert.equal(page.byId('recommend-button').disabled, false);
    assert.equal(page.byId('clear-filters-button').disabled, false);

    page.choose([...new Set(seedApiData.materials.filter((material) => material.material_type === 'main').map((material) => material.name))]);
    page.byId('recommend-button').click();
    const cards = page.byId('recipe-list').children;
    assert.deepEqual(cards.map((card) => card.dataset.recipeId), ['recipe-001', 'recipe-002', 'recipe-005', 'recipe-003', 'recipe-004']);
    assert.match(page.byId('results-note').textContent, /^找到 5 道菜：/);
    for (const recipe of seedApiData.recipes) {
      const card = cards.find((node) => node.dataset.recipeId === recipe.id);
      assert.equal(card.querySelector('h3').textContent, recipe.name);
      card.querySelector('button').click();
      const detail = page.byId('recipe-detail-content');
      assert.equal(detail.dataset.recipeId, recipe.id);
      assert.deepEqual(detail.querySelector('ol').children.map((step) => step.textContent), recipe.steps);
      for (const note of [...recipe.notes, ...recipe.safety_notes]) assert.ok(detail.textContent.includes(note));
      for (const material of seedApiData.materials.filter((item) => item.recipe_id === recipe.id)) {
        assert.ok(detail.textContent.includes(`${material.name}：${material.amount}`));
      }
      if (recipe.difficulty_reason) assert.ok(detail.textContent.includes(recipe.difficulty_reason));
      assert.match(detail.querySelector('.missing-summary').textContent, /主要食材齐全/);
    }

    const fifth = cards.find((card) => card.dataset.recipeId === 'recipe-005');
    fifth.querySelector('button').click();
    const detail = page.byId('recipe-detail-content');
    assert.match(detail.textContent, /青椒炒鸡蛋/);
    assert.match(detail.querySelector('.missing-summary').textContent, /缺少调料：食用油、盐/);
    detail.querySelector('.detail-favorite').click();
    assert.equal(detail.querySelector('.detail-favorite').textContent, '取消收藏');
    assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ['recipe-003', 'recipe-005']);
    assert.equal(page.byId('favorites-list').querySelectorAll('article').length, 2);
    detail.querySelector('.detail-favorite').click();
    assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ['recipe-003']);
    assert.deepEqual(page.calls.writes, [[FAVORITES_KEY, '["recipe-003","recipe-005"]'], [FAVORITES_KEY, '["recipe-003"]']]);
    assert.equal(storage.getItem('unrelated-site-setting'), 'keep');
    assertTwoReads(page);
  });

  const invalidRecipeFixture = structuredClone(seedApiData);
  invalidRecipeFixture.recipes[0].steps = [];
  const incompleteMaterialsFixture = {
    recipes: seedApiData.recipes,
    materials: seedApiData.materials.filter((material) => material.recipe_id !== 'recipe-005'),
  };
  const scenarios = apiPaths.flatMap((path) => [
    { name: `${path} 单独 HTTP 失败`, path, failure: async () => ({ ok: false, status: 503 }) },
    { name: `${path} 单独返回 ok:false`, path, failure: async () => ({ ok: true, json: async () => ({ ok: false, data: [] }) }) },
  ]);
  scenarios.push(
    { name: '菜品接口网络异常', path: '/api/recipes', failure: async () => { throw new Error('模拟单接口网络失败'); } },
    { name: '材料接口 JSON 解析异常', path: '/api/recipe-materials', failure: async () => ({ ok: true, json: async () => { throw new SyntaxError('模拟 JSON 解析失败'); } }) },
    { name: '菜品资料格式异常', path: '/api/recipes', failure: async (request) => successfulResponse(request, invalidRecipeFixture) },
    { name: '材料接口缺少第五道主要食材', path: '/api/recipe-materials', failure: async (request) => successfulResponse(request, incompleteMaterialsFixture) },
  );
  for (const scenario of scenarios) await t.test(`${scenario.name}：整页保护，不回退本地资料或改动收藏`, async () => {
    const storage = makeStorage('["recipe-005"]');
    storage.entries.set('unrelated-site-setting', 'keep');
    const saved = [...storage.entries];
    const page = await bootApiPage(storage, {
      fixture: seedApiData, url: 'http://localhost/#recipe/recipe-005',
      respond: (request) => requestUrl(request).pathname === scenario.path
        ? scenario.failure(request) : successfulResponse(request, seedApiData),
    });
    assertTwoReads(page);
    assertBlocked(page);
    assertView(page, 'recipe-detail');
    assert.equal(page.byId('data-source-note').textContent, '数据来源：云端读接口；本次加载失败，未使用示例数据。');
    assert.equal(page.byId('preview-notice').hidden, false);
    assert.equal(page.byId('preview-notice').textContent, '菜品资料未能加载，请确认读接口已部署并允许此页面访问，再刷新重试。');
    assert.equal(page.byId('main-ingredients').textContent, '主要食材未能加载，请刷新页面重试。');
    assert.equal(page.byId('seasonings').textContent, '调料未能加载，请刷新页面重试。');
    assert.equal(page.byId('results-note').textContent, '资料未加载，暂时无法生成推荐。');
    assert.equal(page.byId('favorites-status').textContent, '菜品资料未加载，暂时无法显示收藏。');
    assert.equal(page.byId('recipe-detail-content').textContent, '菜品资料未加载，暂时无法查看详情。');
    for (const id of ['recommend-button', 'clear-filters-button']) page.byId(id).emit('click');
    page.byId('recipe-filters').emit('change');
    page.byId('nav-favorites').click();
    assertView(page, 'favorites');
    assertBlocked(page);
    assert.equal(page.byId('results-note').textContent, '资料未加载，暂时无法生成推荐。');
    assert.deepEqual([...storage.entries], saved);
    assertTwoReads(page);
  });

  await t.test('空库是已加载的零道菜，保持空库提示和禁用状态，不读写原收藏', async () => {
    for (const hash of ['#home', '#recipe/recipe-005']) {
      const storage = makeStorage('["recipe-005"]');
      storage.entries.set('unrelated-site-setting', 'keep');
      const saved = [...storage.entries];
      const page = await bootApiPage(storage, {
        fixture: { recipes: [], materials: [] }, url: `http://localhost/${hash}`,
      });
      assertTwoReads(page);
      assertBlocked(page);
      assert.equal(page.byId('data-source-note').textContent, '数据来源：云端读接口；本次加载 0 道菜。');
      assert.equal(page.byId('preview-notice').hidden, false);
      assert.equal(page.byId('preview-notice').textContent, '数据库暂无菜品资料，请稍后刷新。');
      assert.equal(page.byId('results-note').textContent, '数据库暂无菜品，暂时无法生成推荐。');
      assert.equal(page.byId('recipe-detail-content').textContent, '数据库暂无菜品资料，暂时无法查看详情。');
      assert.equal(page.byId('favorites-status').textContent, '暂无菜品资料可供显示收藏；已保存的收藏不会删除。');
      for (const id of ['recommend-button', 'clear-filters-button']) page.byId(id).emit('click');
      page.byId('recipe-filters').emit('change');
      page.byId('nav-favorites').click();
      assertView(page, 'favorites');
      assertBlocked(page);
      assert.equal(page.byId('results-note').textContent, '数据库暂无菜品，暂时无法生成推荐。');
      assert.deepEqual([...storage.entries], saved);
      assertTwoReads(page);
    }
  });

  await t.test('重新打开会再次读取两接口，显示来源的增减，不沿用上一页资料缓存', async () => {
    const storage = makeStorage('["recipe-005"]');
    const saved = [...storage.entries];
    for (const [fixture, count] of [[seedApiData, 5], [apiData, 4], [seedApiData, 5]]) {
      const page = await bootApiPage(storage, { fixture });
      assertTwoReads(page);
      assert.equal(page.byId('data-source-note').textContent, `数据来源：云端读接口；本次加载 ${count} 道菜。`);
      page.choose(['鸡蛋']);
      page.byId('recommend-button').click();
      const recipeIds = page.byId('recipe-list').children.map((card) => card.dataset.recipeId);
      assert.equal(recipeIds.includes('recipe-005'), count === 5);
      assert.equal(page.byId('favorites-list').querySelectorAll('article').length, count === 5 ? 1 : 0);
      assert.deepEqual(page.calls.reads, [FAVORITES_KEY]);
      assert.deepEqual(page.calls.writes, []);
      assert.deepEqual([...storage.entries], saved);
      assertTwoReads(page);
    }
  });
});
