# HTTP 接口清单

> 本文档由 docs/api-contract.json 生成，请勿手改：改数据后运行 node scripts/api-doc.mjs，再用 node --test test/api-contract.test.mjs 验证。

这份清单与 `src/web/api.mjs` **双向绑定**：代码里出现的路由 / action 必须在这里登记，登记了也必须存在（守卫会逐个核对）。

响应约定：成功响应带 ok:true（或业务字段，如 meta / project / jobs / matches / plan / markdown）；失败响应带 error；部分接口同时给 ok:false。

## 路由（42 条）

| 路由 | 用途 |
| --- | --- |
| `/api/analyze` | 分析一段岗位描述（知识点 / 可练题 / 技术栈） |
| `/api/backup` | 整机备份计划（GET）与执行（POST create/restore，支持 dryRun） |
| `/api/board` | 学习排行榜 |
| `/api/bootstrap` | 平台、轨道、全部题目与判分规则（客户端离线判分用） |
| `/api/check` | 提交答案并判定、记录进度（三端共用） |
| `/api/commands` | 命令面板的命令表与快捷键（网页/原生/CLI 共用 core/commands.mjs） |
| `/api/corpus` | 语料全文检索（跨项目，带行号） |
| `/api/daily` | 每日一题（同一天稳定） |
| `/api/describe` | 描述与提取（岗位/文档/截图 → 技术栈与知识点） |
| `/api/doctor` | 数据体检（GET 只读；POST {fix:true} 做保守修复） |
| `/api/draft` | 项目草案：GET 列表；POST 预览 / 转正式包 |
| `/api/drill` | 按给定题号或权重给出练习清单 |
| `/api/export` | 导出进度备份（含笔记与目标） |
| `/api/flow` | 求职闭环动作（简历 / 推荐 / 搜集 / 投递 / 题包 / 计划构建） |
| `/api/goal` | 学习目标读写 |
| `/api/history` | 练习历史（按题目与客户端过滤） |
| `/api/i18n` | 界面文案表（zh-CN / en），core/i18n.mjs 为唯一事实源 |
| `/api/import` | 导入进度备份 |
| `/api/jobs` | 投递记录增改删查 + JD 分析 + 跟进视图 |
| `/api/knowledge` | 知识点字典与命中情况 |
| `/api/mastery` | 知识点掌握度（最弱先补 + 今天先练哪几道） |
| `/api/metrics` | 运行指标：请求量/延迟/错误率/事件分布 + 本地数据量 |
| `/api/note` | 题目笔记读写 |
| `/api/ocr` | 截图识别（能力矩阵 / 文本） |
| `/api/onboarding` | 首次运行引导：六步走到哪、下一步跑什么（三端同一份口径） |
| `/api/pack` | 题包：生成模板 / 深度校验（口径 + 参考答案自测）/ 全库体检 |
| `/api/plan` | 学习计划（按岗位缺口生成） |
| `/api/prefs` | 界面偏好（外观主题 auto/light/dark），三端共用 |
| `/api/probe` | 平台探针（只读，默认 dry-run） |
| `/api/progress` | 学习进度汇总（含连续学习天数） |
| `/api/project` | 项目管理：元数据 / 来源 / 索引 / 开练清单 / JD 清单 / 回填 / 重命名 / 删除 / 刷新 / 导入 |
| `/api/reminder` | 目标提醒（今天的练习量 vs 每日目标；level none/info/warn） |
| `/api/report` | Markdown 学习报告 |
| `/api/research` | 搜索并解析（搜到 → 抓回 → 抽知识点与草案） |
| `/api/review` | 间隔复习队列 |
| `/api/runners` | 可用执行后端（本地 / 容器 / 远程） |
| `/api/scorecard` | 进度趋势与成绩单（days 窗口；format=markdown 出 Markdown） |
| `/api/search` | 搜索命令用法（多引擎，带 tried 记录） |
| `/api/storage` | 存储 schema 状态（GET）与迁移（POST，支持 dryRun） |
| `/api/survey` | 多岗位调研（texts）与分方向调研（groups） |
| `/api/understand` | 文字理解（硬要求 / 加分项 / 技术栈结构） |
| `/api/verify` | 题目验证（只读白名单，默认 dry-run） |

## POST 动作（22 个）

| action | 所在路由 | 识别的字段 | 说明 |
| --- | --- | --- | --- |
| `analyze` | /api/jobs | `id` | 分析岗位记录里的 JD，结果存回记录 |
| `apply` | /api/flow | `id` | 把岗位记录置为已投（状态时间线留痕） |
| `backfill` | /api/project | —（批量，不需要） | 旧数据回填原文；不需要项目名（批量） |
| `build` | /api/flow | —（批量，不需要） | 按现状生成学习计划文件 |
| `collect` | /api/flow | —（批量，不需要） | 搜集招聘信息（搜索 / 粘 JD / 截图 / 链接） |
| `create` | /api/backup | `out` | 生成整机备份包（progress/jobs/goals/notes/projects/trust），支持 dryRun |
| `delete` | /api/jobs 或 /api/project | `id` / `name` | 删除记录 / 项目（项目需 confirm） |
| `drill` | /api/project | `project` / `prefix` | 开练清单；行里同时给 id 与 taskId |
| `import` | /api/project | —（批量，不需要） | 按目录批量导入；不需要项目名（批量） |
| `index` | /api/project | `name` | 项目索引（知识点 / 可练题 / 草案） |
| `init` | /api/project | `name` | 建项目；响应同时给 project 与 meta 两个别名 |
| `jdplan` | /api/project | `name` / `project` | 岗位描述 → 练习清单（计划草案） |
| `new` | /api/pack | `id` | 按 id/轨道/参考答案生成**开箱即通过深度校验**的题包模板（只生成不落盘） |
| `pack` | /api/flow | —（批量，不需要） | 把当前进展整理成题包草案 |
| `recommend` | /api/flow | —（批量，不需要） | 岗位推荐；响应同时给 jobs 与 matches（core 返回数组） |
| `refresh` | /api/project | `name` | 重算知识点并重建索引（补题包后用） |
| `rename` | /api/project | `name` | 项目重命名（改目录 + 元数据） |
| `restore` | /api/backup | `file` | 从备份包恢复；支持 dryRun；覆盖前把原文件留到 pre-restore 目录 |
| `resume` | /api/flow | —（批量，不需要） | 按真实练习生成简历要点 |
| `tasks` | /api/project | `name` | 项目可练题清单 |
| `validate` | /api/pack | `pack` | 深度校验：结构 + 难度口径 + 参考答案必须自测满分 |
| `validate-all` | /api/pack | —（批量，不需要） | 全库体检：packs/ 下每个包都过一遍深度校验 |
