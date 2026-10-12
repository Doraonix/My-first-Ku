# 下一餐接口契约｜Day 15 / Day 17 / Day 18

Day 15 记录日期：2026-10-04，版本 v0.1。Day 17 更新日期：2026-10-09，版本 v0.14（适配方案 A 的功能验收通过；全项目 354 项测试通过，学员已核对并授权提交、推送 14 个 Day 17 文件，执行结果以 Git 历史及远端分支为准）。

接口契约是调用方和服务方共同遵守的约定：请求发到哪里、怎么发、成功时返回什么。第 1–6 节保留 Day 15 最小健康接口的当时约定与证据；第 7 节新增本次已获授权的 Day 17 菜品及材料读接口，不将新接口的规范套用到健康接口。

Day 18 开始记录日期：2026-10-10，功能续做：2026-10-11，收尾授权：2026-10-12，版本 v0.1。学员选择收藏POST并明确按用户UID归属；三个功能用例真实通过，已确认两图保存并授权7文件提交/推送。图片保存依据用户自述，不冒称201图已由AI核验或作业已提交；Git结果以实际历史和远端main为准。此前504原因未知、未实施源码修复，保留异常记录。

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

## 8. Day 18｜按登录用户 UID 新增收藏

### 8.1 范围与归属

学员选择方案 A，明确“现在开始做 Day 18”；核对 PRD 的首版不登录边界后，又明确选择“按用户 UID”。本日获准增加收藏表、服务端身份核验及部署验证所需的 CloudBase 测试用户/令牌配置；不增加登录页面、不把现有网页收藏改成云端同步，不新增 PATCH、DELETE、批量写入或收藏 GET。读回使用管理员 SELECT，既有两个 GET 与菜品资料保持原样。

普通云函数源码为 `cloudfunctions/favorites/`，入口 `index.main`，Node.js 20.19。学员已在既有 HTTP 网关域名新增 `/api/favorites` 并开启身份认证，函数只处理 POST；网关先执行平台鉴权，函数再核验同一请求的用户令牌以确定记录归属。路由配置与真实 HTTP 201/409/400 调用均已核对，实际验收见第 8.14–8.24 节，不以配置正确代替业务响应证据。

### 8.2 请求及身份验证

```http
POST /api/favorites
Content-Type: application/json
Authorization: Bearer <当前测试用户的access_token>
```

```json
{"recipe_id":"recipe-001"}
```

请求只允许 `recipe_id`，其值为 1–64 个 ASCII 字母、数字、下划线或连字符；不自动修剪编号。`user_id`、SQL、角色、环境、时间或数组等额外字段全部拒绝。JSON body 上限为 1024 UTF-8 字节，支持网关字符串、标准 base64 JSON 和控制台对象 body。函数校验顺序为方法、请求体、Bearer 格式、身份、单句 SQL；请求体不合格时不会调用认证或数据库。

每次以当前 access_token 调用固定官方 `GET /auth/v1/token/introspect`，显式指定默认环境 `client_id`，仅接受 Bearer 类型、与本环境匹配的 client_id 和合法非空 sub；sub 作为 user_id，1–128 个 ASCII 字母、数字、下划线或连字符。空对象、无效类型或不匹配身份返回 401；网络/服务/解析故障返回 503，均不写库。不解析未验签 JWT，不信任 body、query、context 或遗留环境变量中的 UID，也不缓存 token/UID。认证请求禁止重定向、禁缓存，限时 1000 ms。[验证 token](https://docs.cloudbase.net/http-api/auth/auth-token-introspect)、[国内 HTTP API 地址](https://docs.cloudbase.net/http-api/basic/overview)

本期只接受默认环境客户端的用户 access_token，不把 API Key、Publishable Key 或控制台主账号登录当作应用用户身份。测试用户已由学员手动创建并完成登录与有效 token 核验，后续失效须重新登录；代码、文档、自定义诊断日志和提交中不保存真实 token、密码或密钥。平台拒绝请求时函数未执行，响应可能是平台格式；中文缺字段测试已使用有效凭证到达该函数并取得真实 400。

### 8.3 收藏表与写入方式

新增准备脚本 `db/day18-favorites.sql`；不修改 Day 16 建表、seed 或 Day 17 策略。管理员按脚本编号一次一条执行，先核对新表不存在、已有 service_role 可切换、具备 BYPASSRLS、public USAGE 和 recipes SELECT，再创建表；任何错误或非预期结果立即停止，不覆盖既有表或改其他角色。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| user_id | text | 官方验证得到的用户 UID，不由请求体提供。 |
| recipe_id | text | 指向 recipes.id，删除/更新关联键采用 RESTRICT。 |
| created_at | timestamptz | 数据库 CURRENT_TIMESTAMP 生成的时间。 |

`PRIMARY KEY (user_id, recipe_id)` 防止同一用户重复收藏，同菜可分别属于不同用户。表启用 RLS，无公开收藏策略；清除新表对 PUBLIC、anon、authenticated、service_role 的直接默认授权后，仅给内部 service_role SELECT/INSERT。它是已有的高权限、绕过 RLS 的身份，归属依赖本函数验证和固定 SQL；不将该角色交给浏览器。脚本另逐项核对有效权限，若继承权限导致结果不符先停止，不能宣称 REVOKE 已消除所有权限。

一次固定 SQL 的 CTE 查询目标菜品，再 INSERT 单行并 `ON CONFLICT (user_id, recipe_id) DO NOTHING`，仅从已插入行 RETURNING；不会先查收藏再写、不会 UPDATE 旧收藏时间。结果区分 created、duplicate、recipe_not_found。两项数据只在严格 ASCII 标识校验后进入固定语句，不允许调用者提供 SQL/表名/角色。成功解码还需核对 UID、菜品与有效 UTC 毫秒时间。[PG17 INSERT/冲突与 RETURNING](https://www.postgresql.org/docs/17/sql-insert.html)

写库沿用 CommonClient 4.1.220 和平台当次完整临时凭据，固定 Role=service_role；只复用 SDK 类，每次新建客户端，SDK 请求限时 1 秒，无自动重试。认证和 SQL 的两处限时不保证总执行一定小于免费函数 3 秒，冷启动/真实网络仍须部署实测。SQL 调用后若超时或解码异常，写入状态可能不确定，应读库核对；不能把所有 500 都说成数据库未变。

### 8.4 成功与错误响应

正常新增为 HTTP **201**，正文形状如下；UID、时间为示例，不是实际登录或写入证据：

```json
{
  "ok": true,
  "data": {
    "user_id": "TEST_USER_A",
    "recipe_id": "recipe-001",
    "created_at": "2026-10-10T08:00:00.000Z"
  }
}
```

`user_id` 与已验 UID 相同，`recipe_id` 与本次请求相同；`created_at` 为数据库时间转成的 ISO UTC 毫秒字符串，不接收客户端自填时间。函数返回与 Day 17 同样的 HTTP 集成包装，公网正文应只包含上述业务 JSON。

统一错误正文为 `{ "ok": false, "error": { "code": "...", "message": "中文提示" } }`：

| HTTP | code | 中文 message |
| --- | --- | --- |
| 400 | RECIPE_ID_REQUIRED | 请填写菜品编号 recipe_id。 |
| 400 | RECIPE_ID_INVALID | 菜品编号格式不正确。 |
| 400 | UNEXPECTED_FIELDS | 请求只允许 recipe_id 字段。 |
| 400 | INVALID_JSON | 请求内容不是有效的 JSON。 |
| 400 | INVALID_BODY | 请求内容必须是单条收藏对象。 |
| 401 | AUTH_REQUIRED | 请先登录后再收藏。 |
| 401 | AUTH_INVALID | 登录状态无效或已过期，请重新登录。 |
| 404 | RECIPE_NOT_FOUND | 这道菜不存在，无法收藏。 |
| 405 | METHOD_NOT_ALLOWED | 只支持 POST 请求。 |
| 409 | FAVORITE_EXISTS | 你已经收藏过这道菜，请勿重复提交。 |
| 413 | BODY_TOO_LARGE | 请求内容过长。 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 请使用 application/json 请求。 |
| 500 | FAVORITE_WRITE_FAILED | 暂时无法保存收藏，请稍后重试。 |
| 503 | AUTH_UNAVAILABLE | 暂时无法验证登录状态，请稍后重试。 |

响应头统一 JSON UTF-8、Cache-Control=no-store，405 另带 Allow=POST。重复为拒绝，不返回第二次成功，也不增加行；缺字段/身份失败在执行 SQL 前结束。日志 `favorites-diag-v1` 仅阶段、累计毫秒和受控错误码，不含 token、UID、SQL、请求、上下文或原始异常；api_return 表示 SDK 返回，不等同于业务新增成功。

### 8.5 板块①验证与待完成项（2026-10-10）

函数与测试文件语法检查通过。新增收藏测试先 40 项通过，补充网关 base64 JSON 边界后为 41 项；完整 `npm test` 实际 395 项通过，0 失败、0 跳过。覆盖串行/并发同用户重复仅模拟新增一行、不同用户同菜分别新增、缺字段/批量/伪造 UID/认证失败零 SQL、固定官方验证地址、token/UID 不缓存、每调用平台凭据、原始列行解码及敏感异常不泄漏。全部 UID、凭据、HTTP 和 SQL 为合成/模拟；没有安装 SDK、拿真实 token、执行真实 POST 或建表。

独立只读复核未发现必须修复项；板块①时 SQL 脚本只作静态复核，未实际执行。当前 7 个文件均属 Day 18：两份函数文件、新收藏表脚本、收藏接口测试、根 package.json、README.md 与本契约。既有读函数、前端、本地收藏、schema.sql、seed.sql 和正式 JSON 不改；未重新构建前端、暂存、提交或推送。板块①结束时，建表/测试身份配置/部署及板块③真实验收均待学员进入下一板块后推进；后续进度见下节。

### 8.6 板块②数据库准备的实际结果（2026-10-10）

学员回复“进入下一板块”后人工操作控制台；创建前查询确认 favorites 不存在，已有 service_role 的 BYPASSRLS、API 账号可 SET、public USAGE 与 recipes SELECT 均为 true。随后学员依次创建表、开启 RLS、REVOKE 新表直接权限、GRANT SELECT/INSERT，均回传执行成功；没有修改旧表、创建角色或授予角色成员资格。

有效权限查询返回：anon、authenticated、public 对 favorites 的 SELECT/INSERT/UPDATE/DELETE 均为 false；service_role 为 true/true/false/false。后续结构查询返回 RLS=true、policies_count=0、row_count=0、PRIMARY KEY (user_id, recipe_id)，以及 recipe_id REFERENCES recipes(id) ON UPDATE RESTRICT ON DELETE RESTRICT。这些是学员提供的真实控制台查询结果，不是本地模拟，也不代表其他表或整个角色的权限已被缩减。

数据库准备已核对，尚未写入收藏。该核对时测试用户/有效用户 token、云函数 favorites 与新路由尚待人工配置，不能宣称 POST 已部署或通过真实验收；板块③的一次新增、重复拒绝、中文必填拒绝、SELECT 读回和两张截图仍待完成。AI 仅记录进度，未代为执行云端 SQL、取得凭据或提交推送。

### 8.7 板块②测试用户配置进度（2026-10-10）

学员提供的登录方式截图显示用户名密码已启用、匿名登录关闭。用户管理原来只有 administrator；学员另建 day18_test，创建后的列表显示共 2 个用户、新用户已激活并有系统生成的用户 ID，最后登录时间为空。没有要求授予测试用户管理员权限；截图不作为已核对角色策略或成功登录的证据。

后续指引是由学员手动调用固定环境 `POST /auth/v1/signin`，JSON 仅 username/password，client_id 放查询参数并固定为默认环境 ID；成功返回的 sub 应与新用户 ID 相同。密码通过 PowerShell 隐藏输入，access_token 只留本地会话内存，只显示 UID、has_access_token 和 expires_in，不要求提交密码或完整 token。[官方用户登录接口](https://docs.cloudbase.net/http-api/auth/auth-sign-in)

学员随后回传一次真实登录输出：sub/UID 与新用户列表的用户 ID 一致、has_access_token=True、expires_in=7200（2 小时）。只取得这些非凭据的摘要，没有收到完整 token 或密码；不将登录成功当作云函数鉴权或写库成功。消息还包含第二次清空变量并重跑脚本的过程，未见该次最终返回，当前终端变量是否仍有 token 需在后续请求前核对。

登录小步结束时云函数与路由仍未部署，真实收藏写入未开始。只更新两份进度文档，未修改业务代码、测试、前端或旧表，未提交推送。

### 8.8 板块②普通云函数创建进度（2026-10-10）

学员人工选择普通 Node.js Hello World 模板并设置函数名 favorites；创建前配置截图确认普通云函数、Node.js 20.19、index.main，创建后详情截图显示同一目标环境下 favorites 状态正常、模板 $LATEST 与已部署代码一致。未将模板创建当作收藏代码部署或 HTTP 验收成功。

后续先核对部署下拉中的依赖安装和自动部署状态，再只替换云端 favorites 函数内部的 index.js、package.json，对应本地 cloudfunctions/favorites/ 两文件；不是项目根 package.json，也不替换其他函数。代码、版本和依赖沿用板块①已验证实现，本轮未修改；两文件完整保存后需安装依赖并部署。该创建小步结束时未收到替换/业务部署结果，路由尚未创建、收藏写入未开始。

### 8.9 板块②收藏代码部署确认与路由待办（2026-10-10）

学员提供的下拉截图仅显示“部署且不安装依赖”；指引是两份函数文件完整替换保存后点击“部署”主按钮，不选择跳过依赖，安装精确版本 tencentcloud-sdk-nodejs-common 4.1.220。该截图未展示自动部署设置，不将它记为该开关已验证。学员随后回复“成功”，按人工确认记录代码部署成功；尚未收到新版部署截图、安装日志或业务返回，不能宣称认证、SDK 真调用或写库已通过。

下一小步为既有 HTTP 网关默认域名下新增 /api/favorites，关联 favorites 普通云函数；路由启用、身份认证开启、跨域开启、路径透传关闭。只改新路由，不改旧三条读路由、域名或全局跨域设置；新测试用户的实际资源访问策略尚待调用验证，不提前扩大匿名访问。[网关路由配置](https://docs.cloudbase.net/service/quick-start)、[HTTP 身份认证与 Bearer 用户 token](https://docs.cloudbase.net/service/authentication)

该部署小步结束时路由仍未创建核对，板块③的一次真实写入、重复及中文缺字段拒绝、数据库读回和两张截图仍未开始；只记录两份文档，未修改业务代码、测试或前端，未提交推送。

### 8.10 板块②路由配置核对与结束（2026-10-10）

学员首次配置弹窗路径为 /，保存前已指出并回传改成 /api/favorites 的字段截图；随后人工确认保存。最终列表截图显示默认域名 doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com 下 /api/favorites 关联 favorites 云函数，路由、跨域、身份认证开启，路径透传关闭、限额未设置，更新时间为 2026-10-10 23:32:59。没有证据表明曾保存 / 根路由，不记录未发生的删除或回退。

配置地址为 `https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com/api/favorites`。同图旧三条读路由及关联资源、开关与 Day 17 一致，仅作配置核对，不声称本轮已实际请求回归或验证 CORS 响应。

板块②部署配置完成，但新版云端 SDK 安装/加载、运行时凭据、测试用户实际调用权限和身份核验均未由真实收藏调用验证；此前登录成功也不保证当前 token 仍有效。正常 POST 201、数据库新增一行及读回、重复 409、缺字段 400 中文提示和两张截图均留在板块③，未提前发业务请求。本轮仅记录两份文档、格式检查通过，未改业务代码、运行模拟测试、构建、暂存或提交推送；按项目规则停下等待学员“进入下一板块”。

### 8.11 板块③真实验证开始（2026-10-10）

学员已明确回复“进入下一板块”。第一小步是由学员在原本地 PowerShell 会话手动 GET 固定环境 /auth/v1/token/introspect，client_id 固定为默认环境 ID，Authorization 使用会话内用户 token；核对 Bearer、client_id 和字符串 sub 与测试用户一致。指引仅显示验证布尔值，不输出 token、完整身份响应或原始异常，不写文件。缺失/失效/错误/不匹配时停下，不自动重试或发送收藏 POST。

学员回传当前 PowerShell 实际输出 TOKEN_MISSING；变量为空，代码未发起 introspect，也未发送收藏 POST。不将会话内缺凭据误记为远端 token 失效或接口故障。解释当前窗口没有保留此前变量后，学员明确授权重新登录。

后续合并指引为一次人工 signin 后立即 introspect：固定 HTTPS 地址、query client_id、限时 20 秒、禁止重定向、ErrorAction Stop；登录和验证均检查字符串类型与测试 UID，核验默认 client_id/Bearer，失败清空放行标志、token、UID，临时凭据/JSON/响应变量在 finally 清空。仅打印四个布尔值或阶段/HTTP 状态，不要求提供密码或完整令牌，不自动重试或继续收藏 POST。AI 仅用 PowerShell AST 解析该文本，0 语法错误、未执行或请求网络；指引发出时实际合并登录结果待学员回传，后续结果见第 8.12 节。

正常单条 POST、真实新增/读回、重复及缺字段拒绝、两张作业截图均未执行。本轮仅记录两份文档，未改业务代码、运行模拟测试、构建或提交推送。

### 8.12 板块③当前身份核验与写入前基线（2026-10-10）

学员回传当前会话合并登录/核验的实际结果：valid=True、user_matches=True、client_matches=True、bearer_type=True。按先前指引，这确认用户 token 经官方 introspect 验证，字符串 UID 与测试用户匹配、client_id 是默认环境、类型为 Bearer；不扩大为收藏路由授权、SDK 调用或 SQL 成功的证据，也不保证之后一直有效。

学员随后在管理员角色执行只读 SELECT，并提供实际结果截图：favorites_before=0、target_before=0。两项分别为 favorites 总行数和测试用户/recipe-001 组合行数，用作本次新增前基线；未删除、覆盖或更改归属。此时未发收藏 POST、未写库，仅记录两份文档，未改业务代码、运行模拟测试、构建或提交推送。

### 8.13 板块③首次正常 POST 指引（2026-10-10）

基线 0/0 核对后，指引学员在同一 PowerShell 会话先检查 AuthReady 为布尔 True、UID 为已核验测试用户、token 为非空字符串，再手动向已配置 HTTPS /api/favorites 发送一次 POST，JSON 仅 recipe_id=recipe-001；不传客户端 UID，不自动重试。请求使用 UseBasicParsing、ErrorAction Stop、20 秒超时、禁止重定向，兼容 Windows PowerShell，不使用 PowerShell 7 专属参数。

成功先核对根对象仅 ok/data、data 仅 user_id/recipe_id/created_at 三字段，类型及用户/菜品匹配，再显示 HTTP 状态与同形业务 JSON；不打印未知响应或请求头，避免意外旧模板回显整个 event，也不将忽略额外字段的投影当作契约对齐证据。非 2xx/网络/解析异常只给安全状态并停下；超时、5xx 或解析失败可能已写入，必须先 SELECT 读回，不能盲重发。指引 AST 为 0 错误，并在原生 Windows PowerShell 5.1.22621.6133 用合成 JSON/替身验证，created_at 仍为字符串、替身一次调用、成功 DTO/201 可解码；没有真实网络请求，不将替身数据当作云端结果。指引发出时尚无真实正常 POST 返回，201/ok=true 仅为预期，后续结果见第 8.14 节。仅更新两份文档，未改业务代码、重跑项目模拟测试、构建或提交推送。

### 8.14 板块③首次正常 POST 返回与数据库读回待办（2026-10-11）

学员提供单次真实请求的终端返回 HTTP:201，正文 ok=true，data 三字段 user_id/recipe_id/created_at。UID 与测试用户一致、recipe_id 为 recipe-001、created_at 为 2026-10-10T16:07:55.192Z。该命令核对原响应字段数与值后以同形 JSON 显示，不是模拟 HTTP 或手填成功样例；未收到完整 token、请求头或原始异常。当前证明正常响应满足契约，但尚不单独作为数据库增量核对。

该 UTC 时间对应 UTC+8 本地 2026-10-11 00:07:55.192。读回指引使用与函数相同 to_char/UTC/MS 格式，比较到毫秒；不称它与原生数据库时间的全部微秒精度相同。后续指引由学员管理员 SELECT 实际目标行及全表/目标行数，预期从写前 0/0 变成 1/1、UID/菜品/UTC 毫秒时间一致；当时查询尚待回传，不能用 API 返回代替真实 SELECT。

正常 POST 截图已提示保存，该小步结束时仅收到文本、未收到截图或保存确认；数据库新增行截图、重复拒绝和缺字段中文拒绝当时仍待完成。只更新两份记录文档，未改业务代码、发起或重发请求、执行云端 SQL、重跑项目测试、构建或提交推送。

### 8.15 板块③正常新增读回与重复验证待办（2026-10-11）

学员回传实际管理员查询截图：table_name 标签为 public.favorites，UID 与测试用户一致、recipe_id=recipe-001，favorites_after=1、target_after=1。与新增前 0/0 及单次真实 POST 201 对照，正常新增一行和读回通过。该截图只显示时间 2026-10-10 16:07:55+00，能核对同秒 UTC 时间，不能宣称 .192 毫秒已展示或一致，也不凭截图诊断原因；后续只读查询会用 UTC= 文本前缀补充完整毫秒呈现，不修改数据。

本次已看到数据库新增行图，但未取得已保存或提交确认；正常 POST 图仍仅有文本证据，不声称 AI 已保存或完成作业提交。接下来只指引学员在同一会话重复一次相同 POST，不传客户端 UID、不清首次 DTO、不自动重试；仅 HTTP 409 与精确契约形状、FAVORITE_EXISTS、固定中文 message 均匹配时记为重复被拒，之后还需 SELECT 核对行数和创建时间不变。

指引非 2xx 使用 ErrorDetails.Message 作 JSON 候选，缺失/解析失败时本地读取 UTF-8 响应流，不新增请求；不打印原始异常、HTML、token 或未知响应。原生 Windows PowerShell 5.1 替身验证 0 语法错误、一次调用/409 可解析、身份 guard 零新增调用、首次 DTO 保留，无真实网络请求。指引发出时实际重复返回及缺字段中文拒绝待学员执行回传；仅记录两份文档，未改业务代码、请求云端/执行 SQL、重跑项目测试、构建或提交推送。

### 8.16 板块③重复请求 504 与只读诊断待办（2026-10-11）

学员实际重复请求输出 HTTP:504，正文未通过预期 409/FAVORITE_EXISTS/中文提示核对，原始内容未显示。重复拒绝仍未通过，不能以模拟 409 冒充真实结果。504 属网关等待后端超时，但此时无函数日志，具体是否 SCF 3 秒时限、认证/SDK/SQL 阶段等尚不能定论，亦不推定数据库已变或未变。

此处不重发、不开启付费超时、不改函数、依赖、角色或表。先指引学员管理员只读 SELECT 当前全表/目标行数及 UTC= 前缀的完整毫秒时间，与首次返回比较，再看该次 favorites-diag-v1 日志定位；该小步结束时未收到这次读回或日志。缺字段用例未开始，截图保存/提交仍待确认。仅更新两份记录文档，未改业务代码、请求云端/执行 SQL、重跑项目测试、构建或提交推送。

### 8.17 板块③504 后数据库状态与日志待办（2026-10-11）

学员回传真实只读查询截图：目标 UID/recipe-001 仍为同一行，favorites_now=1、target_now=1、time_evidence=UTC=2026-10-10T16:07:55.192Z。与首次 201 的时间核对到毫秒完全一致，也补齐前图未显示 .192 的证据；不称为全部微秒精度相等。该查询快照证明 504 后未多出记录、原创建时间的毫秒值不变，不替代 HTTP 409 的实际拒绝响应，也不保证未来状态。

下一小步只由学员查询 favorites 的该次调用日志，用 RequestId 区分首次成功与本次 504；仅提供受控阶段和安全平台行，不要求完整事件/上下文/请求头/密钥或 token。若无对应记录先报告，不重发制造日志。该读回小步结束时未取得日志，不判定超时具体原因，不提出已实施的修复；仅更新两份文档，未改业务代码、配置、权限或数据，不请求云端/执行 SQL、重跑项目测试、构建或提交推送。

### 8.18 板块③旧日志未找到与带日志诊断提议（2026-10-11）

学员报告该次日志找不到、日志功能刚由自己开启；没有配置截图或新日志返回，因此尚未验证采集生效，AI 未代开启或修改日志服务。官方资料说明日志采集/投递、主题和检索配置，未保证新开启能补回此前未采集日志；也不据此断言所有历史永久不存在。若此前主题曾保留日志，可只读核对函数、地域、版本、时间范围；监控的调用/错误/耗时汇总不等于该次逐阶段轨迹。[日志投递说明](https://cloud.tencent.com/document/product/583/52644)、[CloudBase 监控](https://docs.cloudbase.net/cloud-function/debugging/monitor)

观测条件已改变，提议学员明确同意后仅一次同 UID/recipe-001 的受控重复诊断，记本地时间、查新 RequestId，再只读核对；不自动循环、不新增用户/菜品、不改变代码、超时、权限或表，不升级套餐/新增其他付费资源，不保证调用和既有日志存储绝对免费。该提议小步结束时停下等待同意，未提供执行指令、发请求或修复；只更新两份记录文档，未重跑项目测试、构建或提交推送。

### 8.19 板块③一次带日志诊断授权与指引（2026-10-11）

学员明确回复“带日志重测一次”。指引仅对同已验证 UID/recipe-001 人工发一次重复请求，身份 guard 完成后、实际 IWR 前设置当前 PowerShell 全局尝试标志；之后成功、失败、超时均不重置，防同窗口重复粘贴。缺身份时不发请求；此本地标志不是跨窗口控制或服务器幂等机制，也不保证请求一定已抵达服务器。

显示 DateTimeOffset 转 UTC+8 的起止时间与 Stopwatch 客户端总耗时，供日志时间范围定位，不等于函数内部耗时；继续严格验证 409 的契约与中文消息、保护首次 DTO，不打印凭据或未知原文。原生 Windows PowerShell 5.1 替身验证 0 语法错误、首次 1 调用、再次粘贴 0 新调用、标志/首次 DTO 保留，未真实发网络请求。

该指引小步结束时人工重测结果和新日志未返回；不顺带进行缺字段测试，不改代码、配置、超时、角色、表或套餐、不自动循环。当时正常新增读回已通过，重复和缺字段验收未完成；只更新两份文档，未重跑项目测试、构建或提交推送。

### 8.20 板块③唯一带日志诊断取得 409（2026-10-11）

学员回传已授权单次实际请求：HTTP:409，ok=false，error 两字段 code=FAVORITE_EXISTS、message=你已经收藏过这道菜，请勿重复提交。先前指引严格核对原错误形状后显示同形 JSON，当前重复拒绝响应通过；未将模拟结果或自填文案当作实际返回。

客户端 UTC+8 窗口为 2026-10-11 00:38:38.877–00:38:40.847，Stopwatch=1968 ms，不是云函数内部执行耗时。未实施代码/超时修复，新的成功不能反推旧 504 原因或声称旧问题已消除。下一小步仅按 favorites、本地 00:38:30–00:39:00 找新 RequestId 日志；若界面 UTC，则窗口为 2026-10-10 16:38:30–16:39:00。不再发请求。

该响应小步结束时新日志、这次 409 后行数/创建时间不变的读回尚待提供，之前 504 后查询是当时最后数据库状态证据；缺字段中文拒绝未开始，作业截图保存/提交待确认。仅更新两份文档，未改源码/配置、请求云端/执行 SQL、重跑项目测试、构建或提交推送。

### 8.21 板块③新调用日志确认（2026-10-11）

学员提供完整安全日志与控制台截图，favorites/$LATEST，RequestId=0bcba4c3-c4c9-11f1-ba0a-5254008bd148，调用时间00:38:39–00:38:40落在客户端诊断窗口内。阶段 elapsed_ms 为 entry0、auth_start1、auth_ready301、sdk_ready/api_call_start1101、api_return1250；Report Duration1252ms、256MB、峰值46.773438MB。认证区间约300ms，SDK准备区间约800ms（含加载、凭据处理、构造），API等待区间约149ms；它们不是独立精确的网络/数据库服务耗时。

RetMsg 的业务 statusCode409、ok=false、FAVORITE_EXISTS/固定中文提示与客户端一致；平台日志 status_code200表明函数执行正常结束，不是业务 HTTP200。另有 Coldstart76ms（InitRuntime10、InitFunction66）；内部1252ms、冷启动指标与客户端1968ms不混同或随意相加。此日志确认当前新请求被采集并正确拒绝，不能追溯证明旧504原因、已修复或全局稳定性，未实施任何源码/配置优化。

后续指引仅管理员 SELECT 核对此次409后行数仍1/1与首次UTC毫秒创建时间未变；该日志小步结束时未取得新读回，缺字段中文用例未开始。只更新两份文档，不改业务代码、不请求云端/执行SQL、不重跑项目测试、构建或提交推送。

### 8.22 板块③重复闭环通过与缺字段指引（2026-10-11）

学员回传409之后的真实查询截图：favorites_now=1、target_now=1、time_evidence=UTC=2026-10-10T16:07:55.192Z。与实际409/FAVORITE_EXISTS/中文提示及其RequestId日志对照，重复拒绝和数据不增行、不变毫秒时间的闭环通过；保留早先504与原因未知记录，不声称已实施修复或稳定性保证。

下一小步仅一次body={}缺必填recipe_id请求，仍使用同一会话已核验用户凭证，通过独立global尝试标志防重复，不重置诊断标志或首次DTO。仅HTTP400+精确ok=false/error形状+RECIPE_ID_REQUIRED+请填写菜品编号 recipe_id。匹配时算通过，401/504等不替代此用例；未知原文隐藏、不自动重试。函数本地实现先校验body，此用例预期不进入身份/SQL阶段，但不能用源码预测代替真实返回。

指引原生Windows PowerShell5.1替身验证0语法错误、一次空对象调用、再次执行0新调用、正确400正文可核对、旧标志/首次DTO保留，无真实网络请求。该指引小步结束时缺字段实际返回、最终数据不变及作业图保存确认待学员执行；只更新两份记录文档，不改代码/配置/权限/表、不请求云端或执行SQL、不重跑项目测试、构建或提交推送。

### 8.23 板块③缺必填真实400与最终读回待办（2026-10-11）

学员回传空对象请求的实际输出HTTP:400，ok=false，error两字段为RECIPE_ID_REQUIRED和请填写菜品编号 recipe_id。指引已严格核对响应形状与固定中文后显示，缺必填拒绝响应通过；不以源码或本地替身替代实际HTTP证据。

后续指引仅管理员SELECT最终总/目标行数与UTC毫秒创建时间，预期仍1/1、UTC=2026-10-10T16:07:55.192Z；该响应小步结束时400后查询尚待回传，不提前认定已核对数据不变，不再发业务请求。正常201作业图当时仍仅有文本返回、未收到图片或保存确认，数据库新增行图已见但未确认另行保存/提交；最终读回后再核对两图，不开始Git收尾或下一天。用户“继续”只推进当前板块，不能代替日终文件清单确认。仅更新两份文档，不改代码/配置/权限/表、不请求云端或执行SQL、不重跑项目测试、构建或提交推送。

### 8.24 板块③功能验证完成与截图暂停点（2026-10-11）

学员回传400之后最终实际查询截图：favorites_now=1、target_now=1、time_evidence=UTC=2026-10-10T16:07:55.192Z。与缺必填的真实400/RECIPE_ID_REQUIRED/中文提示对照，确认该次没有增加行或改变原创建时间的毫秒值。

三个功能用例均有真实证据：正常201/三字段契约/0→1及读回；重复409/FAVORITE_EXISTS/中文提示/对应日志及1/1时间未变；空对象400/RECIPE_ID_REQUIRED/中文提示及最终1/1时间未变。不实现PATCH/DELETE/批量、登录页面或迁移前端本地收藏。旧504原因未查明，保留异常与后续仅一次授权重测记录，不称为已修复、永久消除或整体稳定性保证。

功能验证结束，不再发送请求；两张作业图当时仍待保存确认：首次201的JSON只有文本证据，数据库实际新增行图已看到表名、UID、菜品、时间，但未确认另行保存/提交。纯行数截图不能替代新增行作业图，不重新POST或删除重建记录来制造截图。该功能小步结束时停下等截图确认和用户“今天做完了”，之后才日终核对文件/day清单等待授权。仅更新两份文档，未改代码/配置/权限/表、不请求云端或执行SQL、不重跑项目测试、构建、暂存或提交推送。

### 8.25 Day18日终核对与提交暂停点（2026-10-11）

学员已说“今天做完了”。该2026-10-11核对时正常201/契约三字段/数据库0→1与读回、重复409/中文/日志与不增行不改时间、缺字段400/中文与最终不变均为已完成；旧504原因未知仍保留，不称已修复。当时两图保存为部分完成：新增行图已见、正常201只有文本，两图另行保存/提交未明确确认；Git提交推送未完成，等待最终7文件范围确认。后续授权见第8.26节。

本次7文件全部Day18：cloudfunctions/favorites/index.js、同目录package.json、db/day18-favorites.sql、tests/favorites-api.test.mjs、根package.json、README.md、本契约；用途及标准表见README日终节。USER_TEST.md属Day14不提交，Day16 schema/seed/正式菜品、既有读函数与前端不改。实际暂存区空，受保护4文件SHA256不变；7文件密钥/JWT/DB-URL字面模式扫描无匹配，不作绝对检测保证。只将SQL脚本开头“尚未执行”改为板块①历史说明并指向实际结果，SQL语句不动。

沿用已执行395项全项目模拟测试记录，业务源码/测试/依赖此后未改，不重复测试或构建；本轮格式检查通过。拟标题Day 18｜完成按用户UID收藏写入与真库验证，说明两行为“改了什么：扩展收藏接口契约和测试命令，记录真实写入与拒绝验收。”及“加了什么：UID收藏表、POST云函数、防重复和必填中文校验。”。该核对小步只是拟提交清单，未git add/commit/push；先等两图保存确认和7文件授权，不开始下一天。

### 8.26 截图保存与7文件提交授权（2026-10-12）

学员明确回复“两张已保存，确认提交这7个文件”，确认保存并授权此前7文件提交/推送。保存依据自述，AI已见数据库行图但未见201图片，不称代保存、201图片已核验或作业已发群。源码/测试/依赖不变，三个真实功能闭环及旧504未知原因保留，不重发请求或改表/权限/超时。

执行前核对main、Day17 HEAD、既有origin与空暂存区，文件范围仍是第8.25节的7个Day18文件；USER_TEST.md和Day16资料保留原样，受保护4文件SHA256不变，有限秘密字面模式扫描未匹配，沿用395项模拟测试不重复跑。按确认标题和两行说明精确暂存、检查后提交推送；此处只记录授权与执行前状态，不提前写Git成功，实际结果以Git历史和远端main为准。完成后停下，不开始下一天。
