// 按不同材料名称计数，用量和调料缺项不影响主要食材的匹配规则。
export function getRecipeAvailability(recipe, { mainIngredients = [], seasonings = [] } = {}) {
  const missing = (materials, owned) => [...new Set(materials.map((item) => item.name))]
    .filter((name) => !owned.includes(name));
  return {
    missingMainIngredients: missing(recipe.mainIngredients, mainIngredients),
    missingSeasonings: missing(recipe.seasonings, seasonings),
  };
}

export function recommendRecipes(recipes, { mainIngredients = [], seasonings = [], difficulty = "all" } = {}) {
  const ownedMain = new Set(mainIngredients);
  if (ownedMain.size === 0) return { status: "needs-ingredients", results: [] };

  const results = [];
  for (const recipe of recipes) {
    if (difficulty !== "all" && recipe.difficulty !== difficulty) continue;
    const requiredMain = [...new Set(recipe.mainIngredients.map((item) => item.name))];
    if (!requiredMain.some((name) => ownedMain.has(name))) continue;
    const availability = getRecipeAvailability(recipe, { mainIngredients, seasonings });
    if (availability.missingMainIngredients.length > 2) continue;
    results.push({ recipe, ...availability });
  }

  const difficultyOrder = { 简单: 0, 普通: 1 };
  results.sort((first, second) =>
    first.missingMainIngredients.length - second.missingMainIngredients.length ||
    difficultyOrder[first.recipe.difficulty] - difficultyOrder[second.recipe.difficulty]);
  return { status: results.length ? "ready" : "no-matches", results };
}
