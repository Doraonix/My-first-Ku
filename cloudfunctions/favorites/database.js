// Day 19：收藏数据访问层；固定 SQL、角色、运行身份及数据库结果解码。
// 保留 Day 18 的原子防重复写入与 SDK 调用行为，不接收请求 event 或用户 token。
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const ROLE = "service_role";
const COLUMNS = ["outcome", "user_id", "recipe_id", "created_at"];
const FAVORITE_COLUMNS = ["user_id", "recipe_id", "created_at", "note"];
const DELETED_COLUMNS = ["user_id", "recipe_id"];
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECIPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NOTE_CHARACTERS = 200;
// Day 22：在函数初始化阶段加载 SDK 类，避免首次请求在鉴权后才同步加载。
// 仅复用类定义；运行凭据和数据库客户端仍在每次请求内取得、创建。
const { CommonClient } = require("tencentcloud-sdk-nodejs-common");

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
  // 每个请求使用本次完整运行身份新建客户端，无自动重试。
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

// Day 22：只接收入口已核验的 UID/编号；在数据层再次验证，禁止直接拼入任意文本。
function requireFavoriteKey(uid, recipeId) {
  if (typeof uid !== "string" || !UID_PATTERN.test(uid) ||
      (recipeId !== undefined && (typeof recipeId !== "string" || !RECIPE_PATTERN.test(recipeId)))) {
    throw new TypeError("Invalid favorite key");
  }
}

function validNote(note) {
  return typeof note === "string" && Array.from(note).length <= MAX_NOTE_CHARACTERS &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(note) && Buffer.from(note, "utf8").toString("utf8") === note;
}

// Day 22：新诊断只输出固定阶段、类型和有上限的数量；不输出任何数据库原值。
// 诊断失败不得改变原来的校验结果、HTTP 响应或数据库调用次数。
function tracePatchSafely(trace, stage, detail) {
  try { trace(stage, detail); } catch { /* 诊断仅旁路观察。 */ }
}

function diagnosticType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return ["undefined", "object", "string", "number", "boolean"].includes(type) ? type : "other";
}

function diagnosticCount(value) {
  if (!Array.isArray(value)) return "none";
  const count = value.length;
  if (!Number.isSafeInteger(count) || count < 0) return "none";
  return count > 100 ? "100_plus" : String(count);
}

function tracePatchResultShape(result, trace) {
  try {
    const columns = result?.Columns, rows = result?.Rows;
    tracePatchSafely(trace, "patch_result_shape", "result_type=" + diagnosticType(result) +
      " columns_type=" + diagnosticType(columns) + " columns_count=" + diagnosticCount(columns) +
      " rows_type=" + diagnosticType(rows) + " rows_count=" + diagnosticCount(rows));
  } catch { /* 不读取、序列化或记录不可检查的原始结果。 */ }
}

function decodeFavoriteRows(result, uid, recipeId, trace = () => {}) {
  let failedStage = "patch_decode_shape_failed";
  try {
    if (!result || !Array.isArray(result.Columns) || result.Columns.length !== FAVORITE_COLUMNS.length ||
        new Set(result.Columns).size !== FAVORITE_COLUMNS.length ||
        !FAVORITE_COLUMNS.every((name) => result.Columns.includes(name)) || !Array.isArray(result.Rows) ||
        (recipeId !== undefined && result.Rows.length > 1)) {
      throw new TypeError("Invalid favorite rows");
    }
    const seen = new Set();
    return result.Rows.map((encoded) => {
      failedStage = "patch_decode_row_type_failed";
      if (typeof encoded !== "string") throw new TypeError("Invalid favorite row");
      failedStage = "patch_decode_json_failed";
      const cells = JSON.parse(encoded);
      failedStage = "patch_decode_cells_failed";
      if (!Array.isArray(cells) || cells.length !== FAVORITE_COLUMNS.length) throw new TypeError("Invalid favorite cells");
      const row = Object.fromEntries(result.Columns.map((name, index) => [name, cells[index]]));
      failedStage = "patch_decode_identity_failed";
      if (row.user_id !== uid || typeof row.recipe_id !== "string" || !RECIPE_PATTERN.test(row.recipe_id) ||
          (recipeId !== undefined && row.recipe_id !== recipeId) || seen.has(row.recipe_id)) {
        throw new TypeError("Invalid favorite data");
      }
      failedStage = "patch_decode_note_failed";
      if (!validNote(row.note)) throw new TypeError("Invalid favorite data");
      failedStage = "patch_decode_time_failed";
      if (
        typeof row.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.created_at) ||
        Number.isNaN(Date.parse(row.created_at)) || new Date(row.created_at).toISOString() !== row.created_at) {
        throw new TypeError("Invalid favorite data");
      }
      seen.add(row.recipe_id);
      return { user_id: row.user_id, recipe_id: row.recipe_id, created_at: row.created_at, note: row.note };
    });
  } catch (error) {
    tracePatchSafely(trace, failedStage);
    throw error;
  }
}

async function readFavorites(uid, recipeId, executePGSql = queryDatabase, trace = () => {}, context) {
  requireFavoriteKey(uid, recipeId);
  const sql = [
    "SELECT user_id, recipe_id,",
    "       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at, note",
    "FROM public.favorites",
    "WHERE user_id = '" + uid + "'",
    ...(recipeId === undefined ? [] : ["  AND recipe_id = '" + recipeId + "'"]),
    "ORDER BY created_at DESC, recipe_id;",
  ].join("\n");
  const result = await executePGSql({ Sql: sql, Role: ROLE }, trace, context);
  return decodeFavoriteRows(result, uid, recipeId);
}

async function updateFavoriteNote(uid, recipeId, note, executePGSql = queryDatabase, trace = () => {}, context) {
  requireFavoriteKey(uid, recipeId);
  if (recipeId === undefined || !validNote(note)) throw new TypeError("Invalid favorite patch");
  // 仅拼入 UTF-8 编码产生的十六进制字符；不是参数绑定，备注原文绝不进入 SQL 语法。
  const noteHex = Buffer.from(note, "utf8").toString("hex");
  // 单条修改 CTE：外层 SELECT 只读取本次 UPDATE 的 RETURNING，不另查基表或追加请求。
  const sql = [
    "WITH updated AS (",
    "  UPDATE public.favorites",
    "  SET note = convert_from(decode('" + noteHex + "', 'hex'), 'UTF8')",
    "  WHERE user_id = '" + uid + "' AND recipe_id = '" + recipeId + "'",
    "  RETURNING user_id, recipe_id, created_at, note",
    ")",
    "SELECT user_id, recipe_id,",
    "       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at, note",
    "FROM updated;",
  ].join("\n");
  const result = await executePGSql({ Sql: sql, Role: ROLE }, trace, context);
  tracePatchResultShape(result, trace);
  const rows = decodeFavoriteRows(result, uid, recipeId, trace);
  tracePatchSafely(trace, "patch_decode_ready");
  if (rows.length === 0) {
    tracePatchSafely(trace, "patch_target_missing");
    return null;
  }
  if (rows[0].note !== note) {
    tracePatchSafely(trace, "patch_note_mismatch");
    throw new TypeError("Invalid updated favorite");
  }
  tracePatchSafely(trace, "patch_note_verified");
  return rows[0];
}

async function deleteFavorite(uid, recipeId, executePGSql = queryDatabase, trace = () => {}, context) {
  requireFavoriteKey(uid, recipeId);
  if (recipeId === undefined) throw new TypeError("Invalid favorite delete");
  // 一次请求只删已核验用户的一个收藏键；外层只读本次删除的 RETURNING。
  // 内部角色的表级 DELETE 不提供归属隔离，因此两个 WHERE 条件都不可省略。
  const sql = [
    "WITH deleted AS (",
    "  DELETE FROM public.favorites",
    "  WHERE user_id = '" + uid + "' AND recipe_id = '" + recipeId + "'",
    "  RETURNING user_id, recipe_id",
    ")",
    "SELECT user_id, recipe_id FROM deleted;",
  ].join("\n");
  const result = await executePGSql({ Sql: sql, Role: ROLE }, trace, context);
  // null 结构或 AffectedRows 不能当成删除成功/目标不存在；失败后不自动重试。
  if (!result || !Array.isArray(result.Columns) || result.Columns.length !== DELETED_COLUMNS.length ||
      new Set(result.Columns).size !== DELETED_COLUMNS.length ||
      !DELETED_COLUMNS.every((name) => result.Columns.includes(name)) ||
      !Array.isArray(result.Rows) || result.Rows.length > 1) {
    throw new TypeError("Invalid deleted favorite result");
  }
  if (result.Rows.length === 0) return null;
  if (typeof result.Rows[0] !== "string") throw new TypeError("Invalid deleted favorite row");
  const cells = JSON.parse(result.Rows[0]);
  if (!Array.isArray(cells) || cells.length !== DELETED_COLUMNS.length) {
    throw new TypeError("Invalid deleted favorite cells");
  }
  const row = Object.fromEntries(result.Columns.map((name, index) => [name, cells[index]]));
  if (row.user_id !== uid || row.recipe_id !== recipeId) throw new TypeError("Invalid deleted favorite identity");
  return { recipe_id: row.recipe_id, deleted: true };
}

exports.queryDatabase = queryDatabase;
exports.createFavorite = createFavorite;
exports.readFavorites = readFavorites;
exports.updateFavoriteNote = updateFavoriteNote;
exports.deleteFavorite = deleteFavorite;
