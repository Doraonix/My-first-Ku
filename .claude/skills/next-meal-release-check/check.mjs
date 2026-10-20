// Day 25：下一餐发布前检查。只读：只发 GET 请求，不登录、不访问收藏接口；
// 正式构建只写到系统临时目录，检查结束后删除本次创建的那个目录。
// 只有五项全部通过才是“可以发布”（退出码 0）；任何一项失败、出错或没跑成都是“不可发布”（退出码 1）；
// 脚本自身出错也是“不可发布”（退出码 2）。

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FRONTEND_ORIGIN = "https://doraonix-d2g6piooqfa4ba0c9-1500260867.tcloudbaseapp.com";
const FRONTEND_URL = FRONTEND_ORIGIN + "/next-meal/";
// 网页实际读取的两个接口要求允许首页跨域；health 网页不调用，只查返回值。
const API_CHECKS = [
  { path: "/api/health", needsCors: false },
  { path: "/api/recipes", needsCors: true },
  { path: "/api/recipe-materials", needsCors: true },
];
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const COMMAND_TIMEOUT_MS = 5 * 60_000;
const MAX_LISTED = 20;
const TEMP_PREFIX = "next-meal-release-check-";
const IS_WINDOWS = process.platform === "win32";
// 读差异时固定这些设置，不受本机 Git 配置影响：中文文件名不转义、空行照常带前缀、文件名前缀固定为 a/ b/；
// --text 让 UTF-16 和二进制文件也按文字列出差异，不显示成 “Binary files differ”。
const GIT_DIFF_CONFIG = ["-c", "core.quotepath=false", "-c", "diff.suppressBlankEmpty=false"];
const GIT_PATCH_FLAGS = ["-p", "--text", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];

// 只写规则，不写任何真实或示例密钥；命中时只报位置和长度，不显示内容。
const SECRET_RULES = [
  { name: "腾讯云 SecretId", patterns: [/AKID[0-9A-Za-z]{16,}/g] },
  {
    name: "SecretKey / SessionToken 的具体值",
    patterns: [
      // 赋值、JSON（含转义引号）、YAML、$env: 写法
      /(?:secret[_-]?key|session[_-]?token)\\?["']?\s*[:=]\s*\\?["']?[A-Za-z0-9+/=_-]{16,}/gi,
      // setx 名字 值
      /\bsetx\s+\S*(?:secret[_-]?key|session[_-]?token)\s+["']?[A-Za-z0-9+/=_-]{16,}/gi,
      // [Environment]::SetEnvironmentVariable("名字", "值")
      /SetEnvironmentVariable\(\s*["'][^"']*(?:secret[_-]?key|session[_-]?token)["']\s*,\s*["'][A-Za-z0-9+/=_-]{16,}/gi,
    ],
  },
  { name: "私钥文件头", patterns: [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g] },
  // 只从一串字符的开头起找，超长的一行也不会反复回溯卡住。
  { name: "登录令牌（JWT）", patterns: [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g] },
  { name: "带密码的数据库连接串", patterns: [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/'"]+:[^\s@/'"]+@/gi] },
  {
    name: "写死的密码",
    // 名字前不要求单词边界，DB_PASSWORD、PGPASSWORD、dbPassword 也算；值可以加引号（含转义引号的 JSON）、
    // 紧跟 = 不加引号（以 $ % { < 开头的变量除外），或像 SQL 那样写成 PASSWORD '值'。
    patterns: [/(?:password|passwd|pwd)\b(?:\\?["']?\s*[:=]\s*\\?["'][^"'\s]{4,}["']|=(?![$%{<])[^\s"'&;]{4,}|\s+'[^'\s]{4,}')/gi],
  },
];

const CHECKS = [
  { id: 1, name: "公网首页", run: checkFrontend },
  { id: 2, name: "公网读接口", run: checkApis },
  { id: 3, name: "密钥", run: checkSecrets },
  { id: 4, name: "自动测试", run: checkTests },
  { id: 5, name: "正式构建", run: checkBuild },
];
// 密钥要扫描构建产物，所以先构建、最后扫密钥；报告仍按 1–5 排列。
const RUN_ORDER = [1, 2, 4, 5, 3];

const build = { base: null, dir: null, files: [], passed: false };

async function main() {
  // 没走到结论行就结束时，退出码保持 2（不可发布），不会默认成 0。
  process.exitCode = 2;
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  if (pkg.name !== "my-first-ku") throw new Error("脚本不在“下一餐”项目里（package.json 的 name 不是 my-first-ku）");

  console.log("下一餐｜发布前检查（next-meal-release-check）");
  console.log(`项目：${ROOT}`);
  console.log(`时间：${new Date().toLocaleString("zh-CN", { hour12: false })}（本机时间）`);
  console.log(`当前提交：${await describeHead()}`);
  console.log("只读：只发 GET，不登录、不访问收藏接口；构建写到临时目录，结束后删除。\n");

  const results = new Map();
  try {
    for (const id of RUN_ORDER) {
      const check = CHECKS.find((item) => item.id === id);
      console.log(`· 正在检查 ${check.id} ${check.name}……`);
      const result = await runCheck(check.run);
      // 第 3 项只在构建整项通过时才扫描构建产物。
      if (id === 5) build.passed = result.passed;
      results.set(id, result);
    }
  } finally {
    await removeBuildDir();
  }

  console.log("\n" + "─".repeat(48));
  const failed = [];
  for (const check of CHECKS) {
    const result = results.get(check.id) ?? { passed: false, notes: [], problems: ["没有执行"] };
    if (!result.passed) failed.push(check);
    console.log(`[${check.id}] ${check.name}：${result.passed ? "通过" : "失败"}`);
    for (const problem of result.problems) console.log(`    ✗ ${problem}`);
    for (const note of result.notes) console.log(`    · ${note}`);
  }
  console.log("─".repeat(48));
  if (failed.length === 0 && results.size === CHECKS.length) {
    console.log(`结论：可以发布（${CHECKS.length}/${CHECKS.length} 项通过）`);
    process.exitCode = 0;
  } else {
    console.log(`结论：不可发布（失败 ${failed.length} 项：${failed.map((item) => `${item.id} ${item.name}`).join("、")}）`);
    process.exitCode = 1;
  }
}

// 提交说明里如果像有密钥，只显示提交号，不显示说明。
async function describeHead() {
  const head = await runCommand("git", ["log", "-1", "--format=%h %s"]);
  if (head.code !== 0) return "读取失败";
  const [hash, ...subject] = head.stdout.trim().split(" ");
  let suspicious = false;
  scanLine(subject.join(" "), () => {
    suspicious = true;
  });
  return suspicious ? `${hash}（提交说明含疑似密钥，已遮住）` : head.stdout.trim();
}

// 检查函数跑完必须明确返回 true；抛错、提前结束或记过问题都算失败。
async function runCheck(run) {
  const result = { passed: false, notes: [], problems: [] };
  const report = { note: (text) => result.notes.push(text), fail: (text) => result.problems.push(text) };
  let finished = false;
  try {
    finished = (await run(report)) === true;
  } catch (error) {
    report.fail("没跑成：" + describeError(error));
  }
  if (!finished && result.problems.length === 0) report.fail("检查没有跑完");
  result.passed = finished && result.problems.length === 0;
  return result;
}

async function checkFrontend(report) {
  const page = await httpGet(FRONTEND_URL);
  if (page.blockedRedirect) {
    report.fail(`首页要跳转到别的网站 ${page.blockedRedirect}，没有去请求`);
    return true;
  }
  if (page.status !== 200) {
    report.fail(`首页返回 ${page.status}，应为 200`);
    return true;
  }
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(page.text)?.[1] ?? "").trim();
  if (title.includes("下一餐")) report.note(`首页 200，标题“${title}”`);
  else report.fail(`首页标题“${title || "（没有标题）"}”里没有“下一餐”`);

  const assets = findResourceRefs(page.text).filter((item) => item.kind !== "other");
  for (const kind of ["js", "css"]) {
    if (!assets.some((item) => item.kind === kind)) report.fail(`首页没有引用任何 ${kind.toUpperCase()} 文件`);
  }
  for (const { ref, kind } of assets) {
    try {
      const assetUrl = new URL(ref, page.url);
      // 只请求首页所在的网站，运行前列给用户的请求清单才准确；别的网站上的文件算没查。
      if (assetUrl.origin !== FRONTEND_ORIGIN) {
        report.fail(`${ref} 在别的网站上；本检查不请求其他网站，这个文件算没查`);
        continue;
      }
      const asset = await httpGet(assetUrl);
      const expectedType = kind === "js" ? /javascript|ecmascript/i : /text\/css/i;
      if (asset.blockedRedirect) report.fail(`${ref} 要跳转到别的网站 ${asset.blockedRedirect}，没有去请求，这个文件算没查`);
      else if (asset.status !== 200) report.fail(`${ref} 返回 ${asset.status}，应为 200`);
      else if (!expectedType.test(asset.contentType)) report.fail(`${ref} 的类型是“${asset.contentType || "空"}”，不是 ${kind.toUpperCase()}（可能是找不到文件时返回的网页）`);
      else if (asset.text.length === 0) report.fail(`${ref} 内容为空`);
      else report.note(`${ref} 200（${asset.contentType.split(";")[0]}）`);
    } catch (error) {
      report.fail(`${ref} 没取到：${describeError(error)}`);
    }
  }
  return true;
}

async function checkApis(report) {
  const source = await readFile(path.join(ROOT, "recipe-data.mjs"), "utf8");
  const apiBase = /export const API_BASE_URL = "([^"]+)"/.exec(source)?.[1];
  if (!apiBase) {
    report.fail("没在 recipe-data.mjs 里找到 API_BASE_URL");
    return true;
  }
  for (const { path: apiPath, needsCors } of API_CHECKS) {
    try {
      const response = await httpGet(new URL(apiPath, apiBase), { Origin: FRONTEND_ORIGIN });
      if (response.blockedRedirect) {
        report.fail(`${apiPath} 要跳转到别的网站 ${response.blockedRedirect}，没有去请求`);
        continue;
      }
      const problems = [];
      if (response.status !== 200) problems.push(`返回 ${response.status}，应为 200`);
      const allowOrigin = response.headers.get("access-control-allow-origin");
      if (needsCors && allowOrigin !== FRONTEND_ORIGIN && allowOrigin !== "*") {
        problems.push(`没有允许首页跨域读取（access-control-allow-origin：${allowOrigin ?? "没有"}）`);
      }
      let body;
      try {
        body = JSON.parse(response.text);
      } catch {
        problems.push("返回的不是 JSON");
      }
      if (body !== undefined) problems.push(...validateApiBody(apiPath, body));
      if (problems.length > 0) {
        for (const problem of problems) report.fail(`${apiPath} ${problem}`);
      } else {
        const summary = apiPath === "/api/health" ? `service=${body.service}` : `${body.data.length} 条`;
        report.note(`${apiPath} 200，ok:true，${summary}${needsCors ? `，允许首页跨域（${allowOrigin}）` : ""}`);
      }
    } catch (error) {
      report.fail(`${apiPath} 没取到：${describeError(error)}`);
    }
  }
  return true;
}

function validateApiBody(apiPath, body) {
  if (body?.ok !== true) return ["ok 不是 true"];
  if (apiPath === "/api/health") return body.service === "next-meal" ? [] : [`service 是“${body.service}”，应为 next-meal`];
  if (!Array.isArray(body.data)) return ["data 不是列表"];
  return body.data.length > 0 ? [] : ["data 是空列表"];
}

async function checkTests(report) {
  const run = await runNpm("test");
  const output = stripAnsi(run.stdout + "\n" + run.stderr);
  if (run.error) report.fail(`npm test 没能启动：${describeError(run.error)}`);
  if (run.timedOut) report.fail(`npm test 超过 ${COMMAND_TIMEOUT_MS / 60_000} 分钟没结束`);
  if (run.code !== 0) report.fail(`npm test 退出码 ${run.code}，应为 0`);

  const counts = {};
  for (const match of output.matchAll(/^\s*(?:#|ℹ)\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) {
    counts[match[1]] = Number(match[2]);
  }
  const names = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
  if (names.some((name) => counts[name] === undefined)) {
    report.fail("看不懂测试输出里的汇总行（找不到 tests/pass/fail 等计数）");
    return true;
  }
  if (counts.tests === 0) report.fail("一个测试都没有跑");
  if (counts.pass !== counts.tests) report.fail(`共 ${counts.tests} 项，只通过 ${counts.pass} 项`);
  for (const name of ["fail", "cancelled", "skipped", "todo"]) {
    if (counts[name] !== 0) report.fail(`${name} ${counts[name]} 项，应为 0`);
  }
  // 去掉“✖ failing tests:”这类小标题，只留测试名。
  const failedNames = [...output.matchAll(/^\s*(?:not ok \d+ - |✖ )(.+)$/gm)].map((match) => match[1].trim()).filter((name) => !name.endsWith(":"));
  for (const name of [...new Set(failedNames)].slice(0, 5)) report.note(`没通过：${name}`);
  report.note(`共 ${counts.tests} 项：通过 ${counts.pass}，失败 ${counts.fail}，取消 ${counts.cancelled}，跳过 ${counts.skipped}，待办 ${counts.todo}`);
  return true;
}

async function checkBuild(report) {
  build.base = path.resolve(tmpdir());
  const fromRoot = path.relative(ROOT, build.base);
  if (fromRoot === "" || (fromRoot.split(path.sep)[0] !== ".." && !path.isAbsolute(fromRoot))) {
    report.fail(`系统临时目录 ${build.base} 在项目里面，不能用来构建`);
    return true;
  }
  build.dir = await mkdtemp(path.join(build.base, TEMP_PREFIX));
  const run = await runNpm(`run build -- --outDir "${build.dir}"`);
  if (run.error) report.fail(`构建没能启动：${describeError(run.error)}`);
  if (run.timedOut) report.fail(`构建超过 ${COMMAND_TIMEOUT_MS / 60_000} 分钟没结束`);
  if (run.code !== 0) {
    report.fail(`构建退出码 ${run.code}，应为 0`);
    for (const line of lastLines(stripAnsi(run.stderr || run.stdout), 3)) report.note(`构建输出：${line}`);
    return true;
  }

  build.files = await listFiles(build.dir);
  const issues = [];
  if (!build.files.includes("index.html")) issues.push("构建产物里没有 index.html");
  for (const file of build.files.filter((item) => item !== "index.html" && !item.startsWith("assets/"))) {
    issues.push(`构建产物里有多余文件：${file}（只应有 index.html 和 assets/）`);
  }
  let refs = [];
  if (build.files.includes("index.html")) {
    refs = findResourceRefs(await readFile(path.join(build.dir, "index.html"), "utf8"));
    for (const kind of ["js", "css"]) {
      if (!refs.some((item) => item.kind === kind)) issues.push(`index.html 没有引用任何 ${kind.toUpperCase()} 文件`);
    }
    for (const { ref } of refs) {
      if (!ref.startsWith("./assets/")) issues.push(`index.html 引用了 ${ref}，路径应以 ./assets/ 开头`);
      else if (!build.files.includes(decodeURIComponent(ref.slice(2)))) issues.push(`index.html 引用的 ${ref} 不在构建产物里`);
    }
  }
  for (const issue of issues) report.fail(issue);
  if (issues.length === 0) {
    const assetCount = build.files.filter((item) => item.startsWith("assets/")).length;
    report.note(`构建成功：index.html，assets/ 下 ${assetCount} 个文件；引用 ${refs.map((item) => item.ref).join("、")}`);
  }
  return true;
}

async function checkSecrets(report) {
  const hits = [];
  const addHit = (place, rule, length) => hits.push({ place, rule, length });

  // ① .env 类文件不能被提交，且 Git 要确实忽略它们。
  const listing = await runCommand("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listing.code !== 0) {
    report.fail("git ls-files 失败，无法列出会被提交的文件");
    return true;
  }
  const files = [...new Set(listing.stdout.split("\0").filter(Boolean))];
  if (files.length === 0) report.fail("没有列出任何会被提交的文件");
  for (const file of files.filter((item) => /(^|\/)\.env(\.|$)/.test(item))) report.fail(`${file} 会被提交（.env 类文件必须被忽略）`);
  // 必须是项目根目录的 .gitignore 忽略它们，并且这个 .gitignore 本身会被提交；
  // 只靠本机 .git/info/exclude、全局设置或不提交的 .gitignore，换台电脑就会被提交。
  if (!files.includes(".gitignore")) report.fail("项目根目录的 .gitignore 不会被提交（没被跟踪，或被忽略了），换台电脑 .env 就会被提交");
  for (const name of [".env", ".env.local"]) {
    const ignored = await runCommand("git", ["check-ignore", "-v", "--no-index", name]);
    if (ignored.code === 1) {
      report.fail(`Git 不会忽略 ${name}（.gitignore 里缺少 .env 规则）`);
      continue;
    }
    if (ignored.code !== 0) {
      report.fail(`git check-ignore ${name} 失败`);
      continue;
    }
    const [, source = "", pattern = ""] = /^(.+?):\d+:([^\t]*)\t/.exec(ignored.stdout) ?? [];
    if (source !== ".gitignore" || pattern.startsWith("!")) {
      report.fail(`${name} 不是由项目的 .gitignore 忽略的（来源：${source || "看不懂"}），换台电脑就会被提交`);
    }
  }

  // ② 现在会被提交的文件：已跟踪的加上没被忽略的新文件。
  let scanned = 0;
  let utf16 = 0;
  let rawBytes = 0;
  let missing = 0;
  for (const file of files) {
    let buffer;
    try {
      buffer = await readFile(path.join(ROOT, file));
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing += 1;
      } else if (error?.code === "EISDIR") {
        // 嵌套的 Git 仓库或子模块：git add 只记下它的提交号，里面的文件不会进本项目。
        report.note(`${file} 是嵌套仓库或子模块，git add 只记录它的提交号，里面的文件不扫描`);
      } else {
        report.fail(`${file} 读不出来（${error?.code ?? "未知错误"}），没扫到`);
      }
      continue;
    }
    const decoded = decodeForScan(buffer);
    if (decoded.mode === "utf16") utf16 += 1;
    if (decoded.mode === "bytes") rawBytes += 1;
    scanned += 1;
    for (const text of decoded.texts) scanText(text, (line, rule, length) => addHit(`${file}:${line}`, rule, length));
  }

  // ③ 暂存区里还没提交的内容：git add 过、之后工作区又改了或删了，git commit 仍会把暂存区的版本提交上去。
  const staged = await runCommand("git", [...GIT_DIFF_CONFIG, "diff", "--cached", ...GIT_PATCH_FLAGS]);
  let stagedFiles = 0;
  if (staged.code !== 0) {
    report.fail("git diff --cached 失败，暂存区没扫到");
  } else {
    stagedFiles = scanPatch(staged.stdout, (commit, file, line, content) => scanLine(content, (rule, length) => addHit(`暂存区 ${file}:${line}`, rule, length))).files;
  }

  // ④ 第 5 项本次构建出来的文件（项目里原有的 dist/ 不在这里）。
  let buildScanned = 0;
  if (!build.passed || build.files.length === 0) {
    report.fail("第 5 项构建没有成功，本次构建出的文件没扫到");
  } else {
    for (const file of build.files) {
      const decoded = decodeForScan(await readFile(path.join(build.dir, file)));
      buildScanned += 1;
      for (const text of decoded.texts) scanText(text, (line, rule, length) => addHit(`本次构建 ${file}:${line}`, rule, length));
    }
  }

  // ⑤ Git 历史：所有分支、标签里每个提交新增的行和提交说明。
  const history = await scanHistory(addHit);
  if (history.error) report.fail(history.error);
  else if (history.commits === 0) report.fail("Git 历史里没读到任何提交");

  const unique = [...new Map(hits.map((hit) => [`${hit.place}|${hit.rule}`, hit])).values()];
  for (const hit of unique.slice(0, MAX_LISTED)) report.fail(`${hit.place} 【${hit.rule}】命中内容已遮住（共 ${hit.length} 个字符）`);
  if (unique.length > MAX_LISTED) report.fail(`另有 ${unique.length - MAX_LISTED} 处命中未逐条列出`);
  report.note(`扫描会被提交的文件 ${scanned} 个（其中按 UTF-16 读 ${utf16} 个、含 0 字节按单字节读 ${rawBytes} 个；已删除 ${missing} 个）、暂存区改动 ${stagedFiles} 个文件、本次构建文件 ${buildScanned} 个、Git 历史提交 ${history.commits} 个；规则 ${SECRET_RULES.length} 条；命中 ${unique.length} 处`);
  if (scanned === 0) report.fail("一个文件都没扫到");
  return true;
}

// Windows PowerShell 5.1 用 > 存的文件是 UTF-16。含 0 字节的文件（包括二进制、UTF-32）还要按单字节读一遍并去掉 0 字节，
// 这样 UTF-16 文件后面用别的程序追加的英文、UTF-32 文件里的英文密钥也能查到；不跳过任何文件。
function decodeForScan(buffer) {
  const even = (body) => body.subarray(0, body.length - (body.length % 2));
  const bytesView = () => buffer.toString("latin1").replaceAll("\0", "");
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { mode: "utf16", texts: [even(buffer.subarray(2)).toString("utf16le"), bytesView()] };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { mode: "utf16", texts: [Buffer.from(even(buffer.subarray(2))).swap16().toString("utf16le"), bytesView()] };
  if (buffer.includes(0)) return { mode: "bytes", texts: [bytesView()] };
  return { mode: "utf8", texts: [buffer.toString("utf8")] };
}

function scanText(text, onHit) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => scanLine(line, (rule, length) => onHit(index + 1, rule, length)));
}

function scanLine(line, onHit) {
  for (const rule of SECRET_RULES) {
    for (const pattern of rule.patterns) {
      for (const match of line.matchAll(pattern)) onHit(rule.name, match[0].length);
    }
  }
}

async function scanHistory(addHit) {
  // log.showRoot、完整提交号和 medium 格式也固定下来：第一个提交的内容照样列出，提交行能被认出来。
  const run = await runCommand("git", [...GIT_DIFF_CONFIG, "-c", "log.showRoot=true", "log", "--all", "-m", "--no-abbrev-commit", "--pretty=medium", ...GIT_PATCH_FLAGS]);
  if (run.code !== 0) return { commits: 0, error: "git log 失败，Git 历史没扫到" };
  const result = scanPatch(
    run.stdout,
    (commit, file, line, content) => scanLine(content, (rule, length) => addHit(`提交 ${commit} ${file}:${line}`, rule, length)),
    (commit, content) => scanLine(content, (rule, length) => addHit(`提交 ${commit} 的说明`, rule, length)),
  );
  return { commits: result.commits };
}

// 逐行读 git 的差异输出：新增的行（+ 开头）连同文件名和行号交给 onAdded，提交说明等其余行交给 onMeta。
// 提交说明里折成几行的一段，还会连成一行再交给 onMeta 一次，跨行写的密钥也能查到。
function scanPatch(text, onAdded, onMeta = () => {}) {
  const seen = new Set();
  let files = 0;
  let commit = "";
  let file = "";
  let lineNumber = 0;
  let mode = "meta";
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length > 1) onMeta(commit, paragraph.join(" "));
    paragraph = [];
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replaceAll("\0", "");
    const commitMatch = /^commit ([0-9a-f]{40})/.exec(line);
    if (commitMatch) {
      flushParagraph();
      seen.add(commitMatch[1]);
      commit = commitMatch[1].slice(0, 7);
      mode = "meta";
      continue;
    }
    if (line.startsWith("diff --git ")) {
      flushParagraph();
      mode = "header";
      file = "";
      files += 1;
      continue;
    }
    if (mode === "header" || mode === "hunk") {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        mode = "hunk";
        lineNumber = Number(hunk[1]);
        continue;
      }
    }
    if (mode === "header") {
      if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
      continue;
    }
    if (mode === "hunk") {
      if (line.startsWith("+")) {
        onAdded(commit, file, lineNumber, line.slice(1));
        lineNumber += 1;
      } else if (line.startsWith(" ")) {
        lineNumber += 1;
      } else if (!line.startsWith("-") && !line.startsWith("\\")) {
        mode = "meta";
      }
      continue;
    }
    if (line.startsWith("    ") && line.trim() !== "") paragraph.push(line.trim());
    else flushParagraph();
    onMeta(commit, line);
  }
  flushParagraph();
  return { commits: seen.size, files };
}

function findResourceRefs(html) {
  const refs = [];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    // 属性值可以用双引号、单引号或不加引号。
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)].map(([, key, double, single, bare]) => [key.toLowerCase(), double ?? single ?? bare]),
    );
    const isScript = /^<script/i.test(tag);
    const ref = isScript ? attrs.src : attrs.href;
    if (!ref) continue;
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    const as = (attrs.as ?? "").toLowerCase();
    const preload = rel.includes("preload");
    const kind = isScript || rel.includes("modulepreload") || (preload && as === "script") ? "js" : rel.includes("stylesheet") || (preload && as === "style") ? "css" : "other";
    refs.push({ ref, kind });
  }
  return refs;
}

// 不让 fetch 自动跟随跳转：同一网站内的跳转才跟过去；要跳到别的网站时不去请求，返回 blockedRedirect 由调用方判失败。
// 10 秒时限包括中间的跳转。
async function httpGet(url, headers = {}) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let current = new URL(url);
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(current, {
      method: "GET",
      headers: { "Cache-Control": "no-cache", ...headers },
      redirect: "manual",
      signal,
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      const next = new URL(location, current);
      if (next.origin !== current.origin) return { blockedRedirect: next.origin };
      if (hop >= MAX_REDIRECTS) throw new Error(`同一网站内跳转超过 ${MAX_REDIRECTS} 次`);
      current = next;
      continue;
    }
    return {
      status: response.status,
      url: current.href,
      headers: response.headers,
      contentType: response.headers.get("content-type") ?? "",
      text: await response.text(),
    };
  }
}

function runNpm(args) {
  return runCommand(`${IS_WINDOWS ? "npm.cmd" : "npm"} ${args}`, [], { shell: true });
}

function runCommand(command, args, { shell = false } = {}) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    let settled = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), timedOut, ...result });
    };
    // 关掉 npm 每周一次去 npm 官网查新版本的请求，运行时只访问列给用户的两个网站。
    const env = { ...process.env, NO_COLOR: "1", npm_config_update_notifier: "false" };
    delete env.FORCE_COLOR;
    let child;
    try {
      child = spawn(command, args, { cwd: ROOT, shell, env, windowsHide: true });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, error });
      return;
    }
    // shell:true 时 child 只是 cmd.exe：超时要在 Windows 上连同子进程一起结束，并且不再等管道关闭，直接按超时收尾。
    const timer = setTimeout(() => {
      timedOut = true;
      const done = () => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish({ code: null });
      };
      if (IS_WINDOWS && child.pid) {
        // 等 taskkill 把整组进程结束了再收尾；taskkill 自己 5 秒没结束也照样收尾。
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", done);
        killer.on("exit", done);
        setTimeout(done, 5000).unref();
      } else {
        child.kill();
        done();
      }
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => finish({ code: null, error }));
    child.on("close", (code) => finish({ code }));
  });
}

async function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(path.join(dir, entry.name), relative + "/")));
    else files.push(relative);
  }
  return files.sort();
}

// 只删除本次 mkdtemp 建出来的目录。
async function removeBuildDir() {
  if (!build.dir) return;
  if (path.dirname(build.dir) !== build.base || !path.basename(build.dir).startsWith(TEMP_PREFIX)) return;
  try {
    await rm(build.dir, { recursive: true, force: true });
  } catch {
    console.log(`  （临时构建目录没能删除，可以手动删：${build.dir}）`);
  }
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function lastLines(text, count) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-count);
}

function describeError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return `超过 ${REQUEST_TIMEOUT_MS / 1000} 秒没有响应`;
  const code = error?.cause?.code ?? error?.code;
  const message = String(error?.message ?? error).slice(0, 160);
  return code ? `${message}（${code}）` : message;
}

main().catch((error) => {
  console.log(`\n检查脚本自身出错：${describeError(error)}`);
  console.log("结论：不可发布（检查没有跑完）");
  process.exitCode = 2;
});
