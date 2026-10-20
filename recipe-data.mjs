export const API_BASE_URL = "https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com";

function text(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("接口菜品资料格式不正确。");
  return value;
}

function textArray(value, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && !value.length) ||
      value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("接口菜品资料格式不正确。");
  }
  return [...value];
}

// 仅转换两条读接口的字段，不修改源数据、不读本地 JSON、不放宽筛选规则。
export function normalizeRecipeData(recipeRows, materialRows) {
  if (!Array.isArray(recipeRows) || !Array.isArray(materialRows)) throw new Error("接口资料格式不正确。");
  const groups = new Map();
  const recipes = recipeRows.map((row) => {
    if (!row || typeof row !== "object") throw new Error("接口菜品资料格式不正确。");
    const id = text(row.id);
    if (groups.has(id) || !["简单", "普通"].includes(row.difficulty) ||
        !(row.difficulty_reason === null || typeof row.difficulty_reason === "string")) {
      throw new Error("接口菜品资料格式不正确。");
    }
    groups.set(id, { main: [], seasoning: [], names: new Set(), positions: new Set() });
    return {
      id,
      name: text(row.name),
      difficulty: row.difficulty,
      steps: textArray(row.steps, true),
      difficultyReason: row.difficulty_reason,
      notes: textArray(row.notes),
      safetyNotes: textArray(row.safety_notes),
    };
  });
  for (const row of materialRows) {
    if (!row || typeof row !== "object") throw new Error("接口材料资料格式不正确。");
    const group = groups.get(text(row.recipe_id));
    const name = text(row.name);
    const amount = text(row.amount);
    if (!group || !["main", "seasoning"].includes(row.material_type) ||
        !Number.isSafeInteger(row.position) || row.position < 1) {
      throw new Error("接口材料资料不完整或格式不正确。");
    }
    const positionKey = row.material_type + ":" + row.position;
    if (group.names.has(name) || group.positions.has(positionKey)) throw new Error("接口材料资料存在重复。");
    group.names.add(name);
    group.positions.add(positionKey);
    group[row.material_type].push({ name, amount, position: row.position });
  }
  for (const recipe of recipes) {
    const group = groups.get(recipe.id);
    if (!group.main.length) throw new Error("接口菜品缺少主要食材资料。");
    const materialList = (items) => items.sort((a, b) => a.position - b.position)
      .map(({ name, amount }) => ({ name, amount }));
    recipe.mainIngredients = materialList(group.main);
    recipe.seasonings = materialList(group.seasoning);
  }
  return { recipes };
}

export async function loadRecipeData(fetchImpl = globalThis.fetch) {
  const read = async (path) => {
    const response = await fetchImpl(new URL(path, API_BASE_URL), {
      method: "GET", cache: "no-store", credentials: "omit",
    });
    if (!response.ok) throw new Error("云端读接口请求失败。");
    const payload = await response.json();
    if (payload?.ok !== true || !Array.isArray(payload.data)) throw new Error("云端读接口资料格式不正确。");
    return payload.data;
  };
  // 两条接口都成功后才提交给页面，防止用部分材料生成错误推荐。
  const [recipes, materials] = await Promise.all([read("/api/recipes"), read("/api/recipe-materials")]);
  return normalizeRecipeData(recipes, materials);
}
