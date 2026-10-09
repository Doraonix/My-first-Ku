// Day 17：普通云函数 index.main，由 HTTP 网关映射到 GET /api/recipes。
// 使用普通云函数运行时身份，不在代码中配置固定密钥；不读取本地 seed。
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
// anon 已有两表 SELECT；部署前须配置 db/day17-anon-read.sql 中的 RLS 读取策略。
const ROLE = "anon";
const COLUMNS = ["id", "name", "difficulty", "steps", "difficulty_reason", "notes", "safety_notes"];
const SQL = "SELECT id, name, difficulty, steps, difficulty_reason, notes, safety_notes FROM public.recipes ORDER BY id;";
let CommonClient;
// 仅允许公开错误码；未列出的子码只记录固定大类，避免输出任意错误内容。
const API_ERROR_FAMILIES = new Set([
  "AuthFailure", "UnauthorizedOperation", "InvalidParameter", "InvalidParameterValue",
  "ResourceNotFound", "ResourceUnavailable", "FailedOperation", "InternalError",
  "RequestLimitExceeded", "LimitExceeded", "UnsupportedOperation", "InvalidAction",
  "MissingParameter", "UnknownParameter", "ResourceInUse", "ResourceInsufficient",
  "OperationDenied", "ResourcesSoldOut", "ActionOffline", "DryRunOperation", "InvalidRequest",
  "IpInBlacklist", "IpNotInWhitelist", "NoSuchProduct", "NoSuchVersion", "RequestSizeLimitExceeded",
  "ResponseSizeLimitExceeded", "ServiceUnavailable", "UnsupportedProtocol", "UnsupportedRegion",
]);
const API_ERROR_CODES = new Set([
  "AuthFailure.InvalidAuthorization", "AuthFailure.InvalidSecretId", "AuthFailure.MFAFailure",
  "AuthFailure.SecretIdNotFound", "AuthFailure.SignatureExpire", "AuthFailure.SignatureFailure",
  "AuthFailure.TokenFailure", "AuthFailure.UnauthorizedOperation",
  "FailedOperation.InstanceStatusConflict", "FailedOperation.OperationTimeout",
  "FailedOperation.PGConnectError", "FailedOperation.PGExecuteSqlError", "FailedOperation.PGResultTooLarge",
  "InternalError.SYS_ERR", "InvalidParameter.INVALID_PARAM", "InvalidParameter.EnvId",
  "ResourceNotFound.RoleNotFound", "ResourceNotFound.EnvNotExist",
  "OperationDenied.FreePackageDenied", "OperationDenied.ResourceFrozen",
  "FailedOperation.PackageUnsupported", "FailedOperation.AccountInsufficient",
  "ResourceUnavailable.ResourceOverdue", "RequestLimitExceeded.GlobalRegionUinLimitExceeded",
  "RequestLimitExceeded.IPLimitExceeded", "RequestLimitExceeded.UinLimitExceeded",
]);

function safeApiErrorCode(error) {
  const code = error?.code;
  if (typeof code !== "string" || !code.trim()) return "NO_API_ERROR_CODE";
  if (API_ERROR_CODES.has(code)) return code;
  const family = code.split(".", 1)[0];
  return API_ERROR_FAMILIES.has(family) ? family : "UNKNOWN_API_ERROR";
}

function runtimeCredentials(context) {
  const keys = ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY", "TENCENTCLOUD_SESSIONTOKEN"];
  const hasCredentialFields = (source) => source && typeof source === "object" &&
    keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
  let source = context;
  if (!hasCredentialFields(source)) {
    const environment = typeof context?.environment === "string" && context.environment.trim()
      ? JSON.parse(context.environment) : context?.environment;
    source = hasCredentialFields(environment) ? environment : process.env;
  }
  if (!source || keys.some((key) => typeof source[key] !== "string" || !source[key].trim())) {
    throw new Error("Missing runtime credentials");
  }
  return {
    secretId: source.TENCENTCLOUD_SECRETID,
    secretKey: source.TENCENTCLOUD_SECRETKEY,
    token: source.TENCENTCLOUD_SESSIONTOKEN,
  };
}

async function queryDatabase(options, trace, context) {
  if (!CommonClient) {
    ({ CommonClient } = require("tencentcloud-sdk-nodejs-common"));
  }
  // 只复用 SDK 模块；每次调用用本次运行身份创建客户端，避免缓存过期凭据。
  const client = new CommonClient("tcb.tencentcloudapi.com", "2018-06-08", {
    credential: runtimeCredentials(context),
    region: "ap-shanghai",
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      httpProfile: { reqMethod: "POST", reqTimeout: 2 },
    },
  });
  trace("sdk_ready");
  // 请求超时单位为秒，给平台 3 秒限制内的响应处理留出余量；不自动重试。
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

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

function text(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Invalid database text");
  return value;
}

function textArray(value, nonempty = false) {
  const array = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(array) || (nonempty && !array.length) ||
      array.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError("Invalid database array");
  }
  return array;
}

function decodeRows(result) {
  if (!result || !Array.isArray(result.Columns) || result.Columns.length !== COLUMNS.length ||
      new Set(result.Columns).size !== COLUMNS.length || !COLUMNS.every((name) => result.Columns.includes(name)) ||
      !(result.Rows === null || Array.isArray(result.Rows))) {
    throw new TypeError("Invalid database result");
  }
  return (result.Rows ?? []).map((encoded) => {
    if (typeof encoded !== "string") throw new TypeError("Invalid database row");
    const cells = JSON.parse(encoded);
    if (!Array.isArray(cells) || cells.length !== result.Columns.length) throw new TypeError("Invalid database cells");
    const row = Object.fromEntries(result.Columns.map((name, index) => [name, cells[index]]));
    if (!["简单", "普通"].includes(row.difficulty) ||
        !(row.difficulty_reason === null || typeof row.difficulty_reason === "string")) {
      throw new TypeError("Invalid recipe fields");
    }
    return {
      id: text(row.id),
      name: text(row.name),
      difficulty: row.difficulty,
      steps: textArray(row.steps, true),
      difficulty_reason: row.difficulty_reason,
      notes: textArray(row.notes),
      safety_notes: textArray(row.safety_notes),
    };
  });
}

// 可注入查询函数以做本地测试；公网入口只调用下面的 main。
function createHandler(executePGSql = queryDatabase, logStage = () => {}) {
  return async (event, context) => {
    const startedAt = Date.now();
    const trace = (stage, errorCode) => logStage(stage, Date.now() - startedAt, errorCode);
    trace("entry");
    if (event?.httpMethod !== "GET") {
      return response(405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支持 GET 请求。" } }, { Allow: "GET" });
    }
    try {
      const result = await executePGSql({ Sql: SQL, Role: ROLE }, trace, context);
      return response(200, { ok: true, data: decodeRows(result) });
    } catch {
      // 不将 SDK 原始报错、SQL、凭据或连接信息输出到响应或日志。
      return response(500, { ok: false, error: { code: "DATA_READ_FAILED", message: "暂时无法读取数据库资料，请稍后重试。" } });
    }
  };
}

exports.createHandler = createHandler;
// 诊断只含固定版本、阶段、累计毫秒和受控错误码，不输出请求或数据库内容。
exports.main = createHandler(queryDatabase, (stage, elapsedMs, errorCode) => {
  const codePart = stage === "api_error" ? ` code=${errorCode}` : "";
  console.info(`[recipes-diag-v5] ${stage} elapsed_ms=${elapsedMs}${codePart}`);
});
