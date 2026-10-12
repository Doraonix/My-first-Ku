// Day 19：收藏数据访问层；固定 SQL、角色、运行身份及数据库结果解码。
// 保留 Day 18 的原子防重复写入与 SDK 调用行为，不接收请求 event 或用户 token。
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const ROLE = "service_role";
const COLUMNS = ["outcome", "user_id", "recipe_id", "created_at"];
let CommonClient;

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
  // 只缓存 SDK 类；每个请求使用本次完整运行身份新建客户端，无自动重试。
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

// 仅由本函数入口调用；uid 必须已验证，recipeId 必须已通过请求格式校验。
async function createFavorite(uid, recipeId, executePGSql = queryDatabase, trace, context) {
  const result = await executePGSql({ Sql: favoriteSql(uid, recipeId), Role: ROLE }, trace, context);
  return decodeResult(result, uid, recipeId);
}

exports.queryDatabase = queryDatabase;
exports.createFavorite = createFavorite;
