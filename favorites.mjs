export const FAVORITES_KEY = "my-first-ku:favorite-recipe-ids:v1";
const browserStorage = () => globalThis.localStorage;

export function readFavorites(validIds, getStorage = browserStorage) {
  try {
    const raw = getStorage().getItem(FAVORITES_KEY);
    const ids = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && validIds.includes(id))) {
      throw new Error("收藏记录格式无法识别");
    }
    return { ok: true, ids: [...new Set(ids)] };
  } catch {
    return { ok: false, kind: "read", error: "收藏读取失败，未改动原记录。请重试读取。" };
  }
}

export function saveFavorite(validIds, recipeId, shouldSave, getStorage = browserStorage) {
  // 每次写入前重新核对原记录，避免用空列表覆盖无法读取的资料。
  const current = readFavorites(validIds, getStorage);
  if (!current.ok) return current;
  if (!validIds.includes(recipeId) || typeof shouldSave !== "boolean") {
    return { ok: false, kind: "write", error: "无法确认这道菜的收藏操作，未改动原记录。" };
  }
  const ids = shouldSave ? [...new Set([...current.ids, recipeId])] : current.ids.filter((id) => id !== recipeId);
  try {
    getStorage().setItem(FAVORITES_KEY, JSON.stringify(ids));
    return { ok: true, ids };
  } catch {
    return { ok: false, kind: "write", error: "收藏保存失败，仍显示上次确认的状态。请重试保存。" };
  }
}
