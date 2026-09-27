import { recommendRecipes, getRecipeAvailability } from "./recommendations.mjs";
import { readFavorites, saveFavorite } from "./favorites.mjs";

const filters = document.querySelector("#recipe-filters");
const recommendButton = document.querySelector("#recommend-button");
const resultList = document.querySelector("#recipe-list");
const resultNote = document.querySelector("#results-note");
const previewNotice = document.querySelector("#preview-notice");
const detailContent = document.querySelector("#recipe-detail-content");
const favoriteList = document.querySelector("#favorites-list");
const favoriteStatus = document.querySelector("#favorites-status");
const favoriteRetry = document.querySelector("#favorites-retry");
let recipes = [];
let recipeNotes = [];
let safetyNotes = [];
let ready = false;
let favoriteIds = [];
let favoritesReadable = false;
let pendingFavorite = null;
let activeDetail = null;
let recommendationSelection = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderChoices(containerId, fieldName, materialKey) {
  const container = document.getElementById(containerId);
  const names = new Set(recipes.flatMap((recipe) => recipe[materialKey].map((item) => item.name)));
  container.replaceChildren();
  for (const name of names) {
    const label = element("label", "choice");
    const input = element("input");
    input.type = "checkbox";
    input.name = fieldName;
    input.value = name;
    label.append(input, document.createTextNode(name));
    container.append(label);
  }
}

function selectedValues(fieldName) {
  return [...filters.querySelectorAll(`input[name="${fieldName}"]:checked`)]
    .map((input) => input.value);
}

function missingSummary({ missingMainIngredients, missingSeasonings }) {
  const missing = element("div", "missing-summary");
  missing.append(
    element("p", "", missingMainIngredients.length
      ? `缺少 ${missingMainIngredients.length} 种主要食材：${missingMainIngredients.join("、")}`
      : "主要食材齐全"),
    element("p", "", missingSeasonings.length
      ? `缺少调料：${missingSeasonings.join("、")}`
      : "调料齐全"),
  );
  return missing;
}

function detailList(title, items, ordered = false) {
  const section = element("section", "detail-section");
  const list = element(ordered ? "ol" : "ul");
  list.append(...items.map((text) => element("li", "", text)));
  section.append(element("h4", "", title), list);
  return section;
}

function resetRecipeDetail(message = "请从推荐结果或收藏中选择一道菜，查看完整材料和做法。") {
  activeDetail = null;
  detailContent.replaceChildren(element("p", "placeholder", message));
  delete detailContent.dataset.recipeId;
}

function showRecipeDetail(match) {
  const { recipe } = match;
  activeDetail = recipe;
  const heading = element("div", "card-heading detail-header");
  const title = element("h3", "", recipe.name);
  title.tabIndex = -1;
  heading.append(title, element("span", "difficulty-badge", recipe.difficulty));
  detailContent.replaceChildren(heading);
  detailContent.dataset.recipeId = recipe.id;
  if (recipe.difficultyReason) detailContent.append(element("p", "field-note", recipe.difficultyReason));
  if (match.missingMainIngredients !== undefined) {
    detailContent.append(
      element("p", "detail-context", "缺料情况根据最近一次有效选材计算；用量是否足够，请对照下面的完整材料确认。"),
      missingSummary(match),
    );
  } else {
    detailContent.append(element("p", "detail-context", "尚无有效选材条件，以下展示完整材料和做法，未判断缺料情况。"));
  }
  detailContent.append(
    detailList("主要食材与用量", recipe.mainIngredients.map((item) => `${item.name}：${item.amount}`)),
    detailList("调料与用量", recipe.seasonings.map((item) => `${item.name}：${item.amount}`)),
    detailList("做法步骤", recipe.steps, true),
    detailList("用量与烹调说明", recipeNotes),
    detailList("安全提醒", safetyNotes),
  );
  const favoriteButton = element("button", "button button-secondary detail-favorite");
  favoriteButton.type = "button";
  favoriteButton.setAttribute("aria-describedby", "favorites-status");
  favoriteButton.addEventListener("click", () => changeFavorite(recipe.id, !favoriteIds.includes(recipe.id)));
  detailContent.append(favoriteButton);
  updateDetailFavoriteButton();
  title.focus();
}

function recipeCard(match) {
  const { recipe } = match;
  const card = element("article", "recipe-card");
  card.dataset.recipeId = recipe.id;
  const heading = element("div", "card-heading");
  heading.append(element("h3", "", recipe.name), element("span", "difficulty-badge", recipe.difficulty));
  const detailsButton = element("button", "button button-secondary", "查看做法");
  detailsButton.type = "button";
  detailsButton.setAttribute("aria-label", `查看${recipe.name}的做法`);
  detailsButton.addEventListener("click", () => showRecipeDetail(match));
  card.append(heading, element("p", "material-label", "主要食材"),
    element("p", "", recipe.mainIngredients.map((item) => item.name).join(" · ")),
    missingSummary(match), detailsButton);
  return card;
}

recommendButton.addEventListener("click", () => {
  if (!ready) return;
  resetRecipeDetail();
  const selection = {
    mainIngredients: selectedValues("main-ingredient"),
    seasonings: selectedValues("seasoning"),
    difficulty: selectedValues("difficulty")[0] ?? "all",
  };
  recommendationSelection = selection.mainIngredients.length ? selection : null;
  const recommendation = recommendRecipes(recipes, selection);
  resultList.replaceChildren();
  if (recommendation.status === "needs-ingredients") {
    resultNote.textContent = "请至少选择一种主要食材；只选择调料还不能推荐。";
  } else if (recommendation.status === "no-matches") {
    resultNote.textContent = "当前条件没有符合的菜，请调整主要食材或制作难度。";
  } else {
    resultNote.textContent = `找到 ${recommendation.results.length} 道菜：缺少主要食材越少越靠前，同等情况简单优先。用量仍需对照菜谱确认。`;
    resultList.append(...recommendation.results.map(recipeCard));
  }
  document.querySelector("#results-heading").focus();
});

// 条件一变就清除旧结果和详情，避免沿用过期的缺料信息。
filters.addEventListener("change", () => {
  if (!ready) return;
  resultList.replaceChildren();
  recommendationSelection = null;
  resetRecipeDetail("条件已修改，请重新推荐后查看菜品详情。");
  resultNote.textContent = "条件已修改，请点击“看看能做什么”重新推荐。";
});

function updateDetailFavoriteButton() {
  const button = detailContent.querySelector(".detail-favorite");
  if (!button || !activeDetail) return;
  button.disabled = !favoritesReadable;
  button.textContent = !favoritesReadable ? "收藏状态未读取"
    : favoriteIds.includes(activeDetail.id) ? "取消收藏" : "收藏";
}

function renderFavorites() {
  favoriteList.replaceChildren();
  if (!favoriteIds.length) {
    favoriteList.append(element("p", "placeholder", favoritesReadable ? "还没有收藏的菜" : "暂时无法确认收藏列表。"));
    return;
  }
  if (!favoritesReadable) favoriteList.append(element("p", "field-note", "以下为上次成功读取的收藏，当前记录尚未确认。"));
  for (const id of favoriteIds) {
    const recipe = recipes.find((item) => item.id === id);
    const card = element("article", "favorite-card");
    card.dataset.recipeId = id;
    card.append(element("h3", "", recipe.name), element("p", "field-note", recipe.difficulty));
    const actions = element("div", "favorite-actions");
    const view = element("button", "button button-secondary", "查看做法");
    view.type = "button";
    view.setAttribute("aria-label", `查看${recipe.name}的做法`);
    view.addEventListener("click", () => showRecipeDetail({ recipe,
      ...(recommendationSelection ? getRecipeAvailability(recipe, recommendationSelection) : {}) }));
    const remove = element("button", "button button-secondary", "取消收藏");
    remove.type = "button";
    remove.disabled = !favoritesReadable;
    remove.setAttribute("aria-label", `取消收藏${recipe.name}`);
    remove.addEventListener("click", () => {
      changeFavorite(id, false);
      document.querySelector("#favorites-heading").focus();
    });
    actions.append(view, remove);
    card.append(actions);
    favoriteList.append(card);
  }
}

function loadFavorites() {
  const result = readFavorites(recipes.map((recipe) => recipe.id));
  favoritesReadable = result.ok;
  pendingFavorite = null;
  if (result.ok) favoriteIds = result.ids;
  favoriteStatus.textContent = result.ok ? (favoriteIds.length ? `已收藏 ${favoriteIds.length} 道菜` : "") : result.error;
  favoriteRetry.hidden = result.ok;
  favoriteRetry.textContent = "重试读取";
  renderFavorites();
  updateDetailFavoriteButton();
}

function changeFavorite(id, shouldSave) {
  const result = saveFavorite(recipes.map((recipe) => recipe.id), id, shouldSave);
  if (result.ok) {
    favoriteIds = result.ids;
    favoritesReadable = true;
    pendingFavorite = null;
    favoriteRetry.hidden = true;
    const name = recipes.find((recipe) => recipe.id === id).name;
    favoriteStatus.textContent = `${shouldSave ? "已收藏" : "已取消收藏"}：${name}。`;
  } else {
    pendingFavorite = result.kind === "write" ? { id, shouldSave } : null;
    if (result.kind === "read") favoritesReadable = false;
    favoriteStatus.textContent = result.error;
    favoriteRetry.hidden = false;
    favoriteRetry.textContent = pendingFavorite ? "重试保存" : "重试读取";
  }
  renderFavorites();
  updateDetailFavoriteButton();
}

favoriteRetry.addEventListener("click", () => {
  if (pendingFavorite) changeFavorite(pendingFavorite.id, pendingFavorite.shouldSave);
  else loadFavorites();
});

async function loadRecipes() {
  try {
    const response = await fetch(new URL("./data/recipes.json", import.meta.url));
    if (!response.ok) throw new Error(`菜品请求失败：${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.recipes) || !data.recipes.length) throw new Error("菜品资料为空或格式不正确");
    recipes = data.recipes;
    recipeNotes = data.notes ?? [];
    safetyNotes = data.safetyNotes ?? [];
    renderChoices("main-ingredients", "main-ingredient", "mainIngredients");
    renderChoices("seasonings", "seasoning", "seasonings");
    for (const fieldset of filters.querySelectorAll("fieldset")) fieldset.disabled = false;
    recommendButton.disabled = false;
    ready = true;
    previewNotice.hidden = true;
    resultNote.textContent = "请至少选择一种主要食材，再点击“看看能做什么”。";
    loadFavorites();
  } catch (error) {
    previewNotice.hidden = false;
    previewNotice.textContent = "菜品资料未能加载，请确认通过本地预览服务打开后刷新。";
    document.getElementById("main-ingredients").replaceChildren(
      element("p", "field-note", "主要食材未能加载，请刷新页面重试。"),
    );
    document.getElementById("seasonings").replaceChildren(
      element("p", "field-note", "调料未能加载，请刷新页面重试。"),
    );
    resultNote.textContent = "资料未加载，暂时无法生成推荐。";
    favoriteStatus.textContent = "菜品资料未加载，暂时无法显示收藏。";
    resetRecipeDetail("菜品资料未加载，暂时无法查看详情。");
    console.error("菜品资料加载失败：", error);
  }
}

loadRecipes();
