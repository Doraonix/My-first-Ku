import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommendRecipes } from '../recommendations.mjs';

const { recipes } = JSON.parse(readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const run = (mainIngredients, seasonings = [], difficulty = 'all', data = recipes) =>
  recommendRecipes(data, { mainIngredients, seasonings, difficulty });
const ids = ({ results }) => results.map(({ recipe }) => recipe.id);
const sorted = (values) => [...values].sort();

test('未选主要食材，包括只选调料时，不生成推荐', () => {
  for (const seasonings of [[], ['食用油', '盐']]) {
    assert.deepEqual(run([], seasonings), { status: 'needs-ingredients', results: [] });
  }
});

test('只选番茄，两道候选分别缺一种、两种主要食材', () => {
  const result = run(['番茄']);
  assert.equal(result.status, 'ready');
  assert.deepEqual(ids(result), ['recipe-001', 'recipe-003']);
  assert.deepEqual(result.results.map((entry) => sorted(entry.missingMainIngredients)),
    [['鸡蛋'], sorted(['北豆腐', '鸡蛋'])]);
});

test('只选北豆腐时排除缺三种主要食材的什锦豆腐', () => {
  const result = run(['北豆腐']);
  assert.deepEqual(ids(result), ['recipe-003']);
  assert.deepEqual(sorted(result.results[0].missingMainIngredients), sorted(['番茄', '鸡蛋']));
});

test('没有主要食材交集或没有符合难度的菜时返回无候选', () => {
  for (const result of [run(['不存在的食材']), run(['土豆'], [], '普通'), run(['番茄'], [], 'all', [])]) {
    assert.deepEqual(result, { status: 'no-matches', results: [] });
  }
  assert.ok(!ids(run(['番茄'])).includes('recipe-002'));
});

test('简单、普通严格匹配，不限接受两档', () => {
  const allMain = recipes.flatMap((recipe) => recipe.mainIngredients.map(({ name }) => name));
  for (const difficulty of ['简单', '普通']) {
    const result = run(allMain, [], difficulty);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every(({ recipe }) => recipe.difficulty === difficulty));
  }
  assert.equal(run(allMain).results.length, 4);
});

test('排序先按缺主食材数，再按难度，不以缺调料数抢先', () => {
  const fixture = (id, difficulty, names, seasonings) => ({
    ...structuredClone(recipes[0]), id, difficulty,
    mainIngredients: names.map((name) => ({ name })), seasonings,
  });
  const data = [fixture('simple-two', '简单', ['番茄', '鸡蛋', '北豆腐'], []),
    fixture('normal-one', '普通', ['番茄', '鸡蛋'], []),
    fixture('simple-one', '简单', ['番茄', '鸡蛋'], recipes[2].seasonings),
    fixture('normal-zero', '普通', ['番茄'], recipes[2].seasonings)];
  assert.deepEqual(ids(run(['番茄'], [], 'all', data)),
    ['normal-zero', 'simple-one', 'normal-one', 'simple-two']);
});

test('调料只影响缺调料提示，不影响准入或排序', () => {
  const lacking = run(['番茄']);
  const stocked = run(['番茄'], ['食用油', '盐', '生抽']);
  assert.deepEqual(ids(lacking), ids(stocked));
  assert.ok(lacking.results.every(({ missingSeasonings }) => missingSeasonings.length > 0));
  assert.ok(stocked.results.every(({ missingSeasonings }) => missingSeasonings.length === 0));
});

test('主要食材齐全仍正确提示缺少调料', () => {
  const entry = run(['番茄', '鸡蛋'], ['食用油']).results.find(({ recipe }) => recipe.id === 'recipe-001');
  assert.deepEqual(entry.missingMainIngredients, []);
  assert.deepEqual(entry.missingSeasonings, ['盐']);
});

test('重复材料名称和重复勾选不增加缺料种数', () => {
  const recipe = structuredClone(recipes[2]);
  recipe.mainIngredients.push({ name: '鸡蛋' }, { name: '鸡蛋' }, { name: '番茄' });
  recipe.seasonings.push({ name: '盐' });
  const result = run(['番茄', '番茄'], ['食用油', '食用油'], 'all', [recipe]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(sorted(result.results[0].missingMainIngredients), sorted(['北豆腐', '鸡蛋']));
  assert.deepEqual(sorted(result.results[0].missingSeasonings), sorted(['盐', '生抽']));
});

test('推荐不修改菜品资料或用户选择', () => {
  const data = structuredClone(recipes);
  const options = { mainIngredients: ['番茄', '鸡蛋', '番茄'], seasonings: ['盐'], difficulty: 'all' };
  const before = structuredClone({ data, options });
  recommendRecipes(data, options);
  assert.deepEqual({ data, options }, before);
});
