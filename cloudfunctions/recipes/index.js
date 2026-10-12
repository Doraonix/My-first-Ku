// Day 17：普通云函数 index.main，由 HTTP 网关映射到 GET /api/recipes。
// 使用普通云函数运行时身份，不在代码中配置固定密钥；不读取本地 seed。
// Day 19：入口只处理 HTTP；查库和数据库结果解码移到同目录 database.js。
const { queryDatabase, readRecipes } = require("./database.js");

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
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
      const data = await readRecipes(executePGSql, trace, context);
      return response(200, { ok: true, data });
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
