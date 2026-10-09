import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const recipesModule = require("../cloudfunctions/recipes/index.js");
const materialsModule = require("../cloudfunctions/recipe-materials/index.js");
const reviewed = JSON.parse(readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"));
const recipeColumns = ["id", "name", "difficulty", "steps", "difficulty_reason", "notes", "safety_notes"];
const materialColumns = ["recipe_id", "name", "material_type", "amount", "position"];
const recipeRows = reviewed.recipes.map((recipe) => ({
  id: recipe.id, name: recipe.name, difficulty: recipe.difficulty, steps: recipe.steps,
  difficulty_reason: recipe.difficultyReason ?? null, notes: reviewed.notes, safety_notes: reviewed.safetyNotes,
}));
const materialRows = reviewed.recipes.flatMap((recipe) => [
  ...recipe.mainIngredients.map((item, index) => ({ recipe_id: recipe.id, ...item, material_type: "main", position: index + 1 })),
  ...recipe.seasonings.map((item, index) => ({ recipe_id: recipe.id, ...item, material_type: "seasoning", position: index + 1 })),
]);
const specs = [
  { name: "recipes", module: recipesModule, columns: recipeColumns, rows: recipeRows, table: "public.recipes", order: "ORDER BY id", role: "anon", diagnostic: "recipes-diag-v5" },
  { name: "recipe-materials", module: materialsModule, columns: materialColumns, rows: materialRows, table: "public.recipe_materials", order: "ORDER BY recipe_id, material_type, position", role: "anon", diagnostic: "recipe-materials-diag-v1" },
];

// 模拟 ExecutePGSql 的实际契约：Rows 每项是 JSON 字符串，单元格为 string/null。
// 这里只用已审核的本地资料做测试，不代表已经读取真库或公网接口。
function pgResult(rows, columns) {
  return {
    Columns: columns,
    Rows: rows.map((row) => JSON.stringify(columns.map((name) => {
      const value = row[name];
      return value === null ? null : Array.isArray(value) ? JSON.stringify(value) : String(value);
    }))),
  };
}

function payload(response) {
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.isBase64Encoded, false);
  return JSON.parse(response.body);
}

function assertReadQuery(options, spec) {
  assert.deepEqual(Object.keys(options).sort(), ["Role", "Sql"]);
  assert.equal(options.Role, spec.role);
  assert.match(options.Sql, /^SELECT /);
  assert.ok(options.Sql.includes("FROM " + spec.table + " "));
  assert.ok(options.Sql.includes(spec.order));
  assert.ok(!options.Sql.includes("*"));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT)\b/.test(options.Sql));
}

// 全部凭据均为 VM 合成值，不读取本机环境或连接云资源。
function runtimeFields(marker) {
  return {
    TENCENTCLOUD_SECRETID: marker + "_id",
    TENCENTCLOUD_SECRETKEY: marker + "_key",
    TENCENTCLOUD_SESSIONTOKEN: marker + "_token",
  };
}

function sdkCredential(fields) {
  return {
    secretId: fields.TENCENTCLOUD_SECRETID,
    secretKey: fields.TENCENTCLOUD_SECRETKEY,
    token: fields.TENCENTCLOUD_SESSIONTOKEN,
  };
}

function readMainFixture(spec, { env = runtimeFields("VM_ENV_PRIVATE"), request } = {}) {
  const exported = {}, logs = [], clients = [], requests = [];
  let moduleLoads = 0, now = 1000;
  class FakeCommonClient {
    constructor(endpoint, version, config) {
      assert.equal(endpoint, "tcb.tencentcloudapi.com");
      assert.equal(version, "2018-06-08");
      assert.deepEqual(Object.keys(config).sort(), ["credential", "profile", "region"]);
      assert.equal(config.region, "ap-shanghai");
      assert.deepEqual(Object.keys(config.credential).sort(), ["secretId", "secretKey", "token"]);
      assert.ok(Object.values(config.credential).every((value) => typeof value === "string" && value.trim()));
      assert.deepEqual(Object.keys(config.profile).sort(), ["httpProfile", "signMethod"]);
      assert.equal(config.profile.signMethod, "TC3-HMAC-SHA256");
      assert.deepEqual(Object.keys(config.profile.httpProfile).sort(), ["reqMethod", "reqTimeout"]);
      assert.equal(config.profile.httpProfile.reqMethod, "POST");
      assert.equal(config.profile.httpProfile.reqTimeout, 2);
      this.credential = { ...config.credential };
      clients.push(this);
    }
    async request(action, params) {
      assert.equal(action, "ExecutePGSql");
      assert.deepEqual(Object.keys(params).sort(), ["EnvId", "Role", "Sql"]);
      const { EnvId, ...options } = params;
      assert.equal(EnvId, "doraonix-d2g6piooqfa4ba0c9");
      assertReadQuery(options, spec);
      requests.push({ action, params: { ...params }, credential: { ...this.credential } });
      const index = requests.length - 1;
      return request ? request(params, index) : pgResult([spec.rows[index % spec.rows.length]], spec.columns);
    }
  }
  vm.runInNewContext(readFileSync(new URL("../cloudfunctions/" + spec.name + "/index.js", import.meta.url), "utf8"), {
    exports: exported,
    process: { env },
    Date: { now() { return now++; } },
    console: { info(...args) { assert.equal(args.length, 1); logs.push(args[0]); } },
    require(name) {
      assert.equal(name, "tencentcloud-sdk-nodejs-common");
      moduleLoads++;
      return { CommonClient: FakeCommonClient };
    },
  });
  return { exported, env, logs, clients, requests, get moduleLoads() { return moduleLoads; } };
}

for (const spec of specs) {
  test(spec.name + "：按实际 Columns/Rows 形状返回已审核资料，不改字段值", async () => {
    let calls = 0;
    const handler = spec.module.createHandler(async (options) => {
      calls++;
      assertReadQuery(options, spec);
      return pgResult(spec.rows, spec.columns);
    });
    const response = await handler({ httpMethod: "GET" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: spec.rows });
    assert.equal(calls, 1);
  });

  test(spec.name + "：按列名而非猜测列位置解码", async () => {
    const columns = [...spec.columns].reverse();
    const response = await spec.module.createHandler(async () => pgResult(spec.rows, columns))({ httpMethod: "GET" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: spec.rows });
  });

  test(spec.name + "：空结果不会回退到本地种子", async (t) => {
    for (const rows of [[], null]) {
      await t.test(rows === null ? "Rows 为 null" : "Rows 为空数组", async () => {
        const response = await spec.module.createHandler(async () => ({ Columns: spec.columns, Rows: rows }))({ httpMethod: "GET" });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(payload(response), { ok: true, data: [] });
      });
    }
  });

  test(spec.name + "：非 GET 不调用数据库", async (t) => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS", "get", undefined]) {
      await t.test(String(method), async () => {
        let calls = 0;
        const response = await spec.module.createHandler(async () => { calls++; throw new Error("must not query"); })({ httpMethod: method });
        assert.equal(response.statusCode, 405);
        assert.equal(response.headers.Allow, "GET");
        assert.deepEqual(payload(response), { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支持 GET 请求。" } });
        assert.equal(calls, 0);
      });
    }
  });

  test(spec.name + "：请求参数不能替换固定 SQL 或角色", async () => {
    const response = await spec.module.createHandler(async (options) => {
      assertReadQuery(options, spec);
      assert.ok(!options.Sql.includes("other_table"));
      return pgResult(spec.rows, spec.columns);
    })({
      httpMethod: "GET",
      queryStringParameters: { table: "other_table", Sql: "DELETE FROM other_table", Role: "cloudbase_admin", envId: "other-env", limit: "0" },
      body: JSON.stringify({ Sql: "DROP TABLE other_table" }),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response).data, spec.rows);
  });

  test(spec.name + "：每次重新查询，不缓存旧数据", async () => {
    let calls = 0;
    const handler = spec.module.createHandler(async () => pgResult([spec.rows[calls++]], spec.columns));
    const first = await handler({ httpMethod: "GET" });
    const second = await handler({ httpMethod: "GET" });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.deepEqual(payload(first).data, [spec.rows[0]]);
    assert.deepEqual(payload(second).data, [spec.rows[1]]);
    assert.equal(calls, 2);
  });

  test(spec.name + "：数据库异常不冒充空列表，不泄露原始诊断", async () => {
    const response = await spec.module.createHandler(async () => { throw new Error("PRIVATE_DIAGNOSTIC"); })({ httpMethod: "GET" });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(payload(response), { ok: false, error: { code: "DATA_READ_FAILED", message: "暂时无法读取数据库资料，请稍后重试。" } });
    assert.ok(!response.body.includes("PRIVATE_DIAGNOSTIC"));
    assert.ok(!response.body.includes("SELECT"));
    assert.ok(!response.body.includes(spec.table));
  });

  test(spec.name + "：畸形结果或缺失/重复列不会返回成功", async (t) => {
    const invalidResults = [
      null, {}, { Columns: null, Rows: null },
      { Columns: spec.columns.slice(1), Rows: [] },
      { Columns: [...spec.columns.slice(1), spec.columns[1]], Rows: [] },
      { Columns: spec.columns, Rows: "not an array" },
      { Columns: spec.columns, Rows: ["not JSON"] },
      { Columns: spec.columns, Rows: [JSON.stringify({})] },
      { Columns: spec.columns, Rows: [JSON.stringify([])] },
      { Columns: spec.columns, Rows: [spec.rows[0]] },
    ];
    for (const [index, result] of invalidResults.entries()) {
      await t.test(String(index), async () => {
        const response = await spec.module.createHandler(async () => result)({ httpMethod: "GET" });
        assert.equal(response.statusCode, 500);
        assert.equal(payload(response).ok, false);
      });
    }
  });

  test(spec.name + "：实际 main 使用模拟 SDK 固定环境，只缓存 SDK 不缓存结果", async () => {
    let rejectQuery;
    const fixture = readMainFixture(spec, { request: async (_params, index) => {
      if (index === 5) return new Promise((_resolve, reject) => { rejectQuery = reject; });
      if (index === 6) throw new Error("PRIVATE_DIAGNOSTIC " + fixture.env.TENCENTCLOUD_SESSIONTOKEN);
      return pgResult([spec.rows[index % spec.rows.length]], spec.columns);
    } });
    const eventFields = runtimeFields("VM_EVENT_FORGED_PRIVATE");
    const event = {
      httpMethod: "GET", ...eventFields, environment: eventFields, credential: sdkCredential(eventFields),
      queryStringParameters: { EnvId: "other-env", Sql: "DELETE FROM other_table", Role: "cloudbase_admin", ...eventFields },
      body: JSON.stringify({ ...eventFields, environment: eventFields, credential: sdkCredential(eventFields) }),
    };
    assert.equal((await fixture.exported.main({ ...event, httpMethod: "POST" })).statusCode, 405);
    assert.equal(fixture.moduleLoads, 0);
    assert.equal(fixture.clients.length, 0);

    const top = runtimeFields("VM_CONTEXT_TOP_PRIVATE");
    const objectEnvironment = runtimeFields("VM_CONTEXT_OBJECT_PRIVATE");
    const jsonEnvironment = runtimeFields("VM_CONTEXT_JSON_PRIVATE");
    const updatedEnvironment = runtimeFields("VM_ENV_UPDATED_PRIVATE");
    const invocations = [
      { context: { ...top, environment: "INVALID_LOWER_PRIORITY_JSON" }, fields: top },
      { context: { environment: objectEnvironment }, fields: objectEnvironment },
      { context: { environment: JSON.stringify(jsonEnvironment) }, fields: jsonEnvironment },
      { context: { environment: { CUSTOM_FLAG: "unused" } }, fields: { ...fixture.env } },
      { context: undefined, fields: updatedEnvironment },
    ];
    for (const [index, invocation] of invocations.entries()) {
      if (index === 4) Object.assign(fixture.env, updatedEnvironment);
      const result = await fixture.exported.main(event, invocation.context);
      assert.equal(result.statusCode, 200);
      assert.deepEqual(payload(result).data, [spec.rows[index % spec.rows.length]]);
      assert.deepEqual(fixture.clients[index].credential, sdkCredential(invocation.fields));
      assert.deepEqual(fixture.requests[index].credential, sdkCredential(invocation.fields));
      if (index > 0) assert.notEqual(fixture.clients[index], fixture.clients[index - 1]);
    }
    assert.equal(fixture.moduleLoads, 1);
    assert.equal(fixture.clients.length, 5);
    assert.equal(fixture.requests.length, 5);
    assert.deepEqual(fixture.logs, [
      `[${spec.diagnostic}] entry elapsed_ms=1`,
      ...Array.from({ length: 5 }, () => [
        `[${spec.diagnostic}] entry elapsed_ms=1`,
        `[${spec.diagnostic}] sdk_ready elapsed_ms=2`,
        `[${spec.diagnostic}] api_call_start elapsed_ms=3`,
        `[${spec.diagnostic}] api_return elapsed_ms=4`,
      ]).flat(),
    ]);

    fixture.logs.length = 0;
    const pending = fixture.exported.main({ ...event, body: "PRIVATE_REQUEST" }, { environment: jsonEnvironment });
    const unfinishedStages = [
      `[${spec.diagnostic}] entry elapsed_ms=1`,
      `[${spec.diagnostic}] sdk_ready elapsed_ms=2`,
      `[${spec.diagnostic}] api_call_start elapsed_ms=3`,
    ];
    const failedStages = [...unfinishedStages, `[${spec.diagnostic}] api_error elapsed_ms=4 code=NO_API_ERROR_CODE`];
    assert.deepEqual(fixture.logs, unfinishedStages);
    assert.equal(typeof rejectQuery, "function");
    rejectQuery(new Error("PRIVATE_DIAGNOSTIC " + jsonEnvironment.TENCENTCLOUD_SECRETKEY));
    const failed = await pending;
    assert.equal(failed.statusCode, 500);
    assert.equal(payload(failed).error.code, "DATA_READ_FAILED");
    assert.deepEqual(fixture.logs, failedStages);

    fixture.logs.length = 0;
    const immediatelyFailed = await fixture.exported.main(event);
    assert.equal(immediatelyFailed.statusCode, 500);
    assert.equal(payload(immediatelyFailed).error.code, "DATA_READ_FAILED");
    assert.deepEqual(fixture.logs, failedStages);
    assert.equal(fixture.clients.length, 7);
    assert.equal(fixture.requests.length, 7);
    assert.equal(fixture.moduleLoads, 1);
    const privateValues = ["PRIVATE_REQUEST", "PRIVATE_DIAGNOSTIC", ...Object.values(eventFields),
      ...Object.values(top), ...Object.values(objectEnvironment), ...Object.values(jsonEnvironment), ...Object.values(updatedEnvironment)];
    for (const value of privateValues) {
      assert.ok(!fixture.logs.join("\n").includes(value));
      assert.ok(!failed.body.includes(value));
      assert.ok(!immediatelyFailed.body.includes(value));
    }
    const manifest = JSON.parse(readFileSync(new URL("../cloudfunctions/" + spec.name + "/package.json", import.meta.url), "utf8"));
    assert.equal(manifest.type, "commonjs");
    assert.deepEqual(manifest.dependencies, { "tencentcloud-sdk-nodejs-common": "4.1.220" });
  });
}

for (const spec of specs) {
  test(spec.name + "：createHandler 把本次 context 原样传给查询函数", async () => {
    const context = { environment: runtimeFields("VM_FORWARDED_PRIVATE") };
    let calls = 0;
    const handler = spec.module.createHandler(async (options, trace, receivedContext) => {
      calls++;
      assertReadQuery(options, spec);
      assert.equal(typeof trace, "function");
      assert.equal(receivedContext, context);
      return pgResult(spec.rows, spec.columns);
    });
    assert.equal((await handler({ httpMethod: "GET" }, context)).statusCode, 200);
    assert.equal(calls, 1);
  });

  test(spec.name + "：运行身份缺失或所选来源不完整时 500，不拼接或回退凭据", async (t) => {
    const valid = runtimeFields("VM_FALLBACK_PRIVATE");
    const partial = { TENCENTCLOUD_SECRETID: "VM_PARTIAL_PRIVATE_id" };
    const cases = [
      { name: "环境缺少凭据，event 伪造完整凭据无效", env: {}, context: undefined },
      { name: "自定义环境别名不能充当运行身份", env: { TENCENTCLOUD_SECRET_ID: "VM_CUSTOM_id", TENCENTCLOUD_SECRET_KEY: "VM_CUSTOM_key", TENCENTCLOUD_TOKEN: "VM_CUSTOM_token" } },
      { name: "顶层来源不完整，不能改用有效 environment 或 env", context: { ...partial, environment: valid } },
      { name: "顶层键存在但为 undefined，不能向下回退", context: { TENCENTCLOUD_SECRETID: undefined, environment: valid } },
      { name: "顶层键存在但为 null", context: { ...valid, TENCENTCLOUD_SECRETKEY: null, environment: valid } },
      { name: "顶层凭据为空白字符串", context: { ...valid, TENCENTCLOUD_SESSIONTOKEN: " \t", environment: valid } },
      { name: "顶层凭据为空字符串", context: { ...valid, TENCENTCLOUD_SECRETID: "", environment: valid } },
      { name: "顶层凭据不是字符串", context: { ...valid, TENCENTCLOUD_SECRETKEY: 123, environment: valid } },
      { name: "environment 对象缺字段，不能与 env 拼接", context: { environment: partial } },
      { name: "environment 对象有 undefined 键，不能回退", context: { environment: { TENCENTCLOUD_SECRETKEY: undefined } } },
      { name: "environment JSON 缺字段，不能向 env 回退", context: { environment: JSON.stringify(partial) } },
      { name: "environment JSON 中凭据不是字符串", context: { environment: JSON.stringify({ ...valid, TENCENTCLOUD_SESSIONTOKEN: false }) } },
      { name: "environment JSON 无法解析", context: { environment: "PRIVATE_INVALID_JSON" } },
      { name: "env 来源缺字段", env: partial },
      { name: "env 来源凭据不是字符串", env: { ...valid, TENCENTCLOUD_SECRETKEY: {} } },
    ];
    for (const item of cases) {
      await t.test(item.name, async () => {
        const fixture = readMainFixture(spec, { env: item.env ?? { ...valid } });
        const forged = runtimeFields("VM_EVENT_FORGED_PRIVATE");
        const response = await fixture.exported.main({
          httpMethod: "GET", ...forged, environment: forged, credential: sdkCredential(forged),
          body: JSON.stringify(forged), queryStringParameters: forged,
        }, item.context);
        assert.equal(response.statusCode, 500);
        assert.deepEqual(payload(response), { ok: false, error: { code: "DATA_READ_FAILED", message: "暂时无法读取数据库资料，请稍后重试。" } });
        assert.equal(fixture.clients.length, 0);
        assert.equal(fixture.requests.length, 0);
        assert.deepEqual(fixture.logs, [`[${spec.diagnostic}] entry elapsed_ms=1`]);
        assert.ok(!response.body.includes("PRIVATE"));
        assert.ok(!response.body.includes("Missing runtime credentials"));
      });
    }
  });

  test(spec.name + "：API 请求失败只记录安全错误码，响应、日志不包含原始异常或身份", async (t) => {
    const officialCodes = [
      "AuthFailure.SignatureFailure", "AuthFailure.TokenFailure", "AuthFailure.SecretIdNotFound",
      "AuthFailure.InvalidAuthorization", "AuthFailure.UnauthorizedOperation", "UnauthorizedOperation",
      "InvalidParameter.INVALID_PARAM", "ResourceNotFound.RoleNotFound", "FailedOperation.PGConnectError",
      "FailedOperation.PGExecuteSqlError", "FailedOperation.OperationTimeout",
      "OperationDenied.FreePackageDenied", "OperationDenied.ResourceFrozen",
      "FailedOperation.PackageUnsupported", "FailedOperation.AccountInsufficient",
      "ResourceUnavailable.ResourceOverdue", "RequestLimitExceeded.GlobalRegionUinLimitExceeded",
      "RequestLimitExceeded.IPLimitExceeded", "RequestLimitExceeded.UinLimitExceeded",
    ];
    const cases = [
      ...officialCodes.map((code) => ({ name: "允许的完整码 " + code, code, expected: code })),
      { name: "未列 AuthFailure 后缀", code: "AuthFailure.SomeSuffix", expected: "AuthFailure" },
      { name: "AuthFailure 后缀含敏感文字和换行", code: `AuthFailure.VM_CODE_SECRET_PRIVATE\n[${spec.diagnostic}] forged elapsed_ms=99`, expected: "AuthFailure" },
      { name: "允许完整码后不能拼接任意后缀", code: "AuthFailure.TokenFailure.VM_CODE_SECRET_PRIVATE", expected: "AuthFailure" },
      { name: "UnauthorizedOperation 后缀含敏感文字", code: "UnauthorizedOperation.VM_CODE_SECRET_PRIVATE", expected: "UnauthorizedOperation" },
      { name: "InvalidParameter 后缀含敏感文字", code: "InvalidParameter.VM_CODE_SECRET_PRIVATE", expected: "InvalidParameter" },
      { name: "ResourceNotFound 后缀含敏感文字", code: "ResourceNotFound.VM_CODE_SECRET_PRIVATE", expected: "ResourceNotFound" },
      { name: "FailedOperation 后缀含 SQL 和换行", code: "FailedOperation.SELECT * FROM VM_PRIVATE_TABLE;\nVM_CODE_SECRET_PRIVATE", expected: "FailedOperation" },
      { name: "OperationDenied 后缀含敏感文字和换行", code: "OperationDenied.VM_CODE_SECRET_PRIVATE\nPRIVATE_MESSAGE", expected: "OperationDenied" },
      { name: "未知大类含敏感文字", code: "VM_CODE_SECRET_PRIVATE.SomeSuffix", expected: "UNKNOWN_API_ERROR" },
      { name: "相似前缀不能冒充 AuthFailure", code: "AuthFailurePRIVATE.VM_CODE_SECRET_PRIVATE", expected: "UNKNOWN_API_ERROR" },
      { name: "大小写不同不能冒充官方大类", code: "authFailure.TokenFailure", expected: "UNKNOWN_API_ERROR" },
      { name: "无 code 属性", omitCode: true, expected: "NO_API_ERROR_CODE" },
      { name: "code 为 undefined", code: undefined, expected: "NO_API_ERROR_CODE" },
      { name: "code 为 null", code: null, expected: "NO_API_ERROR_CODE" },
      { name: "code 为空字符串", code: "", expected: "NO_API_ERROR_CODE" },
      { name: "code 仅有空白和换行", code: " \t\r\n", expected: "NO_API_ERROR_CODE" },
      { name: "code 为数字", code: 123, expected: "NO_API_ERROR_CODE" },
      { name: "code 为布尔值", code: false, expected: "NO_API_ERROR_CODE" },
      { name: "code 为数组", code: ["AuthFailure.TokenFailure"], expected: "NO_API_ERROR_CODE" },
      { name: "非字符串 code 不做字符串转换", code: { toString() { throw new Error("PRIVATE_CODE_COERCION"); } }, expected: "NO_API_ERROR_CODE" },
    ];
    for (const item of cases) {
      await t.test(item.name, async () => {
        const contextFields = runtimeFields("VM_ERROR_CONTEXT_PRIVATE");
        const envFields = runtimeFields("VM_ERROR_ENV_PRIVATE");
        const privateValues = ["PRIVATE_MESSAGE", "PRIVATE_STACK", "PRIVATE_ERROR_NAME", "PRIVATE_REQUEST",
          "VM_CODE_SECRET_PRIVATE", "VM_PRIVATE_TABLE", ...Object.values(contextFields), ...Object.values(envFields)];
        const error = new Error("PRIVATE_MESSAGE\n" + privateValues.join("\n"));
        error.name = "PRIVATE_ERROR_NAME";
        error.stack = "PRIVATE_STACK\n" + privateValues.join("\n");
        error.RequestId = contextFields.TENCENTCLOUD_SESSIONTOKEN;
        // 其他异常字段不能被误当作安全 code，也不能通过序列化整份异常写入日志。
        error.Code = "AuthFailure.TokenFailure";
        error.credential = sdkCredential(contextFields);
        if (!item.omitCode) error.code = item.code;
        let rawSql;
        const fixture = readMainFixture(spec, { env: envFields, request: async (params) => {
          rawSql = params.Sql;
          error.message += "\n" + rawSql;
          error.stack += "\n" + rawSql;
          throw error;
        } });
        const response = await fixture.exported.main({ httpMethod: "GET", body: "PRIVATE_REQUEST" }, contextFields);
        assert.equal(response.statusCode, 500);
        assert.deepEqual(payload(response), {
          ok: false,
          error: { code: "DATA_READ_FAILED", message: "暂时无法读取数据库资料，请稍后重试。" },
        });
        assert.equal(fixture.requests.length, 1);
        assert.deepEqual(fixture.requests[0].credential, sdkCredential(contextFields));
        assert.deepEqual(fixture.logs, [
          `[${spec.diagnostic}] entry elapsed_ms=1`,
          `[${spec.diagnostic}] sdk_ready elapsed_ms=2`,
          `[${spec.diagnostic}] api_call_start elapsed_ms=3`,
          `[${spec.diagnostic}] api_error elapsed_ms=4 code=` + item.expected,
        ]);
        assert.equal(fixture.logs.filter((line) => line.includes(" api_error ")).length, 1);
        assert.ok(!fixture.logs.some((line) => line.includes(" api_return ")));
        const observable = [...fixture.logs, response.body].join("\n");
        for (const value of [...privateValues, rawSql, error.message, error.stack]) {
          assert.ok(!observable.includes(value), "日志或响应不能包含私有值：" + value);
        }
        if (typeof item.code === "string" && item.code && item.code !== item.expected) {
          assert.ok(!observable.includes(item.code), "未允许的原始 code 不能出现在日志或响应");
        }
      });
    }
  });

  test(spec.name + "：SDK 成功后字段解码失败仍为 500，不误记 API 请求错误", async () => {
    const fixture = readMainFixture(spec, { request: async () => ({ Columns: spec.columns, Rows: ["PRIVATE_INVALID_ROW"] }) });
    const response = await fixture.exported.main({ httpMethod: "GET" });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(payload(response), {
      ok: false,
      error: { code: "DATA_READ_FAILED", message: "暂时无法读取数据库资料，请稍后重试。" },
    });
    assert.deepEqual(fixture.logs, [
      `[${spec.diagnostic}] entry elapsed_ms=1`,
      `[${spec.diagnostic}] sdk_ready elapsed_ms=2`,
      `[${spec.diagnostic}] api_call_start elapsed_ms=3`,
      `[${spec.diagnostic}] api_return elapsed_ms=4`,
    ]);
    assert.ok(!response.body.includes("PRIVATE_INVALID_ROW"));
  });
}

test("菜品数组字段和难度类型异常返回 500", async (t) => {
  const patches = [
    { steps: [] }, { steps: [1] }, { steps: [""] }, { steps: null },
    { notes: {} }, { safety_notes: [null] }, { difficulty: "较难" }, { difficulty_reason: 1 },
  ];
  for (const [index, patch] of patches.entries()) {
    await t.test(String(index), async () => {
      const result = pgResult([{ ...recipeRows[0], ...patch }], recipeColumns);
      if (patch.difficulty_reason === 1) {
        const cells = JSON.parse(result.Rows[0]); cells[4] = 1; result.Rows[0] = JSON.stringify(cells);
      }
      const response = await recipesModule.createHandler(async () => result)({ httpMethod: "GET" });
      assert.equal(response.statusCode, 500);
    });
  }
});

test("材料顺序必须为正整数，用量不能变成数字", async (t) => {
  for (const position of ["0", "-1", "1.5", "x", null, "9007199254740992"]) {
    await t.test(String(position), async () => {
      const response = await materialsModule.createHandler(async () => pgResult([{ ...materialRows[0], position }], materialColumns))({ httpMethod: "GET" });
      assert.equal(response.statusCode, 500);
    });
  }
  const result = pgResult([materialRows[0]], materialColumns);
  const cells = JSON.parse(result.Rows[0]); cells[3] = 150; result.Rows[0] = JSON.stringify(cells);
  assert.equal((await materialsModule.createHandler(async () => result)({ httpMethod: "GET" })).statusCode, 500);
});

test("Day 15 健康接口保持原返回，不套用新接口外层", async () => {
  const health = require("../cloudfunctions/health/index.js");
  assert.deepEqual(await health.main({ httpMethod: "GET" }), { ok: true, service: "next-meal" });
});
