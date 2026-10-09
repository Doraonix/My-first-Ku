// Day 17：普通云函数 index.main，对应 GET /api/recipe-materials。
// 使用平台运行身份和已验证的 anon SELECT/RLS；不接收调用方指定的查询。
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const ROLE = "anon";
const COLUMNS = ["recipe_id", "name", "material_type", "amount", "position"];
const SQL = "SELECT recipe_id, name, material_type, amount, position FROM public.recipe_materials ORDER BY recipe_id, material_type, position;";
let CommonClient;
// 与菜品函数相同：只记录受控错误码，不输出 SDK 原始错误内容。
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
  // 只缓存 SDK 模块，每次请求重新获取平台身份并创建客户端。
  const client = new CommonClient("tcb.tencentcloudapi.com", "2018-06-08", {
    credential: runtimeCredentials(context),
    region: "ap-shanghai",
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      httpProfile: { reqMethod: "POST", reqTimeout: 2 },
    },
  });
  trace("sdk_ready");
  // 单次 SDK 请求限时 2 秒；不自动重试，留出平台 3 秒限制内的响应时间。
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
    if (!["main", "seasoning"].includes(row.material_type) ||
        !(typeof row.position === "number" || (typeof row.position === "string" && /^[0-9]+$/.test(row.position)))) {
      throw new TypeError("Invalid material fields");
    }
    const position = Number(row.position);
    if (!Number.isSafeInteger(position) || position < 1) throw new TypeError("Invalid material position");
    return {
      recipe_id: text(row.recipe_id),
      name: text(row.name),
      material_type: row.material_type,
      amount: text(row.amount),
      position,
    };
  });
}

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
      // 不将原始错误、SQL、请求、数据或凭据写入响应或日志。
      return response(500, { ok: false, error: { code: "DATA_READ_FAILED", message: "暂时无法读取数据库资料，请稍后重试。" } });
    }
  };
}

exports.createHandler = createHandler;
exports.main = createHandler(queryDatabase, (stage, elapsedMs, errorCode) => {
  const codePart = stage === "api_error" ? ` code=${errorCode}` : "";
  console.info(`[recipe-materials-diag-v1] ${stage} elapsed_ms=${elapsedMs}${codePart}`);
});
