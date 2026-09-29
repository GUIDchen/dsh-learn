# 三端能力对照表

> 本文档由 docs/capabilities.json 生成，请勿手改：改数据后运行 node scripts/capabilities-doc.mjs，再用 node --test test/capability-matrix.test.mjs 验证。

这张表回答一个问题：**同一个能力，CLI / 接口 / 网页版 / 原生端 四处是不是都有。**
守卫会逐个去源码里找「有」后面的标记；标了「缺」的必须真的缺，并写明原因。

| 能力 | CLI | 接口 | 网页版 | 原生端 | 用例 | 实测证据 |
| --- | --- | --- | --- | --- | --- | --- |
| 学习与判分（提交命令 → 判定 → 记录） | 有：check: tasks.check, | 有：pathname === '/api/check' | 有：async function submitAnswer | 有：func check( | test/content.test.mjs | [evidence/web-mastery-0.162.0.png](docs/evidence/web-mastery-0.162.0.png) |
| 描述与提取（知识点 + 技术栈） | 有：describe: describeCommand.describe | 有：pathname === '/api/describe' | 有：function runFlowDescribe | 有：func describe( | test/stack.test.mjs | — |
| 多岗位调研（热度 / 通用技能 / 缺口） | 有：survey: surveyCommand.survey | 有：pathname === '/api/survey' | 有：function runFlowSurvey | 有：func survey(texts: | test/survey.test.mjs | [samples/boss-survey-all.md](docs/samples/boss-survey-all.md) |
| 分方向调研（矩阵 + 共性/专有） | 有：surveyByCategory | 有：const groups = Array.isArray(body.grou | 有：function runFlowGroupSurvey | 有：func surveyGroups | test/survey.test.mjs | [samples/boss-by-direction.md](docs/samples/boss-by-direction.md) |
| 项目/仓库：收来源（截图 / 文字 / 链接 / 仓库） | 有：project: projects.project | 有：const action = body.action // 'add' | 有：action: 'init' | 有：func ingestText | test/project.test.mjs | — |
| 按目录批量导入（每个子目录一个项目） | 有：importTree( | 有：action === 'import' | 有：function runProjectImport | 有：func importTree | test/project-import.test.mjs | — |
| 项目页筛选 / 排序 / 来源检索 | 缺：筛选/排序/来源检索是界面能力；命令行用 project list / pr | 缺：筛选在界面本地做（项目列表一次取回），接口不单独提供筛选参数 | 有：id="ppFilter" | 有：visibleProjects | test/page.test.mjs | — |
| 来源原文查看（原封不动） | 有：readSourceText( | 有：url.searchParams.get('source') | 有：function showSourceText | 有：func sourceText | test/project-import.test.mjs | [evidence/web-project-sources-0.140.0.png](docs/evidence/web-project-sources-0.140.0.png) |
| 按项目生成开练清单 | 有：projectDrillPlan( | 有：action === 'drill' | 有：function loadDrillPlan | 有：func drillPlan | test/project-import.test.mjs | [evidence/web-project-drill-0.143.0.png](docs/evidence/web-project-drill-0.143.0.png) |
| 岗位描述 → 练习清单（计划草案） | 有：buildJdPlan( | 有：action === 'jdplan' | 有：function runJdPlan | 有：func jdPlan | test/jdplan.test.mjs | [evidence/web-jd-plan-0.149.0.png](docs/evidence/web-jd-plan-0.149.0.png) |
| 语料全文检索（跨项目 / 行号） | 有：corpus: corpusCommand.corpus | 有：pathname === '/api/corpus' | 有：function runCorpusSearch | 有：func corpusSearch | test/corpus.test.mjs | [evidence/web-corpus-search-0.150.0.png](docs/evidence/web-corpus-search-0.150.0.png) |
| 旧数据回填原文 | 有：backfillAll( | 有：action === 'backfill' | 有：id="ppBackfillBtn" | 有：func backfillText | test/project-import.test.mjs | — |
| 项目重命名 / 移除 / 删除 | 有：renameProject( | 有：action === 'rename' | 有：function renameProjectPrompt | 有：func renameProject | test/page.test.mjs | — |
| 简历投递记录（增改删查 + JD 分析） | 有：jobs: jobsCommand.jobs | 有：pathname === '/api/jobs' | 有：async function loadJobs | 有：func jobs(status: | test/jobs.test.mjs | — |
| 投递跟进（状态时间线 + 待跟进） | 有：jobFollowUps( | 有：jobFollowUps(jobs | 有：function renderJobFollowUps | 有：jobsFollow | test/jobs-followup.test.mjs | [evidence/web-jobs-followup-0.151.0.png](docs/evidence/web-jobs-followup-0.151.0.png) |
| 招聘信息搜集（搜索 + 粘 JD） | 有：collect | 有：action === 'collect' | 有：function runFlowCollect | 有：func flowCollect | test/flow.test.mjs | — |
| 按匹配度推荐岗位 | 有：recommend | 有：action === 'recommend' | 有：function runFlowRecommend | 有：func flowRecommend | test/flow.test.mjs | — |
| 按学习进度生成简历要点 | 有：resume | 有：action === 'resume' | 有：function runFlowResume | 有：func flowResume | test/flow.test.mjs | — |
| 搜索并解析（搜到 → 抓回 → 抽知识点） | 有：search: researchCommand.search | 有：pathname === '/api/search' | 有：async function runSearch | 有：func search( | test/search.test.mjs | — |
| 识图解析（截图 → 知识点 / 草案） | 有：understand: understandCommand.understa | 有：pathname === '/api/ocr' | 有：$('ocrCap') | 有：func understand | test/understand.test.mjs | [evidence/jd-screenshot.png](docs/evidence/jd-screenshot.png) |
| 远程/容器执行（runner） | 有：runners: verify.runners | 有：pathname === '/api/runners' | 缺：远程/容器执行要 runner 端点与凭据，网页版不做，避免浏览器里下发远端 | 缺：原生端不做远程/容器执行（要 runner 凭据与端点，桌面端只覆盖学习闭环 | test/runners.test.mjs | — |
| 刷新项目知识点（补题包后让老项目用上） | 有：sub === 'refresh' | 有：action === 'refresh' | 有：ppRefreshPointsBtn | 有：func refreshProjectPoints | test/refresh-points.test.mjs | — |
| 数据体检（元数据/索引/原文/记录自洽 + 一键修复） | 有：doctor: doctorCommand.doctor | 有：pathname === '/api/doctor' | 有：async function runDoctor | 有：func doctor() | test/doctor.test.mjs | — |
| 执行型判定（只读白名单内真跑一遍答案） | 有：assessAnswer | 有：assessAnswer(task, body.answer | 有：function renderExecution | 有：run: Bool | test/exec-answer.test.mjs | [evidence/web-check-run-0.161.0.png](docs/evidence/web-check-run-0.161.0.png) |
| 知识点掌握度（最弱先补 + 今天先练哪几道） | 有：mastery: masteryCommand.mastery | 有：pathname === '/api/mastery' | 有：async function loadMastery | 有：func mastery( | test/mastery.test.mjs | — |
| 判定反馈定位（缺的要素该补在哪一行） | 有：locateMissing(task, answer, platform) | 有：feedback: result.missing | 有：renderExecution | 有：run: Bool | test/feedback.test.mjs | — |
| 题包脚手架与深度校验（口径 + 参考答案自测） | 有：sub === 'new' | 有：action === 'validate-all' | 有：export function initPackPanel | 有：func packValidateAll( | test/packfile.test.mjs | [evidence/web-pack-0.164.0.png](docs/evidence/web-pack-0.164.0.png) |
| 项目筛选与检索（关键词 / 只看缺原文 / 排序） | 有：projectSearchHit(row, query) | 有：url.searchParams.get('missingText') | 有：async function loadProjectList | 有：func projects(query: String = "", miss | test/project-filter.test.mjs | [evidence/web-project-search-0.165.0.png](docs/evidence/web-project-search-0.165.0.png) |

## 故意缺失的入口（4 处）

- 项目页筛选 / 排序 / 来源检索 · cli：筛选/排序/来源检索是界面能力；命令行用 project list / project show 看全量，没有等价开关
- 项目页筛选 / 排序 / 来源检索 · api：筛选在界面本地做（项目列表一次取回），接口不单独提供筛选参数
- 远程/容器执行（runner） · web：远程/容器执行要 runner 端点与凭据，网页版不做，避免浏览器里下发远端命令
- 远程/容器执行（runner） · native：原生端不做远程/容器执行（要 runner 凭据与端点，桌面端只覆盖学习闭环）
