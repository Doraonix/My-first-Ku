// Day 17：普通云函数 index.main，对应 GET /api/recipe-materials。
// 使用平台运行身份和已验证的 anon SELECT/RLS；不接收调用方指定的查询。
// Day 19：入口只处理 HTTP；查库和数据库结果解码移到同目录 database.js。
const { queryDatabase, readMaterials } = require("./database.js");

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
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
      const data = await readMaterials(executePGSql, trace, context);
      return response(200, { ok: true, data });
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
