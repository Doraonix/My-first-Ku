import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const favorites = require("../cloudfunctions/favorites/index.js");
const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const AUTH_URL = `https://${ENV_ID}.api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=${ENV_ID}`;
const UID = "user_SYN_A";
const RECIPE_ID = "recipe_SYN_01";
const TOKEN = "TOKEN_SYN_A";
const CREATED_AT = "2026-10-10T08:09:10.123Z";
const COLUMNS = ["outcome", "user_id", "recipe_id", "created_at"];

// 全部身份、菜品编号、时间和数据库结果均为合成值；不读取凭据，不连接云端。
function pgResult(row, columns = COLUMNS) {
  return { Columns: [...columns], Rows: [JSON.stringify(columns.map((name) => row[name]))] };
}

function created(uid = UID, recipeId = RECIPE_ID, createdAt = CREATED_AT) {
  return pgResult({ outcome: "created", user_id: uid, recipe_id: recipeId, created_at: createdAt });
}

function emptyOutcome(outcome) {
  return pgResult({ outcome, user_id: null, recipe_id: null, created_at: null });
}

function event(body = { recipe_id: RECIPE_ID }, overrides = {}) {
  return {
    httpMethod: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...overrides,
  };
}

function payload(response) {
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.isBase64Encoded, false);
  return JSON.parse(response.body);
}

function assertFailure(response, statusCode, code) {
  assert.equal(response.statusCode, statusCode);
  const value = payload(response);
  assert.deepEqual(Object.keys(value).sort(), ["error", "ok"]);
  assert.equal(value.ok, false);
  assert.deepEqual(Object.keys(value.error).sort(), ["code", "message"]);
  assert.equal(value.error.code, code);
  assert.match(value.error.message, /[\u4e00-\u9fff]/);
  return value;
}

function instrument({ verifyToken = async () => UID, executePGSql = async () => created() } = {}) {
  const authCalls = [], sqlCalls = [], stages = [];
  const handler = favorites.createHandler({
    async verifyToken(token, trace) {
      authCalls.push(token);
      assert.equal(typeof trace, "function");
      return verifyToken(token, trace);
    },
    async executePGSql(options, trace, context) {
      sqlCalls.push({ options, context });
      assert.equal(typeof trace, "function");
      return executePGSql(options, trace, context);
    },
    logStage(stage, elapsedMs, code) { stages.push({ stage, elapsedMs, code }); },
  });
  return { handler, authCalls, sqlCalls, stages };
}

async function assertInputRejected(request, statusCode, code) {
  const fixture = instrument();
  const response = await fixture.handler(request);
  assertFailure(response, statusCode, code);
  assert.equal(fixture.authCalls.length, 0, "请求校验失败不能调用认证");
  assert.equal(fixture.sqlCalls.length, 0, "请求校验失败不能写库");
}

function assertWriteQuery(options, uid = UID, recipeId = RECIPE_ID) {
  assert.deepEqual(Object.keys(options).sort(), ["Role", "Sql"]);
  assert.equal(options.Role, "service_role");
  const sql = options.Sql.replace(/\s+/g, " ").trim();
  assert.match(sql, /^WITH target AS \(/i);
  assert.ok(sql.includes("SELECT id FROM public.recipes WHERE id = '" + recipeId + "'"));
  assert.match(sql, /INSERT INTO public\.favorites\s*\(user_id, recipe_id\)/i);
  assert.ok(sql.includes("SELECT '" + uid + "', id FROM target"));
  assert.match(sql, /ON CONFLICT\s*\(user_id, recipe_id\) DO NOTHING/i);
  assert.match(sql, /RETURNING user_id, recipe_id, created_at/i);
  assert.match(sql, /to_char\(created_at AT TIME ZONE 'UTC'/i);
  assert.equal((sql.match(/\bINSERT\b/gi) ?? []).length, 1);
  assert.ok(!/\b(UPDATE|DELETE|DROP|ALTER|GRANT|TRUNCATE)\b/i.test(sql));
}

function sqlIdentity(sql) {
  const uid = /SELECT '([A-Za-z0-9_-]+)', id FROM target/.exec(sql)?.[1];
  const recipeId = /WHERE id = '([A-Za-z0-9_-]+)'/.exec(sql)?.[1];
  assert.ok(uid && recipeId, "查询必须绑定认证 UID 和通过校验的菜品编号");
  return { uid, recipeId };
}

// 模拟唯一约束的原子判定，确认处理器面对数据库的重复结果不会改写已有收藏。
function atomicStore(available = new Set([RECIPE_ID])) {
  const rows = new Map();
  let calls = 0;
  return {
    rows,
    get calls() { return calls; },
    async executePGSql(options) {
      calls++;
      const { uid, recipeId } = sqlIdentity(options.Sql);
      assertWriteQuery(options, uid, recipeId);
      await Promise.resolve();
      if (!available.has(recipeId)) return emptyOutcome("recipe_not_found");
      const key = JSON.stringify([uid, recipeId]);
      if (rows.has(key)) return emptyOutcome("duplicate");
      const row = { user_id: uid, recipe_id: recipeId, created_at: CREATED_AT };
      rows.set(key, row);
      return pgResult({ outcome: "created", ...row });
    },
  };
}

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

function validIdentity(uid = UID) {
  return { token_type: "Bearer", client_id: ENV_ID, sub: uid };
}

function authResponse(identity = validIdentity(), status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return identity; } };
}

// 在隔离 VM 中替换 fetch、SDK、process.env 和计时器；main 不能触及真实网络或身份。
function mainFixture({ env = runtimeFields("VM_ENV_PRIVATE"), fetch: fetchImpl, request } = {}) {
  const exported = {}, logs = [], clients = [], requests = [], authCalls = [], timeouts = [];
  let moduleLoads = 0, now = 1000;
  class FakeDate extends Date { static now() { return now++; } }
  class FakeCommonClient {
    constructor(endpoint, version, config) {
      assert.equal(endpoint, "tcb.tencentcloudapi.com");
      assert.equal(version, "2018-06-08");
      assert.equal(config.region, "ap-shanghai");
      assert.equal(config.profile.signMethod, "TC3-HMAC-SHA256");
      assert.equal(config.profile.httpProfile.reqMethod, "POST");
      assert.equal(config.profile.httpProfile.reqTimeout, 1);
      assert.deepEqual(Object.keys(config.credential).sort(), ["secretId", "secretKey", "token"]);
      this.credential = { ...config.credential };
      clients.push(this);
    }
    async request(action, params) {
      assert.equal(action, "ExecutePGSql");
      assert.deepEqual(Object.keys(params).sort(), ["EnvId", "Role", "Sql"]);
      assert.equal(params.EnvId, ENV_ID);
      const { EnvId, ...options } = params;
      const { uid, recipeId } = sqlIdentity(params.Sql);
      assertWriteQuery(options, uid, recipeId);
      requests.push({ params: { ...params }, credential: { ...this.credential } });
      return request ? request(params, requests.length - 1) : created(uid, recipeId);
    }
  }
  const captureLog = (...args) => {
    assert.equal(args.length, 1, "诊断只输出单条受控文本");
    assert.equal(typeof args[0], "string");
    logs.push(args[0]);
  };
  const sandbox = vm.createContext({
    process: { env },
    Buffer,
    Date: FakeDate,
    AbortSignal: { timeout(ms) { const signal = { vmTimeoutMs: ms }; timeouts.push(signal); return signal; } },
    console: { info: captureLog, warn: captureLog, error: captureLog, log: captureLog },
    async fetch(url, options) {
      authCalls.push({ url, options });
      return fetchImpl ? fetchImpl(url, options, authCalls.length - 1) : authResponse();
    },
  });
  const localModules = new Map();
  function loadLocalModule(filename) {
    assert.ok(["index.js", "database.js"].includes(filename), "只能加载收藏函数包中的两个本地模块");
    if (localModules.has(filename)) return localModules.get(filename);
    const output = filename === "index.js" ? exported : {};
    localModules.set(filename, output);
    const source = readFileSync(new URL("../cloudfunctions/favorites/" + filename, import.meta.url), "utf8");
    const runModule = vm.runInContext("(function (exports, require) {\n" + source + "\n})", sandbox, {
      filename: "cloudfunctions/favorites/" + filename,
    });
    runModule(output, (name) => {
      if (name === "./database.js") return loadLocalModule("database.js");
      assert.equal(name, "tencentcloud-sdk-nodejs-common");
      moduleLoads++;
      return { CommonClient: FakeCommonClient };
    });
    return output;
  }
  loadLocalModule("index.js");
  return { exported, env, logs, clients, requests, authCalls, timeouts, get moduleLoads() { return moduleLoads; } };
}

test("收藏 POST：Day19 数据库操作独立在当前函数包，入口只保留请求/鉴权/响应", () => {
  const indexSource = readFileSync(new URL("../cloudfunctions/favorites/index.js", import.meta.url), "utf8");
  const databaseSource = readFileSync(new URL("../cloudfunctions/favorites/database.js", import.meta.url), "utf8");
  const database = require("../cloudfunctions/favorites/database.js");
  assert.match(indexSource, /require\("\.\/database\.js"\)/);
  assert.doesNotMatch(indexSource, /ExecutePGSql|new CommonClient|function runtimeCredentials|INSERT INTO|function favoriteSql|function decodeResult/);
  assert.match(indexSource, /function verifyAccessToken/);
  assert.match(databaseSource, /ExecutePGSql/);
  assert.match(databaseSource, /ON CONFLICT \(user_id, recipe_id\) DO NOTHING/);
  assert.equal(typeof database.queryDatabase, "function");
  assert.equal(typeof database.createFavorite, "function");
  assert.doesNotMatch(databaseSource, /statusCode|Content-Type|exports\.main|verifyAccessToken|require\("\.\.\//);
});

test("收藏 POST：Day19 数据访问层保留 created/duplicate/notfound 结果及查询参数", async () => {
  const database = require("../cloudfunctions/favorites/database.js");
  const context = { environment: runtimeFields("VM_DAL_PRIVATE") };
  const trace = () => {};
  for (const outcome of ["created", "duplicate", "recipe_not_found"]) {
    let calls = 0;
    const result = await database.createFavorite(UID, RECIPE_ID, async (options, receivedTrace, receivedContext) => {
      calls++;
      assertWriteQuery(options);
      assert.equal(receivedTrace, trace);
      assert.equal(receivedContext, context);
      return outcome === "created" ? created() : emptyOutcome(outcome);
    }, trace, context);
    assert.equal(calls, 1);
    assert.deepEqual(result, outcome === "created"
      ? { outcome, data: { user_id: UID, recipe_id: RECIPE_ID, created_at: CREATED_AT } }
      : { outcome });
  }
});

test("收藏 POST：使用已验证 UID 新增，并返回 HTTP 集成 JSON", async () => {
  const context = { environment: runtimeFields("VM_FORWARDED_PRIVATE") };
  const fixture = instrument({ executePGSql: async (options, _trace, receivedContext) => {
    assertWriteQuery(options);
    assert.equal(receivedContext, context);
    return created();
  } });
  const response = await fixture.handler(event(), context);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(payload(response), { ok: true, data: { user_id: UID, recipe_id: RECIPE_ID, created_at: CREATED_AT } });
  assert.deepEqual(fixture.authCalls, [TOKEN]);
  assert.equal(fixture.sqlCalls.length, 1);
});

test("收藏 POST：控制台对象 body 也只提交一条收藏", async () => {
  const fixture = instrument();
  const response = await fixture.handler(event(undefined, { body: { recipe_id: RECIPE_ID }, headers: { Authorization: "Bearer " + TOKEN } }));
  assert.equal(response.statusCode, 201);
  assert.equal(payload(response).data.recipe_id, RECIPE_ID);
  assert.equal(fixture.sqlCalls.length, 1);
});

test("收藏 POST：网关 base64 JSON 能解码，错误编码不能写库", async () => {
  const encoded = Buffer.from(JSON.stringify({ recipe_id: RECIPE_ID }), "utf8").toString("base64");
  const fixture = instrument();
  const response = await fixture.handler(event(encoded, { isBase64Encoded: true }));
  assert.equal(response.statusCode, 201);
  assert.equal(payload(response).data.recipe_id, RECIPE_ID);
  assert.equal(fixture.sqlCalls.length, 1);
  for (const body of ["%%%%", "YR=="]) {
    await assertInputRejected(event(body, { isBase64Encoded: true }), 400, "INVALID_JSON");
  }
  await assertInputRejected(event(encoded, { isBase64Encoded: "true" }), 400, "INVALID_BODY");
});

test("收藏 POST：原始 Columns/Rows 按列名解码，列顺序变化仍正确", async () => {
  const columns = [...COLUMNS].reverse();
  const fixture = instrument({ executePGSql: async () => pgResult({ outcome: "created", user_id: UID, recipe_id: RECIPE_ID, created_at: CREATED_AT }, columns) });
  const response = await fixture.handler(event());
  assert.equal(response.statusCode, 201);
  assert.deepEqual(payload(response).data, { user_id: UID, recipe_id: RECIPE_ID, created_at: CREATED_AT });
});

test("收藏 POST：接受 ASCII 标识的最小和最大长度", async () => {
  for (const [uid, recipeId] of [["u", "r"], ["u".repeat(128), "r".repeat(64)], ["U_-09", "R_-09"]]) {
    const fixture = instrument({ verifyToken: async () => uid, executePGSql: async (options) => {
      assertWriteQuery(options, uid, recipeId);
      return created(uid, recipeId);
    } });
    assert.equal((await fixture.handler(event({ recipe_id: recipeId }))).statusCode, 201);
  }
});

test("收藏 POST：同用户串行重复收藏只新增一条", async () => {
  const store = atomicStore();
  const fixture = instrument({ executePGSql: store.executePGSql });
  const first = await fixture.handler(event());
  const duplicate = await fixture.handler(event());
  assert.equal(first.statusCode, 201);
  assertFailure(duplicate, 409, "FAVORITE_EXISTS");
  assert.equal(store.rows.size, 1);
  assert.equal(store.calls, 2);
  assert.deepEqual([...store.rows.values()], [payload(first).data]);
});

test("收藏 POST：同用户并发重复收藏只有一个 201、其余 409", async () => {
  const store = atomicStore();
  const fixture = instrument({ executePGSql: store.executePGSql });
  const responses = await Promise.all(Array.from({ length: 8 }, () => fixture.handler(event())));
  assert.equal(responses.filter((response) => response.statusCode === 201).length, 1);
  for (const response of responses.filter((item) => item.statusCode !== 201)) assertFailure(response, 409, "FAVORITE_EXISTS");
  assert.equal(store.rows.size, 1);
  assert.equal(store.calls, 8);
});

test("收藏 POST：不同已登录用户可分别收藏同一道菜", async () => {
  const store = atomicStore();
  const fixture = instrument({ verifyToken: async (token) => token === TOKEN ? UID : "user_SYN_B", executePGSql: store.executePGSql });
  const responses = await Promise.all([
    fixture.handler(event()),
    fixture.handler(event(undefined, { headers: { Authorization: "Bearer TOKEN_SYN_B" } })),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [201, 201]);
  assert.deepEqual(responses.map((response) => payload(response).data.user_id), [UID, "user_SYN_B"]);
  assert.equal(store.rows.size, 2);
});

test("收藏 POST：不存在的菜品返回 404，模拟数据库没有新增", async () => {
  const store = atomicStore(new Set());
  const fixture = instrument({ executePGSql: store.executePGSql });
  assertFailure(await fixture.handler(event()), 404, "RECIPE_NOT_FOUND");
  assert.equal(store.rows.size, 0);
  assert.equal(store.calls, 1);
});

test("收藏 POST：非 POST 请求拒绝且声明 Allow，不认证、不写库", async () => {
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD", "post", undefined]) {
    const fixture = instrument();
    const response = await fixture.handler(event(undefined, { httpMethod: method }));
    assertFailure(response, 405, "METHOD_NOT_ALLOWED");
    assert.equal(response.headers.Allow, "POST");
    assert.equal(fixture.authCalls.length, 0);
    assert.equal(fixture.sqlCalls.length, 0);
  }
});

test("收藏 POST：缺失、null 或空白 recipe_id 都提示必填", async () => {
  for (const body of [{}, { recipe_id: null }, { recipe_id: "" }, { recipe_id: " \t" }]) {
    await assertInputRejected(event(body), 400, "RECIPE_ID_REQUIRED");
  }
});

test("收藏 POST：编号不能是数字、布尔值、对象或数组", async () => {
  for (const recipe_id of [1, false, {}, [RECIPE_ID]]) {
    await assertInputRejected(event({ recipe_id }), 400, "RECIPE_ID_INVALID");
  }
});

test("收藏 POST：非法字符、SQL 片段、尾换行和超长编号均不能写库", async () => {
  for (const recipe_id of ["菜品", "recipe space", "recipe/id", "recipe.id", "recipe' OR '1'='1", RECIPE_ID + "\n", "r".repeat(65)]) {
    await assertInputRejected(event({ recipe_id }), 400, "RECIPE_ID_INVALID");
  }
});

test("收藏 POST：伪造 user_id、角色、SQL 或批量字段均拒绝", async () => {
  for (const extra of [{ user_id: "user_SYN_FORGED" }, { uid: "user_SYN_FORGED" }, { Role: "anon" }, { Sql: "DELETE FROM public.favorites" }, { recipe_ids: [RECIPE_ID] }]) {
    await assertInputRejected(event({ recipe_id: RECIPE_ID, ...extra }), 400, "UNEXPECTED_FIELDS");
  }
});

test("收藏 POST：数组 body 和批量对象数组拒绝", async () => {
  for (const body of [[], [{ recipe_id: RECIPE_ID }]]) await assertInputRejected(event(body), 400, "INVALID_BODY");
});

test("收藏 POST：null、数字、字符串等非对象 body 拒绝", async () => {
  for (const body of [null, 1, true]) await assertInputRejected(event(body), 400, "INVALID_BODY");
  await assertInputRejected(event('"recipe_SYN_01"'), 400, "INVALID_BODY");
  await assertInputRejected(event(undefined, { body: undefined }), 400, "INVALID_BODY");
});

test("收藏 POST：坏 JSON 返回 400，不进入认证或数据库", async () => {
  for (const body of ["", "{", '{"recipe_id":}', '{"recipe_id":"recipe_SYN_01",}']) {
    await assertInputRejected(event(body), 400, "INVALID_JSON");
  }
});

test("收藏 POST：body 上限按 UTF-8 字节计算，1024 字节边界可通过", async () => {
  const json = JSON.stringify({ recipe_id: RECIPE_ID });
  const atLimit = json + " ".repeat(1024 - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(atLimit), 1024);
  assert.equal((await instrument().handler(event(atLimit))).statusCode, 201);
  await assertInputRejected(event(atLimit + " "), 413, "BODY_TOO_LARGE");
  const multibyte = JSON.stringify({ recipe_id: "菜".repeat(400) });
  assert.ok(multibyte.length < 1024 && Buffer.byteLength(multibyte) > 1024);
  await assertInputRejected(event(multibyte), 413, "BODY_TOO_LARGE");
  await assertInputRejected(event(undefined, { body: { recipe_id: "r".repeat(1100) } }), 413, "BODY_TOO_LARGE");
});

test("收藏 POST：非 JSON 内容类型和冲突类型头返回 415", async () => {
  for (const headers of [
    { Authorization: "Bearer " + TOKEN, "Content-Type": "text/plain" },
    { Authorization: "Bearer " + TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
    { Authorization: "Bearer " + TOKEN, "Content-Type": ["application/json"] },
    { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", "content-type": "application/json" },
  ]) await assertInputRejected(event(undefined, { headers }), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("收藏 POST：JSON 参数与大小写不同的 header 名称正常处理", async () => {
  const fixture = instrument();
  const response = await fixture.handler(event(undefined, { headers: { "content-type": "Application/JSON; charset=utf-8", authorization: "bearer " + TOKEN } }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(fixture.authCalls, [TOKEN]);
});

test("收藏 POST：无登录头且 body 非法时先报告 body 错误", async () => {
  await assertInputRejected(event({}, { headers: {} }), 400, "RECIPE_ID_REQUIRED");
  await assertInputRejected(event("{", { headers: {} }), 400, "INVALID_JSON");
});

test("收藏 POST：未登录返回 401 AUTH_REQUIRED，不写库", async () => {
  const fixture = instrument();
  assertFailure(await fixture.handler(event(undefined, { headers: {} })), 401, "AUTH_REQUIRED");
  assert.equal(fixture.authCalls.length, 0);
  assert.equal(fixture.sqlCalls.length, 0);
});

test("收藏 POST：格式错误或冲突 Authorization 不能进入认证", async () => {
  for (const authorization of ["", "Bearer", "Bearer ", "Basic " + TOKEN, "Bearer one two", "Bearer " + TOKEN + "\n", ["Bearer " + TOKEN]]) {
    const fixture = instrument();
    assertFailure(await fixture.handler(event(undefined, { headers: { Authorization: authorization } })), 401, "AUTH_INVALID");
    assert.equal(fixture.authCalls.length, 0);
    assert.equal(fixture.sqlCalls.length, 0);
  }
  const fixture = instrument();
  assertFailure(await fixture.handler(event(undefined, { headers: { Authorization: "Bearer " + TOKEN, authorization: "Bearer TOKEN_SYN_B" } })), 401, "AUTH_INVALID");
  assert.equal(fixture.sqlCalls.length, 0);
});

test("收藏 POST：认证返回缺失或非法 UID 时不能写库", async () => {
  for (const uid of [undefined, null, 1, "", "用户", "user space", UID + "\n", "u".repeat(129)]) {
    const fixture = instrument({ verifyToken: async () => uid });
    assertFailure(await fixture.handler(event()), 401, "AUTH_INVALID");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.sqlCalls.length, 0);
  }
});

test("收藏 POST：认证异常返回 503，不信任异常自带状态或错误码", async () => {
  const secret = "PRIVATE_AUTH_EXCEPTION";
  const error = Object.assign(new Error(secret), { code: "AUTH_REQUIRED", statusCode: 201 });
  const fixture = instrument({ verifyToken: async () => { throw error; } });
  const response = await fixture.handler(event());
  assertFailure(response, 503, "AUTH_UNAVAILABLE");
  assert.equal(fixture.sqlCalls.length, 0);
  assert.ok(!response.body.includes(secret));
});

test("收藏 POST：数据库失败返回 500，不暴露 SQL、身份或原始异常", async () => {
  let sql;
  const fixture = instrument({ executePGSql: async (options) => {
    sql = options.Sql;
    throw Object.assign(new Error("PRIVATE_DATABASE_EXCEPTION " + TOKEN + " " + UID + " " + sql), { code: "PRIVATE_DATABASE_CODE" });
  } });
  const response = await fixture.handler(event());
  assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
  for (const value of ["PRIVATE_DATABASE_EXCEPTION", "PRIVATE_DATABASE_CODE", TOKEN, UID, sql]) assert.ok(!response.body.includes(value));
  assert.equal(fixture.sqlCalls.length, 1);
});

test("收藏 POST：畸形 Columns/Rows、缺列、重复列或多行都不能冒充写入成功", async () => {
  const invalid = [
    null, {}, { Columns: null, Rows: null },
    { Columns: COLUMNS.slice(1), Rows: [] },
    { Columns: ["outcome", "user_id", "recipe_id", "recipe_id"], Rows: [] },
    { Columns: COLUMNS, Rows: null }, { Columns: COLUMNS, Rows: [] },
    { Columns: COLUMNS, Rows: [created().Rows[0], created().Rows[0]] },
    { Columns: COLUMNS, Rows: "not an array" },
    { Columns: COLUMNS, Rows: ["not JSON"] }, { Columns: COLUMNS, Rows: ["{}"] },
    { Columns: COLUMNS, Rows: ["[]"] }, { Columns: COLUMNS, Rows: [["created", UID, RECIPE_ID, CREATED_AT]] },
  ];
  for (const result of invalid) {
    const fixture = instrument({ executePGSql: async () => result });
    assertFailure(await fixture.handler(event()), 500, "FAVORITE_WRITE_FAILED");
  }
});

test("收藏 POST：数据库返回的 UID 或菜品编号必须与本次请求匹配", async () => {
  for (const result of [created("user_SYN_OTHER"), created(UID, "recipe_SYN_OTHER")]) {
    const fixture = instrument({ executePGSql: async () => result });
    assertFailure(await fixture.handler(event()), 500, "FAVORITE_WRITE_FAILED");
  }
});

test("收藏 POST：created_at 必须是有效 UTC 毫秒时间，不接受无效日期或其它格式", async () => {
  for (const timestamp of [null, 123, "bad time", "2026-02-30T08:09:10.123Z", "2026-10-10T08:09:10Z", "2026-10-10T08:09:10.123+00:00", CREATED_AT + "\n"]) {
    const fixture = instrument({ executePGSql: async () => created(UID, RECIPE_ID, timestamp) });
    assertFailure(await fixture.handler(event()), 500, "FAVORITE_WRITE_FAILED");
  }
});

test("收藏 POST：未知 outcome 或重复/不存在结果夹带数据视为数据库失败", async () => {
  for (const row of [
    { outcome: "unknown", user_id: null, recipe_id: null, created_at: null },
    { outcome: "duplicate", user_id: UID, recipe_id: null, created_at: null },
    { outcome: "recipe_not_found", user_id: null, recipe_id: RECIPE_ID, created_at: null },
    { outcome: "duplicate", user_id: null, recipe_id: null, created_at: CREATED_AT },
  ]) {
    const fixture = instrument({ executePGSql: async () => pgResult(row) });
    assertFailure(await fixture.handler(event()), 500, "FAVORITE_WRITE_FAILED");
  }
});

test("收藏 POST：请求中的环境、角色、SQL 和用户资料不能替换固定写库参数", async () => {
  const fixture = instrument({ executePGSql: async (options) => { assertWriteQuery(options); return created(); } });
  const response = await fixture.handler(event(undefined, {
    user_id: "user_SYN_FORGED", uid: "user_SYN_FORGED", Role: "anon", Sql: "DELETE FROM other_table", EnvId: "other-env",
    queryStringParameters: { user_id: "user_SYN_FORGED", Role: "anon", Sql: "DELETE FROM other_table", EnvId: "other-env" },
  }));
  assert.equal(response.statusCode, 201);
  const sql = fixture.sqlCalls[0].options.Sql;
  assert.ok(!sql.includes("FORGED") && !sql.includes("other_table") && !sql.includes("other-env"));
  assert.equal(payload(response).data.user_id, UID);
});

test("收藏 POST：每个请求重新执行 SQL，不缓存前次成功结果", async () => {
  let calls = 0;
  const timestamps = [CREATED_AT, "2026-10-10T08:09:11.456Z"];
  const fixture = instrument({ executePGSql: async () => created(UID, RECIPE_ID, timestamps[calls++]) });
  const first = await fixture.handler(event());
  const second = await fixture.handler(event());
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.deepEqual([payload(first).data.created_at, payload(second).data.created_at], timestamps);
  assert.equal(calls, 2);
  assert.equal(fixture.authCalls.length, 2);
});

test("收藏 main：官方 introspect 地址、Bearer 和短超时请求选项固定", async () => {
  const fixture = mainFixture();
  const response = await fixture.exported.main(event());
  assert.equal(response.statusCode, 201);
  assert.equal(fixture.authCalls.length, 1);
  const { url, options } = fixture.authCalls[0];
  assert.equal(url, AUTH_URL);
  assert.equal(options.method, "GET");
  assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.signal, fixture.timeouts[0]);
  assert.equal(fixture.timeouts[0].vmTimeoutMs, 1000);
  assert.equal(fixture.requests.length, 1);
});

test("收藏 main：官方认证 payload 必须有匹配环境、Bearer 类型和合法 sub", async () => {
  const invalid = [null, [], {}, { ...validIdentity(), client_id: "other-env" }, { ...validIdentity(), token_type: "Basic" },
    { ...validIdentity(), sub: null }, { ...validIdentity(), sub: 1 }, { ...validIdentity(), sub: "用户" },
    { ...validIdentity(), sub: UID + "\n" }, { ...validIdentity(), sub: "u".repeat(129) }];
  for (const identity of invalid) {
    const fixture = mainFixture({ fetch: async () => authResponse(identity) });
    assertFailure(await fixture.exported.main(event()), 401, "AUTH_INVALID");
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
  }
  const fixture = mainFixture({ fetch: async () => authResponse({ ...validIdentity(), token_type: "bEaReR" }) });
  assert.equal((await fixture.exported.main(event())).statusCode, 201);
});

test("收藏 main：官方认证拒绝返回 401，不能调用数据库", async () => {
  for (const status of [400, 401, 403, 404]) {
    const fixture = mainFixture({ fetch: async () => authResponse({ PRIVATE_AUTH_BODY: TOKEN }, status) });
    const response = await fixture.exported.main(event());
    assertFailure(response, 401, "AUTH_INVALID");
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
    assert.ok(!response.body.includes(TOKEN));
  }
});

test("收藏 main：认证网络错误、服务错误和坏 JSON 返回 503 且不泄露原始错误", async () => {
  const cases = [
    async () => { throw new Error("PRIVATE_AUTH_NETWORK " + TOKEN); },
    async () => authResponse({}, 500),
    async () => authResponse({}, 503),
    async () => ({ ok: true, status: 200, async json() { throw new Error("PRIVATE_AUTH_JSON " + TOKEN); } }),
  ];
  for (const fetchImpl of cases) {
    const fixture = mainFixture({ fetch: fetchImpl });
    const response = await fixture.exported.main(event());
    assertFailure(response, 503, "AUTH_UNAVAILABLE");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.clients.length, 0);
    for (const privateValue of ["PRIVATE_AUTH_NETWORK", "PRIVATE_AUTH_JSON", TOKEN]) {
      assert.ok(![response.body, ...fixture.logs].join("\n").includes(privateValue));
    }
  }
});

test("收藏 main：同一 token 也重新认证，更新 token/UID 不沿用旧身份", async () => {
  const identities = [validIdentity(UID), validIdentity("user_SYN_B"), validIdentity("user_SYN_C")];
  const fixture = mainFixture({ fetch: async (_url, _options, index) => authResponse(identities[index]) });
  const responses = [];
  for (const token of [TOKEN, TOKEN, "TOKEN_SYN_C"]) {
    responses.push(await fixture.exported.main(event(undefined, { headers: { Authorization: "Bearer " + token } })));
  }
  assert.deepEqual(responses.map((response) => payload(response).data.user_id), [UID, "user_SYN_B", "user_SYN_C"]);
  assert.deepEqual(fixture.authCalls.map((call) => call.options.headers.Authorization), ["Bearer " + TOKEN, "Bearer " + TOKEN, "Bearer TOKEN_SYN_C"]);
  assert.equal(fixture.requests.length, 3);
  assert.equal(new Set(fixture.clients).size, 3);
});

test("收藏 main：每次使用本次完整运行身份，新建 SDK 客户端并固定环境和写角色", async () => {
  const fixture = mainFixture();
  const top = runtimeFields("VM_TOP_PRIVATE");
  const objectEnvironment = runtimeFields("VM_OBJECT_PRIVATE");
  const jsonEnvironment = runtimeFields("VM_JSON_PRIVATE");
  const updated = runtimeFields("VM_UPDATED_PRIVATE");
  const forged = runtimeFields("VM_EVENT_FORGED_PRIVATE");
  const request = event(undefined, { ...forged, environment: forged, credential: sdkCredential(forged), queryStringParameters: { ...forged, EnvId: "other-env", Role: "anon" } });
  const invocations = [
    { context: { ...top, environment: "INVALID_LOWER_PRIORITY_JSON" }, expected: top },
    { context: { environment: objectEnvironment }, expected: objectEnvironment },
    { context: { environment: JSON.stringify(jsonEnvironment) }, expected: jsonEnvironment },
    { context: { environment: { CUSTOM_FLAG: "unused" } }, expected: { ...fixture.env } },
    { context: undefined, expected: updated },
  ];
  for (const [index, invocation] of invocations.entries()) {
    if (index === 4) Object.assign(fixture.env, updated);
    const response = await fixture.exported.main(request, invocation.context);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(fixture.clients[index].credential, sdkCredential(invocation.expected));
    assert.deepEqual(fixture.requests[index].credential, sdkCredential(invocation.expected));
  }
  assert.equal(fixture.authCalls.length, 5);
  assert.equal(fixture.requests.length, 5);
  assert.equal(new Set(fixture.clients).size, 5);
  assert.equal(fixture.moduleLoads, 1, "可以复用 SDK 模块，但不能复用带凭据的客户端");
});

test("收藏 main：运行身份缺失或来源不完整时 500，不拼接、回退或相信 event", async () => {
  const valid = runtimeFields("VM_FALLBACK_PRIVATE");
  const partial = { TENCENTCLOUD_SECRETID: "VM_PARTIAL_PRIVATE_id" };
  const cases = [
    { env: {} },
    { env: { TENCENTCLOUD_SECRET_ID: "VM_CUSTOM_id", TENCENTCLOUD_SECRET_KEY: "VM_CUSTOM_key", TENCENTCLOUD_TOKEN: "VM_CUSTOM_token" } },
    { context: { ...partial, environment: valid } },
    { context: { TENCENTCLOUD_SECRETID: undefined, environment: valid } },
    { context: { ...valid, TENCENTCLOUD_SESSIONTOKEN: " \t", environment: valid } },
    { context: { environment: partial } },
    { context: { environment: JSON.stringify(partial) } },
    { context: { environment: "PRIVATE_INVALID_JSON" } },
    { env: { ...valid, TENCENTCLOUD_SECRETKEY: 123 } },
  ];
  for (const item of cases) {
    const fixture = mainFixture({ env: item.env ?? { ...valid } });
    const forged = runtimeFields("VM_EVENT_FORGED_PRIVATE");
    const response = await fixture.exported.main(event(undefined, { ...forged, environment: forged, credential: sdkCredential(forged) }), item.context);
    assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
    assert.ok(!response.body.includes("PRIVATE"));
  }
});

test("收藏 main：诊断只含阶段、毫秒与受控错误码，敏感异常不进入响应或日志", async () => {
  const fields = runtimeFields("VM_DIAG_PRIVATE");
  const errorCases = [
    { code: "FailedOperation.PGExecuteSqlError", safe: "FailedOperation.PGExecuteSqlError" },
    { code: "AuthFailure.PRIVATE_CODE\nforged_log", safe: "AuthFailure" },
    { code: "PRIVATE_CODE.Unknown", safe: "UNKNOWN_API_ERROR" },
    { code: undefined, safe: "NO_API_ERROR_CODE" },
  ];
  for (const item of errorCases) {
    let sql;
    const fixture = mainFixture({ env: fields, request: async (params) => {
      sql = params.Sql;
      const error = Object.assign(new Error("PRIVATE_ERROR_MESSAGE " + TOKEN + " " + UID + " " + sql), { code: item.code, RequestId: fields.TENCENTCLOUD_SESSIONTOKEN });
      error.stack = "PRIVATE_ERROR_STACK " + Object.values(fields).join(" ");
      throw error;
    } });
    const response = await fixture.exported.main(event());
    assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
    assert.equal(fixture.requests.length, 1, "写入失败不能自动重试");
    assert.equal(fixture.authCalls.length, 1);
    assert.ok(fixture.logs.some((line) => line.endsWith(" code=" + item.safe)));
    assert.equal(fixture.logs.filter((line) => line.includes(" api_error ")).length, 1);
    for (const line of fixture.logs) {
      assert.match(line, /^\[favorites-diag-v1\] (?:entry|auth_start|auth_ready|auth_error|sdk_ready|api_call_start|api_return|api_error) elapsed_ms=\d+(?: code=[A-Za-z0-9_.]+)?$/);
    }
    const observable = [response.body, ...fixture.logs].join("\n");
    for (const value of [TOKEN, UID, RECIPE_ID, "PRIVATE_CODE", "PRIVATE_ERROR_MESSAGE", "PRIVATE_ERROR_STACK", sql, ...Object.values(fields)]) {
      assert.ok(!observable.includes(value), "可见输出不得包含合成私有值：" + value);
    }
  }
});

test("收藏函数独立使用 CommonJS 并固定 SDK 依赖版本", () => {
  const manifest = JSON.parse(readFileSync(new URL("../cloudfunctions/favorites/package.json", import.meta.url), "utf8"));
  assert.equal(manifest.type, "commonjs");
  assert.deepEqual(manifest.dependencies, { "tencentcloud-sdk-nodejs-common": "4.1.220" });
  assert.equal(typeof favorites.createHandler, "function");
  assert.equal(typeof favorites.main, "function");
});
