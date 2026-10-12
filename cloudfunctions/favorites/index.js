// Day 18：POST /api/favorites；UID 仅来自 CloudBase 对当前 access_token 的验证。
// 本函数不使用调用方提供的 user_id、SQL、数据库角色或运行凭据。
// Day 19：数据库操作移到同目录 database.js；入口仍负责请求校验、鉴权和 HTTP 响应。
const { queryDatabase, createFavorite } = require("./database.js");
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const AUTH_URL = "https://" + ENV_ID + ".api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=" + encodeURIComponent(ENV_ID);
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECIPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 1024;

const ERRORS = {
  METHOD_NOT_ALLOWED: [405, "只支持 POST 请求。"],
  UNSUPPORTED_MEDIA_TYPE: [415, "请使用 application/json 请求。"],
  BODY_TOO_LARGE: [413, "请求内容过长。"],
  INVALID_JSON: [400, "请求内容不是有效的 JSON。"],
  INVALID_BODY: [400, "请求内容必须是单条收藏对象。"],
  RECIPE_ID_REQUIRED: [400, "请填写菜品编号 recipe_id。"],
  RECIPE_ID_INVALID: [400, "菜品编号格式不正确。"],
  UNEXPECTED_FIELDS: [400, "请求只允许 recipe_id 字段。"],
  AUTH_REQUIRED: [401, "请先登录后再收藏。"],
  AUTH_INVALID: [401, "登录状态无效或已过期，请重新登录。"],
  AUTH_UNAVAILABLE: [503, "暂时无法验证登录状态，请稍后重试。"],
  FAVORITE_EXISTS: [409, "你已经收藏过这道菜，请勿重复提交。"],
  RECIPE_NOT_FOUND: [404, "这道菜不存在，无法收藏。"],
  FAVORITE_WRITE_FAILED: [500, "暂时无法保存收藏，请稍后重试。"],
};

class FavoriteError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

function failure(code) {
  const [statusCode, message] = ERRORS[code];
  return response(statusCode, { ok: false, error: { code, message } },
    code === "METHOD_NOT_ALLOWED" ? { Allow: "POST" } : {});
}

function readHeader(headers, name) {
  const values = Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!values.length) return undefined;
  if (values.length !== 1 || typeof values[0][1] !== "string") {
    throw new FavoriteError(name === "Authorization" ? "AUTH_INVALID" : "UNSUPPORTED_MEDIA_TYPE");
  }
  return values[0][1];
}

function requestRecipeId(event) {
  const contentType = readHeader(event?.headers, "Content-Type");
  if (contentType !== undefined && !/^application\/json(?:\s*;.*)?$/i.test(contentType.trim())) {
    throw new FavoriteError("UNSUPPORTED_MEDIA_TYPE");
  }
  let body = event?.body;
  if (event?.isBase64Encoded !== undefined && typeof event.isBase64Encoded !== "boolean") {
    throw new FavoriteError("INVALID_BODY");
  }
  if (event?.isBase64Encoded === true) {
    if (typeof body !== "string" || body.length > 2048) throw new FavoriteError("INVALID_BODY");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) {
      throw new FavoriteError("INVALID_JSON");
    }
    const bytes = Buffer.from(body, "base64");
    if (bytes.toString("base64") !== body) throw new FavoriteError("INVALID_JSON");
    body = bytes.toString("utf8");
  }
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw new FavoriteError("BODY_TOO_LARGE");
    try { body = JSON.parse(body); } catch { throw new FavoriteError("INVALID_JSON"); }
  }
  if (!body || Object.prototype.toString.call(body) !== "[object Object]") {
    throw new FavoriteError("INVALID_BODY");
  }
  let encoded;
  try { encoded = JSON.stringify(body); } catch { throw new FavoriteError("INVALID_BODY"); }
  if (Buffer.byteLength(encoded, "utf8") > MAX_BODY_BYTES) throw new FavoriteError("BODY_TOO_LARGE");
  if (Object.keys(body).some((key) => key !== "recipe_id")) throw new FavoriteError("UNEXPECTED_FIELDS");
  if (!Object.hasOwn(body, "recipe_id") || body.recipe_id === null || body.recipe_id === undefined ||
      (typeof body.recipe_id === "string" && !body.recipe_id.trim())) {
    throw new FavoriteError("RECIPE_ID_REQUIRED");
  }
  if (typeof body.recipe_id !== "string" || !RECIPE_PATTERN.test(body.recipe_id)) {
    throw new FavoriteError("RECIPE_ID_INVALID");
  }
  return body.recipe_id;
}

function requestToken(event) {
  const authorization = readHeader(event?.headers, "Authorization");
  if (authorization === undefined) throw new FavoriteError("AUTH_REQUIRED");
  const match = authorization.length <= 8192 && authorization.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/i);
  if (!match) throw new FavoriteError("AUTH_INVALID");
  return match[1];
}

async function verifyAccessToken(token) {
  let result, identity;
  try {
    result = await fetch(AUTH_URL, {
      method: "GET", headers: { Authorization: "Bearer " + token },
      cache: "no-store", credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(1000),
    });
    if (!result.ok) {
      throw new FavoriteError(result.status >= 400 && result.status < 500 ? "AUTH_INVALID" : "AUTH_UNAVAILABLE");
    }
    identity = await result.json();
  } catch (error) {
    if (error instanceof FavoriteError) throw error;
    throw new FavoriteError("AUTH_UNAVAILABLE");
  }
  if (!identity || Array.isArray(identity) || typeof identity.token_type !== "string" ||
      identity.token_type.toLowerCase() !== "bearer" || identity.client_id !== ENV_ID ||
      typeof identity.sub !== "string" || !UID_PATTERN.test(identity.sub)) {
    throw new FavoriteError("AUTH_INVALID");
  }
  return identity.sub;
}

function createHandler({ verifyToken = verifyAccessToken, executePGSql = queryDatabase, logStage = () => {} } = {}) {
  return async (event, context) => {
    const startedAt = Date.now();
    const trace = (stage, code) => logStage(stage, Date.now() - startedAt, code);
    trace("entry");
    if (event?.httpMethod !== "POST") return failure("METHOD_NOT_ALLOWED");
    let recipeId, token;
    try {
      recipeId = requestRecipeId(event);
      token = requestToken(event);
    } catch (error) {
      return failure(error instanceof FavoriteError ? error.code : "INVALID_BODY");
    }
    let uid;
    trace("auth_start");
    try {
      uid = await verifyToken(token, trace);
      if (typeof uid !== "string" || !UID_PATTERN.test(uid)) throw new FavoriteError("AUTH_INVALID");
    } catch (error) {
      const code = error instanceof FavoriteError ? error.code : "AUTH_UNAVAILABLE";
      trace("auth_error", code);
      return failure(code);
    }
    trace("auth_ready");
    try {
      const favorite = await createFavorite(uid, recipeId, executePGSql, trace, context);
      if (favorite.outcome === "duplicate") return failure("FAVORITE_EXISTS");
      if (favorite.outcome === "recipe_not_found") return failure("RECIPE_NOT_FOUND");
      return response(201, { ok: true, data: favorite.data });
    } catch {
      // SQL、UID、token、上下文、平台凭据和原始异常均不输出。
      return failure("FAVORITE_WRITE_FAILED");
    }
  };
}

exports.createHandler = createHandler;
// 每个请求重新验证用户身份；数据访问层重新创建写库客户端，无自动重试。
exports.main = createHandler({ logStage: (stage, elapsedMs, code) => {
  const suffix = stage === "api_error" || stage === "auth_error" ? " code=" + code : "";
  console.info("[favorites-diag-v1] " + stage + " elapsed_ms=" + elapsedMs + suffix);
} });
