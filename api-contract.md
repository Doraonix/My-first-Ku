# 下一餐接口契约｜Day 15 / Day 17

Day 15 记录日期：2026-10-04，版本 v0.1。Day 17 更新日期：2026-10-09，版本 v0.14（适配方案 A 的功能验收通过；全项目 354 项测试通过，学员已核对并授权提交、推送 14 个 Day 17 文件，执行结果以 Git 历史及远端分支为准）。

接口契约是调用方和服务方共同遵守的约定：请求发到哪里、怎么发、成功时返回什么。第 1–6 节保留 Day 15 最小健康接口的当时约定与证据；第 7 节新增本次已获授权的 Day 17 菜品及材料读接口，不将新接口的规范套用到健康接口。

## 1. Day 15 发布时的服务与页面地址

| 用途 | 地址 | 当前职责 |
| --- | --- | --- |
| 健康接口 | [GET /api/health](https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com/api/health) | 检查健康函数能否经公网 HTTP 路由调用并返回约定 JSON。 |
| mock 前端 | [下一餐页面](https://doraonix-d2g6piooqfa4ba0c9-1500260867.tcloudbaseapp.com/next-meal/) | 显示已审核的固定菜品，浏览器本地完成筛选和收藏；不调用健康接口或业务接口。 |

这两个地址属于不同域名。健康接口不在前端的 `/next-meal/` 路径下，不能直接把前端网址后面加上 `/api/health` 当成接口地址。

环境 ID：`doraonix-d2g6piooqfa4ba0c9`。云函数名称：`health`；类型：普通云函数；入口：`index.main`；云端运行环境：Node.js 20.19。

实现文件：`cloudfunctions/health/index.js`；目录内 `package.json` 指定 CommonJS，不依赖第三方库。环境 ID 和公开网址不是密钥；本文件不记录账号凭据、Token、数据库连接串或 `.env` 内容。

## 2. 请求约定

| 项目 | 约定 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/health` |
| 查询参数 | 不需要。 |
| 请求体 | 不需要。 |
| 请求头 | 不要求业务自定义请求头；调用方可声明接受 JSON。 |
| 身份认证 | 该健康路由未开启身份认证；无需登录、Cookie 或授权令牌。此约定不扩大到其他云资源。 |

可直接在浏览器打开上面的完整健康接口链接。本期只约定并验证 `GET`；现有函数没有检查 HTTP 方法，不承诺其他方法一定被拒绝，也没有实现 `405` 响应。

## 3. 成功响应

HTTP 状态码：`200`。响应类型：`application/json`；本日公网验证实际观察到 `application/json; charset=utf-8`。

响应示例：

```json
{
  "ok": true,
  "service": "next-meal"
}
```

| 字段 | 类型 | 是否必需 | 当前含义 |
| --- | --- | --- | --- |
| `ok` | boolean | 是 | 当前固定为 `true`，说明该次请求执行到了这个健康函数的返回逻辑。 |
| `service` | string | 是 | 当前固定为 `"next-meal"`，用于辨认响应来自本项目的健康函数。 |

调用方按 JSON 解析并核对字段和值，不依赖缩进、空格或属性排列顺序。`"true"` 字符串不是这里约定的布尔值 `true`。

本接口不读取菜品、不执行推荐、不读写收藏、不连接数据库，也不检查其他服务。因此 `ok: true` 不等于数据库正常、所有功能正常或所有用户都能打开前端。

## 4. 未成功时如何判断

未取得 HTTP `200`、正文无法解析为 JSON、必需字段类型或值不符合上表，均不能判为本契约验证成功。

当前实现没有自定义业务错误码、统一错误响应对象或重试机制。不虚构 `{ "code": ..., "message": ... }` 等错误格式，也不承诺平台异常一定返回 JSON；网络、路由和平台可能在函数执行前就失败。

遇到问题时保留实际访问地址、时间、HTTP 状态（若有）、正文或浏览器报错，再分清是本机网络、网关路由还是函数调用问题。不要通过开放其他资源的认证或改写正式菜品来修复健康接口。

## 5. 验证依据与边界

- 本地已检查入口语法、实际返回值、JSON 序列化和连续调用 10 次；本地 Node.js 为 24.16.0，不将其称作 Node.js 20.19 本地测试。
- 云端控制台调用曾返回成功，正文为 `{"ok":true,"service":"next-meal"}`。
- 本日前端发布前，AI 实际发送不带 Cookie 或认证头的公网 GET，取得 HTTP `200`、JSON 响应类型及上述正文；学员也提供公网 JSON 页面截图并确认已保存。
- 前端随后更新至 `next-meal-002`。部署后的自动健康复检受本机网络权限限制，未取得新响应；不将工具访问失败判成服务故障，也不冒充已完成最新复检。具体证据及后续补充记录见 `README.md` 的 Day 15 部分。
- 实际前端与手机截图证明页面能显示，不替代接口状态码或完整响应的核对；控制台测试成功也不单独证明匿名公网路由可访问。

验证本接口时，应亲眼看到完整健康地址返回 JSON，并核对 `ok` 和 `service`。若要核对状态码、响应类型，需检查实际 HTTP 响应；仅看见 JSON 文本不能证明所有响应头。

## 6. Day 15 不做什么

- 不新增真实菜品、推荐、收藏等业务接口，不设计尚未确认的请求或响应字段。
- 不建数据库表，不接登录、支付或跨设备收藏同步。
- 不调整跨域配置；健康网关的默认跨域开关未被改写，也未据此宣称浏览器跨域请求已通过测试。
- 不把前端改为请求健康接口。当日页面使用固定 mock 资料，收藏保存在当前站点的浏览器 localStorage；Day 17 新版页面接入另见第 7 节。

后续如需业务接口、数据库或前后端接入，应在对应天数的任务获得授权后，再更新这份契约并分别验证。

## 7. Day 17｜菜品与材料读接口（部署与真库联动验证通过）

### 7.1 适配范围与当前状态

学员选择方案 A，并明确回复“现在开始做 Day 17”，将原热搜清单适配为“下一餐”：读取现有两张表，不同步热搜、不新增 `/api/hot` 或云端收藏 `/api/favorites`，不改表结构、不写业务写入接口。收藏继续留在浏览器本地；适配后的验收是两条 GET、页面真库资料及控制台改一行后接口与页面随之变化，不冒充通过原“当日真实热搜”标准。

| 方法与公网路径 | 普通云函数源码目录 | 查询表 | 当前状态 |
| --- | --- | --- | --- |
| `GET /api/recipes` | `cloudfunctions/recipes/` | `public.recipes` | 控制台返回 5 道菜；学员公网截图为 ok=true、5 道菜；AI 实际 GET 返回 HTTP 200。 |
| `GET /api/recipe-materials` | `cloudfunctions/recipe-materials/` | `public.recipe_materials` | 云端资源实际名为 `scf-nodejs-helloworld-u4ds`；控制台及学员公网正文均为 ok=true、25 条材料；AI 实际 GET 返回 HTTP 200。 |

两条路径已由学员添加到第 1 节健康接口所在的 HTTP 网关域名，不在前端静态域名下。材料路由关联云端实际资源名，本地源码目录名保持 `recipe-materials`。板块①当时没有创建云函数或路由；板块②的本地页面接入见第 7.6 节，当前公网证据见第 7.14 节。

当前[下一餐公网首页](https://doraonix-d2g6piooqfa4ba0c9-1500260867.tcloudbaseapp.com/next-meal/#home)已发布新版，学员截图确认“数据来源：云端读接口；本次加载 5 道菜。”、食材和调料选项及 5 道推荐结果。该浏览器加载证据见第 7.15 节；控制台临时改名、接口与页面变化及恢复证据见第 7.16 节。

### 7.2 请求、响应与字段

- 只支持 HTTP `GET`；不需要请求体，不接收调用方指定的 SQL、表名、环境或权限角色。
- 本期未实现筛选、分页或 `limit` 参数；查询参数不改变固定查询。返回现有表记录，菜品按 `id`，材料按 `recipe_id`、`material_type`、`position` 排序。
- 成功：HTTP `200`，正文为 `{ "ok": true, "data": [...] }`。有效空结果返回 `data: []`，不回退或伪造种子结果。
- `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`；两函数每次请求都重新查库，不复用旧数据；只复用 SDK 模块，每次用本次运行身份创建客户端。

菜品的每条 `data`：

| 字段 | JSON 类型 | 对应数据库字段 |
| --- | --- | --- |
| `id` | string | `recipes.id`，保持固定菜品编号。 |
| `name` | string | `recipes.name`。 |
| `difficulty` | string | `recipes.difficulty`，仅简单、普通。 |
| `steps` | string[] | `recipes.steps`，至少一条，保留顺序。 |
| `difficulty_reason` | string 或 null | `recipes.difficulty_reason`，不把 SQL NULL 变成字符串。 |
| `notes` | string[] | `recipes.notes`，保留用量及烹调说明。 |
| `safety_notes` | string[] | `recipes.safety_notes`。 |

材料的每条 `data`：

| 字段 | JSON 类型 | 对应数据库字段 |
| --- | --- | --- |
| `recipe_id` | string | `recipe_materials.recipe_id`，关联 `recipes.id`。 |
| `name` | string | `recipe_materials.name`。 |
| `material_type` | string | `main`（主要食材）或 `seasoning`（调料）。 |
| `amount` | string | 原样保留 `recipe_materials.amount` 的用量文字，不换算。 |
| `position` | number（正整数） | `recipe_materials.position`，显式转换 SDK 返回的整数文本。 |

### 7.3 读库与类型边界

沿用普通云函数 `index.main`，目标运行环境为 Node.js 20.19；两函数各有独立 CommonJS `package.json`，均固定依赖 `tencentcloud-sdk-nodejs-common` 4.1.220。普通云函数使用平台运行身份，源码不配置固定密钥；本地测试模拟 SDK 和凭据，不使用实际凭据访问真库。本地 Node.js 不等于云函数环境。[官方通用 SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs#common-client)、[普通函数运行身份](https://cloud.tencent.com/document/product/583/47933)

只执行源码中的固定显式 `SELECT`。两函数均固定使用 `anon`；API Explorer 已实际验证该角色可切换，两表 SELECT 为 true，所查表级写权限为 false。此前系统只读角色虽补齐 SELECT，却仍不允许当前 API 数据库账号切换；完整系统角色名还会被 API 重复追加后缀，不能作为修复方案。运行身份、角色参数与 API 真库调用分别验证；目前两函数均取得完整控制台成功响应，5 道菜与 25 条材料另有公网返回证据。[PostgreSQL API](https://docs.cloudbase.net/api-reference/manager/node/postgresql)、[PG 角色说明](https://docs.cloudbase.net/authentication-v2/auth/auth-pg)

两表保留 RLS。学员获知匿名读取范围后回复“继续”，批准准备两条 `FOR SELECT TO anon USING (true)` 策略，脚本为 `db/day17-anon-read.sql`；随后人工执行并确认两条均成功。策略开放两表全部行，包括未来新增行；结合既有整表 SELECT，全部列也可读。有效 anon 身份通过其他 CloudBase 数据入口也适用，不限于这两个自建 GET。此修改不授予写权限、不关闭 RLS，不适用于将来的私有收藏或用户资料。后续 API Explorer 已以 anon 读到 5/25 行，菜品函数控制台已返回 5 道菜；不将其等同于两条公网接口或页面验收。

`ExecutePGSql` 返回 `Columns` 和字符串数组 `Rows`，CommonClient 已解开 API 的 `Response` 包装。代码先解析每条行字符串，再按列名对齐字段；仅对 JSONB 数组字段解码，并对材料 `position` 验证正整数。不能直接把原始行字符串当对象，也不能递归解析用量等普通文字。类型或结果结构不符时返回错误，而不是成功空列表。

### 7.4 错误与 HTTP 集成

- 非 GET（包括没有 `httpMethod`）：HTTP `405`，响应头 `Allow: GET`，正文 `{ "ok": false, "error": { "code": "METHOD_NOT_ALLOWED", "message": "只支持 GET 请求。" } }`，不查询数据库。
- 读库或结果解码失败：HTTP `500`，正文 `{ "ok": false, "error": { "code": "DATA_READ_FAILED", "message": "暂时无法读取数据库资料，请稍后重试。" } }`。
- 不向响应或日志输出 SDK 原始异常、SQL、凭据和连接信息；前端不得把 `ok: false` 当成正常空数据。
- 网关按顶层 `event.httpMethod` 提供方法。普通函数返回集成响应 `{statusCode, headers, body, isBase64Encoded:false}`，其中 `body` 为 JSON 字符串；公网正文应是其中的业务 JSON，而非整份集成响应包装。控制台测试须显式传入 `{ "httpMethod": "GET" }`。[普通函数返回格式](https://docs.cloudbase.net/cloud-function/how-coding)
- 两条 HTTP 网关路由已创建，实际公网 GET 为 HTTP 200；带静态网页 Origin 的请求返回匹配的跨域响应头。新版网页读取、数据库改名及恢复另有真实接口检查和学员确认，详见第 7.14–7.16 节。

### 7.5 本地验证与未完成事项

新增 `tests/read-api.test.mjs`，使用模拟的实际 SDK `Columns/Rows` 形状测试成功、空结果、列名对齐、JSONB 与整数转换、非 GET 拒绝、固定查询、每次读取新结果、异常不泄露及健康接口不变。模拟资料取自已审核的本地 JSON，不是云数据库的当前查询结果，也不会被正式函数作为回退数据。

板块①的本地入口语法检查通过；新增接口测试 73 项通过，当时根目录 `npm test` 共 141 项通过，0 失败、0 跳过。本地 Node.js 为 24.16.0，不将其称为 Node.js 20.19 云端测试；未在本地安装或真实调用 Manager SDK，没有取得新的公网或真库响应。

板块①结束时，页面接入及所有部署/真库验收均待后续板块。板块②已完成的本地页面接入见下节；板块③的初次云端超时及最小修改见第 7.7 节。5 道菜及 25 条材料的公网结果、新版页面加载、数据库改名与恢复现已有实际证据及学员确认（第 7.14–7.16 节）；当日收尾和作业截图长期保存仍需按项目规则核对，不把本地模拟测试作为真库证据。

### 7.6 板块②｜页面字段映射与本地验证

`recipe-data.mjs` 同时 GET 本域名的 `/api/recipes` 与 `/api/recipe-materials`，不发送令牌或 Cookie，使用 `cache: "no-store"`。两端都返回成功且资料完整后，才按 `recipe_id` 将材料归入菜品；不会使用部分响应或退回本地 JSON 冒充真库。

| 读接口字段 | 页面使用字段 | 转换 |
| --- | --- | --- |
| `difficulty_reason` | `difficultyReason` | 保留 string/null，只改变字段名。 |
| `notes` / `safety_notes` | 每菜 `notes` / `safetyNotes` | 保留该菜的说明，不合并成别的菜的说明。 |
| 材料 `recipe_id` | 菜品 `id` 下的材料 | 关联未知菜品时拒绝整次加载。 |
| `material_type: "main"` | `mainIngredients` | 按 `position` 排序，至少一种主要食材。 |
| `material_type: "seasoning"` | `seasonings` | 单独分组，允许为空，不默认已有油盐。 |
| 材料 `name` / `amount` | `{name, amount}` | 文字原样保留，不自动换算或推断同义词。 |

接口异常、非法字段或缺主料时页面保护推荐/清空及收藏；两个有效空列表显示“数据库暂无菜品”，不读取或覆盖原收藏。成功时显示本次加载条数，去掉“四道菜”固定文案，仍使用既有筛选、视图及浏览器本地收藏，不新增后台写入。

本板块曾因测试替身直接比较 URL 对象与字符串而失败；按项目规则暂停，经学员明确同意后仅修测试地址规范化，过程见 `README.md`。随后全项目 238 项测试通过（0 失败、0 跳过），构建 8 模块成功。自动测试使用模拟请求和内存页面，不能证明真实跨域或真库响应；板块②结束时前端和两函数均未部署，控制台改行联动与人工截图仍待确认。

### 7.7 板块③｜菜品函数超时与最小修改

学员已创建并部署 `recipes` 普通云函数。首次控制台 GET 实际返回 `Invoking task timed out after 3 seconds`、`statusCode: 433`，尚未取得业务成功响应。当前平台超时配置为 3 秒；学员反馈修改需要付费，本轮保留现有配置。

经学员同意，本地菜品函数改用同版本 SDK 的 `commonService("tcb", "2018-06-08").call({ Action: "ExecutePGSql", Param: { EnvId, Sql, Role } })`。已发布的 5.9.0 源码表明，这条入口省去 database 模块首次查询前的 `DescribeEnvInfo` 请求，并返回相同的 `Columns`/`Rows` 结构。移除未被该版本初始化读取的 `timeout` 参数，不把 SDK 参数当成平台时限设置。[通用服务入口](https://docs.cloudbase.net/api-reference/manager/node/common)、[ExecutePGSql 参数](https://cloud.tencent.com/document/product/876/130469)

此次只修改菜品查询入口，固定 SQL、只读角色和 HTTP 约定不变；材料函数暂留原实现。语法检查通过，相关接口模拟测试 73 项通过、0 失败；随后学员提供的第二次 GET 测试仍在 3 秒超时，未取得业务数据。后续诊断见下节；两条公网路由、跨域和新版前端尚未部署，真库验收未完成。

### 7.8 板块③｜首次诊断版本与云端结果

学员同意加入诊断日志后，仅为菜品函数添加版本标记 `recipes-diag-v1` 与每次调用独立计算的累计毫秒。所有阶段使用固定名称，不打印请求、上下文、环境变量、SQL、数据内容或原始异常；诊断不加入业务响应，HTTP 契约保持不变。

| 日志阶段 | 含义 |
| --- | --- |
| `entry` | 已进入带此版本标记的函数处理入口。 |
| `sdk_ready` | SDK 本地加载、初始化和服务对象准备结束，或复用了已准备好的对象。 |
| `api_call_start` | 即将调用 SDK；不能据此证明 HTTP 已发出或抵达服务器。 |
| `api_return` | SDK 调用成功返回，尚未执行后续数据解码。等待或失败时不记录此阶段。 |

阶段之间的耗时可定位到 SDK 准备或 SDK 调用等待等范围，不能单独分辨网络与数据库执行耗时。第二次截图的冷启动 90 ms 也不包括请求阶段延迟加载 SDK 的用时。若未看到版本标记，应先核对本次完整日志和部署版本，不能仅凭缺失日志认定旧代码。

该版本本地语法检查及 73 项接口模拟测试通过。随后学员提供云端截图，仍在 3000 ms 超时，日志只出现 `[recipes-diag-v1] entry elapsed_ms=0`。这确认新版入口已执行，但未到 SDK 准备完成与查询调用节点；尚不能区分模块加载与初始化各用了多久。本地通过不代表云端超时已解决，替换方案见下节。

### 7.9 板块③｜通用 SDK 替换

学员明确同意替换 SDK 后，仅将菜品函数换为官方 `CommonClient("tcb.tencentcloudapi.com", "2018-06-08", config)`，调用 `request("ExecutePGSql", { EnvId, Sql, Role })`；仍使用原固定 SELECT、环境和只读角色，返回字段、方法限制与错误约定不变。材料函数暂不修改。

客户端每次调用创建，临时凭据优先取平台 `context` 顶层字段，其次兼容 `context.environment` 对象或 JSON 字符串，最后使用平台环境变量。字段为 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`、`TENCENTCLOUD_SESSIONTOKEN`；三个字段必须来自同一个完整来源，不拼接，不使用 HTTP 事件提供的凭据。官方说明 context 凭据随每次调用更新，环境变量仅冷启动时更新，因此环境变量只作为兼容后备；源码与日志不记录凭据值。[临时授权刷新规则](https://cloud.tencent.com/document/product/583/9180)

SDK 请求超时设为 2 秒（官方参数单位为秒），用于在当前平台 3 秒限制内留出响应余量；没有修改平台限制，不自动重试。若 SDK 准备或平台处理仍耗时较长，仍可能在平台时限终止，不能保证此修改必然解决超时。

保留四个诊断节点，固定标签更新为 `recipes-diag-v2`，以区别已测试的旧版。部署时须同时替换函数的 `index.js`、`package.json`，并选择部署且安装依赖；需要安装的新依赖是 `tencentcloud-sdk-nodejs-common` 4.1.220。随后收到的该版本控制台结果见下节；公网路由、跨域、新版前端和真库联动验收仍待完成。

本地函数与测试文件语法检查通过，接口模拟测试 90 项通过（0 失败、0 跳过），覆盖 SDK 参数、每次身份更新、完整来源、事件伪造、等待/失败日志及原有字段/方法约定。SDK 未在本地安装，没有测量其真实加载速度或发起真库请求；实际 3 秒内的成功读取仍需云端验证。

### 7.10 板块③｜云端 500 与安全错误码日志

学员提供的 `recipes-diag-v2` 控制台截图显示运行时间 631 ms，`sdk_ready` 和 `api_call_start` 均为 273 ms，没有 `api_return`，返回集成响应 `statusCode: 500`、业务 `DATA_READ_FAILED`。这次未触发平台 3 秒超时，但读库未成功，不能把页面顶部的“测试成功”当作业务通过；尚不能确定是权限、签名、参数或其他 SDK 调用问题。

经学员明确同意记录错误码，仅在 SDK 查询调用异常时增加一条 `api_error` 日志，版本标签为 `recipes-diag-v3`。常见官方完整错误码使用固定允许列表；其他子码只输出允许的固定大类。无有效字符串码输出 `NO_API_ERROR_CODE`，未知大类输出 `UNKNOWN_API_ERROR`，不输出未知后缀、异常消息、堆栈、凭据、SQL 或数据。HTTP 响应继续使用原统一错误格式，不带内部错误码。[官方接口错误码](https://cloud.tencent.com/document/product/876/130469)、[官方公共错误码](https://cloud.tencent.com/document/product/876/34823)

`NO_API_ERROR_CODE` 只表示 SDK 没有提供可用 API 错误码，不能据此认定权限不足；未知子码被归为大类时也不代表已经查清根因。当时仅增加诊断，不修改查询、身份、依赖或平台配置；随后 v3 云端结果与授权核对见下节。

函数与测试文件语法检查通过；相关接口模拟测试 131 项通过（0 失败、0 跳过），新增 39 种安全码场景，覆盖原始异常、敏感后缀和凭据不泄漏，以及查询失败与解码失败日志的区别。本地验证没有访问真库，不作为该版本云端成功或具体错误原因的证据。

### 7.11 板块③｜读取授权核对与完整角色名验证（2026-10-09）

v3 云端日志取得 `FailedOperation.PGExecuteSqlError`。管理员只读查询表明：库中没有裸名 `cloudbase_read_only_user`，实际只读角色为 `cloudbase_read_only_user_postgres_c8t0z5ym`，`BYPASSRLS` 和 schema USAGE 为 true，但两表表级 SELECT 为 false。目录中缺少裸名不能单独证明 API 参数无效；平台是否映射角色名仍未知，不把这一点直接当作已确定根因。

学员明确批准“仅补两表 SELECT 授权”，随后在控制台以管理员执行：

```sql
GRANT SELECT ON public.recipes, public.recipe_materials
TO "cloudbase_read_only_user_postgres_c8t0z5ym";
```

执行截图显示成功、影响 0 行；后续权限查询实际返回两表 SELECT 为 true，INSERT/UPDATE/DELETE/TRUNCATE 为 false。没有新建角色、更改 RLS、授予匿名权限或改动表字段。由于角色已有 BYPASSRLS，授权覆盖两表全部行和列。

授权后 v3 测试仍返回 500，运行时间 765 ms，错误码仍为 `FailedOperation.PGExecuteSqlError`。学员再以管理员执行函数的原样 SELECT，返回 recipe-001 至 recipe-005，共 5 行、全部 7 个约定字段。这证明该控制台中的查询和资料可读，不能替代云函数角色读取或公网验证。

学员同意修正 recipes 角色名后，当时本地仅改其固定 ROLE 为上述实际完整名称，并将诊断标记更新为 `recipes-diag-v4`。现有测试对两个接口各自固定角色作严格断言，材料函数暂不修改。依赖、凭据读取、查询、解析和 HTTP 契约不变；随后实际失败及纠正见第 7.12 节。

当时函数语法检查及相关接口模拟测试通过：131 项、0 失败、0 跳过；固定角色不可被 HTTP 参数覆盖，原有错误与日志保护仍有效。本地测试没有验证云 API 对完整角色名的实际处理，也没有证明 v4 云端读取成功。

### 7.12 板块③｜角色映射、切换权限与 anon 只读策略（2026-10-09）

学员部署 v4 后实际返回 500，耗时 568 ms；日志含 v4 标记、SDK 准备 281 ms、查询调用前 282 ms、API 错误 564 ms，仍为 `FailedOperation.PGExecuteSqlError`，尚未进入结果解码。

学员随后在官方 API Explorer 执行诊断，取得以下直接证据；这些请求使用登录用户身份，不冒充云函数运行身份或公网验收：

1. 传完整系统角色名，API 再追加 `_postgres_c8t0z5ym`，得到不存在的重复后缀角色（SQLSTATE 22023）。主代理此前推荐完整名的判断有误，已明确纠正。
2. 改传短名 `cloudbase_read_only_user`，API 映射到正确实体角色，但 `SET ROLE` 被拒绝（SQLSTATE 42501）；表 SELECT 与切换身份权限不能混为一项。
3. 省略 Role、仅查询身份，`session_user` 与 `current_user` 均为 `cloudbase_postgres_postgres_c8t0z5ym`，版本号 170011（PostgreSQL 17.11）。以实际返回为准，不按文档概述假定默认身份是超级用户；不将省略 Role 用于正式业务函数。
4. 角色查询显示该 API 账号没有 SUPERUSER/CREATEROLE，也没有授予系统只读角色的 ADMIN 权限；系统只读角色不可切换。`anon` 可切换，两表 SELECT 为 true，INSERT/UPDATE/DELETE/TRUNCATE 表级权限为 false；其他可切换的高权限角色未被用作业务修复。
5. 实际指定 `Role: "anon"` 查询成功（14 ms），返回 `active_role=anon`、菜品 0 行、材料 0 行、两表策略空数组。结合既有 RLS 开启及管理员 5/25 行证据，定位为缺少允许 anon 读取的行级策略。诊断请求 ID 为 `d88dc8c0-4dbe-40ba-9b75-1708e672d075`。

在说明两表匿名读取会扩大访问范围并需确认后，学员回复“继续”。本轮据此新增 `db/day17-anon-read.sql`：只创建两条明确的 SELECT 策略并提供只读核对语句，一次执行一条；不覆盖已有策略，报错即停止。已有系统只读角色的 SELECT 授权暂不撤销，不把新增策略扩展为角色管理或其他资源授权。[PG17 权限查询](https://www.postgresql.org/docs/17/functions-info.html)、[SELECT 策略](https://www.postgresql.org/docs/17/sql-createpolicy.html)

当时菜品函数改为固定 `Role: "anon"`，安全诊断标记为 `recipes-diag-v5`；现有测试同步角色和标记。SQL、依赖、运行凭据处理、解码及 HTTP 契约不变；材料函数留待菜品验证后继续。当时脚本和 v5 尚未云端执行或部署；后续实际结果见第 7.13 节。不保存 API 调试请求头、签名或临时凭据。

本轮实际执行 `node --check cloudfunctions/recipes/index.js` 和 `node --test tests/read-api.test.mjs`，语法检查通过，131 项测试通过、0 失败、0 跳过。使用本地 Node.js 和模拟 SDK，未安装 SDK 或连接数据库；SQL 仅作静态检查，没有声称策略已创建。`git diff --check` 无格式错误；未重新运行前端测试或构建、未暂存或提交。

### 7.13 板块③｜菜品控制台成功与材料函数同步（2026-10-09）

学员确认两条 SELECT 策略“都成功”。随后 API Explorer 使用 `Role: "anon"` 查询，实际返回 `active_role=anon`、`recipes_count=5`、`materials_count=25`，数据库执行耗时 8 ms，请求 ID 为 `fca43869-9c7b-4973-9f37-0696ad2f0529`。这是该 API 角色的可见行数验证，不是材料云函数的完整行响应。

学员按 v5 替换及部署步骤测试 `recipes`，贴出完整集成响应：`statusCode: 200`、`isBase64Encoded: false`，JSON body 为 `ok: true`，包含 recipe-001 至 recipe-005 共 5 道菜、全部 7 个约定字段。做法与说明为数组，简单菜品的 `difficulty_reason` 为 null，两道普通菜品保留原因文字。该次未提供日志或耗时，不预填 SDK 时序、日志版本或运行时间；不把控制台集成响应当作公网 HTTP 验收。

主代理说明下一项是同步并部署材料函数后，学员回复“继续”。本轮仅改 `cloudfunctions/recipe-materials/index.js` 与该函数内 `package.json`，沿用菜品函数已跑通的 CommonClient 4.1.220、固定 anon、每调用平台临时身份、同一完整凭据来源、2 秒 SDK 超时及无重试方案；SDK 类可以复用，但不缓存客户端、凭据或查询结果。材料函数只部署本目录两个文件即可，不依赖相邻 recipes 目录。

材料保留原有 5 字段、显式 SELECT 和 `recipe_id, material_type, position` 排序；`amount` 保持原文字，`position` 转为正安全整数，异常仍返回既有 500 业务错误。诊断标记为 `recipe-materials-diag-v1`，只含阶段、耗时及受控错误码。非 GET 不查库，事件无法替换角色、SQL、环境或运行身份。菜品函数源码、Day 16 数据及已执行的 RLS 脚本不在本轮修改范围。

现有接口测试复用 CommonClient 模拟，检查两个独立云函数的 SDK 请求、运行身份与错误保护；本地测试不能替代材料云函数部署。当时材料函数须由学员创建/更新为普通云函数（Node.js 20.19、index.main），复制本目录两个文件，部署并安装依赖，再用 `{"httpMethod":"GET"}` 测试；目标是 statusCode=200、ok=true、25 条完整材料。后续实际部署及公网结果见第 7.14 节。

本轮实际执行材料函数及接口测试文件的语法检查，均通过；`node --test tests/read-api.test.mjs` 为 189 项通过、0 失败、0 跳过。身份和 SDK 请求均使用替身，没有读取真实凭据、安装 SDK 或请求云数据库。独立源码复核通过，`git diff --check` 无格式错误；Day 16 建表、种子、正式 JSON 和 Day 14 文件的 SHA256 不变。未重新构建前端，未暂存、提交或推送。

### 7.14 板块③｜公网接口与前端发布准备（2026-10-09）

学员提供材料函数完整成功日志：`recipe-materials-diag-v1`，SDK 准备 494 ms、查询调用前 495 ms、API 返回 829 ms，总运行时间 834 ms，statusCode=200、ok=true、25 条材料。随后资源列表没有 `recipe-materials`，仅有默认模板函数 `scf-nodejs-helloworld-u4ds`、`recipes` 和 `health`；按该默认函数复测又取得相同材料正文，总时间 863 ms，API 返回 859 ms。依据学员操作与返回，将材料路由绑定实际资源名，不新建重复函数。请求 ID 分别为 `4d8d0cb5-a8d2-437c-a311-f154348a306c`、`d157694d-732a-4d1b-92cb-e9e7d986506a`。

学员人工创建两条路由，使用既有默认网关域名，路由启用、跨域设置开启，路径透传和身份认证关闭。菜品公网截图可见完整 `/api/recipes` 地址与直接业务正文 ok=true、5 道菜；材料公网正文 ok=true、25 条，材料的五字段、用量文字与整数顺序正确。公网正文已去掉函数集成包装。没有将截图或正文当作已核对 HTTP 状态码的证据。

AI 随后各发起一次无 Cookie、无授权头的公网 GET，`Origin` 为 `https://doraonix-d2g6piooqfa4ba0c9-1500260867.tcloudbaseapp.com`。两条路由实际均返回 HTTP 200，Content-Type 为 application/json; charset=utf-8；Access-Control-Allow-Origin 精确等于上述来源、Vary 为 Origin，Cache-Control 含 no-store。只检查响应头，未保存本轮 HTTP 正文或读取任何凭据。此证据确认网关响应允许网页来源，不替代真实浏览器页面加载；无需为此调整现有允许域名配置。[官方跨域校验](https://docs.cloudbase.net/service/cors)

现有页面适配器分别 GET 两条固定路径，cache=no-store、credentials=omit，没有自定义请求头；每次必须收到两份完整成功响应，才按 recipe_id 对应 recipes.id 合并材料。本轮重新运行 `npm run build` 成功，转换 8 模块，生成 `dist/index.html`、`dist/assets/index-C-03VQmn.css` 与 `dist/assets/index-CxF1pTzp.js`。没有修改前端源码或扩大测试场景；此前自动测试证据保持独立。

准备发布时，本轮修改的跟踪文件仅为 README.md 与本契约，均属 Day 17；dist 为既有忽略的生成目录。当时发布包待学员上传至静态托管 `/next-meal/`；后续实际发布和页面加载结果见第 7.15 节。数据库改行及恢复、作业截图长期保存确认仍待完成；未暂存、提交或推送。

### 7.15 板块③｜新版页面发布与浏览器加载通过（2026-10-09）

控制台应用详情另显示访问域名 `https://next-meal-doraonix-d2g6piooqfa4ba0c9.webapps.tcloudbase.com`。AI 以该 Origin 分别发起两条无 Cookie、无授权头 GET，也得到 HTTP 200 和精确匹配来源的 Access-Control-Allow-Origin。此项只核对接口对该来源的响应头；实际页面截图来自下一段的 tcloudbaseapp.com 地址，不宣称已在 webapps 地址验证页面。

学员在“更新服务”选择文件夹并上传现有 dist，框架为其他，目标与构建产物目录为 `./`，安装、构建命令留空，部署路径为 `/next-meal`。学员粘贴的发布日志显示三份文件被解包到项目根目录，2026-10-09 15:53:12 开始发布，15:53:14 完成；退出码为 0，成功上传 3 个文件。日志中的 Node.js 18.20.8 是发布工具环境，本次直接上传本地构建产物，没有在该环境编译 Vite 源码；不与云函数 Node.js 20.19 混淆。没有保存整份日志或照执行其中的其他工具建议。

AI 使用无缓存请求核对发布后的三份公网文件，全部 HTTP 200，SHA256 与本地 dist 完全一致；不把这一检查当作浏览器执行 JavaScript 的证据：

| 公网 `/next-meal/` 下的文件 | 与本地一致的 SHA256 |
| --- | --- |
| `index.html` | `BDDA429ECC6EB79971E87E796E5476ADF8BDDA11B3654956CE97403D5847FDCC` |
| `assets/index-C-03VQmn.css` | `A47D2D10327E2280320125B573EEC1CE20EB5405EAF3F449C8CDF932442693C4` |
| `assets/index-CxF1pTzp.js` | `9253FB0876583653DC8C54A770DA3350EDDA10107B4529196FC15AE9C54F7A3B` |

学员随后提供带完整地址栏的首页截图，URL 为 `https://doraonix-d2g6piooqfa4ba0c9-1500260867.tcloudbaseapp.com/next-meal/#home`。截图显示来源为云端读接口、本次加载 5 道菜；8 种主要食材及 3 种调料均选中，难度不限，推荐提示“找到 5 道菜”，下方可见番茄炒蛋和青椒土豆丝卡片标题。截图没有展示全部卡片或材料总条数，不据此声称逐条浏览了 25 条材料；页面适配器已完成两条成功响应的合并后才显示加载成功。

至此板块③的两函数、两条公网路由和新版页面部署及加载验证通过。当时只更新 README.md 和本契约两个 Day 17 文件，未改业务代码，也未重复构建或运行模拟测试。板块④当时尚未开始，后续结果见第 7.16 节；本日收尾和提交仍待学员按项目规则推进，截图已收到但未宣称由 AI 保存或长期保留。

### 7.16 板块④｜数据库改名、接口与页面联动及恢复（2026-10-09）

学员回复“进入下一板块”，授权真库联动验证。只读检查先确认 recipes 中 `recipe-001` 的公网名称为“番茄炒蛋”，HTTP 200、ok=true、总数 5、该 ID 仅一行。验证选择 name 字段，不更改主键、材料关联、难度、用量或烹调说明；页面推荐卡片与详情标题直接显示该字段。

由学员在 SQL 编辑器以管理员执行下面的临时更新。WHERE 同时核对唯一 ID 和已确认的原值，避免覆盖其他修改；RETURNING 用于亲眼核对结果，无返回行时停止，不移除保护条件：

```sql
UPDATE public.recipes
SET name = '番茄炒蛋（联动验证）'
WHERE id = 'recipe-001'
  AND name = '番茄炒蛋'
RETURNING id, name;
```

学员按步骤刷新接口和公网页面后回复“都有了”，确认两处变化及取证。AI 随后再次实际 GET 菜品接口，得到 HTTP 200、ok=true、5 道菜，目标名称确实变为“番茄炒蛋（联动验证）”。变化时的页面依据学员确认，不声称 AI 已看到该时刻的截图或浏览器网络日志；本次不重新部署前端或函数。

随后由学员执行有同样原值保护的恢复语句：

```sql
UPDATE public.recipes
SET name = '番茄炒蛋'
WHERE id = 'recipe-001'
  AND name = '番茄炒蛋（联动验证）'
RETURNING id, name;
```

恢复期间学员误打开 localhost:5173，截图为 ERR_CONNECTION_REFUSED。AI 只读检查该端口监听数为 0，同时公网接口已恢复“番茄炒蛋”（HTTP 200、ok=true、5 道菜）。据此指导回公网验证，没有启动本地服务、调整代理、防火墙或重新部署。

学员最终明确回复“恢复完成”，附推荐结果截图；卡片名显示“番茄炒蛋”和“番茄鸡蛋炖豆腐”，临时标记已消失。该截图没有地址栏，恢复后的公网访问由学员确认及实际接口检查支持，不单凭截图推定完整 URL。截图中找到 2 道是该次推荐数量，不作为数据库总数。

板块④联动与恢复验证通过。数据库 name 的临时变化已撤销；没有新增业务写接口，DB 操作由学员人工完成，本地 schema.sql、seed.sql、正式 JSON 和业务代码不变。本轮仅更新 README.md 与本契约两个 Day 17 文件，格式检查通过；未重复运行模拟测试、暂存、提交或推送。当日验收表、最终文件清单及提交仍按 AGENTS.md 第五、六节等待学员推进。

### 7.17 Day 17 收尾核对（2026-10-09）

学员回复“今天做完了”，按已确认的 A 方案验收，不将本项目菜品数据冒充原清单的当日热搜。两条 GET 分别提供 5 道菜、25 条材料，新版公网页面显示来源与菜品，数据库临时改名通过接口和页面联动后已恢复；功能标准通过。变化时页面依据学员确认，恢复及部署时的页面另有截图，保持第 7.15–7.16 节的证据边界。

收尾实际运行根目录 `npm test`：354 项通过，0 失败、0 取消、0 跳过。本次是全部五个既有测试文件的组合验证，身份、网络和 DOM 仍为模拟，真实云端证据另列于前面章节。本轮没有重新构建，因为既有发布包构建与公网字节一致证据已经通过，源码此后未变。

独立只读复核未发现必须修复项：两函数固定 SELECT、anon 角色、字段转换、完整平台临时凭据和受控日志符合约定，事件不能改变查询或身份；两条 RLS 策略仅允许 SELECT。复核未改文件、运行测试或操作云端。

`git diff --check` 通过，计划提交的 14 个 Day 17 文件未发现所扫描的固定凭据特征；此扫描不声称覆盖所有可能秘密。建表、seed.sql、正式 JSON 和 Day 14 USER_TEST.md 的 SHA256 与此前记录一致。USER_TEST.md 属 Day 14，排除；dist 为既有忽略的发布产物，不提交。查询条数参数为选做，本日未实现；未新增业务写入或云端收藏接口。

最终文件清单记录于 README.md，并在回复中逐项列明所属 Day 17。拟提交标题为 `Day 17｜接通菜品读接口并完成真库联动验证`，说明两行为“改了什么：页面改读云端菜品与材料，更新接口契约。”和“加了什么：两条只读 GET、anon SELECT 策略与验证测试。”。此处仅是核对方案，尚未暂存、提交或推送；按 AGENTS.md 第五节，须学员核对文件清单后确认。

学员随后明确回复“确认提交并推送”，授权上述 14 个文件和提交信息。Day 14 USER_TEST.md 及忽略的 dist 继续排除；提交和推送的实际结果以 Git 历史及远端分支为准，不在本记录中预填未发生的结果。
