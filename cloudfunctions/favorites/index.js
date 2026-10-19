// Day 18：POST /api/favorites；UID 仅来自 CloudBase 对当前 access_token 的验证。
// 本函数不使用调用方提供的 user_id、SQL、数据库角色或运行凭据。
// Day 19：数据库操作移到同目录 database.js；入口仍负责请求校验、鉴权和 HTTP 响应。
// Day 22：本人收藏 GET、单条备注 PATCH；DELETE 按方案 A 返回删除确认或 404。
const { queryDatabase, createFavorite, readFavorites, updateFavoriteNote, deleteFavorite } = require("./database.js");
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const AUTH_URL = "https://" + ENV_ID + ".api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=" + encodeURIComponent(ENV_ID);
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECIPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 1024;
const MAX_NOTE_CHARACTERS = 200;
const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE"];
// 只允许类型枚举和有界计数进入 PATCH 结构日志，拒绝任意详情字符串。
const DIAGNOSTIC_TYPE = "(?:null|array|undefined|object|string|number|boolean|other)";
const DIAGNOSTIC_COUNT = "(?:none|100_plus|100|[1-9]?[0-9])";
const PATCH_SHAPE_PATTERN = new RegExp("^result_type=" + DIAGNOSTIC_TYPE +
  " columns_type=" + DIAGNOSTIC_TYPE + " columns_count=" + DIAGNOSTIC_COUNT +
  " rows_type=" + DIAGNOSTIC_TYPE + " rows_count=" + DIAGNOSTIC_COUNT + "$");

const ERRORS = {
  METHOD_NOT_ALLOWED: [405, "只支持 GET、POST、PATCH 或 DELETE 请求。"],
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
  INVALID_QUERY: [400, "查询只允许一个有效的 recipe_id。"],
  GET_BODY_NOT_ALLOWED: [400, "GET 请求不能携带收藏内容。"],
  DELETE_BODY_NOT_ALLOWED: [400, "DELETE 请求不能携带请求体，请在查询参数中指定 recipe_id。"],
  PATCH_FIELDS_INVALID: [400, "PATCH 请求只允许 recipe_id 和 note 字段。"],
  NOTE_REQUIRED: [400, "请填写收藏备注 note。"],
  NOTE_INVALID: [400, "备注须为不含控制字符的文本，最多 200 个字符。"],
  FAVORITE_NOT_FOUND: [404, "未找到你的这条收藏。"],
  FAVORITE_READ_FAILED: [500, "暂时无法读取收藏，请稍后重试。"],
  FAVORITE_DELETE_FAILED: [500, "无法确认删除结果，请先核对收藏状态，不要立即重复删除。"],
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
    code === "METHOD_NOT_ALLOWED" ? { Allow: ALLOWED_METHODS.join(", ") } : {});
}

function readHeader(headers, name) {
  const values = Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!values.length) return undefined;
  if (values.length !== 1 || typeof values[0][1] !== "string") {
    throw new FavoriteError(name === "Authorization" ? "AUTH_INVALID" : "UNSUPPORTED_MEDIA_TYPE");
  }
  return values[0][1];
}

function requestBody(event) {
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
  return body;
}

function bodyRecipeId(body) {
  if (!Object.hasOwn(body, "recipe_id") || body.recipe_id === null || body.recipe_id === undefined ||
      (typeof body.recipe_id === "string" && !body.recipe_id.trim())) {
    throw new FavoriteError("RECIPE_ID_REQUIRED");
  }
  if (typeof body.recipe_id !== "string" || !RECIPE_PATTERN.test(body.recipe_id)) {
    throw new FavoriteError("RECIPE_ID_INVALID");
  }
  return body.recipe_id;
}

function requestRecipeId(event) {
  const body = requestBody(event);
  if (Object.keys(body).some((key) => key !== "recipe_id")) throw new FavoriteError("UNEXPECTED_FIELDS");
  return bodyRecipeId(body);
}

function requestPatch(event) {
  const body = requestBody(event);
  if (Object.keys(body).some((key) => !["recipe_id", "note"].includes(key))) {
    throw new FavoriteError("PATCH_FIELDS_INVALID");
  }
  const recipeId = bodyRecipeId(body);
  if (!Object.hasOwn(body, "note")) throw new FavoriteError("NOTE_REQUIRED");
  const note = body.note;
  if (typeof note !== "string" || Array.from(note).length > MAX_NOTE_CHARACTERS ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(note) || Buffer.from(note, "utf8").toString("utf8") !== note) {
    throw new FavoriteError("NOTE_INVALID");
  }
  return { recipeId, note };
}

function requestFavoriteQuery(event) {
  if (event?.body !== undefined && event.body !== null && event.body !== "") {
    throw new FavoriteError("GET_BODY_NOT_ALLOWED");
  }
  const query = event?.queryStringParameters;
  if (query !== undefined && query !== null &&
      (Object.prototype.toString.call(query) !== "[object Object]" ||
       Object.keys(query).some((key) => key !== "recipe_id"))) {
    throw new FavoriteError("INVALID_QUERY");
  }
  const recipeId = query && Object.hasOwn(query, "recipe_id") ? query.recipe_id : undefined;
  if (recipeId !== undefined && (typeof recipeId !== "string" || !RECIPE_PATTERN.test(recipeId))) {
    throw new FavoriteError("INVALID_QUERY");
  }
  if (query && Object.hasOwn(query, "recipe_id") && recipeId === undefined) {
    throw new FavoriteError("INVALID_QUERY");
  }
  // 如网关同时提供多值参数，必须与单值参数一致，不能接受重复编号。
  const multi = event?.multiValueQueryStringParameters;
  if (multi !== undefined && multi !== null &&
      (Object.prototype.toString.call(multi) !== "[object Object]" ||
       Object.keys(multi).some((key) => key !== "recipe_id") ||
       (Object.hasOwn(multi, "recipe_id") &&
        (!Array.isArray(multi.recipe_id) || multi.recipe_id.length !== 1 ||
         typeof multi.recipe_id[0] !== "string" || !RECIPE_PATTERN.test(multi.recipe_id[0]) ||
         multi.recipe_id[0] !== recipeId)))) {
    throw new FavoriteError("INVALID_QUERY");
  }
  return recipeId;
}

function requestDelete(event) {
  if (event?.body !== undefined && event.body !== null && event.body !== "") {
    throw new FavoriteError("DELETE_BODY_NOT_ALLOWED");
  }
  const recipeId = requestFavoriteQuery(event);
  // GET 可省略编号以读全列表；DELETE 必须明确指定唯一编号。
  if (recipeId === undefined) throw new FavoriteError("RECIPE_ID_REQUIRED");
  // 网关如提供原始参数，还须检查重复键、额外字段和单值表示是否一致。
  // 未提供原始/多值参数时，不能凭单值对象判断 URL 是否曾出现重复键。
  if (event?.rawQueryString !== undefined) {
    if (typeof event.rawQueryString !== "string") throw new FavoriteError("INVALID_QUERY");
    const entries = [...new URLSearchParams(event.rawQueryString)];
    if (entries.length !== 1 || entries[0][0] !== "recipe_id" || entries[0][1] !== recipeId) {
      throw new FavoriteError("INVALID_QUERY");
    }
  }
  return recipeId;
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
    const method = event?.httpMethod;
    if (!ALLOWED_METHODS.includes(method)) return failure("METHOD_NOT_ALLOWED");
    let recipeId, note, token;
    try {
      if (method === "GET") recipeId = requestFavoriteQuery(event);
      else if (method === "DELETE") recipeId = requestDelete(event);
      else if (method === "PATCH") ({ recipeId, note } = requestPatch(event));
      else recipeId = requestRecipeId(event);
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
      if (method === "GET") {
        const data = await readFavorites(uid, recipeId, executePGSql, trace, context);
        return response(200, { ok: true, data });
      }
      if (method === "PATCH") {
        const data = await updateFavoriteNote(uid, recipeId, note, executePGSql, trace, context);
        if (data === null) return failure("FAVORITE_NOT_FOUND");
        const result = response(200, { ok: true, data });
        try { trace("patch_response_ready"); } catch { /* 诊断失败不改变原响应。 */ }
        return result;
      }
      if (method === "DELETE") {
        const data = await deleteFavorite(uid, recipeId, executePGSql, trace, context);
        if (data === null) return failure("FAVORITE_NOT_FOUND");
        return response(200, { ok: true, data });
      }
      const favorite = await createFavorite(uid, recipeId, executePGSql, trace, context);
      if (favorite.outcome === "duplicate") return failure("FAVORITE_EXISTS");
      if (favorite.outcome === "recipe_not_found") return failure("RECIPE_NOT_FOUND");
      return response(201, { ok: true, data: favorite.data });
    } catch {
      // SQL、UID、token、上下文、平台凭据和原始异常均不输出。
      if (method === "PATCH") {
        try { trace("patch_processing_failed"); } catch { /* 诊断失败不改变原响应。 */ }
      }
      return failure(method === "GET" ? "FAVORITE_READ_FAILED" :
        method === "DELETE" ? "FAVORITE_DELETE_FAILED" : "FAVORITE_WRITE_FAILED");
    }
  };
}

exports.createHandler = createHandler;
// 每个请求重新验证用户身份；数据访问层重新创建写库客户端，无自动重试。
exports.main = createHandler({ logStage: (stage, elapsedMs, code) => {
  let suffix = stage === "api_error" || stage === "auth_error" ? " code=" + code : "";
  if (stage === "patch_result_shape") {
    const shape = typeof code === "string" ? PATCH_SHAPE_PATTERN.exec(code) : null;
    suffix = shape && shape[0] === code ? " " + code : " shape=invalid";
  }
  console.info("[favorites-diag-v1] " + stage + " elapsed_ms=" + elapsedMs + suffix);
} });
