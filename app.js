import { recommendRecipes, getRecipeAvailability } from "./recommendations.mjs";
import { readFavorites, saveFavorite } from "./favorites.mjs";
import { loadRecipeData } from "./recipe-data.mjs";

const filters = document.querySelector("#recipe-filters");
const recommendButton = document.querySelector("#recommend-button");
const clearFiltersButton = document.querySelector("#clear-filters-button");
const resultList = document.querySelector("#recipe-list");
const resultNote = document.querySelector("#results-note");
const previewNotice = document.querySelector("#preview-notice");
const dataSourceNote = document.querySelector("#data-source-note");
const detailContent = document.querySelector("#recipe-detail-content");
const favoriteList = document.querySelector("#favorites-list");
const favoriteStatus = document.querySelector("#favorites-status");
const favoriteRetry = document.querySelector("#favorites-retry");
const detailFavoriteStatus = document.querySelector("#detail-favorites-status");
const detailFavoriteRetry = document.querySelector("#detail-favorites-retry");
const detailBack = document.querySelector("#detail-back");
const routeNote = document.querySelector("#route-note");
const statePreviewNotice = document.querySelector("#state-preview-notice");
const statePreviewText = document.querySelector("#state-preview-text");
const exitStatePreview = document.querySelector("#exit-state-preview");
const previewMode = import.meta.env?.DEV === true
  && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  ? new URLSearchParams(window.location.search).get("state-preview") : null;
const views = {
  home: document.querySelector("#home-view"),
  detail: document.querySelector("#recipe-detail"),
  favorites: document.querySelector("#favorites"),
};
const navigation = [
  [document.querySelector("#nav-home"), "#home", "home"],
  [document.querySelector("#nav-favorites"), "#favorites", "favorites"],
];
const initialResultNote = "请至少选择一种主要食材，再点击“看看能做什么”。";
let recipes = [];
let ready = false;
let favoriteIds = [];
let favoritesReadable = false;
let pendingFavorite = null;
let activeDetail = null;
let recommendationSelection = null;
let currentView = "home";
let renderedHash = null;
let recipeLoadFailed = false;
let recipeUnavailableMessage = "菜品资料未加载，暂时无法查看详情。";

function updateStatePreviewExit() {
  if (previewMode !== "loading" && previewMode !== "error") return;
  const exitUrl = new URL(window.location.href);
  exitUrl.searchParams.delete("state-preview");
  exitStatePreview.href = exitUrl.href;
}

function focusCurrentView() {
  const target = currentView === "detail"
    ? detailContent.querySelector("h3") ?? document.querySelector("#detail-heading")
    : currentView === "favorites" ? document.querySelector("#favorites-heading")
      : document.querySelector(resultList.children.length ? "#results-heading" : "#page-title");
  target.focus();
}

function renderRoute(focus = true) {
  let hash = window.location.hash;
  if (hash !== renderedHash) routeNote.hidden = true;
  if (!hash) {
    hash = "#home";
    window.history.replaceState(null, "", hash);
  }
  const detailRoute = hash.match(/^#recipe(?:\/([a-zA-Z0-9_-]+))?$/);
  if (hash !== "#home" && hash !== "#favorites" && !detailRoute) {
    hash = "#home";
    window.history.replaceState(null, "", hash);
    routeNote.textContent = "这个地址没有对应的视图，已返回选菜首页。";
    routeNote.hidden = false;
  }
  currentView = detailRoute ? "detail" : hash === "#favorites" ? "favorites" : "home";
  renderedHash = hash;
  for (const [name, view] of Object.entries(views)) view.hidden = name !== currentView;
  for (const [link, , name] of navigation) link.setAttribute("aria-current", name === currentView ? "page" : "false");
  const viewTitle = currentView === "home" ? "从现有食材开始选菜" : currentView === "favorites" ? "我的收藏" : "菜品详情";
  document.title = `下一餐｜${viewTitle}`;
  updateStatePreviewExit();
  if (currentView === "detail") {
    detailBack.textContent = window.history.state?.nextMealDetailFrom === "favorites" ? "返回收藏" : "返回选菜";
    if (!ready) {
      resetRecipeDetail(recipeLoadFailed ? recipeUnavailableMessage : "正在加载菜品资料，请稍候……");
    } else if (!detailRoute[1]) {
      resetRecipeDetail();
    } else {
      const recipe = recipes.find((item) => item.id === detailRoute[1]);
      if (recipe) {
        showRecipeDetail({ recipe,
          ...(recommendationSelection ? getRecipeAvailability(recipe, recommendationSelection) : {}) });
      } else {
        resetRecipeDetail("没有找到这道菜，请返回选菜或从收藏中重新选择。");
      }
    }
  }
  if (focus) focusCurrentView();
}

function navigate(hash, from) {
  routeNote.hidden = true;
  if (window.location.hash !== hash) window.location.hash = hash;
  // 来源跟随这条历史记录，前进、后退时不会借用另一次打开详情的来源。
  if (from) window.history.replaceState({ nextMealDetailFrom: from }, "", hash);
  renderRoute();
}

for (const [link, hash] of navigation) {
  link.addEventListener("click", (event) => {
    if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(hash);
  });
}
detailBack.addEventListener("click", () => {
  navigate(window.history.state?.nextMealDetailFrom === "favorites" ? "#favorites" : "#home");
});
document.querySelector("#skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  focusCurrentView();
});
window.addEventListener("hashchange", () => {
  if (window.location.hash !== renderedHash) renderRoute();
});

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

function recipeSteps(recipe) {
  const section = detailList("做法步骤", recipe.steps, true);
  const steps = section.querySelector("ol");
  steps.id = "recipe-steps";
  steps.hidden = false;
  const toggle = element("button", "button button-secondary steps-toggle", "收起做法");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", steps.id);
  toggle.setAttribute("aria-expanded", "true");
  toggle.addEventListener("click", () => {
    steps.hidden = !steps.hidden;
    toggle.textContent = steps.hidden ? "展开做法" : "收起做法";
    toggle.setAttribute("aria-expanded", String(!steps.hidden));
  });
  section.replaceChildren(section.querySelector("h4"), toggle, steps);
  return section;
}

function resetRecipeDetail(message = "请从推荐结果或收藏中选择一道菜，查看完整材料和做法。") {
  activeDetail = null;
  detailContent.replaceChildren(element("p", "placeholder", message));
  delete detailContent.dataset.recipeId;
  syncDetailFavoriteFeedback();
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
    recipeSteps(recipe),
    detailList("用量与烹调说明", recipe.notes),
    detailList("安全提醒", recipe.safetyNotes),
  );
  const favoriteButton = element("button", "button button-secondary detail-favorite");
  favoriteButton.type = "button";
  favoriteButton.setAttribute("aria-describedby", "detail-favorites-status");
  favoriteButton.addEventListener("click", () => changeFavorite(recipe.id, !favoriteIds.includes(recipe.id)));
  detailContent.append(favoriteButton);
  updateDetailFavoriteButton();
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
  detailsButton.addEventListener("click", () => navigate(`#recipe/${recipe.id}`, "home"));
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

clearFiltersButton.addEventListener("click", () => {
  if (!ready) return;
  for (const input of filters.querySelectorAll("input")) {
    input.checked = input.name === "difficulty" && input.value === "all";
  }
  resultList.replaceChildren();
  recommendationSelection = null;
  resetRecipeDetail();
  resultNote.textContent = initialResultNote;
});

// 条件一变就清除旧结果和详情，避免沿用过期的缺料信息。
filters.addEventListener("change", () => {
  if (!ready) return;
  resultList.replaceChildren();
  recommendationSelection = null;
  resetRecipeDetail("条件已修改，请重新推荐后查看菜品详情。");
  resultNote.textContent = selectedValues("main-ingredient").length
    ? "条件已修改，请点击“看看能做什么”重新推荐。"
    : "请至少选择一种主要食材；只选择调料还不能推荐。";
});

function syncDetailFavoriteFeedback() {
  detailFavoriteStatus.textContent = favoriteStatus.textContent;
  detailFavoriteStatus.hidden = !activeDetail;
  detailFavoriteRetry.textContent = favoriteRetry.textContent;
  detailFavoriteRetry.hidden = !activeDetail || favoriteRetry.hidden;
}

function updateDetailFavoriteButton() {
  syncDetailFavoriteFeedback();
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
    view.addEventListener("click", () => navigate(`#recipe/${recipe.id}`, "favorites"));
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

function retryFavorite() {
  if (pendingFavorite) changeFavorite(pendingFavorite.id, pendingFavorite.shouldSave);
  else loadFavorites();
}
favoriteRetry.addEventListener("click", retryFavorite);
detailFavoriteRetry.addEventListener("click", retryFavorite);

async function loadRecipes() {
  if (previewMode === "loading") return;
  try {
    if (previewMode === "error") throw new Error("状态演示：模拟菜品资料读取失败");
    const data = await loadRecipeData();
    recipes = data.recipes;
    dataSourceNote.textContent = `数据来源：云端读接口；本次加载 ${recipes.length} 道菜。`;
    if (!recipes.length) {
      recipeLoadFailed = true;
      recipeUnavailableMessage = "数据库暂无菜品资料，暂时无法查看详情。";
      previewNotice.hidden = false;
      previewNotice.textContent = "数据库暂无菜品资料，请稍后刷新。";
      document.getElementById("main-ingredients").replaceChildren(element("p", "field-note", "数据库暂无主要食材资料。"));
      document.getElementById("seasonings").replaceChildren(element("p", "field-note", "数据库暂无调料资料。"));
      resultNote.textContent = "数据库暂无菜品，暂时无法生成推荐。";
      favoriteStatus.textContent = "暂无菜品资料可供显示收藏；已保存的收藏不会删除。";
      resetRecipeDetail(recipeUnavailableMessage);
      renderRoute(false);
      return;
    }
    renderChoices("main-ingredients", "main-ingredient", "mainIngredients");
    renderChoices("seasonings", "seasoning", "seasonings");
    for (const fieldset of filters.querySelectorAll("fieldset")) fieldset.disabled = false;
    recommendButton.disabled = false;
    clearFiltersButton.disabled = false;
    ready = true;
    previewNotice.hidden = true;
    resultNote.textContent = initialResultNote;
    loadFavorites();
    renderRoute(false);
  } catch (error) {
    recipeLoadFailed = true;
    previewNotice.hidden = false;
    previewNotice.textContent = "菜品资料未能加载，请确认读接口已部署并允许此页面访问，再刷新重试。";
    dataSourceNote.textContent = "数据来源：云端读接口；本次加载失败，未使用示例数据。";
    document.getElementById("main-ingredients").replaceChildren(
      element("p", "field-note", "主要食材未能加载，请刷新页面重试。"),
    );
    document.getElementById("seasonings").replaceChildren(
      element("p", "field-note", "调料未能加载，请刷新页面重试。"),
    );
    resultNote.textContent = "资料未加载，暂时无法生成推荐。";
    favoriteStatus.textContent = "菜品资料未加载，暂时无法显示收藏。";
    resetRecipeDetail("菜品资料未加载，暂时无法查看详情。");
    renderRoute(false);
    if (previewMode !== "error") console.error("菜品资料加载失败：", error);
  }
}

if (previewMode === "loading" || previewMode === "error") {
  statePreviewNotice.hidden = false;
  statePreviewText.textContent = previewMode === "loading"
    ? "状态演示：加载中。此页面会停留在加载状态，方便核对；点击退出演示可恢复正常使用。"
    : "状态演示：加载失败。这是用于核对错误提示的模拟情况；点击退出演示可恢复正常使用。";
}

renderRoute(false);
loadRecipes();
