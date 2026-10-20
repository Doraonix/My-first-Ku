import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API_BASE_URL, loadRecipeData, normalizeRecipeData } from "../recipe-data.mjs";

// 所有请求均由测试替身模拟；本文件的通过不代表已访问真库或公网接口。
// 菜品资料只来自已审核的现有 JSON 和 seed.sql，不新增菜品内容。
const reviewed = JSON.parse(readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"));
const seed = readFileSync(new URL("../seed.sql", import.meta.url), "utf8");
const recipeRows = reviewed.recipes.map((recipe) => ({
  id: recipe.id,
  name: recipe.name,
  difficulty: recipe.difficulty,
  steps: [...recipe.steps],
  difficulty_reason: recipe.difficultyReason ?? null,
  notes: [...reviewed.notes],
  safety_notes: [...reviewed.safetyNotes],
}));
const materialRows = reviewed.recipes.flatMap((recipe) => [
  ...recipe.mainIngredients.map((item, index) => ({
    recipe_id: recipe.id, name: item.name, material_type: "main", amount: item.amount, position: index + 1,
  })),
  ...recipe.seasonings.map((item, index) => ({
    recipe_id: recipe.id, name: item.name, material_type: "seasoning", amount: item.amount, position: index + 1,
  })),
]);
const expectedReviewed = reviewed.recipes.map((recipe) => ({
  ...recipe,
  difficultyReason: recipe.difficultyReason ?? null,
  notes: [...reviewed.notes],
  safetyNotes: [...reviewed.safetyNotes],
}));
const expectedBaseUrl = "https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com";
const recipeUrl = expectedBaseUrl + "/api/recipes";
const materialUrl = expectedBaseUrl + "/api/recipe-materials";

function copy(value) {
  return structuredClone(value);
}

function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function response(data, overrides = {}) {
  return { ok: true, status: 200, json: async () => ({ ok: true, data }), ...overrides };
}

function createFetch(recipeResponse = response(recipeRows), materialResponse = response(materialRows)) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, options: copy(options) });
    assert.ok(requestUrl === recipeUrl || requestUrl === materialUrl, "只能读取约定的两个远端接口");
    return requestUrl === recipeUrl ? recipeResponse : materialResponse;
  };
  return { fetchImpl, calls };
}

function assertRequests(calls) {
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url).sort(), [recipeUrl, materialUrl].sort());
  for (const call of calls) {
    assert.deepEqual(call.options, { method: "GET", cache: "no-store", credentials: "omit" });
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("现有四道已审核菜品转换无损，提示和难度原因按每道菜保留", () => {
  assert.equal(reviewed.recipes.length, 4);
  const actual = normalizeRecipeData(recipeRows, materialRows);
  assert.deepEqual(actual, { recipes: expectedReviewed });
  assert.equal(actual.recipes[0].difficultyReason, null);
  assert.equal(actual.recipes[2].difficultyReason, reviewed.recipes[2].difficultyReason);
  assert.deepEqual(actual.recipes[0].notes, reviewed.notes);
  assert.deepEqual(actual.recipes[0].safetyNotes, reviewed.safetyNotes);
});

test("第五道菜只从已审核 seed.sql 提取，五道菜均能关联材料", () => {
  const fifth = seed.match(/\('recipe-005', '([^']*)', '([^']*)', '([^']*)'::jsonb, (NULL::text|'[^']*')\)/u);
  const common = seed.match(/SELECT '([^']*)'::jsonb AS notes,\s*'([^']*)'::jsonb AS safety_notes/u);
  assert.ok(fifth, "seed.sql 应包含已审核 recipe-005");
  assert.ok(common, "seed.sql 应包含公共说明与安全提示");
  const fifthRecipe = {
    id: "recipe-005", name: fifth[1], difficulty: fifth[2], steps: JSON.parse(fifth[3]),
    difficulty_reason: fifth[4] === "NULL::text" ? null : fifth[4].slice(1, -1),
    notes: JSON.parse(common[1]), safety_notes: JSON.parse(common[2]),
  };
  const fifthMaterials = [...seed.matchAll(/\('recipe-005', '([^']*)', '(main|seasoning)', '([^']*)', (\d+)\)/gu)]
    .map((match) => ({ recipe_id: "recipe-005", name: match[1], material_type: match[2], amount: match[3], position: Number(match[4]) }));
  assert.equal(fifthMaterials.length, 4);
  const actual = normalizeRecipeData([...recipeRows, fifthRecipe], [...materialRows, ...fifthMaterials]);
  assert.equal(actual.recipes.length, 5);
  assert.deepEqual(actual.recipes.slice(0, 4), expectedReviewed);
  assert.deepEqual(actual.recipes[4], {
    id: "recipe-005", name: fifthRecipe.name, difficulty: fifthRecipe.difficulty,
    steps: fifthRecipe.steps, difficultyReason: fifthRecipe.difficulty_reason,
    notes: fifthRecipe.notes, safetyNotes: fifthRecipe.safety_notes,
    mainIngredients: fifthMaterials.filter((item) => item.material_type === "main").map(({ name, amount }) => ({ name, amount })),
    seasonings: fifthMaterials.filter((item) => item.material_type === "seasoning").map(({ name, amount }) => ({ name, amount })),
  });
});

test("材料按 recipe_id 关联、分组 position 排序，用量文字不被改写", () => {
  const shuffled = [...materialRows].reverse();
  assert.deepEqual(normalizeRecipeData(recipeRows, shuffled), { recipes: expectedReviewed });
  const actual = normalizeRecipeData(recipeRows, shuffled).recipes;
  assert.equal(actual[1].mainIngredients[1].amount, "半个（约 40 克）");
  assert.equal(actual[2].seasonings[1].amount, "0.5 克");
  assert.equal(actual[0].mainIngredients[0].amount, "1 个（约 150 克）");
});

test("适配不修改输入，输出与输入的数组和材料互相独立", () => {
  const inputRecipes = freezeDeep(copy(recipeRows));
  const inputMaterials = freezeDeep(copy([...materialRows].reverse()));
  const actual = normalizeRecipeData(inputRecipes, inputMaterials);
  assert.deepEqual(inputRecipes, recipeRows);
  assert.deepEqual(inputMaterials, [...materialRows].reverse());
  assert.deepEqual(actual, { recipes: expectedReviewed });
  assert.notEqual(actual.recipes[0].steps, inputRecipes[0].steps);
  assert.notEqual(actual.recipes[0].notes, inputRecipes[0].notes);
  assert.notEqual(actual.recipes[0].safetyNotes, inputRecipes[0].safety_notes);
  actual.recipes[0].steps.pop();
  actual.recipes[0].notes.pop();
  actual.recipes[0].safetyNotes.pop();
  actual.recipes[0].mainIngredients.pop();
  assert.deepEqual(inputRecipes, recipeRows);
  assert.deepEqual(inputMaterials, [...materialRows].reverse());
});

test("两个空数组合法；有主料的菜允许没有调料", () => {
  assert.deepEqual(normalizeRecipeData([], []), { recipes: [] });
  const mainOnly = materialRows.filter((item) => item.recipe_id === recipeRows[0].id && item.material_type === "main");
  const actual = normalizeRecipeData([recipeRows[0]], mainOnly);
  assert.deepEqual(actual.recipes[0].seasonings, []);
  assert.deepEqual(actual.recipes[0].mainIngredients, reviewed.recipes[0].mainIngredients);
});

test("关联异常或重复数据不能组装为可用菜品", async (t) => {
  const cases = [
    ["空菜品却有孤立材料", [], [materialRows[0]]],
    ["材料关联未知菜品", recipeRows, [...materialRows, { ...materialRows[0], recipe_id: "unknown" }]],
    ["菜品 id 重复", [...recipeRows, copy(recipeRows[0])], materialRows],
    ["同一道菜的主料与调料名字重复", recipeRows, [...materialRows, { ...materialRows[0], material_type: "seasoning", position: 3 }]],
    ["同组材料 position 重复", recipeRows, [...materialRows, { ...materialRows[1], position: materialRows[0].position }]],
    ["菜品没有主料", recipeRows, materialRows.filter((item) => item.recipe_id !== recipeRows[0].id || item.material_type !== "main")],
    ["非空菜品没有材料", recipeRows, []],
  ];
  for (const [name, recipes, materials] of cases) {
    await t.test(name, () => assert.throws(() => normalizeRecipeData(recipes, materials), Error));
  }
});

test("数组入参、菜品字段和材料字段必须符合接口契约", async (t) => {
  for (const invalid of [null, undefined, {}, "[]", 1]) {
    await t.test("菜品入参 " + String(invalid), () => assert.throws(() => normalizeRecipeData(invalid, materialRows), Error));
    await t.test("材料入参 " + String(invalid), () => assert.throws(() => normalizeRecipeData(recipeRows, invalid), Error));
  }
  const recipePatches = [
    { id: null }, { name: 1 }, { difficulty: null }, { difficulty: "较难" },
    { steps: null }, { steps: {} }, { steps: [1] },
    { difficulty_reason: 1 }, { notes: null }, { notes: [1] },
    { safety_notes: {} }, { safety_notes: [null] },
  ];
  for (const [index, patch] of recipePatches.entries()) {
    await t.test("菜品字段 " + index, () => {
      assert.throws(() => normalizeRecipeData([{ ...recipeRows[0], ...patch }, ...recipeRows.slice(1)], materialRows), Error);
    });
  }
  const materialPatches = [
    { recipe_id: null }, { name: 1 }, { amount: 150 }, { material_type: "other" },
    { position: "1" }, { position: 0 }, { position: -1 }, { position: 1.5 }, { position: NaN },
  ];
  for (const [index, patch] of materialPatches.entries()) {
    await t.test("材料字段 " + index, () => {
      assert.throws(() => normalizeRecipeData(recipeRows, [{ ...materialRows[0], ...patch }, ...materialRows.slice(1)]), Error);
    });
  }
  await t.test("菜品行不是对象", () => assert.throws(() => normalizeRecipeData([null], []), Error));
  await t.test("材料行不是对象", () => assert.throws(() => normalizeRecipeData(recipeRows, [null]), Error));
});

test("只通过固定域名的两个 GET 接口读取，不携带令牌或本地回退请求", async () => {
  assert.equal(API_BASE_URL, expectedBaseUrl);
  const { fetchImpl, calls } = createFetch();
  assert.deepEqual(await loadRecipeData(fetchImpl), { recipes: expectedReviewed });
  assertRequests(calls);
});

test("两接口并行启动；任意一端较慢时，快端成功不提前返回菜品", async (t) => {
  for (const slowUrl of [recipeUrl, materialUrl]) {
    await t.test(slowUrl.endsWith("/recipes") ? "菜品接口较慢" : "材料接口较慢", async () => {
      const recipeRequest = deferred();
      const materialRequest = deferred();
      const calls = [];
      const task = loadRecipeData((url, options) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, options: copy(options) });
        return requestUrl === recipeUrl ? recipeRequest.promise : materialRequest.promise;
      });
      let settled = false;
      task.then(() => { settled = true; }, () => { settled = true; });
      await nextTurn();
      assertRequests(calls);
      if (slowUrl === recipeUrl) materialRequest.resolve(response(materialRows));
      else recipeRequest.resolve(response(recipeRows));
      await nextTurn();
      assert.equal(settled, false, "双接口未齐时不能返回部分结果");
      if (slowUrl === recipeUrl) recipeRequest.resolve(response(recipeRows));
      else materialRequest.resolve(response(materialRows));
      assert.deepEqual(await task, { recipes: expectedReviewed });
    });
  }
});

test("任意一端失败均拒绝整次加载，不回退本地四道菜", async (t) => {
  for (const failedUrl of [recipeUrl, materialUrl]) {
    const endpoint = failedUrl === recipeUrl ? "菜品" : "材料";
    for (const failure of ["网络异常", "HTTP 失败", "JSON 解析失败"]) {
      await t.test(endpoint + "：" + failure, async () => {
        const calls = [];
        const fetchImpl = async (url, options) => {
          const requestUrl = String(url);
          calls.push({ url: requestUrl, options: copy(options) });
          if (requestUrl !== failedUrl) return response(requestUrl === recipeUrl ? recipeRows : materialRows);
          if (failure === "网络异常") throw new Error("模拟网络异常");
          if (failure === "HTTP 失败") return response([], { ok: false, status: 500 });
          return response([], { json: async () => { throw new SyntaxError("模拟非法 JSON"); } });
        };
        await assert.rejects(loadRecipeData(fetchImpl), Error);
        assertRequests(calls);
      });
    }
  }
});

test("快端成功后慢端失败也不能交付部分菜品", async () => {
  const slow = deferred();
  const task = loadRecipeData((url) => String(url) === recipeUrl ? Promise.resolve(response(recipeRows)) : slow.promise);
  let settled = false;
  task.then(() => { settled = true; }, () => { settled = true; });
  await nextTurn();
  assert.equal(settled, false);
  const rejection = assert.rejects(task, Error);
  slow.reject(new Error("模拟慢端网络失败"));
  await rejection;
});

test("JSON 外层必须 ok:true 且 data 为数组，任意接口形状异常都失败", async (t) => {
  const invalidPayloads = [
    null, [], {}, { ok: false, data: [] }, { ok: "true", data: [] },
    { data: [] }, { ok: true }, { ok: true, data: null }, { ok: true, data: {} }, { ok: true, data: "[]" },
  ];
  for (const failedUrl of [recipeUrl, materialUrl]) {
    for (const [index, invalidPayload] of invalidPayloads.entries()) {
      await t.test((failedUrl === recipeUrl ? "菜品" : "材料") + " JSON " + index, async () => {
        const invalidResponse = response([], { json: async () => invalidPayload });
        const { fetchImpl, calls } = failedUrl === recipeUrl
          ? createFetch(invalidResponse, response(materialRows))
          : createFetch(response(recipeRows), invalidResponse);
        await assert.rejects(loadRecipeData(fetchImpl), Error);
        assertRequests(calls);
      });
    }
  }
});

test("接口数据关联或字段异常拒绝加载，空双列表保持空结果", async (t) => {
  await t.test("两个空数组", async () => {
    const { fetchImpl, calls } = createFetch(response([]), response([]));
    assert.deepEqual(await loadRecipeData(fetchImpl), { recipes: [] });
    assertRequests(calls);
  });
  await t.test("材料有未知关联", async () => {
    const { fetchImpl } = createFetch(response(recipeRows), response([{ ...materialRows[0], recipe_id: "unknown" }]));
    await assert.rejects(loadRecipeData(fetchImpl), Error);
  });
  await t.test("API 内部 steps 不是数组", async () => {
    const { fetchImpl } = createFetch(response([{ ...recipeRows[0], steps: "不是数组" }]), response(materialRows));
    await assert.rejects(loadRecipeData(fetchImpl), Error);
  });
});

test("每次加载都重新读取两个接口，不复用上次结果", async () => {
  const calls = [];
  let recipeCalls = 0, materialCalls = 0;
  const fetchImpl = async (url, options) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, options: copy(options) });
    if (requestUrl === recipeUrl) return response([recipeRows[recipeCalls++]]);
    const id = recipeRows[materialCalls++].id;
    return response(materialRows.filter((item) => item.recipe_id === id));
  };
  assert.deepEqual(await loadRecipeData(fetchImpl), { recipes: [expectedReviewed[0]] });
  assert.deepEqual(await loadRecipeData(fetchImpl), { recipes: [expectedReviewed[1]] });
  assert.equal(recipeCalls, 2);
  assert.equal(materialCalls, 2);
  assertRequests(calls.slice(0, 2));
  assertRequests(calls.slice(2));
});
