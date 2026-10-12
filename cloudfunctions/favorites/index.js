// Day 18：POST /api/favorites；UID 仅来自 CloudBase 对当前 access_token 的验证。
// 本函数不使用调用方提供的 user_id、SQL、数据库角色或运行凭据。
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const ROLE = "service_role";
const AUTH_URL = "https://" + ENV_ID + ".api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=" + encodeURIComponent(ENV_ID);
const COLUMNS = ["outcome", "user_id", "recipe_id", "created_at"];
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECIPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 1024;
let CommonClient;

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

function runtimeCredentials(context) {
  const keys = ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY", "TENCENTCLOUD_SESSIONTOKEN"];
  const hasFields = (source) => source && typeof source === "object" &&
    keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
  let source = context;
  if (!hasFields(source)) {
    const environment = typeof context?.environment === "string" && context.environment.trim()
      ? JSON.parse(context.environment) : context?.environment;
    source = hasFields(environment) ? environment : process.env;
  }
  if (!source || keys.some((key) => typeof source[key] !== "string" || !source[key].trim())) {
    throw new Error("Missing runtime credentials");
  }
  return { secretId: source.TENCENTCLOUD_SECRETID, secretKey: source.TENCENTCLOUD_SECRETKEY, token: source.TENCENTCLOUD_SESSIONTOKEN };
}

function safeApiErrorCode(error) {
  const code = error?.code;
  if (typeof code !== "string" || !code.trim()) return "NO_API_ERROR_CODE";
  if (code === "FailedOperation.PGExecuteSqlError") return code;
  const family = code.split(".", 1)[0];
  return ["AuthFailure", "UnauthorizedOperation", "FailedOperation", "InternalError",
    "ResourceNotFound", "RequestLimitExceeded", "InvalidParameter", "InvalidParameterValue"].includes(family)
    ? family : "UNKNOWN_API_ERROR";
}

async function queryDatabase(options, trace, context) {
  if (!CommonClient) ({ CommonClient } = require("tencentcloud-sdk-nodejs-common"));
  const client = new CommonClient("tcb.tencentcloudapi.com", "2018-06-08", {
    credential: runtimeCredentials(context), region: "ap-shanghai",
    profile: { signMethod: "TC3-HMAC-SHA256", httpProfile: { reqMethod: "POST", reqTimeout: 1 } },
  });
  trace("sdk_ready");
  trace("api_call_start");
  let result;
  try {
    result = await client.request("ExecutePGSql", { EnvId: ENV_ID, Sql: options.Sql, Role: options.Role });
  } catch (error) {
    trace("api_error", safeApiErrorCode(error));
    throw error;
  }
  trace("api_return");
  return result;
}

function favoriteSql(uid, recipeId) {
  // 两值已分别通过 ASCII 标识校验，不包含引号、反斜杠或 SQL 操作符。
  // 唯一约束和 ON CONFLICT 处理并发重复；不先查询收藏再写，也不更新旧行。
  return [
    "WITH target AS (",
    "  SELECT id FROM public.recipes WHERE id = '" + recipeId + "'",
    "), created AS (",
    "  INSERT INTO public.favorites (user_id, recipe_id)",
    "  SELECT '" + uid + "', id FROM target",
    "  ON CONFLICT (user_id, recipe_id) DO NOTHING",
    "  RETURNING user_id, recipe_id, created_at",
    ")",
    "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'recipe_not_found'",
    "            WHEN EXISTS (SELECT 1 FROM created) THEN 'created'",
    "            ELSE 'duplicate' END AS outcome,",
    "       (SELECT user_id FROM created) AS user_id,",
    "       (SELECT recipe_id FROM created) AS recipe_id,",
    "       (SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM created) AS created_at;",
  ].join("\n");
}

function decodeResult(result, uid, recipeId) {
  if (!result || !Array.isArray(result.Columns) || result.Columns.length !== COLUMNS.length ||
      new Set(result.Columns).size !== COLUMNS.length || !COLUMNS.every((name) => result.Columns.includes(name)) ||
      !Array.isArray(result.Rows) || result.Rows.length !== 1 || typeof result.Rows[0] !== "string") {
    throw new TypeError("Invalid favorite result");
  }
  const cells = JSON.parse(result.Rows[0]);
  if (!Array.isArray(cells) || cells.length !== COLUMNS.length) throw new TypeError("Invalid favorite cells");
  const row = Object.fromEntries(result.Columns.map((name, index) => [name, cells[index]]));
  if (row.outcome === "duplicate" || row.outcome === "recipe_not_found") {
    if ([row.user_id, row.recipe_id, row.created_at].some((value) => value !== null)) {
      throw new TypeError("Invalid empty favorite result");
    }
    return { outcome: row.outcome };
  }
  if (row.outcome !== "created" || row.user_id !== uid || row.recipe_id !== recipeId ||
      typeof row.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.created_at) ||
      Number.isNaN(Date.parse(row.created_at)) || new Date(row.created_at).toISOString() !== row.created_at) {
    throw new TypeError("Invalid created favorite");
  }
  return { outcome: "created", data: { user_id: row.user_id, recipe_id: row.recipe_id, created_at: row.created_at } };
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
      const result = await executePGSql({ Sql: favoriteSql(uid, recipeId), Role: ROLE }, trace, context);
      const favorite = decodeResult(result, uid, recipeId);
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
// 只缓存 SDK 类；每个请求重新验证用户身份并创建写库客户端，无自动重试。
exports.main = createHandler({ logStage: (stage, elapsedMs, code) => {
  const suffix = stage === "api_error" || stage === "auth_error" ? " code=" + code : "";
  console.info("[favorites-diag-v1] " + stage + " elapsed_ms=" + elapsedMs + suffix);
} });
