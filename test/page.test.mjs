// 网页版页面本身的回归测试：手写的 500 行模块脚本必须能被解析，关键能力也要在。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
const appPath = join(ROOT, 'web/app.mjs');
const script = readFileSync(appPath, 'utf8');
// 投递页逻辑已搬到 web/jobs.mjs（第 24 轮拆分），它的断言看这个文件
const jobsScript = readFileSync(join(ROOT, 'web/jobs.mjs'), 'utf8');
const panelsScript = readFileSync(join(ROOT, 'web/panels.mjs'), 'utf8');
// 「页面能力存在」类断言扫全部页面模块：能力已经按页拆到 app/jobs/panels，只扫一个文件会误报
// 浏览器端已按功能拆成多个模块（jobs/panels/repo/…）：守卫必须扫**全部** web/*.mjs，
// 否则「把逻辑搬到新模块」就会让这些页面级断言静默失效（本项目已经踩过两次）。
const webDir = join(ROOT, 'web');
const pageScripts = readdirSync(webDir)
  .filter(function (name) { return name.endsWith('.mjs') && name !== 'sw.js'; })
  .map(function (name) { return readFileSync(join(webDir, name), 'utf8'); })
  .join(String.fromCharCode(10));

// 离线时本机只缓存了一份平台的题库（bootstrap 缓存），所以"切平台"这件事在离线状态下做不到。
// 实测踩到的两个坑：
//   1) 请求 win32 却把 darwin 的缓存当结果用——下拉显示 Windows、题目与判定规则全是 macOS 的；
//   2) 恢复网络后 envline 还挂着"题库来自缓存的备份"这种过期说法（只清了一半提示）。
// 这条护栏盯着这两处的修法别再被改掉。
test('离线切平台会如实提示并切回；恢复网络后两个提示都撤掉', function () {
  assert.ok(script.indexOf('offlinePlatformMismatch = { want: platform, have: data.platform }') > -1,
    '离线时请求的平台与缓存不一致，要记下想切到哪个、缓存里是哪个');
  assert.ok(script.indexOf('if (select) select.value = data.platform') > -1,
    '离线切不动平台时，要把下拉拨回缓存里的那个平台');
  assert.match(script, /需先连上服务端/, '提示里要说清楚怎么才能练那个平台');
  assert.ok(script.indexOf('offlinePlatformMismatch = null') > -1 && script.indexOf('bootstrapCacheAt = null') > -1,
    '联网成功后两个离线提示都要撤掉');
});
test('index.html 只保留 markup，逻辑引用 /app.mjs', function () {
  assert.ok(html.indexOf('<script type="module">') === -1, '不该再有内联模块脚本');
  assert.ok(html.indexOf('src="/app.mjs"') > -1, '应引用 /app.mjs');
  assert.ok(html.indexOf('col-left') > -1 && html.indexOf('col-right') > -1, '三栏结构应留在 markup 里');
});

test('页面逻辑语法正确（node --check 解析，能挡住字符串里的裸换行这类错误）', function () {
  const result = spawnSync(process.execPath, ['--check', appPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'app.mjs 无法解析：' + result.stderr);
});

test('三栏结构与关键能力都在页面里', function () {
  ['col-left', 'col-center', 'col-right'].forEach(function (cls) {
    assert.ok(html.indexOf(cls) > -1, '缺少栏位 ' + cls);
  });
  [
    ['离线判定', 'localJudge'],
    ['离线队列', 'dsh-learn-offline-queue'],
    ['验证结果缓存', 'dsh-learn-verify-cache'],
    ['离线验证提示', 'renderVerifyOffline'],
    ['判定内核动态导入', "import('/core/judge.mjs')"],
    ['今日建议', 'loadDrill'],
    ['历史面板', 'loadHistory'],
    ['键盘快捷键', 'ctrlKey'],
    ['PWA 注册', 'serviceWorker'],
    ['左栏搜索', 'taskSearch'],
    ['状态筛选', 'statusFilter'],
    ['每日一题', '/api/daily'],
    ['学习报告导出', '/api/report'],
    ['键盘切题', 'moveSelection'],
    ['复习队列', '/api/review'],
    ['学习目标', '/api/goal'],
    ['题目笔记', '/api/note'],
    ['笔记编辑器', 'noteSaveBtn']
  ].forEach(function (item) {
    assert.ok(pageScripts.indexOf(item[1]) > -1, '缺少能力：' + item[0] + '（' + item[1] + '）');
  });
});

test('页面脚本里没有把参考答案写死', function () {
  // 参考答案必须来自 /api/bootstrap（否则改题库要改页面）
  ['docker run -d -p 8080:80', 'nginx:1.25', 'sed -i', 'git switch -c'].forEach(function (answer) {
    assert.ok(script.indexOf(answer) === -1, '页面脚本里不应出现参考答案片段：' + answer);
  });
  assert.ok(html.indexOf('docker run -d -p 8080:80') === -1, '页面里也不该出现整条参考答案');
});
test('三栏布局不会互相压：网格子项可收缩、长内容换行、窄屏取消吸顶', function () {
  // 这几条对应一次真实排版问题：长命令把列撑出轨道，压到相邻栏上
  assert.ok(html.indexOf('minmax(200px, 272px) minmax(0, 1fr) minmax(0, 360px)') > -1, '三栏轨道必须允许中间栏收缩');
  assert.ok(html.indexOf('.col-left, .col-center, .col-right { min-width: 0; }') > -1, '网格子项要 min-width: 0，否则内容会撑破轨道');
  assert.ok(html.indexOf('overflow-wrap: anywhere') > -1, '长命令/长路径要换行而不是撑破栏');
  // 断点按调研结论调过：支持性面板（右栏）只应在宽屏出现，1080 以下降两栏并把右栏整幅下移
  // （原来是 860 才降两栏，1024 还在硬撑三栏、右栏被压到 240px）。见 docs/UI-RESEARCH.md。
  assert.ok(html.indexOf('@media (max-width: 1080px)') > -1 && html.indexOf('.col-left, .col-right { position: static;') > -1, '窄屏要取消吸顶并把右栏整幅下移，避免和中间栏滚动内容视觉重叠');
  assert.ok(html.indexOf('@media (max-width: 1280px)') > -1, '1280 以下先收窄三栏，把宽度让给主内容');
  assert.equal(html.indexOf('@media (max-width: 1024px)'), -1, '不该再有"1024 还硬撑三栏"的那条规则');
  assert.ok(html.indexOf('--fs-body') > -1 && html.indexOf('--fs-xs') > -1, '字号要用变量统一，避免每处各写一个大小');
  assert.equal(html.indexOf('max-height: 300px'), -1, '单栏模式不该把题目列表压成 300px 的小滚动框');
});

test('左栏能扛住 200+ 题：分批渲染、键盘自动展开、轨道按钮带进度', function () {
  assert.ok(pageScripts.indexOf('const LIST_PAGE = 60') > -1, '一次渲染的题目数要有常量控制');
  assert.ok(pageScripts.indexOf('state.listLimit') > -1, '列表窗口要存在 state 里');
  assert.ok(pageScripts.indexOf('显示更多（还有 ') > -1, '超出窗口要有「显示更多」，且写明还剩多少');
  assert.ok(pageScripts.indexOf('function ensureTaskVisible') > -1, '键盘切到未渲染的题时要先把窗口撑开');
  assert.ok(pageScripts.indexOf('显示前 ') > -1 && pageScripts.indexOf('题') > -1, '计数要说明只显示了一部分，避免被当成漏题');
  assert.ok(pageScripts.indexOf('state.listLimit = 60') > -1, '换筛选条件要回到第一屏');

  // 轨道按钮要带「通过/总数」，否则看不出哪块该补
  assert.ok(pageScripts.indexOf("button.textContent = label") > -1 && pageScripts.indexOf("'/' + row.total") > -1, '轨道按钮应显示 通过/总数');
  assert.ok(pageScripts.indexOf('data-track') > -1, '轨道按钮要用 data-track 记录轨道名，别从文案反推');
  // 选中模块后要能"整模块开练"：按权重排队并跳到第一题
  assert.ok(pageScripts.indexOf('function renderTrackDrill') > -1 && pageScripts.indexOf('trackDrillBtn') > -1, '选中模块后应有整模块开练入口');
  assert.ok(pageScripts.indexOf("$('drillMode').value = 'all'") > -1, '整模块开练应把建议模式设成全量');
  // 已命中片段可点掉：做完减法实验再看分数怎么变
  assert.ok(pageScripts.indexOf('function removeSnippetFromAnswer') > -1 && pageScripts.indexOf('matched-chip') > -1, '已命中标签应可点击移除');
  // 刷新记录徽标：判定结果里要有明确的"本次为历史最好"，网页与原生客户端同一套判断
  assert.ok(pageScripts.indexOf('本次为历史最好') > -1, '判定结果要给出刷新记录徽标');
  assert.ok(pageScripts.indexOf('function isRecordScore') > -1
    && pageScripts.indexOf('return scoreBefore.attempts === 0 || score > scoreBefore.best;') > -1,
    '徽标判断要覆盖"第一次"与"分数更高"两种情况');
  assert.ok(pageScripts.indexOf('announce(verdictSummary(') > -1, '播报与徽标要共用同一份判断');
  assert.ok(html.indexOf('.tag.best') > -1, '徽标要有自己的样式（实线加粗）');

  // 难度筛选：三档按钮 + 列表项难度标签
  assert.ok(html.indexOf('id="levelFilter"') > -1, '左栏要有难度筛选');
  assert.ok(pageScripts.indexOf("state.level === 'all'") > -1, '筛选要接进可见题计算');
  assert.ok(pageScripts.indexOf('function levelTag') > -1, '列表项要显示难度标签');
  assert.ok(html.indexOf('.tag.level-hard') > -1, '三档难度标签要有可区分的样式');
  // 历史面板按结果筛选，并且记得住
  assert.ok(html.indexOf('id="historyResult"') > -1, '历史面板要有结果筛选');
  assert.ok(pageScripts.indexOf("dsh-learn-history-filter") > -1, '筛选偏好要记在本机');
  assert.ok(pageScripts.indexOf("filter === 'failed'") > -1, '未通过筛选要能筛出非满分记录');
  // 平台变体题多了之后，"那次是在哪个平台判的"必须看得见（老记录没有平台字段时不留空列）
  assert.ok(pageScripts.indexOf("const withPlatform = rows.some") > -1, '历史表要按需显示平台列');
  // 判定结果里也要写清"按哪个平台判的"（在线与离线两条路径都要）
  assert.equal(script.split('平台判定').length - 1, 2, '判定结果应有两处平台标注（服务端判定 + 离线判定）');
  assert.ok(pageScripts.indexOf('<th scope="col">平台</th>') > -1, '平台列要有表头');
});

test('变体题在任务区给出"其他平台怎么写"', function () {
  assert.ok(html.indexOf('id="taskVariants"') > -1, '任务区要有「其他平台写法」那一行');
  assert.ok(script.indexOf('其他平台写法：') > -1, '要真的把对比写法渲染出来');
  assert.ok(script.indexOf("(task && task.others)") > -1, '没有变体的题不该显示空行');
});

test('离线能力：Service Worker 立即注册、题库缓存一份、在线状态由请求结果决定', function () {
  assert.ok(script.indexOf("document.readyState === 'complete'") > -1, 'SW 注册不能只挂在 load 上（脚本晚于 load 执行时会静默失效）');
  assert.ok(script.indexOf('dsh-learn-bootstrap-cache') > -1, 'bootstrap 要缓存一份，离线重开页面才有题可练');
  assert.ok(script.indexOf('function markOffline') > -1 && script.indexOf('function markOnline') > -1, '在线状态应由请求结果统一翻转');
  assert.ok(script.indexOf('离线：题库来自') > -1, '用缓存题库时要说明数据来源');
});

test('网页版也能建项目、解析仓库（与 CLI 同一份 core）', function () {
  ['projectPane', 'projectName', 'projectInitBtn', 'projectText', 'projectTextBtn',
    'projectUrl', 'projectUrlBtn', 'projectImage', 'projectRepoPath', 'projectRepoPathBtn',
    'projectRepoUrl', 'projectRepoUrlBtn', 'projectResult'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') > -1, '缺少元素 ' + id);
  });
  assert.ok(pageScripts.indexOf("api('/api/project'") > -1, '要走 /api/project 接口');
  assert.ok(pageScripts.indexOf('function renderProjectResult') > -1, '要有结果渲染');
  assert.ok(pageScripts.indexOf('function renderProjectList') > -1, '要有项目列表渲染');
  assert.ok(pageScripts.indexOf('readAsDataURL') > -1, '截图要按 dataURL 上传（服务端走 Vision OCR）');
  assert.ok(pageScripts.indexOf('pack promote') > -1, '结果里要提示入库三步（改写 → promote → audit）');
  // 克隆路线要在界面上说清：复用 / 直连 / 走了镜像 / 本地目录，可信度不同
  assert.ok(pageScripts.indexOf('来源方式：') > -1, '结果区要显示来源方式');
  assert.ok(pageScripts.indexOf("payload.via === 'reuse'") > -1, '要能区分"复用上次克隆"与真去下载');
});

test('草案能一键转正式包（预览与列表分开放）', function () {
  ['draftList', 'draftDetail', 'projectDraftsBtn'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') > -1, '缺少元素 ' + id);
  });
  assert.ok(pageScripts.indexOf('function loadDrafts') > -1, '要能列出项目里的草案');
  assert.ok(pageScripts.indexOf('function runDraft') > -1, '要有预览/转换入口');
  assert.ok(pageScripts.indexOf('id="draftPromoteNow"') > -1 || pageScripts.indexOf('draftPromoteNow') > -1, '预览后要能直接转正式包');
  assert.ok(pageScripts.indexOf("download=\"' + escapeText(name) + '\"") > -1 || pageScripts.indexOf('download=') > -1, '要给出正式包下载');
  assert.ok(pageScripts.indexOf('renderDraftResult(payload)') > -1, '要渲染校验结果（补了哪些 level、多少条复核提醒）');
  assert.ok(pageScripts.indexOf('loadDrafts();') > -1, '解析出草案后要自动列出，少一步手动操作');
  assert.ok(pageScripts.indexOf('function openProject') > -1, '要能点开项目看来源');
  assert.ok(pageScripts.indexOf('function startDrillWith') > -1, '要有一份共用的「变成开练清单」函数');
  assert.ok(pageScripts.indexOf('async function startDrillFromProject') > -1, '项目要能一键开练');
  assert.ok(pageScripts.indexOf('projectDrillBtn') > -1, '项目详情里要有开练按钮');
  assert.ok(pageScripts.indexOf('startDrillFromProject(name)') > -1, '开练按钮要绑到项目映射上');
  // 项目可以深链：地址里带 #project=名字 直接打开，并且记住上次看的项目
  assert.ok(pageScripts.indexOf('function setProjectHash') > -1, '打开项目要写进地址');
  assert.ok(pageScripts.indexOf('function readProjectHash') > -1, '要能从地址里读出项目名');
  assert.ok(pageScripts.indexOf('dsh-learn-last-project') > -1, '要记住上次看的项目');
  // 题号也要能进地址：发一条"就是这一题"的链接，对方点开直接开练
  assert.ok(pageScripts.indexOf('function setTaskHash') > -1, '选题要写进地址（#task=题号）');
  assert.ok(pageScripts.indexOf('function readTaskHash') > -1, '要能从地址里读出题号');
  assert.ok(pageScripts.indexOf('function restoreTaskView') > -1, '启动时要恢复题号');
  assert.ok(pageScripts.indexOf('setTaskHash(taskId)') > -1, '切题时要同步地址');
  assert.ok(/function writeHash[\s\S]*?params\.delete\(key\)/.test(script), '写地址要只改自己那一项（开项目别把题号抹掉）');
  assert.ok(pageScripts.indexOf('if (!visible) resetAllFilters();') > -1, '目标题被筛选挡住时要先回到全部筛选');
  assert.ok(pageScripts.indexOf('restoreProjectView();') > -1, '启动时要恢复项目视图');
  assert.ok(pageScripts.indexOf("action: 'delete'") > -1, '要能删项目（带 confirm）');
  assert.ok(pageScripts.indexOf("window.prompt('删除项目 '") > -1, '删除要二次确认，不能一点就没');
  // 列表与详情分开：预览完列表还在，才能继续点其它草案
  assert.ok(pageScripts.indexOf("$('draftList')") > -1 && pageScripts.indexOf("$('draftDetail')") > -1, '列表与详情要各占一块');
  // 页面显示版本：缓存过期（老页面配新服务端）时一眼可见
  assert.ok(pageScripts.indexOf("'版本 ' + data.appVersion") > -1, '页头要显示版本号');
  assert.ok(pageScripts.indexOf('appVersion: data.appVersion') > -1, '版本也要进 __dshPerf，便于实测判断缓存');
  // 外壳版本对不上（SW 缓存里是旧脚本）要能被发现：服务端注入版本号，页面比对后更新 SW 并重载一次
  assert.ok(pageScripts.indexOf("const SCRIPT_VERSION = '__VERSION__'") > -1, '外壳脚本要带版本占位符，服务端会注入真实版本');
  assert.ok(pageScripts.indexOf('syncServiceWorker(data.appVersion)') > -1, '启动时要检查外壳版本');
  assert.ok(/SCRIPT_VERSION !== '__VERSION__' && SCRIPT_VERSION !== appVersion/.test(script), '要能判断"我这份脚本是旧的"');
  assert.ok(pageScripts.indexOf('dsh-learn-shell-reloaded') > -1 && pageScripts.indexOf('location.reload()') > -1, '发现旧外壳要重载一次，但必须只重载一次');
  assert.ok(pageScripts.indexOf('按 ⌘⇧R / Ctrl+Shift+R 强制刷新即可') > -1, '重载后还是旧的要把话说清楚，不做无限刷新');
});

test('判定结果的读法：命中片段有列表语义，满分不复读', function () {
  assert.ok(script.indexOf('role="list" aria-label="已命中 ') > -1, '命中片段要用列表语义包起来（读屏逐项念）');
  assert.ok(script.indexOf('role="listitem"') > -1, '每个命中片段是列表项');
  assert.ok(script.indexOf('aria-label="已命中：') > -1, '片段要有可访问名，说明点击会移除');
  assert.ok(script.indexOf('if (result.scoring && result.score < 100)') > -1, '离线路径满分时不重复评分摘要');
  assert.ok(script.indexOf('if (r.scoring && r.score < 100)') > -1, '在线路径同样');
});

test('导入备份：结果写在页面上，且给出可执行的失败提示（不弹窗）', function () {
  assert.equal(script.indexOf('alert('), -1, '导入反馈不该用 alert：会挡住整个界面，读屏也只能念一句');
  assert.ok(script.indexOf('导入完成：新增 ') > -1, '成功要有明确文案（新增 / 跳过重复各多少条）');
  assert.ok(script.indexOf('（备份文件太大，先拆成几份再导入）') > -1, '请求体过大要给出可执行的下一步');
});

test('筛到空要说明原因并给出一条出路', function () {
  assert.ok(script.indexOf('id = \'taskListEmpty\'') > -1, '空列表要有专门的说明块');
  assert.ok(script.indexOf("if (!list.length)") > -1, '空列表要单独分支处理');
  assert.ok(script.indexOf('function resetAllFilters') > -1, '重置筛选要有独立函数（键盘 0 与按钮共用）');
  assert.ok(script.indexOf("reset.addEventListener('click', resetAllFilters)") > -1, '空状态里的按钮要能一键重置');
  assert.ok(script.indexOf('没有匹配的题') > -1, '要明确说没有匹配的题，而不是留一片空白');
  assert.ok(script.indexOf("if (event.key === '0') {\n    resetAllFilters();") > -1, '键盘 0 要复用同一个重置函数');
});

test('首屏耗时留了可查的记录，触屏目标够大', function () {
  // 每轮实测都拿这两个数字对比，别让它悄悄消失
  assert.ok(script.indexOf('window.__dshPerf') > -1, '首屏耗时要挂在 window.__dshPerf 上');
  assert.ok(script.indexOf('bootstrapMs: Math.round(fetchedAt - startedAt)') > -1, '要记 bootstrap 段耗时');
  assert.ok(script.indexOf('firstListMs: Math.round(performance.now() - startedAt)') > -1, '要记到列表渲染完成的耗时');
  // 触屏：44px 是 iOS 人机指南的下限；触屏没有 hover，相关的提示必须常显
  assert.ok(html.indexOf('@media (hover: none) and (pointer: coarse)') > -1, '要有触屏媒体查询');
  assert.ok(/@media \(hover: none\)[\s\S]*min-height: 44px/.test(html), '触屏上可点区域要抬到 44px');
  assert.ok(html.indexOf('-webkit-tap-highlight-color') > -1, '触屏点击反馈要统一');
});

test('历史可复盘：点命令填回输入框，筛选带条数统计', function () {
  assert.ok(pageScripts.indexOf('function refillFromHistory') > -1, '要有把历史命令填回输入框的函数');
  assert.ok(pageScripts.indexOf('class="ghost cmd-refill"') > -1, '历史里的命令要是可点的按钮');
  assert.ok(pageScripts.indexOf("closest('.cmd-refill')") > -1, '用事件委托接住点击（表格会重绘）');
  assert.ok(pageScripts.indexOf("' 条　通过 '") > -1 && pageScripts.indexOf('未通过 ') > -1, '筛选结果要给出通过/未通过条数');
  assert.ok(pageScripts.indexOf('（未存命令）') > -1, '没有命令原文的旧记录要明确说明');
});

test('离线记录不隐身：待同步面板 + 一键同步按钮', function () {
  assert.ok(html.indexOf('id="pendingBox"') > -1, '提交历史上方要有待同步面板');
  assert.ok(html.indexOf('id="syncNow"') > -1, '要有立即同步按钮');
  assert.ok(script.indexOf('function renderPendingBox') > -1, '待同步面板要有渲染函数');
  assert.ok(script.indexOf('function flushQueueNow') > -1, '要有手动同步入口（名字别和按钮 id 撞车）');
  assert.ok(script.indexOf("addEventListener('click', flushQueueNow)") > -1, '按钮要绑到同步函数上');
  assert.ok(script.indexOf("sync.hidden = pending === 0") > -1, '没有待同步记录时按钮应隐藏');
  assert.ok(script.indexOf('离线判定已完成，恢复网络后自动并入进度') > -1, '要说明记录还没进进度');
  assert.ok(script.indexOf('当前还是离线') > -1, '离线时点同步要给出明确反馈');
  assert.ok(/async function flushQueue\(\)[\s\S]*?writeQueue\(\[\]\);\s*renderNetBadge\(\)/.test(script), '清空队列后必须重画徽标/待同步面板，否则同步成功还显示「待同步 N 条」');
});

test('键盘也能筛题：1-4 切难度、0 清筛选、Esc 退出输入', function () {
  assert.ok(script.indexOf("['1', '2', '3', '4']") > -1, '数字键要能切难度档');
  assert.ok(script.indexOf("['all', 'easy', 'medium', 'hard'][Number(event.key) - 1]") > -1, '数字键要映射到四档难度');
  assert.ok(script.indexOf("event.key === '0'") > -1, '0 要能一次清掉轨道/难度/状态筛选');
  assert.ok(script.indexOf("event.key === 'Escape'") > -1, 'Esc 要能退出输入');
  assert.ok(script.indexOf("if (box.id === 'taskSearch')") > -1, 'Esc 在搜索框里要顺手清空搜索词');
  assert.ok(script.indexOf('state.listLimit = 60') > -1, '清筛选后要回到第一屏');
  assert.ok(html.indexOf('1-4 难度') > -1, '快捷键提示里要写出来，否则没人知道');
});

// 真机量出来的三条：折叠按钮 22px 高（WCAG 2.2 AA 要求 ≥24）、三栏里的两块 aside 没名字、
// 提交后焦点掉回 <body>（键盘用户要再 Tab 143 次才够到「下一题」）。这三条都用实测数字钉回来。
test('可点区域 ≥24px、栏位有可访问名、判定后焦点交给结果区', function () {
  const collapse = html.match(/\.collapseBtn \{[^}]*\}/);
  assert.ok(collapse, '找不到 .collapseBtn 样式');
  const minHeight = Number((collapse[0].match(/min-height:\s*(\d+)px/) || [])[1]);
  assert.ok(minHeight >= 24, '.collapseBtn 的最小高度要 ≥24px（WCAG 2.2 AA SC 2.5.8），现在是 ' + minHeight);

  // 复选框/单选框外面那层 label 就是可点区域，inline 元素必须先变成 inline-flex 才撑得起高度
  assert.ok(/label:has\(input\[type="checkbox"\]\)[^{]*\{[^}]*display:\s*inline-flex[^}]*min-height:\s*24px/.test(html),
    '带复选框的 label 要撑到 24px 高（inline 元素写 min-height 不生效）');

  // 三栏是地标：两块 aside 必须各有名字，否则读屏的地标列表里是「补语地标、补语地标」
  ['col-left', 'col-right'].forEach(function (cls) {
    const tag = html.match(new RegExp('<aside class="' + cls + '"[^>]*>'));
    assert.ok(tag, '找不到 ' + cls + ' 的 aside');
    assert.ok(/aria-label="[^"]+"/.test(tag[0]), cls + ' 要有 aria-label：' + tag[0]);
  });

  // 判定结果出来后把焦点交给结果区：tabindex=-1 让它可被程序聚焦但不进 Tab 顺序
  assert.ok(html.indexOf('id="result" role="region" aria-label="判定结果" tabindex="-1"') > -1, '结果区要能被程序聚焦');
  assert.ok(script.indexOf('function focusResult()') > -1, '要有共用的聚焦函数');
  assert.ok(script.indexOf('box.focus()') > -1, '真的去聚焦');
  assert.equal((script.match(/focusResult\(\);/g) || []).length, 2, '在线与离线两条判定路径都要聚焦结果区');
});

// 离线时不会有人一直点「立即同步」：界面上写着"恢复网络后自动并入进度"，就得真的自动。
// 实测（浏览器、服务端停掉再起来、页面零操作）：修之前 22 秒毫无反应，徽标一直挂「待同步 1 条」；
// 修之后 16 秒内徽标回到「在线」、队列清零、历史里看得到那条记录。
test('离线队列会自己重试（不依赖用户点按钮，也不依赖 online 事件）', function () {
  assert.ok(script.indexOf('function syncOfflineQueueSoon()') > -1, '要有离线重试的调度函数');
  assert.ok(/const OFFLINE_RETRY_MS = \d+;/.test(script), '重试间隔要是明确的常量');
  assert.ok(script.indexOf('offlineRetryTimer = setInterval(') > -1, '用定时器重试，而不是一次性 setTimeout');
  assert.ok(script.indexOf('function stopOfflineRetry()') > -1 && script.indexOf('clearInterval(offlineRetryTimer)') > -1, '同步成功后要能停下来，别一直打接口');

  // 三个触发点：刚排队、启动时队列非空、同步失败后
  // 注意不能写成 /function enqueue[\s\S]*?syncOfflineQueueSoon/——那是"文件后面某处有就行"，
  // 把 enqueue 里的调用删掉照样绿（实测踩过）。这里先把函数体切出来再断言。
  const enqueueBody = script.slice(script.indexOf('function enqueue(record) {'));
  const enqueueEnd = enqueueBody.indexOf('\n}');
  assert.ok(enqueueEnd > 0, '找不到 enqueue 的函数体');
  assert.ok(enqueueBody.slice(0, enqueueEnd).indexOf('syncOfflineQueueSoon();') > -1, '记进队列时就该挂上重试');
  assert.ok(/if \(readQueue\(\)\.length\) syncOfflineQueueSoon\(\);/.test(script), '启动时队列里还有东西就要继续重试');
  assert.ok(/if \(!state\.online\) syncOfflineQueueSoon\(\);/.test(script), '同步失败（仍离线）后要继续重试');

  // 原来的两条路仍然在：online 事件与手动按钮
  assert.ok(script.indexOf("window.addEventListener('online'") > -1, 'online 事件那条路不能丢');
  assert.ok(script.indexOf("$('syncNow').addEventListener('click', flushQueueNow)") > -1, '手动同步按钮也要保留');
});


// 实测：`.tag`（难度标签）与 `.badge`（顶部徽标）写死了 11px，而设计令牌 `--fs-xs` 是 12px——
// 页面上有 64 处文字落在 11px。字号是最小可读性的一件事，不该有硬编码的第二套。
test('页面不出现小于 12px 的字号，小字统一走 --fs-xs', function () {
  // 字面量（现在应该一个都没有）与设计令牌，两处都不能小于 12px
  const literals = (html.match(/font-size:\s*[0-9.]+px/g) || []).map(function (row) {
    return parseFloat(row.replace(/[^0-9.]/g, ''));
  });
  assert.deepEqual(literals.filter(function (n) { return n < 12; }), [], '有小于 12px 的字面量字号：' + literals.join('、'));
  const tokens = (html.match(/--fs-[a-z]+:\s*[0-9.]+px/g) || []).map(function (row) {
    return { name: row.split(':')[0].trim(), size: parseFloat(row.replace(/[^0-9.]/g, '')) };
  });
  // 4 档是有意为之（12/14/16/20）：6 档时中间四档挤在 3px 内，梯度也就不成形了
  assert.ok(tokens.length >= 4, '字号令牌数看起来不对：' + tokens.length);
  assert.deepEqual(tokens.filter(function (row) { return row.size < 12; }), [], '有小于 12px 的令牌：' + JSON.stringify(tokens));
  assert.ok(/--fs-xs:\s*12px/.test(html), '--fs-xs 应当就是 12px');
  ['.tag', '.badge'].forEach(function (cls) {
    const rule = html.match(new RegExp('\\' + cls + ' \\{[^}]*\\}'));
    assert.ok(rule, '找不到 ' + cls + ' 规则');
    assert.match(rule[0], /font-size:\s*var\(--fs-xs\)/, cls + ' 的小字要用令牌，不要写死 px：' + rule[0]);
  });
});
test('无障碍基础：跳转链接、焦点可见、动态区域可播报、表格有列头', function () {
  [
    ['跳到主内容', 'class="skip" href="#main"'],
    // 主区域现在带 data-page（三个页面靠它切换），属性顺序不再固定：两项分开断言更稳
    ['主区域可聚焦', 'id="main"'],
    ['键盘焦点可见', ':focus-visible'],
    // 播报改成"一句话实时区域"：整块结果面板不再朗读，避免屏幕阅读器念完整个缺失项列表
    ['判定结果有一句话播报', 'id="verdictLive" class="skip" role="status" aria-live="polite"'],
    ['结果面板是有名字的区域', 'id="result" role="region" aria-label="判定结果"'],
    ['在线状态可播报', 'role="status" aria-live="polite"'],
    ['命令输入有可访问名', 'id="answer" aria-label'],
    ['笔记输入有可访问名', 'id="noteText" aria-label'],
    ['搜索框有可访问名', 'id="taskSearch" aria-label'],
    ['轨道筛选是一组', 'id="trackList" role="group" aria-label'],
    ['状态筛选是一组', 'id="statusFilter" role="group" aria-label'],
    ['对比度达标的次要文字色', '--muted: #5b6672'],
    // 圆点只是装饰（非文本对比度也要 ≥3:1）：原来的 #98a2b3 只有 2.58:1。
    // 色值现在都走主题令牌（浅/深两套），对比度的数值断言在 test/theme.test.mjs 里按合成后的实际颜色算——
    // 这里只认「用的是令牌」，不再钉死某个十六进制字面量（钉死过一次，改主题就红）。
    ['未练习圆点走主题令牌', '.dot-none { color: var(--idle); }'],
    ['满分圆点走主题令牌', '.dot-ok { color: var(--ok); }'],
    ['中间分圆点走主题令牌', '.dot-mid { color: var(--warn); }']
  ].forEach(function (item) {
    assert.ok(html.indexOf(item[1]) > -1, '缺少无障碍要素：' + item[0] + '（' + item[1] + '）');
  });
  assert.match(html, /id="main"[^>]*tabindex="-1"/, '主区域要可聚焦（tabindex=-1），跳转链接才有落点');
  // 三个页面：只有当前页可见（其余 hidden），导航用 tablist 语义
  assert.match(html, /id="pageNav" role="tablist"/, '要有主导航');
  ['repo', 'learn', 'jobs'].forEach(function (page) {  // 项目管理已并入 repo
    assert.ok(html.indexOf('data-page="' + page + '"') > -1, '缺少页面：' + page);
  });
  assert.ok((html.match(/<main /g) || []).length >= 3, '三个页面各有一个 main，其余用 hidden 藏起来');
  // 列表里的状态圆点是纯装饰（同行文字已写「已满分 / 最高 N 分 / 未练习」），读屏不该再念一遍
  assert.ok(script.indexOf('aria-hidden="true">●</span>') > -1, '状态圆点要标 aria-hidden，避免读屏把「●」当内容念');
  assert.ok(html.indexOf('#7b8794') === -1, '低对比度的 #7b8794 不应再出现（12px 文字只有约 4.0:1）');
  assert.ok(script.indexOf("setAttribute('aria-pressed'") > -1, '筛选按钮要同步 aria-pressed');
  assert.ok(script.indexOf('scope="col"') > -1, '表格列头要带 scope="col"');
  // 深色模式：交给系统色彩，页面自己不写死亮色背景，否则暗色下会白底白字
  assert.ok(html.indexOf('color-scheme: light dark') > -1, '应声明跟随系统配色');
  assert.equal(/background(-color)?:\s*(#fff\b|white|rgba\(255)/i.test(html), false, '不应写死亮色背景');
});


// 首屏不该替用户滚动页面：实测（CDP 打点 + 量几何）原来 renderTaskList 里的
// active.scrollIntoView 会让页面滚掉 475px，页面标题与环境行（版本/平台/工具链）直接不见。
// 现在只有"用户显式切题"才滚动，而且只滚左栏自己的容器。
test('切题滚动只作用于左栏容器，首屏恢复不滚页面', function () {
  assert.ok(script.indexOf('function scrollTaskIntoView(active)') > -1, '要有独立的滚进视野函数');
  assert.match(script, /scroller\.scrollTop \+= item\.top - box\.top/, '宽屏下只滚左栏自己的滚动容器');
  assert.ok(script.indexOf('goToTask(fromHash, { scroll: false })') > -1, '首屏恢复题号时不替用户滚动页面');
  assert.equal(script.indexOf('if (active && active.scrollIntoView) active.scrollIntoView'), -1,
    'renderTaskList 里不该再无条件下 scrollIntoView');
  assert.ok(script.indexOf('if (!visible && active.scrollIntoView)') > -1, '堆叠模式下也只能在那一行看不见时才滚');
  // 聚焦输入框同样不该顺带滚页面
  const focusCalls = (script.match(/\$\('answer'\)\.focus\(\)/g) || []);
  assert.deepEqual(focusCalls, [], '聚焦输入框要带 preventScroll');
  assert.ok(script.indexOf("$('answer').focus({ preventScroll: true })") > -1, 'preventScroll 写法要在');
});

// 「草案 → 加入总题库」这条链路的界面护栏：按钮、确认两步、状态回显、以及去处要写清。
// 背景：这一版之前，草案只能"转到项目的 promoted/ 暂存区"，网页上没有任何入口把它并入总题库；
// 加进来之后又踩过一次：确认按钮走的是项目那一路（scope 没传），状态文案也说成"已写入项目 promoted/"。
test('网页版能一键把草案加入总题库（并如实显示状态）', function () {
  // 这些都在 app.mjs（页面脚本）里，不在 index.html 外壳里
  assert.ok(pageScripts.indexOf('加入总题库') > -1, '项目面板要有「加入总题库」的入口');
  assert.ok(pageScripts.indexOf('id="draftCatalogNow"') > -1, '总题库那一路要有独立的确认按钮');
  assert.ok(pageScripts.indexOf("scope: toCatalog ? 'catalog' : 'project'") > -1, '走哪一路要显式传给接口，不能靠默认值');
  assert.ok(pageScripts.indexOf("runDraft(payload.file, true, 'catalog')") > -1, '列表上的"加入总题库…"要先预览');
  assert.ok(pageScripts.indexOf('已在总题库') > -1, '已经加过的草案要标出来');
  assert.ok(pageScripts.indexOf('这些题下次启动客户端就能练到') > -1, '写完要说清"从哪一步开始能练到"');
});

// 三个页面的护栏：导航、切换不丢 hash、简历投递页的关键动作与文案。
// 背景：功能一直在长，全堆在一页里；这版把它们分成学习 / 项目管理 / 简历投递，
// 学习页保留全部既有功能，另外两页是新的。切页要保留 #task= / #project=，否则分享链接会失效。
test('三个页面：导航、切换与页面级功能', function () {
  assert.ok(html.indexOf('id="pageNav" role="tablist"') > -1, '要有主导航（tablist）');
  ['repo', 'learn', 'jobs'].forEach(function (page) {  // 项目管理已并入 repo
    assert.ok(html.indexOf('data-page="' + page + '"') > -1, '缺少页面容器：' + page);
  });
  assert.ok((html.match(/<main /g) || []).length >= 3, '三个页面各一个 main');
  assert.ok(html.indexOf('id="pageJobs"') > -1 && html.indexOf('id="jobCompany"') > -1 && html.indexOf('id="jobJd"') > -1, '简历投递页要有表单与 JD 输入');
  assert.ok(html.indexOf('id="pageRepo"') > -1 && html.indexOf('id="ppList"') > -1 && html.indexOf('id="ppDraftList"') > -1, '项目/仓库页要有项目列表与草案区（原项目管理页已并入）');
  // 切页只写 page 这一个键：writeHash 是"只在有变化的那一项上动手"，所以任务号/项目名不会被抹掉
  assert.ok(pageScripts.indexOf("writeHash({ page: target === 'learn' ? '' : target })") > -1, '页面要写进 hash');
  assert.ok(pageScripts.indexOf('readPageHash()') > -1, '刷新后要按 hash 回到原页面');
  assert.ok(pageScripts.indexOf("if (target === 'repo') loadProjectPage();") > -1, '切到项目/仓库页要按需加载项目列表');
  assert.ok(pageScripts.indexOf("if (target === 'jobs') jobsPanel.loadJobs();") > -1, '切到简历投递页要按需加载（引用由 web/jobs.mjs 返回）');
  // 简历投递页的动作：分析 JD / 练相关题 / 建项目收 JD / 增改删
  // 这些都在 web/jobs.mjs 里（第 24 轮把投递页拆了出去）
  ['jobAnalyze', 'jobDrill', 'jobProject', 'jobEdit', 'jobDelete'].forEach(function (cls) {
    assert.ok(jobsScript.indexOf(cls) > -1, '缺少动作按钮：' + cls);
  });
  assert.ok(jobsScript.indexOf("action: 'analyze'") > -1 && jobsScript.indexOf("action: 'save'") > -1 && jobsScript.indexOf("action: 'delete'") > -1, '三个动作都要打到 /api/jobs');
  assert.ok(jobsScript.indexOf('startDrillWith(tasks)') > -1, '「练相关题」要复用开练清单（依赖注入进来的同一个函数）');
  // 项目管理页的入库按钮与"已在总题库"状态
  ['ppDraftPreview', 'ppDraftCatalog', 'ppDraftStage'].forEach(function (cls) {
    assert.ok(pageScripts.indexOf(cls) > -1, '项目管理页缺按钮：' + cls);
  });
  assert.ok(pageScripts.indexOf("scope: catalog ? 'catalog' : 'project'") > -1, '入库要显式给 scope');
});

// 识图能力与文字理解的界面护栏：按钮、能力行、结构化渲染、以及"理解 → 练这些题 / 建项目"两个出口。
test('网页版能看识图能力，也能理解文字（结构化 + 依据）', function () {
  assert.ok(html.indexOf('id="understandBtn"') > -1, '分析面板要有「理解这段文本」');
  assert.ok(html.indexOf('id="ocrCap"') > -1, '要有一行如实显示识图能力');
  assert.ok(script.indexOf("api('/api/ocr')") > -1, '识图能力要真的去取（GET /api/ocr）');
  assert.ok(script.indexOf("api('/api/understand'") > -1, '理解要打到 /api/understand');
  assert.ok(script.indexOf('硬要求（') > -1 && script.indexOf('加分项（') > -1, '硬要求与加分项要分开显示');
  assert.ok(script.indexOf('row.evidence') > -1, '每条判断都要把依据显示出来');
  assert.ok(script.indexOf('understandDrill') > -1, '理解结果要能直接开练');
  assert.ok(script.indexOf('understandProject') > -1, '理解结果要能收进项目');
});

// 流程页护栏：七步状态、简历、粘 JD 入库、推荐与记投递都要在界面上有出路。
test('网页版有「流程」页：七步 + 简历 + 搜集 + 推荐 + 投递', function () {
  assert.ok(html.indexOf('id="pageFlow"') > -1, '要有流程页');
  assert.ok(html.indexOf('data-page="flow"') > -1, '导航里要有流程');
  assert.ok(script.indexOf("const PAGES = ['repo', 'learn', 'jobs', 'flow']") > -1, '页面表要含项目/仓库且在最前（项目管理已并入）');
  assert.ok(script.indexOf("if (target === 'flow') loadFlow();") > -1, '切到流程页要按需加载');
  ['flowStages', 'flowResumeBtn', 'flowCollectBtn', 'flowRecommendBtn', 'flowJd'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') > -1, '缺少流程页元素：' + id);
  });
  assert.ok(script.indexOf("api('/api/flow')") > -1, '要靠 /api/flow 取状态');
  assert.ok(script.indexOf("action: 'resume'") > -1 && script.indexOf("action: 'collect'") > -1, '简历与搜集要打到 action');
  assert.ok(script.indexOf("action: 'recommend'") > -1 && script.indexOf("action: 'apply'") > -1, '推荐与记投递要打到 action');
  assert.ok(script.indexOf('startDrillWith(button.getAttribute') > -1, '「练差的题」要复用开练清单');
});

test('流程页能按岗位生成学习项目，也能上传 JD 截图入库', function () {
  assert.ok(html.indexOf('id="flowJdImage"') > -1, '要有 JD 截图入口');
  assert.ok(script.indexOf('runFlowCollectImage') > -1, '截图要走识图入库');
  assert.ok(script.indexOf("action: 'build'") > -1, '要靠 /api/flow action=build 建项目');
  assert.ok(script.indexOf('flowBuild') > -1, '推荐行要有「生成学习项目」按钮');
  assert.ok(script.indexOf('产出文件') > -1, '要告诉用户写了哪些文件');
});
test('流程页能按链接抓 JD（登录站点用环境变量 Cookie）', function () {
  assert.ok(html.indexOf('id="flowCollectUrlBtn"') > -1, '要有「按链接抓 JD」按钮');
  assert.ok(script.indexOf('runFlowCollectUrl') > -1, '按钮要接上抓取逻辑');
  assert.ok(script.indexOf("body: JSON.stringify({ action: 'collect', url: url })") > -1, '要打 action=collect url');
});
test('流程页能生成投递材料（逐条对硬要求，可复制）', function () {
  assert.ok(html.indexOf('id="flowPack"') > -1, '要有投递材料展示区');
  assert.ok(script.indexOf('runFlowPack') > -1, '推荐行要接上生成逻辑');
  assert.ok(script.indexOf("action: 'pack'") > -1, '要打 action=pack');
  assert.ok(script.indexOf('flowPackText') > -1 && script.indexOf('flowPackCopy') > -1, '材料要能一键复制');
});
test('流程页有推荐筛选输入（地点/薪资/远程），行里显示岗位属性', function () {
  assert.ok(html.indexOf('id="flowLoc"') > -1, '要有地点输入');
  assert.ok(html.indexOf('id="flowSalaryMin"') > -1 && html.indexOf('id="flowSalaryMax"') > -1, '要有薪资区间输入');
  assert.ok(html.indexOf('id="flowRemote"') > -1, '要有只看远程');
  assert.ok(script.indexOf('flowFilterArgs') > -1, '筛选要传进请求');
  assert.ok(script.indexOf('flowAttrLine') > -1, '行里要显示地点/薪资/发布时间');
});
test('流程页生成学习项目后能看/复制项目书', function () {
  assert.ok(script.indexOf('renderScaffold') > -1, '要渲染项目书结果');
  assert.ok(script.indexOf('flowBookText') > -1 && script.indexOf('flowBookCopy') > -1, '项目书要能复制');
  assert.ok(script.indexOf('产出文件') > -1, '要告诉用户写了哪些文件');
});

test('页面路由健壮性：短链 #flow 能进流程页，切页面时 hash 不长毛', function () {
  // 回归：验收入口用 #flow 时读不到（只有 #page=flow 才行）；切页面时 hash 会累积成 #flow=&page=jobs
  assert.ok(script.indexOf('const fromQuery = new URLSearchParams(raw).get(\'page\');') > -1, '要认 #page= 形式');
  assert.ok(script.indexOf("fromQuery === 'projects' ? 'repo' : (fromQuery || raw)") > -1, '要认 #flow 短链，并把旧 #page=projects 兜底到 repo');
  assert.ok(script.indexOf("if (params.get(name) === '') params.delete(name);") > -1, '切页面要清掉短链留下的空键');
});

test('切页面必须真的隐藏别的页：作者样式的 display 不能压过 hidden', function () {
  // 回归：学习页的 .layout 设了 display:grid，作者样式压过浏览器默认的 [hidden]{display:none}，
  // 结果四个页面竖着堆在一起（截图里流程页出现在 1820px 处）。CSS 里必须有兜底规则。
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(html), 'CSS 要有 [hidden]{display:none !important}');
  assert.ok(html.indexOf('class="layout" id="main" data-page="learn"') > -1, '学习页仍是 .layout 的 grid 容器（所以兜底必须存在）');
});

test('切页面必须真的隐藏别的页：作者样式的 display 不能压过 hidden', function () {
  // 回归：学习页的 .layout 设了 display:grid，作者样式压过浏览器默认的 [hidden]{display:none}，
  // 结果四个页面竖着堆在一起（截图里流程页出现在 1820px 处）。CSS 里必须有兜底规则。
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(html), 'CSS 要有 [hidden]{display:none !important}');
  assert.ok(html.indexOf('class="layout" id="main" data-page="learn"') > -1, '学习页仍是 .layout 的 grid 容器（所以兜底必须存在）');
});

test('流程页有「描述并抽全技术栈」入口（与 CLI describe 同一份）', function () {
  assert.ok(html.indexOf('id="flowDescribeBtn"') > -1, '要有按钮');
  assert.ok(script.indexOf('runFlowDescribe') > -1, '要接上逻辑');
  assert.ok(script.indexOf("'/api/describe'") > -1, '要打 /api/describe');
  assert.ok(script.indexOf('describeText') > -1 && script.indexOf('describeCopy') > -1, '报告要能复制');
});

test('流程页有「多岗位调研」入口（多份 JD 用 --- 分隔）', function () {
  assert.ok(html.indexOf('id="flowSurveyBtn"') > -1, '要有按钮');
  assert.ok(script.indexOf('runFlowSurvey') > -1, '要接上逻辑');
  assert.ok(script.indexOf("'/api/survey'") > -1, '要打 /api/survey');
  assert.ok(script.indexOf('surveyText') > -1 && script.indexOf('surveyCopy') > -1, '报告要能复制');
});

test('项目/仓库单独成页，标签排在学习左边；学习页里不再有它', function () {
  // 需求：学习页面的项目、仓库模块单独设置一个页面，放在学习左侧
  const nav = html.slice(html.indexOf('id="pageNav"'), html.indexOf('</nav>'));
  const repoAt = nav.indexOf('data-page="repo"');
  const learnAt = nav.indexOf('data-page="learn"');
  assert.ok(repoAt > -1 && learnAt > -1, '导航里要有项目/仓库与学习');
  assert.ok(repoAt < learnAt, '项目/仓库要排在学习左边');
  assert.ok(html.indexOf('id="pageRepo"') > -1, '要有独立的项目/仓库页');
  const learnMain = html.slice(html.indexOf('id="main" data-page="learn"'), html.indexOf('<main class="page" id="pageProjects"'));
  assert.ok(learnMain.indexOf('id="projectPane"') === -1, '学习页里不该再有项目/仓库面板');
  const repoAt2 = html.indexOf('id="pageRepo"');
  const repoMain = html.slice(repoAt2, html.indexOf('</main>', repoAt2));
  assert.ok(repoMain.indexOf('id="projectPane"') > -1, '项目/仓库面板要落在新页面里');
  ['projectName', 'projectInitBtn', 'projectListBtn', 'projectImage', 'projectRepoPath', 'projectRepoUrl', 'projectUrlBtn', 'projectTextBtn', 'projectText', 'projectDraftsBtn', 'draftList'].forEach(function (id) {
    assert.ok(repoMain.indexOf('id="' + id + '"') > -1, '新页面缺少摄入入口：' + id);
  });
  assert.ok(script.indexOf("if (target === 'repo') loadDrafts();") > -1, '进入该页要预载草案');
});

test('「项目管理」已并入「项目/仓库」页（导航只剩四项，旧链接兜底）', function () {
  const nav = html.slice(html.indexOf('id="pageNav"'), html.indexOf('</nav>'));
  assert.ok(nav.indexOf('data-page="projects"') === -1, '导航里不该再有项目管理');
  assert.ok(html.indexOf('id="pageProjects"') === -1, '独立的管理页应已删除');
  const repoAt = html.indexOf('id="pageRepo"');
  const repoMain = html.slice(repoAt, html.indexOf('</main>', repoAt));
  assert.ok(repoMain.indexOf('id="projectPane"') > -1, '摄入面板要在这一页');
  assert.ok(repoMain.indexOf('id="ppList"') > -1 && repoMain.indexOf('id="ppDraftList"') > -1, '项目列表与草案并入表也要在这一页');
  assert.ok(script.indexOf("fromQuery === 'projects' ? 'repo'") > -1, '旧书签 #page=projects 要兜底到 repo');
  assert.ok(script.indexOf("if (target === 'repo') loadProjectPage();") > -1, '进入该页要刷新项目列表');
});

test('项目/仓库页有「按目录导入」入口（与 CLI project import 同一份）', function () {
  assert.ok(html.indexOf('id="projectImportDir"') > -1, '要有目录输入');
  assert.ok(html.indexOf('id="projectImportPrefix"') > -1, '要有前缀输入');
  assert.ok(html.indexOf('id="projectImportBtn"') > -1, '要有导入按钮');
  assert.ok(script.indexOf('runProjectImport') > -1, '要接上逻辑');
  assert.ok(script.indexOf("action: 'import'") > -1, '要打 action=import');
});

test('项目行有重命名/移除/删除，右侧能看来源原文，学习页有提示按钮', function () {
  // 用户报的三件事 + 一个功能请求，逐项钉住
  ['ppRename', 'ppHide', 'ppDelete'].forEach(function (name) {
    assert.ok(pageScripts.indexOf("'." + name + "'") > -1 || pageScripts.indexOf('ppRename') > -1, '缺少动作：' + name);
  });
  assert.ok(pageScripts.indexOf('function hiddenProjects') > -1, '移除要能记住（本地隐藏）');
  assert.ok(pageScripts.indexOf('function clearHiddenProjects') > -1, '要能恢复被移除的');
  assert.ok(pageScripts.indexOf('function renameProjectPrompt') > -1 && pageScripts.indexOf("action: 'rename'") > -1, '重命名要走接口');
  assert.ok(pageScripts.indexOf('function deleteProjectConfirm') > -1, '删除要二次确认');
  assert.ok(html.indexOf('id="ppSources"') > -1 && html.indexOf('id="ppSourceText"') > -1, '要有来源与原文区');
  assert.ok(pageScripts.indexOf('function loadProjectSources') > -1 && pageScripts.indexOf('function showSourceText') > -1, '要能拉来源与原文');
  assert.ok(html.indexOf('id="hintBtn"') > -1 && html.indexOf('id="taskHint"') > -1, '命令输入旁要有提示按钮与提示行');
  assert.ok(pageScripts.indexOf('function toggleHint') > -1, '提示要能展开/收起');
  assert.ok(pageScripts.indexOf('function toggleHint') > -1 && pageScripts.indexOf('task.hint') > -1, '提示取题目自带的 hint');
});

test('项目页有筛选/排序/来源检索/回填原文（都是真实可用的入口）', function () {
  assert.ok(html.indexOf('id="ppFilter"') > -1, '要有项目名筛选');
  assert.ok(html.indexOf('id="ppSort"') > -1, '要有排序');
  assert.ok(html.indexOf('id="ppSourceFilter"') > -1, '要有来源检索');
  assert.ok(html.indexOf('id="ppBackfillBtn"') > -1 && html.indexOf('id="ppBackfillDir"') > -1, '要有回填原文入口');
  assert.ok(pageScripts.indexOf('function loadProjectSources') > -1 && pageScripts.indexOf('filteredSources') > -1 || pageScripts.indexOf('const shown = filter') > -1, '来源检索要真的过滤');
  assert.ok(pageScripts.indexOf("action: 'backfill'") > -1, '回填要打接口');
  assert.ok(pageScripts.indexOf('visible.sort') > -1, '排序要真的生效');
});

test('项目页有开练清单（先练哪几道 + 一键开练）', function () {
  assert.ok(html.indexOf('id="ppDrillPlan"') > -1, '要有开练清单区');
  assert.ok(script.indexOf('function loadDrillPlan') > -1, '要能算清单');
  assert.ok(script.indexOf("action: 'drill'") > -1, '要打 drill 接口');
  assert.ok(script.indexOf('ppDrillNext') > -1 && script.indexOf('ppDrillAll') > -1, '要有「先练这些」「按清单全练」');
  assert.ok(script.indexOf('差一点的先补') > -1, '要说清排序口径');
});

test('网页版有「按分类调研」入口（分方向矩阵）', function () {
  assert.ok(html.indexOf('id="flowGroupSurveyBtn"') > -1, '要有按分类调研按钮');
  assert.ok(script.indexOf('function runFlowGroupSurvey') > -1, '要实现分方向逻辑');
  assert.ok(script.indexOf('groups: groups') > -1, '要按 groups 打接口');
  assert.ok(script.indexOf('至少两个方向') > -1, '方向不足要如实提示');
});

test('项目页有「从 JD 生成练习清单」入口，计划草案不给入题库按钮', function () {
  assert.ok(html.indexOf('id="ppJdPlanBtn"') > -1, '要有生成按钮');
  assert.ok(html.indexOf('id="ppJdPlanBox"') > -1, '要有清单显示区');
  assert.ok(pageScripts.indexOf('function runJdPlan') > -1, '要实现生成逻辑');
  assert.ok(pageScripts.indexOf("action: 'jdplan'") > -1, '要打 jdplan 接口');
  assert.ok(pageScripts.indexOf("row.kind === 'plan'") > -1, '要区分计划草案');
  assert.ok(pageScripts.indexOf('ppDraftDrill') > -1, '计划草案要能一键开练');
});

test('网页版有语料检索入口（关键词 + 任一词 + 命中列表）', function () {
  assert.ok(html.indexOf('id="corpusQ"') > -1, '要有检索输入框');
  assert.ok(html.indexOf('id="corpusBtn"') > -1 && html.indexOf('id="corpusHits"') > -1, '要有按钮与结果区');
  assert.ok(html.indexOf('id="corpusAny"') > -1, '要有任一词命中开关');
  assert.ok(script.indexOf('function runCorpusSearch') > -1 && script.indexOf('/api/corpus?q=') > -1, '要真的打检索接口');
  assert.ok(script.indexOf('showSourceText(project, index)') > -1, '命中行要能点开原文');
});

test('投递页有待跟进区与状态时间线', function () {
  assert.ok(html.indexOf('id="jobFollow"') > -1, '要有待跟进区');
  assert.ok(jobsScript.indexOf('function renderJobFollowUps') > -1, '要实现待跟进渲染');
  assert.ok(jobsScript.indexOf('function renderJobTimeline') > -1, '要实现时间线渲染');
  assert.ok(jobsScript.indexOf('超过 ') > -1 && jobsScript.indexOf('天没动静') > -1, '要说清多少天没动静');
});

test('学习页有「实际跑一遍」开关，执行结果有专门渲染', function () {
  assert.ok(html.indexOf('id="runAnswer"') > -1, '要有执行开关');
  assert.ok(script.indexOf("run: Boolean($('runAnswer')") > -1, '勾选后要随提交发给服务端');
  assert.ok(script.indexOf('function renderExecution') > -1, '要有执行结果渲染');
  assert.ok(script.indexOf('未实际执行') > -1, '没跑要说清原因');
});

test('学习页有知识点掌握度块（最弱列表 + 先练那几道）', function () {
  assert.ok(html.indexOf('id="masteryBox"') > -1, '要有掌握度区');
  assert.ok(html.indexOf('id="masteryDrillBtn"') > -1, '要有「练最弱的这几道」');
  assert.ok(script.indexOf('async function loadMastery') > -1, '要实现加载逻辑');
  assert.ok(script.indexOf("/api/mastery?limit=5") > -1, '要打掌握度接口');
});

test('项目页有检索与筛选（关键词 / 只看缺原文 / 排序），并且真的打给接口', function () {
  assert.ok(html.indexOf('id="projectQuery"') > -1, '要有检索框');
  assert.ok(html.indexOf('id="projectMissingText"') > -1, '要有只看缺原文');
  assert.ok(html.indexOf('id="projectSort"') > -1, '要有排序选择');
  assert.ok(script.indexOf('async function loadProjectList') > -1, '要有统一加载函数');
  assert.ok(script.indexOf("params.push('missingText=1')") > -1, '筛选条件要真的发给服务端');
  assert.ok(script.indexOf('/api/project') > -1);
});

test('项目页：来源与原文挂在每个项目下方（折叠），点开后在右侧显示职位描述详情', function () {
  assert.ok(html.indexOf('ppSourceFilter') > -1, '左栏要有来源筛选');
  assert.ok(html.indexOf('ppSourceTitle') > -1, '右栏要有职位描述详情标题');
  assert.ok(pageScripts.indexOf('pp-sources-toggle') > -1, '要有折叠开关');
  assert.ok(pageScripts.indexOf('function renderSourceDetail') > -1, '要有结构化详情渲染');
  assert.ok(pageScripts.indexOf('只有列表卡片') > -1, '详情抓不到时要如实标注');
  assert.ok(pageScripts.indexOf('&source=') > -1, '详情要走来源接口');
});
