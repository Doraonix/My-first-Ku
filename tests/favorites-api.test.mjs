import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ENV_ID = "doraonix-d2g6piooqfa4ba0c9";
const AUTH_URL = `https://${ENV_ID}.api.tcloudbasegateway.com/auth/v1/token/introspect?client_id=${ENV_ID}`;
const UID = "user_SYN_A";
const RECIPE_ID = "recipe_SYN_01";
const TOKEN = "TOKEN_SYN_A";
const CREATED_AT = "2026-10-10T08:09:10.123Z";
const COLUMNS = ["outcome", "user_id", "recipe_id", "created_at"];
const FAVORITE_COLUMNS = ["user_id", "recipe_id", "created_at", "note"];
const DELETED_COLUMNS = ["user_id", "recipe_id"];
const NOTE = "Day22 合成备注";

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

function favoriteDto(overrides = {}) {
  return { user_id: UID, recipe_id: RECIPE_ID, created_at: CREATED_AT, note: NOTE, ...overrides };
}

function favoriteRows(rows = [favoriteDto()], columns = FAVORITE_COLUMNS) {
  return { Columns: [...columns], Rows: rows.map((row) => JSON.stringify(columns.map((name) => row[name]))) };
}

function deletedRows(rows = [{ user_id: UID, recipe_id: RECIPE_ID }], columns = DELETED_COLUMNS) {
  return { Columns: [...columns], Rows: rows.map((row) => JSON.stringify(columns.map((name) => row[name]))) };
}

function deleteEvent(query = { recipe_id: RECIPE_ID }, overrides = {}) {
  return { httpMethod: "DELETE", headers: { Authorization: "Bearer " + TOKEN },
    queryStringParameters: query, ...overrides };
}

function getEvent(query, overrides = {}) {
  return { httpMethod: "GET", headers: { Authorization: "Bearer " + TOKEN },
    queryStringParameters: query, ...overrides };
}

function patchEvent(note = NOTE, overrides = {}) {
  return event({ recipe_id: RECIPE_ID, note }, { httpMethod: "PATCH", ...overrides });
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

function assertReadQuery(options, uid = UID, recipeId) {
  assert.deepEqual(Object.keys(options).sort(), ["Role", "Sql"]);
  assert.equal(options.Role, "service_role");
  const sql = options.Sql.replace(/\s+/g, " ").trim();
  assert.match(sql, /^SELECT /i);
  assert.match(sql, /FROM public\.favorites WHERE user_id = '/i);
  assert.ok(sql.includes("WHERE user_id = '" + uid + "'"));
  if (recipeId !== undefined) assert.ok(sql.includes("AND recipe_id = '" + recipeId + "'"));
  else assert.doesNotMatch(sql, /AND recipe_id =/i);
  assert.match(sql, /ORDER BY created_at DESC, recipe_id/i);
  assert.match(sql, /to_char\(created_at AT TIME ZONE 'UTC'/i);
  assert.equal((sql.match(/;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|TRUNCATE|LIMIT|OFFSET)\b/i);
}

function assertPatchQuery(options, uid = UID, recipeId = RECIPE_ID, note = NOTE) {
  assert.deepEqual(Object.keys(options).sort(), ["Role", "Sql"]);
  assert.equal(options.Role, "service_role");
  const sql = options.Sql.replace(/\s+/g, " ").trim();
  assert.match(sql, /^WITH updated AS \( UPDATE public\.favorites SET note = convert_from\(decode\('/i);
  const hex = /decode\('([0-9a-f]*)',\s*'hex'\)/i.exec(sql)?.[1];
  assert.equal(typeof hex, "string");
  assert.equal(Buffer.from(hex, "hex").toString("utf8"), note);
  assert.equal(hex, Buffer.from(note, "utf8").toString("hex"));
  assert.ok(sql.includes("WHERE user_id = '" + uid + "' AND recipe_id = '" + recipeId + "'"));
  assert.match(sql, /RETURNING user_id, recipe_id, created_at, note \) SELECT user_id, recipe_id,/i);
  assert.match(sql, /to_char\(created_at AT TIME ZONE 'UTC'/i);
  assert.match(sql, /AS created_at, note FROM updated;$/i);
  assert.equal((sql.match(/\bUPDATE\b/gi) ?? []).length, 1);
  assert.equal((sql.match(/\bSELECT\b/gi) ?? []).length, 1);
  assert.equal((sql.match(/\bFROM\b/gi) ?? []).length, 1, "外层只读取更新结果，不能另读基表");
  assert.equal((sql.match(/;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\b(INSERT|DELETE|DROP|ALTER|GRANT|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /SET (?:user_id|recipe_id|created_at)\s*=/i);
}

function assertDeleteQuery(options, uid = UID, recipeId = RECIPE_ID) {
  assert.deepEqual(Object.keys(options).sort(), ["Role", "Sql"]);
  assert.equal(options.Role, "service_role");
  const sql = options.Sql.replace(/\s+/g, " ").trim();
  assert.equal(sql, "WITH deleted AS ( DELETE FROM public.favorites WHERE user_id = '" + uid +
    "' AND recipe_id = '" + recipeId + "' RETURNING user_id, recipe_id ) SELECT user_id, recipe_id FROM deleted;");
  assert.equal((sql.match(/\bDELETE\b/gi) ?? []).length, 1);
  assert.equal((sql.match(/\bSELECT\b/gi) ?? []).length, 1);
  assert.equal((sql.match(/\bFROM\b/gi) ?? []).length, 2, "外层仅读取本次删除结果，不再查询基表");
  assert.equal((sql.match(/;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DROP|ALTER|GRANT|TRUNCATE|recipes|CASCADE)\b/i);
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
function mainFixture({ env = runtimeFields("VM_ENV_PRIVATE"), fetch: fetchImpl, request,
  onLog, updateFavoriteNote: patchImplementation } = {}) {
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
      let uid, recipeId, result;
      if (/^WITH target AS/.test(params.Sql)) {
        ({ uid, recipeId } = sqlIdentity(params.Sql));
        assertWriteQuery(options, uid, recipeId);
        result = created(uid, recipeId);
      } else {
        uid = /WHERE user_id = '([A-Za-z0-9_-]+)'/.exec(params.Sql)?.[1];
        recipeId = /AND recipe_id = '([A-Za-z0-9_-]+)'/.exec(params.Sql)?.[1];
        assert.ok(uid, "GET/PATCH/DELETE 必须绑定认证 UID");
        if (/^SELECT /.test(params.Sql)) {
          assertReadQuery(options, uid, recipeId);
          result = favoriteRows([favoriteDto({ user_id: uid, recipe_id: recipeId ?? RECIPE_ID })]);
        } else if (/^WITH deleted AS/.test(params.Sql)) {
          assertDeleteQuery(options, uid, recipeId);
          result = deletedRows([{ user_id: uid, recipe_id: recipeId }]);
        } else {
          const hex = /decode\('([0-9a-f]*)',\s*'hex'\)/i.exec(params.Sql)?.[1];
          assert.equal(typeof hex, "string");
          const note = Buffer.from(hex, "hex").toString("utf8");
          assertPatchQuery(options, uid, recipeId, note);
          result = favoriteRows([favoriteDto({ user_id: uid, recipe_id: recipeId, note })]);
        }
      }
      requests.push({ params: { ...params }, credential: { ...this.credential } });
      return request ? request(params, requests.length - 1) : result;
    }
  }
  const captureLog = (...args) => {
    assert.equal(args.length, 1, "诊断只输出单条受控文本");
    assert.equal(typeof args[0], "string");
    logs.push(args[0]);
    if (onLog) onLog(args[0]);
  };
  const sandbox = vm.createContext({
    process: { env },
    Buffer,
    URLSearchParams,
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
    if (filename === "database.js" && patchImplementation) output.updateFavoriteNote = patchImplementation;
    return output;
  }
  loadLocalModule("index.js");
  return { exported, database: localModules.get("database.js"), env, logs, clients, requests, authCalls, timeouts,
    get moduleLoads() { return moduleLoads; } };
}

const favorites = mainFixture().exported;

test("收藏 POST：Day19 数据库操作独立在当前函数包，入口只保留请求/鉴权/响应", () => {
  const indexSource = readFileSync(new URL("../cloudfunctions/favorites/index.js", import.meta.url), "utf8");
  const databaseSource = readFileSync(new URL("../cloudfunctions/favorites/database.js", import.meta.url), "utf8");
  const database = mainFixture().database;
  assert.match(indexSource, /require\("\.\/database\.js"\)/);
  assert.doesNotMatch(indexSource, /ExecutePGSql|new CommonClient|function runtimeCredentials|INSERT INTO|function favoriteSql|function decodeResult/);
  assert.match(indexSource, /function verifyAccessToken/);
  assert.match(databaseSource, /ExecutePGSql/);
  assert.match(databaseSource, /ON CONFLICT \(user_id, recipe_id\) DO NOTHING/);
  assert.equal(typeof database.queryDatabase, "function");
  assert.equal(typeof database.createFavorite, "function");
  assert.deepEqual(Object.keys(database).sort(), ["createFavorite", "deleteFavorite", "queryDatabase", "readFavorites", "updateFavoriteNote"]);
  assert.doesNotMatch(databaseSource, /statusCode|Content-Type|exports\.main|verifyAccessToken|require\("\.\.\//);
});

test("收藏 POST：Day19 数据访问层保留 created/duplicate/notfound 结果及查询参数", async () => {
  const database = mainFixture().database;
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
    assert.deepEqual(JSON.parse(JSON.stringify(result)), outcome === "created"
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

test("收藏接口：支持 GET/POST/PATCH/DELETE，其余方法不认证、不进库", async () => {
  for (const method of ["PUT", "TRACE", "OPTIONS", "HEAD", "post", "get", "patch", "delete", undefined]) {
    const fixture = instrument();
    const response = await fixture.handler(event(undefined, { httpMethod: method }));
    assertFailure(response, 405, "METHOD_NOT_ALLOWED");
    assert.equal(response.headers.Allow, "GET, POST, PATCH, DELETE");
    assert.equal(payload(response).error.message, "只支持 GET、POST、PATCH 或 DELETE 请求。");
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
  for (const extra of [{ user_id: "user_SYN_FORGED" }, { uid: "user_SYN_FORGED" }, { Role: "anon" }, { Sql: "DELETE FROM public.favorites" }, { recipe_ids: [RECIPE_ID] }, { note: NOTE }]) {
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

test("收藏 main：初始化即加载 SDK 类一次，未请求时不认证、不建客户端、不调用库", () => {
  const fixture = mainFixture();
  assert.equal(fixture.moduleLoads, 1);
  assert.equal(fixture.authCalls.length, 0);
  assert.equal(fixture.clients.length, 0);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.timeouts.length, 0);
  assert.equal(fixture.logs.length, 0);
});

test("收藏 main：SDK 类已加载，GET/POST/PATCH/DELETE 校验或登录头失败仍不认证、不建客户端、不调用库", async () => {
  const fixture = mainFixture();
  const cases = [
    [getEvent({ user_id: UID }), 400, "INVALID_QUERY"],
    [event({}), 400, "RECIPE_ID_REQUIRED"],
    [patchEvent("\n"), 400, "NOTE_INVALID"],
    [deleteEvent({}), 400, "RECIPE_ID_REQUIRED"],
    [deleteEvent({ recipe_id: RECIPE_ID, user_id: UID }), 400, "INVALID_QUERY"],
    [deleteEvent(undefined, { body: "{}" }), 400, "DELETE_BODY_NOT_ALLOWED"],
    [deleteEvent(undefined, { rawQueryString: "recipe_id=" + RECIPE_ID + "&recipe_id=" + RECIPE_ID }), 400, "INVALID_QUERY"],
  ];
  for (const request of [getEvent(), event(), patchEvent(), deleteEvent()]) {
    cases.push([{ ...request, headers: {} }, 401, "AUTH_REQUIRED"]);
    cases.push([{ ...request, headers: { Authorization: "Basic " + TOKEN } }, 401, "AUTH_INVALID"]);
  }
  for (const [request, statusCode, code] of cases) {
    assertFailure(await fixture.exported.main(request), statusCode, code);
    assert.equal(fixture.moduleLoads, 1);
    assert.equal(fixture.authCalls.length, 0);
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.timeouts.length, 0);
  }
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
    assert.equal(fixture.moduleLoads, 1);
    assert.equal(fixture.authCalls.length, 1);
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
    assert.equal(fixture.moduleLoads, 1);
    assert.equal(fixture.authCalls.length, 1);
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
    assert.equal(fixture.moduleLoads, 1);
    assert.equal(fixture.authCalls.length, 1);
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
  assert.equal(fixture.moduleLoads, 1);
});

test("收藏 main：每次使用本次完整运行身份，新建 SDK 客户端并固定环境和写角色", async () => {
  const fixture = mainFixture();
  assert.equal(fixture.moduleLoads, 1, "SDK 类必须在首次请求之前加载");
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
    assert.equal(fixture.moduleLoads, 1, "后续请求不能再次加载 SDK 类");
    assert.equal(fixture.clients.length, index + 1, "每次请求都必须新建使用本次凭据的客户端");
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

test("收藏 GET：无筛选只查询验证 UID 的全部收藏，返回四字段 DTO 数组", async () => {
  const rows = [favoriteDto(), favoriteDto({ recipe_id: "recipe_SYN_02", note: "" })];
  for (const query of [undefined, null, {}]) {
    const fixture = instrument({ executePGSql: async (options) => {
      assertReadQuery(options);
      return favoriteRows(rows);
    } });
    const response = await fixture.handler(getEvent(query));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: rows });
    assert.deepEqual(fixture.authCalls, [TOKEN]);
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 GET：空列表正常返回，不添加分页字段或假造数据", async () => {
  const fixture = instrument({ executePGSql: async () => favoriteRows([]) });
  const response = await fixture.handler(getEvent());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload(response), { ok: true, data: [] });
  assert.equal(fixture.sqlCalls.length, 1);
});

test("收藏 GET：单条 recipe_id 筛选仍返回数组，未找到返回空数组", async () => {
  for (const rows of [[], [favoriteDto()]]) {
    const fixture = instrument({ executePGSql: async (options) => {
      assertReadQuery(options, UID, RECIPE_ID);
      return favoriteRows(rows);
    } });
    const response = await fixture.handler(getEvent({ recipe_id: RECIPE_ID }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: rows });
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 GET：查询参数只允许单个合法 recipe_id，不接受批量/分页/SQL/伪造 UID", async () => {
  const invalid = [[], [RECIPE_ID], "recipe_id=" + RECIPE_ID, 1, false,
    { user_id: UID }, { recipe_id: RECIPE_ID, user_id: UID }, { limit: "1" },
    { Role: "anon" }, { Sql: "SELECT * FROM public.favorites" }, { recipe_ids: [RECIPE_ID] },
    { recipe_id: null }, { recipe_id: undefined }, { recipe_id: false }, { recipe_id: 1 },
    { recipe_id: [RECIPE_ID] }, { recipe_id: {} }, { recipe_id: "" }, { recipe_id: " " },
    { recipe_id: "菜" }, { recipe_id: "recipe/id" }, { recipe_id: "recipe.id" },
    { recipe_id: "r' OR '1'='1" }, { recipe_id: RECIPE_ID + "\n" }, { recipe_id: "r".repeat(65) }];
  for (const query of invalid) await assertInputRejected(getEvent(query), 400, "INVALID_QUERY");
});

test("收藏 GET：单值和多值查询表示必须一致，重复值不能伪装单条筛选", async () => {
  const fixture = instrument({ executePGSql: async () => favoriteRows() });
  const response = await fixture.handler(getEvent({ recipe_id: RECIPE_ID }, {
    multiValueQueryStringParameters: { recipe_id: [RECIPE_ID] },
  }));
  assert.equal(response.statusCode, 200);
  for (const multi of [
    { recipe_id: [RECIPE_ID, RECIPE_ID] }, { recipe_id: [] }, { recipe_id: RECIPE_ID },
    { recipe_id: [null] }, { recipe_id: ["recipe_SYN_OTHER"] },
    { recipe_id: [RECIPE_ID], user_id: [UID] },
  ]) await assertInputRejected(getEvent({ recipe_id: RECIPE_ID }, {
    multiValueQueryStringParameters: multi,
  }), 400, "INVALID_QUERY");
});

test("收藏 GET：非空 body 一律拒绝，不能利用 body 传入他人 UID", async () => {
  for (const body of ["{}", " ", "null", "bad JSON", {}, [], false, 0,
    { user_id: "user_SYN_OTHER" }, JSON.stringify({ recipe_id: RECIPE_ID })]) {
    await assertInputRejected(getEvent(undefined, { body }), 400, "GET_BODY_NOT_ALLOWED");
  }
  for (const body of [undefined, null, ""]) {
    const fixture = instrument({ executePGSql: async () => favoriteRows([]) });
    assert.equal((await fixture.handler(getEvent(undefined, { body }))).statusCode, 200);
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 GET：顶层伪造身份、环境和 SQL 不替换验证 UID 与固定查询", async () => {
  const fixture = instrument({ executePGSql: async (options) => {
    assertReadQuery(options, UID, RECIPE_ID);
    assert.ok(!options.Sql.includes("FORGED"));
    return favoriteRows();
  } });
  const response = await fixture.handler(getEvent({ recipe_id: RECIPE_ID }, {
    user_id: "user_SYN_FORGED", uid: "user_SYN_FORGED", Role: "anon", Sql: "DELETE FROM other_table", EnvId: "other-env",
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(payload(response).data[0].user_id, UID);
});

test("收藏 GET：列顺序变化照常解码，结果必须是精确四字段", async () => {
  const fixture = instrument({ executePGSql: async () => favoriteRows([favoriteDto()], [...FAVORITE_COLUMNS].reverse()) });
  const response = await fixture.handler(getEvent());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload(response), { ok: true, data: [favoriteDto()] });
  assert.deepEqual(Object.keys(payload(response).data[0]).sort(), [...FAVORITE_COLUMNS].sort());
});

test("收藏 GET：原始结果缺列/重列/多列/坏 JSON/错单元格均不能读取成功", async () => {
  const valid = favoriteRows();
  const invalid = [null, {}, { Columns: null, Rows: null },
    { Columns: FAVORITE_COLUMNS.slice(1), Rows: [] },
    { Columns: ["user_id", "recipe_id", "created_at", "created_at"], Rows: [] },
    { Columns: [...FAVORITE_COLUMNS, "private_field"], Rows: [] },
    { Columns: FAVORITE_COLUMNS, Rows: null }, { Columns: FAVORITE_COLUMNS, Rows: "[]" },
    { Columns: FAVORITE_COLUMNS, Rows: ["not JSON"] }, { Columns: FAVORITE_COLUMNS, Rows: ["{}"] },
    { Columns: FAVORITE_COLUMNS, Rows: ["[]"] },
    { Columns: FAVORITE_COLUMNS, Rows: [[UID, RECIPE_ID, CREATED_AT, NOTE]] },
    { Columns: FAVORITE_COLUMNS, Rows: [JSON.stringify([UID, RECIPE_ID, CREATED_AT, NOTE, "PRIVATE_EXTRA"])] },
    { ...valid, Columns: [1, "recipe_id", "created_at", "note"] },
  ];
  for (const result of invalid) {
    const fixture = instrument({ executePGSql: async () => result });
    assertFailure(await fixture.handler(getEvent()), 500, "FAVORITE_READ_FAILED");
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 GET：数据库不能返回他人 UID、非法 recipe_id、无效时间或备注", async () => {
  const invalidRows = [
    favoriteDto({ user_id: "user_SYN_OTHER" }), favoriteDto({ user_id: 1 }),
    favoriteDto({ recipe_id: "r' OR '1'='1" }), favoriteDto({ recipe_id: null }),
    favoriteDto({ recipe_id: RECIPE_ID + "\n" }), favoriteDto({ recipe_id: "r".repeat(65) }),
    ...[null, 1, "bad", "2026-02-30T08:09:10.123Z", "2026-10-10T08:09:10Z", CREATED_AT + "\n"]
      .map((created_at) => favoriteDto({ created_at })),
    ...[null, [], 1, "a\0b", "a\nb", "\u007f", "\u0085", "\ud800", "\udfff", "字".repeat(201)]
      .map((note) => favoriteDto({ note })),
  ];
  for (const row of invalidRows) {
    const fixture = instrument({ executePGSql: async () => favoriteRows([row]) });
    const response = await fixture.handler(getEvent());
    assertFailure(response, 500, "FAVORITE_READ_FAILED");
    assert.ok(!response.body.includes("user_SYN_OTHER"));
  }
});

test("收藏 GET：单条筛选不能返回另一菜品或两条，列表重复主键也拒绝", async () => {
  for (const rows of [[favoriteDto({ recipe_id: "recipe_SYN_OTHER" })], [favoriteDto(), favoriteDto()]]) {
    const fixture = instrument({ executePGSql: async () => favoriteRows(rows) });
    assertFailure(await fixture.handler(getEvent({ recipe_id: RECIPE_ID })), 500, "FAVORITE_READ_FAILED");
  }
  const fixture = instrument({ executePGSql: async () => favoriteRows([favoriteDto(), favoriteDto({ note: "different" })]) });
  assertFailure(await fixture.handler(getEvent()), 500, "FAVORITE_READ_FAILED");
});

test("收藏 GET：数据库失败无自动重试，不泄露 SQL/token/UID/私有异常", async () => {
  let sql;
  const fixture = instrument({ executePGSql: async (options) => {
    sql = options.Sql;
    throw new Error("PRIVATE_READ_EXCEPTION " + TOKEN + " " + UID + " " + sql);
  } });
  const response = await fixture.handler(getEvent());
  assertFailure(response, 500, "FAVORITE_READ_FAILED");
  assert.equal(fixture.sqlCalls.length, 1);
  assert.equal(fixture.authCalls.length, 1);
  for (const secret of ["PRIVATE_READ_EXCEPTION", TOKEN, UID, sql]) assert.ok(!response.body.includes(secret));
});

test("收藏 PATCH：只修改验证 UID 的指定收藏备注，响应不改变创建时间", async () => {
  const context = { environment: runtimeFields("VM_PATCH_CONTEXT_PRIVATE") };
  const fixture = instrument({ executePGSql: async (options, trace, receivedContext) => {
    assertPatchQuery(options);
    assert.equal(typeof trace, "function");
    assert.equal(receivedContext, context);
    return favoriteRows();
  } });
  const response = await fixture.handler(patchEvent(), context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload(response), { ok: true, data: favoriteDto() });
  assert.deepEqual(fixture.authCalls, [TOKEN]);
  assert.equal(fixture.sqlCalls.length, 1);
});

test("收藏 PATCH：单条修改 CTE 只更新本人目标，由外层 SELECT 返回本次更新的四列", async () => {
  // 只核对生成的 SQL 和处理合成结果，不模拟或宣称 CloudBase 对 CTE 的真实支持。
  for (const note of [NOTE, "", "O'Reilly\\备注🍅"]) {
    const fixture = instrument({ executePGSql: async (options) => {
      const hex = Buffer.from(note, "utf8").toString("hex");
      assertPatchQuery(options, UID, RECIPE_ID, note);
      assert.equal(options.Sql.replace(/\s+/g, " ").trim(), [
        "WITH updated AS (",
        "UPDATE public.favorites",
        "SET note = convert_from(decode('" + hex + "', 'hex'), 'UTF8')",
        "WHERE user_id = '" + UID + "' AND recipe_id = '" + RECIPE_ID + "'",
        "RETURNING user_id, recipe_id, created_at, note",
        ") SELECT user_id, recipe_id,",
        "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at, note",
        "FROM updated;",
      ].join(" "));
      return favoriteRows([favoriteDto({ note })]);
    } });
    const response = await fixture.handler(patchEvent(note));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: favoriteDto({ note }) });
    assert.equal(fixture.sqlCalls.length, 1, "不能拆成 UPDATE 和另一次读取，也不能失败后补查或重写");
    assert.equal(fixture.authCalls.length, 1);
  }
});

test("收藏 PATCH：note 必传，空字符串清空备注，普通空格保留原样", async () => {
  await assertInputRejected(event({ recipe_id: RECIPE_ID }, { httpMethod: "PATCH" }), 400, "NOTE_REQUIRED");
  for (const note of ["", " ", "  中文备注  "]) {
    const fixture = instrument({ executePGSql: async (options) => {
      assertPatchQuery(options, UID, RECIPE_ID, note);
      return favoriteRows([favoriteDto({ note })]);
    } });
    const response = await fixture.handler(patchEvent(note));
    assert.equal(response.statusCode, 200);
    assert.equal(payload(response).data.note, note);
  }
});

test("收藏 PATCH：备注上限按 Unicode 码点，200 个汉字/emoji 可通过", async () => {
  for (const note of ["a".repeat(200), "字".repeat(200), "🍅".repeat(200), "a".repeat(199) + "🍅", "备注\u2028可保留"]) {
    const fixture = instrument({ executePGSql: async (options) => {
      assertPatchQuery(options, UID, RECIPE_ID, note);
      return favoriteRows([favoriteDto({ note })]);
    } });
    const response = await fixture.handler(patchEvent(note));
    assert.equal(response.statusCode, 200);
    assert.equal(payload(response).data.note, note);
  }
});

test("收藏 PATCH：201 码点/非字符串/全部 C0/C1 控制/孤立 surrogate 在认证前拒绝", async () => {
  const notes = [null, 1, false, [], {}, "a".repeat(201), "字".repeat(201), "🍅".repeat(201),
    "\ud800", "\udfff", "x\ud800y", "\ud800\ud800", "\udfff\ud800"];
  for (let value = 0; value <= 31; value++) notes.push("a" + String.fromCharCode(value) + "b");
  for (let value = 127; value <= 159; value++) notes.push("a" + String.fromCharCode(value) + "b");
  for (const note of notes) await assertInputRejected(patchEvent(note), 400, "NOTE_INVALID");
});

test("收藏 PATCH：只允许 recipe_id/note，不能改用户归属、创建时间或批量记录", async () => {
  for (const extra of [{ user_id: "user_SYN_OTHER" }, { uid: UID }, { created_at: CREATED_AT },
    { recipe_ids: [RECIPE_ID] }, { Role: "anon" }, { Sql: "DELETE FROM public.favorites" }, { is_deleted: true }]) {
    await assertInputRejected(event({ recipe_id: RECIPE_ID, note: NOTE, ...extra }, { httpMethod: "PATCH" }), 400, "PATCH_FIELDS_INVALID");
  }
  for (const body of [[], [{ recipe_id: RECIPE_ID, note: NOTE }], null, 1]) {
    await assertInputRejected(event(body, { httpMethod: "PATCH" }), 400, "INVALID_BODY");
  }
});

test("收藏 PATCH：recipe_id 必填且严格校验，不能利用编号改多条", async () => {
  for (const recipe_id of [null, undefined, "", " "]) {
    await assertInputRejected(event({ recipe_id, note: NOTE }, { httpMethod: "PATCH" }), 400, "RECIPE_ID_REQUIRED");
  }
  for (const recipe_id of [1, false, {}, [], "菜", "r' OR '1'='1", RECIPE_ID + "\n", "r".repeat(65)]) {
    await assertInputRejected(event({ recipe_id, note: NOTE }, { httpMethod: "PATCH" }), 400, "RECIPE_ID_INVALID");
  }
});

test("收藏 PATCH：JSON/对象/base64 body 合法，坏编码和类型拒绝", async () => {
  const fixture = instrument({ executePGSql: async () => favoriteRows() });
  const body = { recipe_id: RECIPE_ID, note: NOTE };
  const requests = [patchEvent(), patchEvent(NOTE, { body }),
    patchEvent(NOTE, { body: Buffer.from(JSON.stringify(body), "utf8").toString("base64"), isBase64Encoded: true })];
  for (const request of requests) assert.equal((await fixture.handler(request)).statusCode, 200);
  assert.equal(fixture.sqlCalls.length, 3);
  for (const body of ["%%%%", "YR=="]) {
    await assertInputRejected(patchEvent(NOTE, { body, isBase64Encoded: true }), 400, "INVALID_JSON");
  }
  await assertInputRejected(patchEvent(NOTE, { isBase64Encoded: "true" }), 400, "INVALID_BODY");
  await assertInputRejected(patchEvent(NOTE, { body: "{" }), 400, "INVALID_JSON");
  await assertInputRejected(patchEvent(NOTE, { headers: { "Content-Type": "text/plain", Authorization: "Bearer " + TOKEN } }), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("收藏 PATCH：1024 字节边界保持，超长请求不进入认证", async () => {
  const body = JSON.stringify({ recipe_id: RECIPE_ID, note: NOTE });
  const atLimit = body + " ".repeat(1024 - Buffer.byteLength(body, "utf8"));
  assert.equal(Buffer.byteLength(atLimit, "utf8"), 1024);
  const fixture = instrument({ executePGSql: async () => favoriteRows() });
  assert.equal((await fixture.handler(patchEvent(NOTE, { body: atLimit }))).statusCode, 200);
  await assertInputRejected(patchEvent(NOTE, { body: atLimit + " " }), 413, "BODY_TOO_LARGE");
});

test("收藏 PATCH：备注的引号/反斜杠/SQL 字样仅以 UTF-8 hex 进入单条 UPDATE", async () => {
  for (const note of ["O'Reilly\\备注", "'; DELETE FROM public.favorites; --", "修改 note = 'x' WHERE 1=1;", "🍅🥚"] ) {
    const fixture = instrument({ executePGSql: async (options) => {
      assertPatchQuery(options, UID, RECIPE_ID, note);
      assert.ok(!options.Sql.includes(note));
      return favoriteRows([favoriteDto({ note })]);
    } });
    const response = await fixture.handler(patchEvent(note));
    assert.equal(response.statusCode, 200);
    assert.equal(payload(response).data.note, note);
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 PATCH：未找到当前用户的目标返回 404，绝不新增或改其它行", async () => {
  const fixture = instrument({ executePGSql: async (options) => {
    assertPatchQuery(options);
    return favoriteRows([]);
  } });
  const response = await fixture.handler(patchEvent());
  const value = assertFailure(response, 404, "FAVORITE_NOT_FOUND");
  assert.equal(value.error.message, "未找到你的这条收藏。");
  assert.equal(fixture.sqlCalls.length, 1);
});

test("收藏 PATCH：只有他人同编号收藏时返回 404，不能修改或冒用他人行", async () => {
  const other = favoriteDto({ user_id: "user_SYN_OTHER", note: "他人原备注" });
  const before = { ...other };
  const fixture = instrument({ executePGSql: async (options) => {
    assertPatchQuery(options);
    const uid = /WHERE user_id = '([A-Za-z0-9_-]+)'/.exec(options.Sql)?.[1];
    const recipeId = /AND recipe_id = '([A-Za-z0-9_-]+)'/.exec(options.Sql)?.[1];
    const matched = [other].filter((row) => row.user_id === uid && row.recipe_id === recipeId);
    for (const row of matched) row.note = NOTE;
    return favoriteRows(matched);
  } });
  assertFailure(await fixture.handler(patchEvent()), 404, "FAVORITE_NOT_FOUND");
  assert.deepEqual(other, before);
  assert.equal(fixture.sqlCalls.length, 1);
  assert.equal(fixture.authCalls.length, 1);
});

test("收藏 PATCH：数据库返回最多一行且必须匹配本次 UID/recipe_id/note", async () => {
  const invalidRows = [
    [favoriteDto(), favoriteDto()], [favoriteDto({ user_id: "user_SYN_OTHER" })],
    [favoriteDto({ recipe_id: "recipe_SYN_OTHER" })], [favoriteDto({ note: "old note" })],
    [favoriteDto({ created_at: "2026-02-30T08:09:10.123Z" })], [favoriteDto({ note: null })],
  ];
  for (const rows of invalidRows) {
    const fixture = instrument({ executePGSql: async () => favoriteRows(rows) });
    assertFailure(await fixture.handler(patchEvent()), 500, "FAVORITE_WRITE_FAILED");
    assert.equal(fixture.sqlCalls.length, 1);
  }
  for (const result of [{}, { Columns: FAVORITE_COLUMNS, Rows: ["bad JSON"] },
    { Columns: ["user_id", "recipe_id", "created_at", "created_at"], Rows: [] },
    favoriteRows([favoriteDto()], [...FAVORITE_COLUMNS, "outcome"])]) {
    const fixture = instrument({ executePGSql: async () => result });
    assertFailure(await fixture.handler(patchEvent()), 500, "FAVORITE_WRITE_FAILED");
  }
});

test("收藏 PATCH：列顺序变化照常解码，数据库异常不暴露备注且不自动重试", async () => {
  const fixture = instrument({ executePGSql: async () => favoriteRows([favoriteDto()], [...FAVORITE_COLUMNS].reverse()) });
  assert.deepEqual(payload(await fixture.handler(patchEvent())), { ok: true, data: favoriteDto() });
  let sql;
  const failing = instrument({ executePGSql: async (options) => {
    sql = options.Sql;
    throw new Error("PRIVATE_PATCH_EXCEPTION " + TOKEN + " " + UID + " " + NOTE + " " + sql);
  } });
  const response = await failing.handler(patchEvent());
  assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
  for (const secret of ["PRIVATE_PATCH_EXCEPTION", TOKEN, UID, NOTE, sql]) assert.ok(!response.body.includes(secret));
  assert.equal(failing.sqlCalls.length, 1);
  assert.equal(failing.authCalls.length, 1);
});

test("收藏 GET/PATCH：匿名、冲突头、坏 token 和伪造验证 UID 均不能进入数据库", async () => {
  for (const request of [getEvent(), patchEvent()]) {
    const anonymous = instrument();
    assertFailure(await anonymous.handler({ ...request, headers: {} }), 401, "AUTH_REQUIRED");
    assert.equal(anonymous.authCalls.length, 0);
    assert.equal(anonymous.sqlCalls.length, 0);
    for (const headers of [{ Authorization: "Basic " + TOKEN }, { Authorization: "Bearer " + TOKEN + "\n" },
      { Authorization: ["Bearer " + TOKEN] }, { Authorization: "Bearer " + TOKEN, authorization: "Bearer TOKEN_SYN_B" }]) {
      const fixture = instrument();
      assertFailure(await fixture.handler({ ...request, headers }), 401, "AUTH_INVALID");
      assert.equal(fixture.authCalls.length, 0);
      assert.equal(fixture.sqlCalls.length, 0);
    }
    for (const uid of [undefined, null, 1, "", "用户", "u' OR '1'='1", UID + "\n", "u".repeat(129)]) {
      const fixture = instrument({ verifyToken: async () => uid });
      assertFailure(await fixture.handler(request), 401, "AUTH_INVALID");
      assert.equal(fixture.authCalls.length, 1);
      assert.equal(fixture.sqlCalls.length, 0);
    }
    const unavailable = instrument({ verifyToken: async () => { throw new Error("PRIVATE_AUTH " + TOKEN); } });
    const response = await unavailable.handler(request);
    assertFailure(response, 503, "AUTH_UNAVAILABLE");
    assert.equal(unavailable.sqlCalls.length, 0);
    assert.ok(!response.body.includes(TOKEN));
  }
});

test("收藏 GET/PATCH：每个请求重新验证身份且重新查询，不复用上次成功数据", async () => {
  const fixtures = [
    { makeRequest: () => getEvent(), makeResult: (uid) => favoriteRows([favoriteDto({ user_id: uid })]) },
    { makeRequest: () => patchEvent(), makeResult: (uid) => favoriteRows([favoriteDto({ user_id: uid })]) },
  ];
  for (const { makeRequest, makeResult } of fixtures) {
    let authIndex = 0, sqlIndex = 0;
    const uids = [UID, "user_SYN_B"];
    const fixture = instrument({ verifyToken: async () => uids[authIndex++],
      executePGSql: async (options) => {
        assert.ok(options.Sql.includes("WHERE user_id = '" + uids[sqlIndex] + "'"));
        return makeResult(uids[sqlIndex++]);
      } });
    for (const uid of uids) {
      const response = await fixture.handler(makeRequest());
      assert.equal(response.statusCode, 200);
      const data = payload(response).data;
      assert.equal((Array.isArray(data) ? data[0] : data).user_id, uid);
    }
    assert.equal(fixture.authCalls.length, 2);
    assert.equal(fixture.sqlCalls.length, 2);
  }
});

test("收藏数据层 GET/PATCH：透传本次 trace/context，四字段结果和零行语义固定", async () => {
  const database = mainFixture().database;
  const trace = () => {};
  const context = { environment: runtimeFields("VM_DAL_DAY22_PRIVATE") };
  let calls = 0;
  const read = await database.readFavorites(UID, RECIPE_ID, async (options, receivedTrace, receivedContext) => {
    calls++;
    assertReadQuery(options, UID, RECIPE_ID);
    assert.equal(receivedTrace, trace);
    assert.equal(receivedContext, context);
    return favoriteRows();
  }, trace, context);
  assert.deepEqual(JSON.parse(JSON.stringify(read)), [favoriteDto()]);
  const patched = await database.updateFavoriteNote(UID, RECIPE_ID, NOTE, async (options, receivedTrace, receivedContext) => {
    calls++;
    assertPatchQuery(options);
    assert.equal(receivedTrace, trace);
    assert.equal(receivedContext, context);
    return favoriteRows();
  }, trace, context);
  assert.deepEqual(JSON.parse(JSON.stringify(patched)), favoriteDto());
  assert.deepEqual(JSON.parse(JSON.stringify(await database.readFavorites(UID, undefined, async () => favoriteRows([]), trace, context))), []);
  assert.equal(await database.updateFavoriteNote(UID, RECIPE_ID, NOTE, async () => favoriteRows([]), trace, context), null);
  assert.equal(calls, 2);
});

test("收藏数据层 GET/PATCH：独立再次验证 UID/recipe/note，非法输入零 SQL 调用", async () => {
  const database = mainFixture().database;
  let calls = 0;
  const execute = async () => { calls++; throw new Error("invalid input must not call SQL"); };
  for (const uid of [null, 1, "", "用户", "u' OR '1'='1", UID + "\n", "u".repeat(129)]) {
    await assert.rejects(() => database.readFavorites(uid, undefined, execute));
    await assert.rejects(() => database.updateFavoriteNote(uid, RECIPE_ID, NOTE, execute));
  }
  for (const recipeId of [null, 1, [], "", "菜", "r' OR '1'='1", RECIPE_ID + "\n", "r".repeat(65)]) {
    await assert.rejects(() => database.readFavorites(UID, recipeId, execute));
    await assert.rejects(() => database.updateFavoriteNote(UID, recipeId, NOTE, execute));
  }
  for (const note of [null, 1, "\ud800", "\udfff", "a\nb", "\u007f", "\u0085", "🍅".repeat(201)]) {
    await assert.rejects(() => database.updateFavoriteNote(UID, RECIPE_ID, note, execute));
  }
  assert.equal(calls, 0);
});

test("收藏 main GET/PATCH：官方 introspect 每次执行，SDK 本次身份和环境固定", async () => {
  const uids = [UID, "user_SYN_B", "user_SYN_C", "user_SYN_D"];
  const fixture = mainFixture({ fetch: async (_url, _options, index) => authResponse(validIdentity(uids[index])) });
  const requests = [getEvent(), getEvent({ recipe_id: RECIPE_ID }), patchEvent(), patchEvent("")];
  for (const [index, request] of requests.entries()) {
    const contextFields = runtimeFields("VM_DAY22_CONTEXT_" + index + "_PRIVATE");
    const response = await fixture.exported.main(request, { environment: contextFields });
    assert.equal(response.statusCode, 200);
    const result = payload(response).data;
    assert.equal((Array.isArray(result) ? result[0] : result).user_id, uids[index]);
    const { url, options } = fixture.authCalls[index];
    assert.equal(url, AUTH_URL);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.signal, fixture.timeouts[index]);
    assert.equal(fixture.timeouts[index].vmTimeoutMs, 1000);
    assert.deepEqual(fixture.clients[index].credential, sdkCredential(contextFields));
  }
  assert.equal(fixture.authCalls.length, 4);
  assert.equal(fixture.requests.length, 4);
  assert.equal(new Set(fixture.clients).size, 4);
  assert.equal(fixture.moduleLoads, 1);
});

test("收藏 main GET/PATCH：官方认证拒绝/错误环境/错误 sub 不建客户端、不调用库", async () => {
  const identities = [null, [], {}, { ...validIdentity(), client_id: "other-env" },
    { ...validIdentity(), token_type: "Basic" }, { ...validIdentity(), sub: 1 },
    { ...validIdentity(), sub: "u' OR '1'='1" }, { ...validIdentity(), sub: UID + "\n" }];
  for (const request of [getEvent(), patchEvent()]) {
    for (const identity of identities) {
      const fixture = mainFixture({ fetch: async () => authResponse(identity) });
      assertFailure(await fixture.exported.main(request), 401, "AUTH_INVALID");
      assert.equal(fixture.moduleLoads, 1);
      assert.equal(fixture.clients.length, 0);
      assert.equal(fixture.requests.length, 0);
      assert.equal(fixture.authCalls.length, 1);
    }
    for (const status of [400, 401, 403, 404]) {
      const fixture = mainFixture({ fetch: async () => authResponse({ PRIVATE_AUTH: TOKEN }, status) });
      const response = await fixture.exported.main(request);
      assertFailure(response, 401, "AUTH_INVALID");
      assert.equal(fixture.moduleLoads, 1);
      assert.equal(fixture.clients.length, 0);
      assert.equal(fixture.requests.length, 0);
      assert.equal(fixture.authCalls.length, 1);
      assert.ok(!response.body.includes(TOKEN));
    }
  }
});

test("收藏 main GET/PATCH：认证异常 503、运行身份缺失 500，各层不自动重试", async () => {
  for (const request of [getEvent(), patchEvent()]) {
    for (const fetchImpl of [async () => { throw new Error("PRIVATE_AUTH_NETWORK " + TOKEN); },
      async () => authResponse({}, 500), async () => ({ ok: true, status: 200, async json() { throw new Error("PRIVATE_AUTH_JSON"); } })]) {
      const fixture = mainFixture({ fetch: fetchImpl });
      assertFailure(await fixture.exported.main(request), 503, "AUTH_UNAVAILABLE");
      assert.equal(fixture.moduleLoads, 1);
      assert.equal(fixture.clients.length, 0);
      assert.equal(fixture.authCalls.length, 1);
      assert.equal(fixture.requests.length, 0);
    }
    const missing = mainFixture({ env: {} });
    assertFailure(await missing.exported.main(request), 500,
      request.httpMethod === "GET" ? "FAVORITE_READ_FAILED" : "FAVORITE_WRITE_FAILED");
    assert.equal(missing.moduleLoads, 1);
    assert.equal(missing.clients.length, 0);
    assert.equal(missing.authCalls.length, 1);
    assert.equal(missing.requests.length, 0);
  }
});

test("收藏 main GET/PATCH：SQL 错误只输出安全阶段码，不泄露本次备注或身份", async () => {
  for (const request of [getEvent(), patchEvent()]) {
    const fields = runtimeFields("VM_DAY22_DIAG_PRIVATE");
    let sql;
    const fixture = mainFixture({ env: fields, request: async (params) => {
      sql = params.Sql;
      throw Object.assign(new Error("PRIVATE_DAY22_ERROR " + TOKEN + " " + UID + " " + NOTE + " " + sql), {
        code: "AuthFailure.PRIVATE_LOG_CODE\nforged_log",
      });
    } });
    const response = await fixture.exported.main(request);
    assertFailure(response, 500, request.httpMethod === "GET" ? "FAVORITE_READ_FAILED" : "FAVORITE_WRITE_FAILED");
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.logs.filter((line) => line.includes(" api_error ")).length, 1);
    assert.ok(fixture.logs.some((line) => line.endsWith(" code=AuthFailure")));
    const observable = [response.body, ...fixture.logs].join("\n");
    for (const secret of ["PRIVATE_DAY22_ERROR", "PRIVATE_LOG_CODE", TOKEN, UID, NOTE, sql, ...Object.values(fields)]) {
      assert.ok(!observable.includes(secret));
    }
    assert.deepEqual(fixture.logs.map((line) => line.split(" ")[1]), request.httpMethod === "PATCH"
      ? ["entry", "auth_start", "auth_ready", "sdk_ready", "api_call_start", "api_error", "patch_processing_failed"]
      : ["entry", "auth_start", "auth_ready", "sdk_ready", "api_call_start", "api_error"]);
    for (const line of fixture.logs) {
      assert.match(line, /^\[favorites-diag-v1\] (?:entry|auth_start|auth_ready|auth_error|sdk_ready|api_call_start|api_return|api_error|patch_processing_failed) elapsed_ms=\d+(?: code=[A-Za-z0-9_.]+)?$/);
    }
  }
});

const PATCH_RETURN_STAGES = ["entry", "auth_start", "auth_ready", "sdk_ready", "api_call_start", "api_return"];

function assertPatchStages(fixture, stages, shape) {
  assert.deepEqual(fixture.logs.map((line) => line.split(" ")[1]), [...PATCH_RETURN_STAGES, ...stages]);
  for (const line of fixture.logs) {
    if (line.includes(" patch_result_shape ")) {
      assert.match(line, /^\[favorites-diag-v1\] patch_result_shape elapsed_ms=\d+ result_type=(?:null|array|undefined|object|string|number|boolean|other) columns_type=(?:null|array|undefined|object|string|number|boolean|other) columns_count=(?:none|100_plus|100|[1-9]?[0-9]) rows_type=(?:null|array|undefined|object|string|number|boolean|other) rows_count=(?:none|100_plus|100|[1-9]?[0-9])$/);
      if (shape !== undefined) assert.ok(line.endsWith(" " + shape), line);
    } else assert.match(line, /^\[favorites-diag-v1\] [a-z_]+ elapsed_ms=\d+$/);
  }
  assert.equal(fixture.requests.length, 1, "诊断成功或失败都不能重发 SQL");
  assert.equal(fixture.authCalls.length, 1);
}

test("收藏 main PATCH 诊断：成功保留四字段响应和单次 SQL，只记录受控结构与阶段", async () => {
  for (const columns of [FAVORITE_COLUMNS, [...FAVORITE_COLUMNS].reverse()]) {
    let sql;
    const fields = runtimeFields("VM_PATCH_SAFE_DIAG_PRIVATE");
    const fixture = mainFixture({ env: fields, request: async (params) => {
      sql = params.Sql;
      return { ...favoriteRows([favoriteDto()], columns), PRIVATE_EXTRA: TOKEN + UID + NOTE };
    } });
    const response = await fixture.exported.main(patchEvent());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: favoriteDto() });
    assertPatchStages(fixture, ["patch_result_shape", "patch_decode_ready", "patch_note_verified", "patch_response_ready"],
      "result_type=object columns_type=array columns_count=4 rows_type=array rows_count=1");
    assertPatchQuery({ Sql: fixture.requests[0].params.Sql, Role: fixture.requests[0].params.Role });
    const visibleLogs = fixture.logs.join("\n");
    for (const secret of [TOKEN, UID, NOTE, RECIPE_ID, CREATED_AT, sql, "user_id", "created_at", "PRIVATE_EXTRA", ...Object.values(fields)]) {
      assert.ok(!visibleLogs.includes(secret), "诊断不可输出字段名或任何原始值");
    }
  }
});

test("收藏 main PATCH 诊断：空行仍为 404，已解码但不伪报备注或响应成功", async () => {
  const fixture = mainFixture({ request: async () => favoriteRows([]) });
  assertFailure(await fixture.exported.main(patchEvent()), 404, "FAVORITE_NOT_FOUND");
  assertPatchStages(fixture, ["patch_result_shape", "patch_decode_ready", "patch_target_missing"],
    "result_type=object columns_type=array columns_count=4 rows_type=array rows_count=0");
});

test("收藏 main PATCH：Columns/Rows 均 null 时保持 500，不依据影响行数伪报成功或 404", async () => {
  for (const metadata of [{}, { AffectedRows: 0 }, { AffectedRows: 1 }]) {
    const fixture = mainFixture({ request: async () => ({ Columns: null, Rows: null, ...metadata }) });
    const response = await fixture.exported.main(patchEvent());
    assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
    assertPatchStages(fixture, ["patch_result_shape", "patch_decode_shape_failed", "patch_processing_failed"],
      "result_type=object columns_type=null columns_count=none rows_type=null rows_count=none");
    assertPatchQuery({ Sql: fixture.requests[0].params.Sql, Role: fixture.requests[0].params.Role });
    for (const secret of [TOKEN, UID, NOTE, RECIPE_ID, CREATED_AT, fixture.requests[0].params.Sql]) {
      assert.ok(![response.body, ...fixture.logs].join("\n").includes(secret));
    }
  }
});

test("收藏 main PATCH 诊断：各类解码失败仍为原 500，明确失败阶段且不泄露原值", async () => {
  const row = favoriteRows().Rows[0];
  const cases = [
    [{ Columns: null, Rows: [row] }, "patch_decode_shape_failed", "columns_type=null columns_count=none rows_type=array rows_count=1"],
    [{ Columns: FAVORITE_COLUMNS, Rows: null }, "patch_decode_shape_failed", "columns_type=array columns_count=4 rows_type=null rows_count=none"],
    [{ Columns: ["PRIVATE_COLUMN", ...FAVORITE_COLUMNS.slice(1)], Rows: [row] }, "patch_decode_shape_failed"],
    [{ Columns: FAVORITE_COLUMNS, Rows: [row, row] }, "patch_decode_shape_failed"],
    [{ Columns: FAVORITE_COLUMNS, Rows: [{ PRIVATE_ROW: TOKEN }] }, "patch_decode_row_type_failed"],
    [{ Columns: FAVORITE_COLUMNS, Rows: ["PRIVATE_JSON " + TOKEN] }, "patch_decode_json_failed"],
    [{ Columns: FAVORITE_COLUMNS, Rows: [JSON.stringify({ PRIVATE_CELLS: UID })] }, "patch_decode_cells_failed"],
    [{ Columns: FAVORITE_COLUMNS, Rows: [JSON.stringify([UID, RECIPE_ID, CREATED_AT])] }, "patch_decode_cells_failed"],
    [favoriteRows([favoriteDto({ user_id: "PRIVATE_OTHER_UID" })]), "patch_decode_identity_failed"],
    [favoriteRows([favoriteDto({ user_id: 123 })]), "patch_decode_identity_failed"],
    [favoriteRows([favoriteDto({ recipe_id: "PRIVATE_OTHER_RECIPE" })]), "patch_decode_identity_failed"],
    [favoriteRows([favoriteDto({ note: { PRIVATE_NOTE: NOTE } })]), "patch_decode_note_failed"],
    [favoriteRows([favoriteDto({ note: "PRIVATE_CONTROL\n" + NOTE })]), "patch_decode_note_failed"],
    [favoriteRows([favoriteDto({ created_at: "PRIVATE_BAD_TIME" })]), "patch_decode_time_failed"],
    [favoriteRows([favoriteDto({ created_at: "2026-02-30T08:09:10.123Z" })]), "patch_decode_time_failed"],
  ];
  for (const [result, failedStage, shapeTail] of cases) {
    const fixture = mainFixture({ request: async () => result });
    const response = await fixture.exported.main(patchEvent());
    assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
    assertPatchStages(fixture, ["patch_result_shape", failedStage, "patch_processing_failed"],
      shapeTail && "result_type=object " + shapeTail);
    const observable = [response.body, ...fixture.logs].join("\n");
    for (const secret of [TOKEN, UID, RECIPE_ID, CREATED_AT, NOTE, "PRIVATE_"]) assert.ok(!observable.includes(secret));
    assert.ok(!observable.includes("TypeError") && !observable.includes("SyntaxError"), "异常类和原文不能进入日志或响应");
  }
});

test("收藏 main PATCH 诊断：合法但不等于本次备注的结果仍 500，不能误记 verified", async () => {
  const fixture = mainFixture({ request: async () => favoriteRows([favoriteDto({ note: "PRIVATE_DIFFERENT_NOTE" })]) });
  const response = await fixture.exported.main(patchEvent());
  assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
  assertPatchStages(fixture, ["patch_result_shape", "patch_decode_ready", "patch_note_mismatch", "patch_processing_failed"],
    "result_type=object columns_type=array columns_count=4 rows_type=array rows_count=1");
  assert.doesNotMatch([response.body, ...fixture.logs].join("\n"), /PRIVATE_DIFFERENT_NOTE|Invalid updated favorite/);
});

test("收藏 main PATCH 诊断：结构仅输出枚举类型，数组数量超过 100 时截断", async () => {
  const values = [
    [null, "null"], [[], "array"], [undefined, "undefined"], [{ PRIVATE_SHAPE: TOKEN }, "object"],
    ["PRIVATE_STRING", "string"], [987654321, "number"], [true, "boolean"],
    [() => "PRIVATE_FUNCTION", "other"], [Symbol("PRIVATE_SYMBOL"), "other"], [12345678901234567890n, "other"],
  ];
  for (const [value, type] of values) {
    const fixture = mainFixture({ request: async () => value });
    assertFailure(await fixture.exported.main(patchEvent()), 500, "FAVORITE_WRITE_FAILED");
    assertPatchStages(fixture, ["patch_result_shape", "patch_decode_shape_failed", "patch_processing_failed"],
      "result_type=" + type + " columns_type=undefined columns_count=none rows_type=undefined rows_count=none");
  }
  for (const field of ["Columns", "Rows"]) {
    for (const [value, type] of values) {
      const result = { ...favoriteRows(), [field]: value };
      const fixture = mainFixture({ request: async () => result });
      const response = await fixture.exported.main(patchEvent());
      if (field === "Rows" && Array.isArray(value)) assertFailure(response, 404, "FAVORITE_NOT_FOUND");
      else assertFailure(response, 500, "FAVORITE_WRITE_FAILED");
      const shape = field === "Columns"
        ? "result_type=object columns_type=" + type + " columns_count=" + (type === "array" ? "0" : "none") + " rows_type=array rows_count=1"
        : "result_type=object columns_type=array columns_count=4 rows_type=" + type + " rows_count=" + (type === "array" ? "0" : "none");
      assertPatchStages(fixture, field === "Rows" && Array.isArray(value)
        ? ["patch_result_shape", "patch_decode_ready", "patch_target_missing"]
        : ["patch_result_shape", "patch_decode_shape_failed", "patch_processing_failed"], shape);
      assert.doesNotMatch(fixture.logs.join("\n"), /PRIVATE_|987654321|12345678901234567890/);
    }
  }
  for (const count of [0, 1, 99, 100, 101, 1000]) {
    for (const field of ["Columns", "Rows"]) {
      const fixture = mainFixture({ request: async () => ({ ...favoriteRows(), [field]: Array(count).fill("PRIVATE_ARRAY_VALUE") }) });
      const response = await fixture.exported.main(patchEvent());
      const zeroRows = field === "Rows" && count === 0;
      assertFailure(response, zeroRows ? 404 : 500, zeroRows ? "FAVORITE_NOT_FOUND" : "FAVORITE_WRITE_FAILED");
      const bounded = count > 100 ? "100_plus" : String(count);
      const shape = field === "Columns"
        ? "result_type=object columns_type=array columns_count=" + bounded + " rows_type=array rows_count=1"
        : "result_type=object columns_type=array columns_count=4 rows_type=array rows_count=" + bounded;
      const failedStage = field === "Rows" && count === 1 ? "patch_decode_json_failed" : "patch_decode_shape_failed";
      assertPatchStages(fixture, zeroRows ? ["patch_result_shape", "patch_decode_ready", "patch_target_missing"]
        : ["patch_result_shape", failedStage, "patch_processing_failed"], shape);
      assert.doesNotMatch(fixture.logs.join("\n"), /PRIVATE_ARRAY_VALUE/);
    }
  }
});

test("收藏 main PATCH 诊断：shape 日志拒绝伪造详情、超界计数和任何终换行", async () => {
  const valid = "result_type=object columns_type=array columns_count=4 rows_type=array rows_count=1";
  const badDetails = [undefined, null, {}, [valid], 1, valid + " PRIVATE_SUFFIX", "PRIVATE_PREFIX " + valid,
    ...["\n", "\r", "\r\n", "\u2028", "\u2029"].flatMap((newline) => [valid + newline, valid + newline + TOKEN]),
    valid.replace("columns_count=4", "columns_count=101"), valid.replace("rows_count=1", "rows_count=-1"),
    valid.replace("rows_count=1", "rows_count=01"), valid.replace("result_type=object", "result_type=PRIVATE_TYPE")];
  for (const detail of [valid, ...badDetails]) {
    const fixture = mainFixture({ updateFavoriteNote: async (_uid, _recipeId, _note, _execute, trace) => {
      trace("patch_result_shape", detail);
      return favoriteDto();
    } });
    assert.equal((await fixture.exported.main(patchEvent())).statusCode, 200);
    const shapeLines = fixture.logs.filter((line) => line.includes(" patch_result_shape "));
    assert.equal(shapeLines.length, 1);
    assert.match(shapeLines[0], detail === valid
      ? /^\[favorites-diag-v1\] patch_result_shape elapsed_ms=\d+ result_type=object columns_type=array columns_count=4 rows_type=array rows_count=1$/
      : /^\[favorites-diag-v1\] patch_result_shape elapsed_ms=\d+ shape=invalid$/);
    assert.doesNotMatch(fixture.logs.join("\n"), /PRIVATE_|TOKEN_SYN_A/);
    assert.equal(fixture.requests.length, 0, "过滤器测试以合成数据层 hook 隔离，不可调用数据库");
    assert.equal(fixture.authCalls.length, 1);
  }
});

test("收藏 main PATCH 诊断：仅新增日志回调抛错仍保留原 200/404/500，不重发 SQL", async () => {
  const cases = [
    [favoriteRows(), 200, null],
    [favoriteRows([]), 404, "FAVORITE_NOT_FOUND"],
    [{ Columns: null, Rows: [] }, 500, "FAVORITE_WRITE_FAILED"],
    [favoriteRows([favoriteDto({ note: "PRIVATE_DIFFERENT" })]), 500, "FAVORITE_WRITE_FAILED"],
  ];
  for (const [result, status, code] of cases) {
    const fixture = mainFixture({ request: async () => result, onLog(line) {
      if (line.includes("] patch_")) throw new Error("PRIVATE_DIAGNOSTIC_THROW " + TOKEN + NOTE);
    } });
    const response = await fixture.exported.main(patchEvent());
    if (code) assertFailure(response, status, code);
    else { assert.equal(response.statusCode, status); assert.deepEqual(payload(response).data, favoriteDto()); }
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.authCalls.length, 1);
    assert.doesNotMatch(fixture.logs.join("\n"), /PRIVATE_DIAGNOSTIC_THROW/);
  }
  const fixture = mainFixture({ request: async () => { throw new Error("PRIVATE_DATABASE_ERROR"); }, onLog(line) {
    if (line.includes("] patch_")) throw new Error("PRIVATE_DIAGNOSTIC_THROW");
  } });
  assertFailure(await fixture.exported.main(patchEvent()), 500, "FAVORITE_WRITE_FAILED");
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.authCalls.length, 1);
  assert.doesNotMatch(fixture.logs.join("\n"), /PRIVATE_DATABASE_ERROR|PRIVATE_DIAGNOSTIC_THROW/);
});

test("收藏 main GET/POST：新增 PATCH 诊断不改变原有成功、坏结果和 SQL 失败日志", async () => {
  for (const request of [getEvent(), event()]) {
    const success = mainFixture();
    const response = await success.exported.main(request);
    assert.equal(response.statusCode, request.httpMethod === "GET" ? 200 : 201);
    assert.deepEqual(success.logs.map((line) => line.split(" ")[1]), PATCH_RETURN_STAGES);
    for (const result of [null, { Columns: null, Rows: null }]) {
      const fixture = mainFixture({ request: async () => result });
      assertFailure(await fixture.exported.main(request), 500,
        request.httpMethod === "GET" ? "FAVORITE_READ_FAILED" : "FAVORITE_WRITE_FAILED");
      assert.deepEqual(fixture.logs.map((line) => line.split(" ")[1]), PATCH_RETURN_STAGES);
      assert.equal(fixture.requests.length, 1);
      assert.ok(!fixture.logs.some((line) => line.includes("] patch_")));
    }
  }
});

test("收藏 GET/PATCH：合法 ASCII 键长度边界与数字形状 UID 保持字符串", async () => {
  for (const [uid, recipeId] of [["u", "r"], ["u".repeat(128), "r".repeat(64)],
    ["U_-09", "R_-09"], ["2100000000000000001", "recipe_SYN_01"]]) {
    for (const method of ["GET", "PATCH"]) {
      const fixture = instrument({ verifyToken: async () => uid, executePGSql: async (options) => {
        if (method === "GET") assertReadQuery(options, uid, recipeId);
        else assertPatchQuery(options, uid, recipeId);
        return favoriteRows([favoriteDto({ user_id: uid, recipe_id: recipeId })]);
      } });
      const request = method === "GET" ? getEvent({ recipe_id: recipeId })
        : event({ recipe_id: recipeId, note: NOTE }, { httpMethod: "PATCH" });
      const response = await fixture.handler(request);
      assert.equal(response.statusCode, 200);
      const data = payload(response).data;
      assert.equal((Array.isArray(data) ? data[0] : data).user_id, uid);
      assert.equal(typeof (Array.isArray(data) ? data[0] : data).user_id, "string");
      assert.equal(fixture.sqlCalls.length, 1);
    }
  }
});

test("收藏 GET/PATCH：新增错误响应契约的中文提示固定且不夹带数据", async () => {
  const cases = [
    [getEvent({ user_id: UID }), "INVALID_QUERY", "查询只允许一个有效的 recipe_id。"],
    [getEvent(undefined, { body: "{}" }), "GET_BODY_NOT_ALLOWED", "GET 请求不能携带收藏内容。"],
    [event({ recipe_id: RECIPE_ID, note: NOTE, user_id: UID }, { httpMethod: "PATCH" }), "PATCH_FIELDS_INVALID", "PATCH 请求只允许 recipe_id 和 note 字段。"],
    [event({ recipe_id: RECIPE_ID }, { httpMethod: "PATCH" }), "NOTE_REQUIRED", "请填写收藏备注 note。"],
    [patchEvent("\n"), "NOTE_INVALID", "备注须为不含控制字符的文本，最多 200 个字符。"],
  ];
  for (const [request, code, message] of cases) {
    const fixture = instrument();
    const value = assertFailure(await fixture.handler(request), 400, code);
    assert.equal(value.error.message, message);
    assert.equal(fixture.authCalls.length, 0);
    assert.equal(fixture.sqlCalls.length, 0);
  }
  const readFailure = instrument({ executePGSql: async () => { throw new Error("PRIVATE_ERROR"); } });
  assert.equal(assertFailure(await readFailure.handler(getEvent()), 500, "FAVORITE_READ_FAILED").error.message,
    "暂时无法读取收藏，请稍后重试。");
});

test("收藏本地 CRUD 闭环：POST→GET→PATCH→GET→DELETE→GET，只删本人目标且重复删除 404", async () => {
  const other = favoriteDto({ user_id: "user_SYN_OTHER", note: "他人原备注" });
  const ownOther = favoriteDto({ recipe_id: "recipe_SYN_OTHER", note: "本人其他收藏" });
  const rows = new Map([other, ownOther].map((row) => [JSON.stringify([row.user_id, row.recipe_id]), { ...row }]));
  const recipes = new Set([RECIPE_ID, ownOther.recipe_id]);
  const recipesBefore = [...recipes];
  const otherBefore = JSON.stringify(other);
  const ownOtherBefore = JSON.stringify(ownOther);
  const fixture = instrument({ executePGSql: async (options) => {
    const sql = options.Sql;
    if (/^WITH target AS/.test(sql)) {
      const { uid, recipeId } = sqlIdentity(sql);
      assertWriteQuery(options, uid, recipeId);
      const key = JSON.stringify([uid, recipeId]);
      if (rows.has(key)) return emptyOutcome("duplicate");
      const row = favoriteDto({ user_id: uid, recipe_id: recipeId, note: "" });
      rows.set(key, row);
      return created(uid, recipeId, row.created_at);
    }
    const uid = /WHERE user_id = '([A-Za-z0-9_-]+)'/.exec(sql)?.[1];
    const recipeId = /AND recipe_id = '([A-Za-z0-9_-]+)'/.exec(sql)?.[1];
    if (/^SELECT /.test(sql)) {
      assertReadQuery(options, uid, recipeId);
      return favoriteRows([...rows.values()].filter((row) => row.user_id === uid &&
        (recipeId === undefined || row.recipe_id === recipeId)));
    }
    if (/^WITH deleted AS/.test(sql)) {
      assertDeleteQuery(options, uid, recipeId);
      const key = JSON.stringify([uid, recipeId]);
      const previous = rows.get(key);
      if (!previous) return deletedRows([]);
      rows.delete(key);
      return deletedRows([previous]);
    }
    const hex = /decode\('([0-9a-f]*)',\s*'hex'\)/i.exec(sql)?.[1];
    assert.equal(typeof hex, "string");
    const note = Buffer.from(hex, "hex").toString("utf8");
    assertPatchQuery(options, uid, recipeId, note);
    const key = JSON.stringify([uid, recipeId]);
    const previous = rows.get(key);
    if (!previous) return favoriteRows([]);
    const updated = { ...previous, note };
    rows.set(key, updated);
    return favoriteRows([updated]);
  } });
  const first = await fixture.handler(event());
  assert.equal(first.statusCode, 201);
  assert.deepEqual(Object.keys(payload(first).data).sort(), ["created_at", "recipe_id", "user_id"]);
  const before = payload(await fixture.handler(getEvent({ recipe_id: RECIPE_ID }))).data[0];
  assert.equal(before.note, "");
  const patched = payload(await fixture.handler(patchEvent())).data;
  const after = payload(await fixture.handler(getEvent({ recipe_id: RECIPE_ID }))).data[0];
  assert.deepEqual(after, patched);
  assert.deepEqual(after, { ...before, note: NOTE });
  assert.equal(after.created_at, payload(first).data.created_at);
  assertFailure(await fixture.handler(event()), 409, "FAVORITE_EXISTS");
  assert.equal(rows.size, 3);
  assert.equal(JSON.stringify(rows.get(JSON.stringify([other.user_id, other.recipe_id]))), otherBefore);
  assert.equal(fixture.sqlCalls.length, 5);
  assert.equal(fixture.authCalls.length, 5);
  const deleted = await fixture.handler(deleteEvent());
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(payload(deleted), { ok: true, data: { recipe_id: RECIPE_ID, deleted: true } });
  assert.equal(rows.has(JSON.stringify([UID, RECIPE_ID])), false);
  assert.equal(rows.size, 2);
  assert.deepEqual(payload(await fixture.handler(getEvent({ recipe_id: RECIPE_ID }))).data, []);
  assertFailure(await fixture.handler(deleteEvent()), 404, "FAVORITE_NOT_FOUND");
  assert.equal(fixture.sqlCalls.length, 8, "各次已认证请求恰好一次 SQL，无补查、重写或自动重试");
  assert.equal(fixture.authCalls.length, 8);
  assert.equal(JSON.stringify(rows.get(JSON.stringify([other.user_id, other.recipe_id]))), otherBefore);
  assert.equal(JSON.stringify(rows.get(JSON.stringify([ownOther.user_id, ownOther.recipe_id]))), ownOtherBefore);
  assert.deepEqual([...recipes], recipesBefore, "删除收藏不能删除菜品");
});

test("收藏 DELETE：两列 CTE 只删本人指定收藏，返回明确删除回执而非原始记录", async () => {
  const context = { environment: runtimeFields("VM_DELETE_CONTEXT_PRIVATE") };
  const fixture = instrument({ executePGSql: async (options, trace, receivedContext) => {
    assertDeleteQuery(options);
    assert.equal(typeof trace, "function");
    assert.equal(receivedContext, context);
    return deletedRows();
  } });
  const response = await fixture.handler(deleteEvent(), context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload(response), { ok: true, data: { recipe_id: RECIPE_ID, deleted: true } });
  assert.deepEqual(fixture.authCalls, [TOKEN]);
  assert.equal(fixture.sqlCalls.length, 1);
  assert.ok(!response.body.includes(UID) && !response.body.includes(NOTE));
});

test("收藏 DELETE：缺失编号拒绝，不能退化为删除本人全部收藏", async () => {
  for (const queryStringParameters of [undefined, null, {}]) {
    await assertInputRejected(deleteEvent(undefined, { queryStringParameters }), 400, "RECIPE_ID_REQUIRED");
  }
});

test("收藏 DELETE：非空 body 均在认证前拒绝，不从 body 取编号", async () => {
  for (const body of ["{}", " ", "null", JSON.stringify({ recipe_id: RECIPE_ID }), {}, [], 0, false,
    Buffer.from(JSON.stringify({ recipe_id: RECIPE_ID })).toString("base64")]) {
    await assertInputRejected(deleteEvent(undefined, { body, isBase64Encoded: true }), 400, "DELETE_BODY_NOT_ALLOWED");
  }
  for (const body of [undefined, null, ""]) {
    const fixture = instrument({ executePGSql: async () => deletedRows() });
    assert.equal((await fixture.handler(deleteEvent(undefined, { body }))).statusCode, 200);
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 DELETE：查询严格单个 recipe_id，类型/批量/额外键/注入或非法字符均拒绝", async () => {
  for (const recipe_id of [undefined, null, "", " ", 1, false, {}, [], [RECIPE_ID], "菜品", "a/b", "a.b",
    "a' OR '1'='1", RECIPE_ID + "\n", RECIPE_ID + "\r", "r".repeat(65)]) {
    await assertInputRejected(deleteEvent({ recipe_id }), 400, "INVALID_QUERY");
  }
  for (const query of [[], [RECIPE_ID], 1, false, "recipe_id=" + RECIPE_ID]) {
    await assertInputRejected(deleteEvent(query), 400, "INVALID_QUERY");
  }
  for (const extra of [{ user_id: "user_SYN_FORGED" }, { uid: UID }, { Role: "service_role" },
    { Sql: "DELETE FROM public.favorites" }, { recipe_ids: [RECIPE_ID] }, { note: NOTE }, { all: true }]) {
    await assertInputRejected(deleteEvent({ recipe_id: RECIPE_ID, ...extra }), 400, "INVALID_QUERY");
  }
});

test("收藏 DELETE：multiValue 参数不许重复、冲突、伪造归属或非数组值", async () => {
  for (const multi of [[], "recipe_id=" + RECIPE_ID, 1, false,
    { recipe_id: RECIPE_ID }, { recipe_id: [] }, { recipe_id: [RECIPE_ID, RECIPE_ID] },
    { recipe_id: ["recipe_SYN_OTHER"] }, { recipe_id: [1] }, { recipe_id: [RECIPE_ID + "\n"] },
    { recipe_id: [RECIPE_ID], user_id: [UID] }]) {
    await assertInputRejected(deleteEvent(undefined, { multiValueQueryStringParameters: multi }), 400, "INVALID_QUERY");
  }
  const fixture = instrument({ executePGSql: async () => deletedRows() });
  assert.equal((await fixture.handler(deleteEvent(undefined,
    { multiValueQueryStringParameters: { recipe_id: [RECIPE_ID] } }))).statusCode, 200);
});

test("收藏 DELETE：rawQueryString 如存在须与单值一致且仅有一个键值，不能掩盖重复参数", async () => {
  for (const rawQueryString of [null, {}, [], 1, false, "", "recipe_id=", "recipe_id=recipe_SYN_OTHER",
    "recipe_id=" + RECIPE_ID + "&recipe_id=" + RECIPE_ID,
    "recipe_id=" + RECIPE_ID + "&recipe_id=recipe_SYN_OTHER",
    "recipe_id=" + RECIPE_ID + "&%72ecipe_id=" + RECIPE_ID,
    "recipe_id=" + RECIPE_ID + "&user_id=" + UID,
    "recipe_id=" + RECIPE_ID + "%0A", "recipe_ids=" + RECIPE_ID]) {
    await assertInputRejected(deleteEvent(undefined, { rawQueryString }), 400, "INVALID_QUERY");
  }
  for (const rawQueryString of ["recipe_id=" + RECIPE_ID, "%72ecipe_id=" + RECIPE_ID]) {
    const fixture = instrument({ executePGSql: async () => deletedRows() });
    assert.equal((await fixture.handler(deleteEvent(undefined, { rawQueryString,
      multiValueQueryStringParameters: { recipe_id: [RECIPE_ID] } }))).statusCode, 200);
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.sqlCalls.length, 1);
  }
});

test("收藏 DELETE：只存在他人同编号时返回与目标缺失相同的 404，不泄露或删除他人行", async () => {
  const other = favoriteDto({ user_id: "user_SYN_OTHER", note: "他人收藏备注" });
  const rows = new Map([[JSON.stringify([other.user_id, other.recipe_id]), { ...other }]]);
  const fixture = instrument({ executePGSql: async (options) => {
    assertDeleteQuery(options);
    const uid = /WHERE user_id = '([A-Za-z0-9_-]+)'/.exec(options.Sql)?.[1];
    const recipeId = /AND recipe_id = '([A-Za-z0-9_-]+)'/.exec(options.Sql)?.[1];
    const key = JSON.stringify([uid, recipeId]);
    const previous = rows.get(key);
    if (!previous) return deletedRows([]);
    rows.delete(key);
    return deletedRows([previous]);
  } });
  const response = await fixture.handler(deleteEvent());
  assertFailure(response, 404, "FAVORITE_NOT_FOUND");
  assert.equal(fixture.authCalls.length, 1);
  assert.equal(fixture.sqlCalls.length, 1);
  assert.deepEqual([...rows.values()], [other]);
  assert.ok(!response.body.includes(other.user_id) && !response.body.includes(other.note));
});

test("收藏 DELETE：列顺序可变，ASCII 键边界与数字形状 UID 仍按字符串精确约束", async () => {
  for (const [uid, recipeId] of [["u", "r"], ["u".repeat(128), "r".repeat(64)],
    ["U_-09", "R_-09"], ["2100000000000000001", RECIPE_ID]]) {
    for (const columns of [DELETED_COLUMNS, [...DELETED_COLUMNS].reverse()]) {
      const fixture = instrument({ verifyToken: async () => uid, executePGSql: async (options) => {
        assertDeleteQuery(options, uid, recipeId);
        return deletedRows([{ user_id: uid, recipe_id: recipeId }], columns);
      } });
      const response = await fixture.handler(deleteEvent({ recipe_id: recipeId }));
      assert.equal(response.statusCode, 200);
      assert.deepEqual(payload(response).data, { recipe_id: recipeId, deleted: true });
      assert.equal(fixture.sqlCalls.length, 1);
    }
  }
});

test("收藏 DELETE：结果形状或归属不符均为 500，不能冒充删除成功或未找到", async () => {
  const valid = deletedRows();
  const invalid = [null, undefined, [], {}, { Columns: null, Rows: null },
    ...[0, 1].map((AffectedRows) => ({ Columns: null, Rows: null, AffectedRows })),
    { Columns: DELETED_COLUMNS, Rows: null }, { Columns: null, Rows: [] },
    { Columns: ["recipe_id", "recipe_id"], Rows: [] }, { Columns: ["user_id"], Rows: [] },
    { Columns: [...DELETED_COLUMNS, "note"], Rows: [] }, { Columns: "user_id,recipe_id", Rows: [] },
    { Columns: DELETED_COLUMNS, Rows: valid.Rows[0] },
    { Columns: DELETED_COLUMNS, Rows: [valid.Rows[0], valid.Rows[0]] },
    ...[null, {}, [UID, RECIPE_ID], 1, "bad JSON", "null", "{}", '"string"',
      JSON.stringify([UID]), JSON.stringify([UID, RECIPE_ID, NOTE]),
      JSON.stringify(["user_SYN_OTHER", RECIPE_ID]), JSON.stringify([UID, "recipe_SYN_OTHER"]),
      JSON.stringify([123, RECIPE_ID]), JSON.stringify([UID, 123])]
      .map((row) => ({ Columns: DELETED_COLUMNS, Rows: [row] }))];
  for (const result of invalid) {
    const fixture = instrument({ executePGSql: async () => result });
    const response = await fixture.handler(deleteEvent());
    assertFailure(response, 500, "FAVORITE_DELETE_FAILED");
    assert.equal(fixture.sqlCalls.length, 1);
    assert.equal(fixture.authCalls.length, 1);
    for (const secret of [UID, TOKEN, RECIPE_ID, NOTE, "user_SYN_OTHER", "recipe_SYN_OTHER"]) {
      assert.ok(!response.body.includes(secret));
    }
  }
});

test("收藏 DELETE：无身份、坏头或认证结果不合法均零 SQL，不允许请求替代验证身份", async () => {
  const anonymous = instrument();
  assertFailure(await anonymous.handler(deleteEvent(undefined, { headers: {} })), 401, "AUTH_REQUIRED");
  assert.equal(anonymous.authCalls.length, 0);
  assert.equal(anonymous.sqlCalls.length, 0);
  for (const headers of [{ Authorization: "Basic " + TOKEN }, { Authorization: "Bearer " + TOKEN + "\n" },
    { Authorization: ["Bearer " + TOKEN] }, { Authorization: "Bearer " + TOKEN, authorization: "Bearer OTHER_TOKEN" }]) {
    const fixture = instrument();
    assertFailure(await fixture.handler(deleteEvent(undefined, { headers })), 401, "AUTH_INVALID");
    assert.equal(fixture.authCalls.length, 0);
    assert.equal(fixture.sqlCalls.length, 0);
  }
  for (const uid of [undefined, null, 1, "", "用户", "u' OR '1'='1", UID + "\n", "u".repeat(129)]) {
    const fixture = instrument({ verifyToken: async () => uid });
    assertFailure(await fixture.handler(deleteEvent()), 401, "AUTH_INVALID");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.sqlCalls.length, 0);
  }
  const forged = instrument({ executePGSql: async (options) => { assertDeleteQuery(options); return deletedRows(); } });
  assert.equal((await forged.handler(deleteEvent(undefined,
    { user_id: "user_SYN_FORGED", uid: "user_SYN_FORGED", Role: "anon", Sql: "DELETE FROM other_table" }))).statusCode, 200);
  assert.equal(forged.sqlCalls.length, 1);
});

test("收藏数据层 DELETE：透传 trace/context，零行 null，两列已验证结果只返回删除回执", async () => {
  const database = mainFixture().database;
  const trace = () => {};
  const context = { environment: runtimeFields("VM_DELETE_DAL_PRIVATE") };
  for (const rowCount of [0, 1]) {
    let calls = 0;
    const data = await database.deleteFavorite(UID, RECIPE_ID, async (options, receivedTrace, receivedContext) => {
      calls++;
      assertDeleteQuery(options);
      assert.equal(receivedTrace, trace);
      assert.equal(receivedContext, context);
      return rowCount ? deletedRows() : deletedRows([]);
    }, trace, context);
    assert.deepEqual(JSON.parse(JSON.stringify(data)), rowCount ? { recipe_id: RECIPE_ID, deleted: true } : null);
    assert.equal(calls, 1);
  }
});

test("收藏数据层 DELETE：独立验证 UID 与必填编号，坏值不能发 SQL", async () => {
  const database = mainFixture().database;
  let calls = 0;
  const execute = async () => { calls++; throw new Error("invalid input must not call SQL"); };
  for (const uid of [undefined, null, 1, "", "用户", "u' OR '1'='1", UID + "\n", "u".repeat(129)]) {
    await assert.rejects(() => database.deleteFavorite(uid, RECIPE_ID, execute));
  }
  for (const recipeId of [undefined, null, 1, [], "", "菜", "r' OR '1'='1", RECIPE_ID + "\n", "r".repeat(65)]) {
    await assert.rejects(() => database.deleteFavorite(UID, recipeId, execute));
  }
  assert.equal(calls, 0);
});

test("收藏 main DELETE：每次官方 introspect 与新运行身份客户端，单次删除无身份缓存", async () => {
  const uids = [UID, "user_SYN_B"];
  const fixture = mainFixture({ fetch: async (_url, _options, index) => authResponse(validIdentity(uids[index])) });
  for (const [index, uid] of uids.entries()) {
    const fields = runtimeFields("VM_DELETE_CONTEXT_" + index + "_PRIVATE");
    const response = await fixture.exported.main(deleteEvent(), { environment: fields });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(payload(response), { ok: true, data: { recipe_id: RECIPE_ID, deleted: true } });
    const { url, options } = fixture.authCalls[index];
    assert.equal(url, AUTH_URL);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.signal, fixture.timeouts[index]);
    assert.equal(fixture.timeouts[index].vmTimeoutMs, 1000);
    assert.deepEqual(fixture.clients[index].credential, sdkCredential(fields));
    const { EnvId, ...query } = fixture.requests[index].params;
    assertDeleteQuery(query, uid);
  }
  assert.equal(fixture.authCalls.length, 2);
  assert.equal(fixture.requests.length, 2);
  assert.equal(new Set(fixture.clients).size, 2);
  assert.equal(fixture.moduleLoads, 1);
});

test("收藏 main DELETE：坏认证拒绝，无客户端、无数据库请求，也不自动重试", async () => {
  for (const identity of [null, [], {}, { ...validIdentity(), client_id: "other-env" },
    { ...validIdentity(), token_type: "Basic" }, { ...validIdentity(), sub: 1 },
    { ...validIdentity(), sub: "u' OR '1'='1" }, { ...validIdentity(), sub: UID + "\n" }]) {
    const fixture = mainFixture({ fetch: async () => authResponse(identity) });
    assertFailure(await fixture.exported.main(deleteEvent()), 401, "AUTH_INVALID");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
  }
  for (const status of [400, 401, 403, 404]) {
    const fixture = mainFixture({ fetch: async () => authResponse({ PRIVATE_AUTH: TOKEN }, status) });
    const response = await fixture.exported.main(deleteEvent());
    assertFailure(response, 401, "AUTH_INVALID");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
    assert.ok(!response.body.includes(TOKEN));
  }
  for (const fetchImpl of [async () => { throw new Error("PRIVATE_DELETE_AUTH " + TOKEN); },
    async () => authResponse({}, 500), async () => ({ ok: true, status: 200, async json() { throw new Error("PRIVATE_AUTH_JSON"); } })]) {
    const fixture = mainFixture({ fetch: fetchImpl });
    assertFailure(await fixture.exported.main(deleteEvent()), 503, "AUTH_UNAVAILABLE");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.clients.length, 0);
    assert.equal(fixture.requests.length, 0);
  }
});

test("收藏 main DELETE：运行凭据缺失时 500，不能回退用户 token 或建立客户端", async () => {
  const fixture = mainFixture({ env: {} });
  const response = await fixture.exported.main(deleteEvent());
  assertFailure(response, 500, "FAVORITE_DELETE_FAILED");
  assert.equal(fixture.authCalls.length, 1);
  assert.equal(fixture.clients.length, 0);
  assert.equal(fixture.requests.length, 0);
  assert.ok(!response.body.includes(TOKEN));
});

test("收藏 main DELETE：SQL 异常脱敏且仅一次调用，不重发或补查确认", async () => {
  for (const code of ["RequestTimeout.PRIVATE_DETAIL", "AuthFailure.PRIVATE_CODE\nforged_log", "FailedOperation.PGExecutionError"]) {
    const fields = runtimeFields("VM_DELETE_ERROR_PRIVATE");
    let sql;
    const fixture = mainFixture({ env: fields, request: async (params) => {
      sql = params.Sql;
      throw Object.assign(new Error("PRIVATE_DELETE_ERROR " + TOKEN + " " + UID + " " + NOTE + " " + sql), { code });
    } });
    const response = await fixture.exported.main(deleteEvent());
    assertFailure(response, 500, "FAVORITE_DELETE_FAILED");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.logs.filter((line) => line.includes(" api_error ")).length, 1);
    const observable = [response.body, ...fixture.logs].join("\n");
    for (const secret of ["PRIVATE_DELETE_ERROR", "PRIVATE_DETAIL", "PRIVATE_CODE", "forged_log", TOKEN, UID, NOTE, sql, ...Object.values(fields)]) {
      assert.ok(!observable.includes(secret));
    }
  }
});

test("收藏 main DELETE：空结果为 404，null/坏结构/错误归属为 500，日志不能泄漏结果原文", async () => {
  for (const [result, status, code] of [[deletedRows([]), 404, "FAVORITE_NOT_FOUND"],
    [{ Columns: null, Rows: null, AffectedRows: 1 }, 500, "FAVORITE_DELETE_FAILED"],
    [deletedRows([{ user_id: "PRIVATE_OTHER_USER", recipe_id: RECIPE_ID }]), 500, "FAVORITE_DELETE_FAILED"],
    [{ Columns: DELETED_COLUMNS, Rows: ["PRIVATE_BAD_JSON " + TOKEN] }, 500, "FAVORITE_DELETE_FAILED"]]) {
    const fixture = mainFixture({ request: async () => result });
    const response = await fixture.exported.main(deleteEvent());
    assertFailure(response, status, code);
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.requests.length, 1);
    const observable = [response.body, ...fixture.logs].join("\n");
    for (const secret of [TOKEN, UID, NOTE, RECIPE_ID, "PRIVATE_OTHER_USER", "PRIVATE_BAD_JSON", fixture.requests[0].params.Sql]) {
      assert.ok(!observable.includes(secret));
    }
  }
});

test("收藏 DELETE：模拟已删成功后超时或返回坏结果仍报不确定的 500，绝不自动重试或补查", async () => {
  for (const outcome of ["timeout", "null_result", "invalid_json"]) {
    const stored = new Map([[JSON.stringify([UID, RECIPE_ID]), favoriteDto()]]);
    const fixture = mainFixture({ request: async (params) => {
      const { EnvId, ...options } = params;
      assertDeleteQuery(options);
      assert.equal(stored.delete(JSON.stringify([UID, RECIPE_ID])), true, "合成数据库本次删除确已发生");
      if (outcome === "timeout") throw Object.assign(new Error("PRIVATE_POST_DELETE_TIMEOUT"), { code: "RequestTimeout" });
      if (outcome === "null_result") return { Columns: null, Rows: null, AffectedRows: 1 };
      return { Columns: DELETED_COLUMNS, Rows: ["PRIVATE_POST_DELETE_BAD_RESULT"] };
    } });
    const response = await fixture.exported.main(deleteEvent());
    const value = assertFailure(response, 500, "FAVORITE_DELETE_FAILED");
    assert.equal(value.error.message, "无法确认删除结果，请先核对收藏状态，不要立即重复删除。");
    assert.equal(stored.size, 0, "业务响应失败不能用来推断数据尚未删除");
    assert.equal(fixture.authCalls.length, 1);
    assert.equal(fixture.requests.length, 1, "未知结果后不得自动重写或补查 SQL");
    assert.doesNotMatch([response.body, ...fixture.logs].join("\n"), /PRIVATE_POST_DELETE_/);
  }
});
