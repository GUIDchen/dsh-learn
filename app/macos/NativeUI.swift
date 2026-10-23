// 原生三栏界面：左栏筛选题单、中栏题目与作答、右栏判定结果与进度。
// 全部用系统控件（List / TextEditor / Gauge / Label），没有一行 HTML。
import SwiftUI
import AppKit   // 截图入口要用 NSOpenPanel（原生文件选择器，不是网页里的 input）
import UniformTypeIdentifiers   // 限制可选文件类型用 UTType，而不是已废弃的 allowedFileTypes

// ⌘F 由菜单发出、由搜索框接收：通知名跟着使用者放（放 main.swift 的话，
// 单独编译 NativeUI 的自检目标会找不到它）
extension Notification.Name {
    static let dshFocusSearch = Notification.Name("dsh-learn.focus-search")
    // 判定面板（右栏）显隐：菜单项与中栏按钮都走这个通知（菜单不好直接改 SwiftUI 的 @State，
    // 这个通知模式在 ⌘F 聚焦搜索框上已经用过一次）
    static let dshToggleVerdict = Notification.Name("dsh-learn.toggle-verdict")
}

@MainActor
// 判定结果对读屏用户也要「自己说出来」：网页版有 aria-live 实时区域，原生端对着的是一块普通文本，
// 不主动播报的话，VoiceOver 用户按完 ⌘↩ 什么也听不到（要自己一路 Tab 到右栏去找）。
// 文案与网页端同一套口径：过了没有、多少分、还缺几项、下一步做什么。
func announceVerdict(_ payload: CheckResponse) {
    let r = payload.result
    var parts: [String] = []
    parts.append("判定：" + r.verdict + "，" + String(r.score) + " 分")
    if r.missing.isEmpty { parts.append("要素齐全") } else { parts.append("还缺 " + String(r.missing.count) + " 项") }
    if let previous = payload.previousBest, r.score > previous { parts.append("本次为历史最好") }
    parts.append(r.pass ? "可以继续下一题" : "看提示或点下面的下一题")
    NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                         userInfo: [.announcement: parts.joined(separator: "，"),
                                    .priority: NSAccessibilityPriorityLevel.high.rawValue])
}

@MainActor
final class Store: ObservableObject {
    @Published var status: String = "正在启动本地引擎…"
    @Published var bootstrap: Bootstrap?
    @Published var progress: ProgressResponse?
    @Published var tasks: [LearnTask] = []
    @Published var track: String = "all"
    @Published var level: String = "all"
    @Published var query: String = ""
    // 空字符串 = 跟随服务端默认平台
    @Published var platform: String = ""
    @Published var platforms: [PlatformOption] = []
    @Published var selected: String?
    @Published var answer: String = ""
    @Published var result: CheckResponse?
    @Published var history: [HistoryRow] = []
    // 每日一题：左栏顶上那张卡就是它（与网页版同一个 /api/daily，挑选规则在服务端）
    @Published var daily: DailyPick?
    // 项目 / 仓库：和网页版同一套能力（摄入 → 知识点 → 一键开练），桌面端不做截图上传（OCR 走服务端，先留接口）
    @Published var projects: [ProjectRow] = []
    @Published var projectQuery = ""
    @Published var projectMissingText = false
    @Published var projectSort = "updated"
    @Published var projectFilterNote = ""
    // 项目里的草案：列表 + 每次操作的一句话回执（与网页版同一套接口）
    @Published var projectDrafts: [ProjectDraft] = []
    @Published var draftMessage: String = ""
    @Published var confirmCatalogDraft: String?   // 非 nil 时弹二次确认：加入总题库会改变可练题库，值得再问一句
    // 项目索引（项目管理页）：知识点带名字、可练题、草案状态
    @Published var projectIndex: ProjectIndex?
    // 简历投递（与网页版「简历投递」页、CLI `jobs` 同一份数据）
    @Published var jobs: [JobRecord] = []
    @Published var jobsFollow: JobFollow?
    @Published var jobsStats: JobStats?
    @Published var jobStatuses: [JobStatusRow] = []
    @Published var jobsMessage: String = ""
    @Published var jobEditing: String = ""
    @Published var page: String = "learn"   // 项目/仓库 / 学习 / 简历 / 流程（与网页版同一套页面划分）
    // 搜索并解析：搜索结果 / 解析结果 / 一句话回执（与网页版、CLI 同一份 core/search.mjs）
    @Published var searchHits: [SearchHit] = []
    @Published var researchRows: [ResearchRow] = []
    @Published var searchTasks: [String] = []
    @Published var searchMessage: String = ""
    // 文字理解与识图能力（与网页版分析面板、CLI understand / ocr --capabilities 同一份）
    @Published var understanding: UnderstandResult?
    @Published var understandingMessage: String = ""
    @Published var ocrLine: String = ""
    // 七步闭环（与网页版流程页、CLI flow 同一份）
    @Published var flow: FlowStatus?
    @Published var flowResume: ResumeRow?
    @Published var flowMatches: [FlowMatch] = []
    @Published var flowMessage: String = ""
    @Published var flowPlan: FlowPlanRow?
    @Published var flowScaffold: FlowScaffoldRow?
    @Published var flowFiles: [String] = []
    @Published var flowPack: FlowPackRow?
    @Published var describeReport: String = ""
    @Published var projectResult: ProjectIngest?
    @Published var projectBusy = false
    @Published var projectName: String = ""
    @Published var projectSources: [ProjectMetaSource] = []
    @Published var drillPlan: DrillPlan?
    @Published var jdPlanText = ""
    @Published var runAnswer = false
    @Published var doctorText = ""
    @Published var masteryWeak: [MasteryRow] = []
    @Published var masteryNext: [MasteryNext] = []
    @Published var masteryMessage = ""
    @Published var packAuditText = ""
    @Published var doctorMessage = ""
    @Published var corpusHits: [CorpusHit] = []
    @Published var corpusMessage = ""
    @Published var sourceText: String = ""
    @Published var sourceTitle: String = ""
    @Published var hiddenProjects: Set<String> = []
    @Published var renameTarget: String?
    @Published var renameText: String = ""
    @Published var deleteTarget: String?
    @Published var showTaskHint = false
    // 备份：整份搬走（记录 + 笔记 + 目标），导出/导入与网页版、命令行同一份内容
    @Published var backupMessage: String = ""
    // 学习目标：每天几题、几分钟（原生端此前只能看进度，不能设目标）
    @Published var goalTasks: Int = 0
    @Published var goalMinutes: Int = 0
    @Published var goalMessage: String = ""
    // 复习队列（间隔重复）：到期该复习的题，右栏里给出「复习」按钮
    // 题目笔记：写在本机、跟题走，与网页版/命令行共用同一份存储
    @Published var noteText: String = ""
    @Published var noteSavedAt: String?
    // 只读验证：跑题库里那条只读命令，验证环境与题目假设是否对得上（与网页版同一个接口）
    @Published var verifyResult: VerifyResult?
    @Published var verifyBusy = false
    @Published var reviewDue: [ReviewRow] = []
    @Published var reviewUpcoming: [ReviewRow] = []
    @Published var busy = false
    @Published var errorText: String?

    let engine: Engine
    let clientId: String
    private let prefs: PrefsStore

    init(engine: Engine, prefs: PrefsStore = PrefsStore()) {
        self.engine = engine
        self.prefs = prefs
        // 桌面端自己的客户端标识：进度里能区分"谁练的"，和网页版/CLI 的记录互不覆盖
        self.clientId = "mac-native"
        // 上次的筛选与选中的题：开窗回到原地，不用每次重新点一遍
        let saved = prefs.load()
        self.track = saved.track
        self.level = saved.level
        self.query = saved.query
        self.selected = saved.taskId
        self.platform = saved.platform
    }

    func persist() {
        prefs.save(NativePrefs(track: track, level: level, query: query, taskId: selected, platform: platform))
    }

    // 评测平台名：界面上显示"macOS / Linux / Windows"，选中项为空时按服务端当前平台显示
    var platformLabel: String {
        if platform.isEmpty { return "跟随服务端（" + (bootstrap?.platform ?? "?") + "）" }
        return platforms.first { $0.id == platform }?.name ?? platform
    }

    // 换平台：重新取题库（目标/提示/要素按平台下发），刷新进度与历史，并把选择记下来
    func setPlatform(_ value: String) async {
        guard value != platform else { return }
        platform = value
        persist()
        engine.note("切换评测平台：" + (value.isEmpty ? "跟随服务端" : value))
        do {
            let boot = try await engine.bootstrap(platform: platform)
            bootstrap = boot
            tasks = boot.tasks
            result = nil
            await refreshProgress()
            await loadHistory()
            // 每日一题与复习队列的文案都按平台下发（目标/提示），换平台必须一起刷新
            await loadDaily()
            await loadReview()
        } catch {
            errorText = error.localizedDescription
        }
    }

    // 点命中片段把它从答案里删掉（只删第一处），再判定就能看到分数怎么变。
    // 与网页版的「点一下从输入里移除」是同一个动作。
    @discardableResult
    func removeSnippet(_ snippet: String) -> Bool {
        let needle = snippet.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty, let range = answer.range(of: needle) else { return false }
        answer.removeSubrange(range)
        answer = answer.replacingOccurrences(of: "  ", with: " ").trimmingCharacters(in: .whitespaces)
        return true
    }

    var levelLabels: [String: String] { bootstrap?.levelLabels ?? ["easy": "简单", "medium": "中等", "hard": "困难"] }

    // 三档难度筛选 + 轨道筛选 + 关键词搜索，全在客户端做：题库已经在内存里，再发一次请求没意义
    var visibleTasks: [LearnTask] {
        tasks.filter { task in
            if track != "all" && task.track != track { return false }
            if level != "all" && (task.level ?? "medium") != level { return false }
            if !query.isEmpty {
                let needle = query.lowercased()
                let hay = (task.id + " " + task.title + " " + task.goal).lowercased()
                if !hay.contains(needle) { return false }
            }
            return true
        }
    }

    func trackCount(_ name: String) -> Int {
        tasks.filter { $0.track == name }.count
    }

    func levelCount(_ name: String) -> Int {
        tasks.filter { ($0.level ?? "medium") == name }.count
    }

    func levelLabel(_ code: String?) -> String {
        levelLabels[code ?? "medium"] ?? "中等"
    }

    func stat(_ taskId: String?) -> TaskStat? {
        guard let taskId = taskId else { return nil }
        return progress?.byTask[taskId]
    }

    func start() async {
        do {
            _ = try await engine.start()
            let boot = try await engine.bootstrap(platform: platform)
            bootstrap = boot
            tasks = boot.tasks
            platforms = boot.platforms
            status = "已连接 " + (engine.baseURL?.absoluteString ?? "")
            // 留痕：出问题时能从日志看出"开窗时到底用了哪套筛选与哪个平台"
            engine.note("恢复筛选：track=" + track + " level=" + level
                + " query=" + (query.isEmpty ? "-" : query) + " task=" + (selected ?? "-")
                + " platform=" + (platform.isEmpty ? "跟随服务端(" + boot.platform + ")" : platform))
            await refreshProgress()
            // 上次的筛选可能已经不匹配任何题（题库更新过），那就退回到第一题
            if selected == nil || !tasks.contains(where: { $0.id == selected }) {
                selected = visibleTasks.first?.id
            }
            persist()
            await loadHistory()
            await loadNote()
            await loadDaily()
            await loadReview()
        } catch {
            errorText = error.localizedDescription
            status = "引擎没起来"
        }
    }

    func refreshProgress() async {
        progress = try? await engine.progress()
        await loadGoal()
    }

    func loadGoal() async {
        guard let payload = try? await engine.goal() else { return }
        goalTasks = payload.goal.dailyTasks ?? 0
        goalMinutes = payload.goal.dailyMinutes ?? 0
    }

    // 保存学习目标：0 表示不设；保存后立刻刷新进度（今日达成会跟着变）
    func saveGoal() async {
        do {
            let payload = try await engine.saveGoal(dailyTasks: goalTasks, dailyMinutes: goalMinutes)
            goalTasks = payload.goal.dailyTasks ?? 0
            goalMinutes = payload.goal.dailyMinutes ?? 0
            goalMessage = (goalTasks == 0 && goalMinutes == 0)
                ? "已清空目标（不计达成）"
                : "已保存：每天 " + String(goalTasks) + " 题　" + String(goalMinutes) + " 分钟"
            engine.note("学习目标：" + goalMessage)
            progress = try? await engine.progress()
        } catch {
            goalMessage = "保存失败：" + error.localizedDescription
        }
    }

    // 按轨道完成度：网页版左栏的「通过/总数」，桌面端放在进度区下面
    var trackRows: [TrackSummary] {
        let rows = progress?.summary?.byTrack ?? []
        // 完成度低的排前面：这一栏的用途是"接下来练哪块"，不是展示成绩
        return rows.filter { $0.total > 0 }.sorted {
            ($0.passed * 100 / max(1, $0.total)) < ($1.passed * 100 / max(1, $1.total))
        }
    }

    func loadDaily() async {
        daily = (try? await engine.daily(track: track, platform: platform))?.daily
    }

    // 项目名缺省用"我的项目"：桌面端点开就能用，不强迫先起名字
    var effectiveProjectName: String {
        let trimmed = projectName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "我的项目" : trimmed
    }

    // 导出：拿到整份备份，写到用户选的位置。文件名带日期，免得几次导出互相覆盖。
    func exportBackup() async {
        do {
            let data = try await engine.exportBackupData()
            let stamp = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
            let panel = NSSavePanel()
            panel.nameFieldStringValue = "dsh-learn-progress-" + stamp + ".json"
            panel.allowedContentTypes = [.json]
            panel.message = "选择备份保存位置（记录 + 笔记 + 学习目标）"
            guard panel.runModal() == .OK, let url = panel.url else { return }
            try data.write(to: url)
            let size = ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file)
            backupMessage = "已导出到 " + url.lastPathComponent + "（" + size + "）"
            engine.note("导出备份：" + url.path)
        } catch {
            backupMessage = "导出失败：" + error.localizedDescription
        }
    }

    // 导入：选文件 → 交给服务端合并（笔记按更新时间取胜、本机没设目标时才采纳）
    func importBackup() async {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.json]
        panel.message = "选择之前导出的备份文件"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let data = try Data(contentsOf: url)
            let summary = try await engine.importBackup(data)
            var text = "导入完成：新增 " + String(summary.added ?? 0) + " 条，跳过重复 " + String(summary.skipped ?? 0) + " 条"
            if let notes = summary.notes, notes > 0 { text += "；笔记 +" + String(notes) + " 条" }
            if summary.goals == true { text += "；学习目标已采纳" }
            backupMessage = text
            engine.note("导入备份：" + url.path + " → " + text)
            await refreshProgress()
            await loadHistory()
            await loadNote()
            await loadDaily()
            await loadReview()
        } catch {
            backupMessage = "导入失败：" + error.localizedDescription
        }
    }

    func loadProjects() async {
        let result = try? await engine.projects(query: projectQuery, missingText: projectMissingText, sort: projectSort)
        projects = result?.projects ?? []
        let total = result?.total ?? projects.count
        if projectQuery.isEmpty && !projectMissingText && projectSort == "updated" {
            projectFilterNote = "共 " + String(total) + " 个项目"
        } else {
            var bits: [String] = []
            if !projectQuery.isEmpty { bits.append("关键词「" + projectQuery + "」") }
            if projectMissingText { bits.append("只看缺原文") }
            if projectSort != "updated" { bits.append("按 " + projectSort + " 排序") }
            projectFilterNote = "命中 " + String(projects.count) + " / " + String(total) + " 个项目（" + bits.joined(separator: "、") + "）"
        }
    }

    // 七步闭环：状态 / 简历 / 推荐，全部来自服务端（core/flow.mjs）
    func loadFlow() async {
        do {
            let status = try await engine.flowStatus()
            flow = status
            flowMessage = status.summary ?? ""
            flowMatches = status.matches ?? []
        } catch {
            flowMessage = "读取流程状态失败：" + error.localizedDescription
        }
    }

    func runFlowResume() async {
        do {
            flowResume = try await engine.flowResume()
            flowMessage = flowResume?.headline ?? "已生成简历要点"
        } catch {
            flowMessage = "生成简历失败：" + error.localizedDescription
        }
    }

    func runFlowRecommend(location: String = "", salaryMin: Int = 0, salaryMax: Int = 0, remoteOnly: Bool = false) async {
        do {
            let recommend = try await engine.flowRecommend(
                location: location.trimmingCharacters(in: .whitespacesAndNewlines),
                salaryMin: salaryMin,
                salaryMax: salaryMax,
                remoteOnly: remoteOnly
            )
            flowMatches = recommend.jobs ?? []
            flowMessage = flowMatches.isEmpty ? "还没有可比对的岗位：先搜集几条 JD" : ("推荐 " + String(flowMatches.count) + " 个岗位")
        } catch {
            flowMessage = "推荐失败：" + error.localizedDescription
        }
    }

    func runFlowCollect(_ text: String) async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty { flowMessage = "先把 JD 正文粘进文本框"; return }
        do {
            let saved = try await engine.flowCollect(text: body, url: "")
            flowMessage = saved.ok == true ? ("已入库：" + (saved.job?.company ?? "") + " · " + (saved.job?.position ?? "")) : (saved.error ?? "入库失败")
            await loadFlow()
            await loadJobs()
        } catch {
            flowMessage = "入库失败：" + error.localizedDescription
        }
    }

    // 按目录批量导入语料（每个子目录一个项目）
    func runImportTree(dir: String, prefix: String) async {
        let target = dir.trimmingCharacters(in: .whitespacesAndNewlines)
        if target.isEmpty { flowMessage = "先填要导入的目录"; return }
        do {
            let result = try await engine.importTree(dir: target, prefix: prefix)
            let rows = result.projects ?? []
            flowMessage = "导入完成：" + String(result.files ?? 0) + " 份 → " + String(rows.count) + " 个项目"
            await loadProjects()
        } catch {
            flowMessage = "导入失败：" + error.localizedDescription
        }
    }

    // 多岗位调研：把多份 JD（用 --- 分隔）聚合成市场画像
    // 按分类调研：文本框里用 ## 方向名 分段（每段多份 JD 再用 --- 分隔）
    func runGroupSurvey(_ text: String) async {
        let segments = text.components(separatedBy: "\n## ")
        var groups: [[String: Any]] = []
        for (index, segment) in segments.enumerated() {
            let trimmed = segment.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            if index == 0 {
                let texts = trimmed.components(separatedBy: "\n---").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                if !texts.isEmpty { groups.append(["name": "未分组", "texts": texts]) }
                continue
            }
            var lines = trimmed.components(separatedBy: "\n")
            let name = lines.isEmpty ? "方向" : lines.removeFirst().trimmingCharacters(in: .whitespaces)
            let body = lines.joined(separator: "\n")
            let texts = body.components(separatedBy: "\n---").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            if !name.isEmpty && !texts.isEmpty { groups.append(["name": name, "texts": texts]) }
        }
        if groups.count < 2 { flowMessage = "至少两个方向：用一行 ## 方向名 分段"; return }
        do {
            let result = try await engine.surveyGroups(groups)
            describeReport = result.markdown ?? ""
            let stats = result.stats
            flowMessage = "分方向调研：" + String(stats?.groups ?? 0) + " 个方向 / " + String(stats?.jobs ?? 0) + " 份；技术栈 " + String(stats?.terms ?? 0) + " 项；共性 " + String(stats?.shared ?? 0) + "；专有 " + String(stats?.unique ?? 0)
        } catch {
            flowMessage = "分方向调研失败：" + error.localizedDescription
        }
    }

    // 语料检索：跨项目在来源原文里搜关键词（与 CLI corpus 同一份 core）
    // 题库体检：全库深度校验，结果一行说清（错在哪里列前几条）
    func loadPackAudit() async {
        packAuditText = "体检中…"
        do {
            let result = try await engine.packValidateAll()
            let bad = result.bad ?? 0
            var line = "题包 " + String(result.packs ?? 0) + " 个 / " + String(result.tasks ?? 0) + " 道题："
            line += bad == 0 ? ("0 错误，" + String(result.warnings ?? 0) + " 条提醒") : (String(bad) + " 个包有问题")
            let firstErrors = (result.rows ?? []).filter { ($0.ok ?? true) == false }.prefix(3).map { row in
                (row.packId ?? "?") + "：" + ((row.errors ?? []).first ?? "")
            }
            if !firstErrors.isEmpty { line += "\n" + firstErrors.joined(separator: "\n") }
            packAuditText = line
        } catch {
            packAuditText = "体检失败：" + error.localizedDescription
        }
    }

    // 掌握度：最弱的先补，并给出今天先练哪几道（与 CLI mastery 同一份 core）
    func loadMastery(limit: Int = 5) async {
        do {
            let result = try await engine.mastery(limit: limit)
            masteryWeak = (result.report?.weakest ?? [])
            masteryNext = (result.report?.nextUp ?? [])
            masteryMessage = "有题知识点 " + String(result.report?.withTasks ?? 0) + " 个，练过 " + String(result.report?.practiced ?? 0) + " 个"
        } catch {
            masteryMessage = "算掌握度失败：" + error.localizedDescription
        }
    }

    // 数据体检：跑一次 / 修复（与 CLI doctor 同一份 core/doctor.mjs）
    func runDoctor(fix: Bool) async {
        do {
            let result = fix ? try await engine.doctorFix() : try await engine.doctor()
            doctorText = result.markdown ?? ""
            let stats = fix ? (result.after ?? result.stats) : result.stats
            doctorMessage = "发现 " + String(stats?.total ?? 0) + " 项（错误 " + String(stats?.errors ?? 0)
                + " / 提醒 " + String(stats?.warns ?? 0) + "），可自动修 " + String(stats?.fixable ?? 0) + " 项"
        } catch {
            doctorMessage = "体检失败：" + error.localizedDescription
        }
    }

    func runCorpusSearch(_ query: String, any: Bool) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { corpusMessage = "先输入关键词"; return }
        do {
            let result = try await engine.corpusSearch(q: q, any: any, limit: 30)
            corpusHits = result.hits ?? []
            let scanned = result.scanned
            corpusMessage = "命中 " + String(result.total ?? 0) + " 行；检索了 " + String(scanned?.sources ?? 0) + " 份来源约 " + String(scanned?.chars ?? 0) + " 字"
                + ((scanned?.withoutText ?? 0) > 0 ? "；另有 " + String(scanned?.withoutText ?? 0) + " 份来源没有原文" : "")
        } catch {
            corpusMessage = "检索失败：" + error.localizedDescription
        }
    }

    // 刷新知识点：补了题包后让老项目用上（与 CLI project refresh 同一份 core）
    func refreshPoints(_ name: String) async {
        do {
            let result = try await engine.refreshProjectPoints(name)
            draftMessage = "刷新完成：" + String(result.sources ?? 0) + " 条来源中 " + String(result.changed ?? 0) + " 条补到新知识点 → 知识点 "
                + String(result.points ?? 0) + " 个 / 可练题 " + String(result.tasks ?? 0) + " 道"
            await loadProjects()
            if !name.isEmpty { await loadProjectIndex(); await loadDrillPlan(name) }
        } catch {
            draftMessage = "刷新失败：" + error.localizedDescription
        }
    }

    // 岗位描述 → 练习清单（计划草案；与 CLI project jdplan 同一份 core）
    func runJdPlan(_ name: String) async {
        do {
            let result = try await engine.jdPlan(project: name, max: 10)
            jdPlanText = result.markdown ?? ""
            flowMessage = jdPlanText.isEmpty ? "这份岗位描述没有命中知识点" : "已生成练习清单（" + String(jdPlanText.count) + " 字），可点「按清单开练」"
        } catch {
            flowMessage = "生成练习清单失败：" + error.localizedDescription
        }
    }

    func runSurvey(_ text: String) async {
        let parts = text.components(separatedBy: "\n---")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if parts.count < 2 { flowMessage = "至少两份岗位要求，用一行 --- 分隔"; return }
        do {
            let result = try await engine.survey(texts: parts)
            describeReport = result.markdown ?? ""
            let stats = result.stats
            flowMessage = "调研完成：" + String(stats?.jobs ?? 0) + " 份；技术栈 " + String(stats?.terms ?? 0) + " 项；通用 " + String(stats?.common ?? 0) + " 项；缺口 " + String(stats?.gaps ?? 0) + " 项"
        } catch {
            flowMessage = "调研失败：" + error.localizedDescription
        }
    }

    // 描述与提取：技术栈按类别抽全 + 知识点 + 未覆盖清单
    func runDescribe(_ text: String) async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty { flowMessage = "先把岗位要求/文档正文粘进来"; return }
        do {
            let result = try await engine.describe(text: body)
            describeReport = result.markdown ?? ""
            let stats = result.stats
            flowMessage = "已提取：技术栈 " + String(stats?.terms ?? 0) + " 项 / " + String(stats?.categories ?? 0) + " 类；知识点 " + String(stats?.points ?? 0) + " 个；可练题 " + String(stats?.tasks ?? 0) + " 道；未覆盖 " + String(stats?.uncovered ?? 0) + " 项"
        } catch {
            flowMessage = "描述失败：" + error.localizedDescription
        }
    }

    // 投递材料：逐条对硬要求 + 可粘贴要点 + 差异自陈
    func runFlowPack(_ id: String) async {
        do {
            let pack = try await engine.flowPack(id: id)
            flowPack = pack
            flowMessage = "投递材料已生成：" + (pack.company ?? "") + " · " + (pack.position ?? "") + "　匹配度 " + String(pack.match ?? 0) + "%"
        } catch {
            flowMessage = "生成投递材料失败：" + error.localizedDescription
        }
    }

    // 按岗位建项目 + 写学习计划
    func runFlowBuild(_ id: String) async {
        do {
            let built = try await engine.flowBuild(id: id)
            let plan = built.plan
            flowMessage = "已建项目 " + (built.project ?? "") + "：匹配度 " + String(plan?.match ?? 0) + "%　待练 " + String((plan?.missingTasks ?? []).count) + " 道　交付标准 " + String((built.scaffold?.deliverables ?? []).count) + " 条"
            flowPlan = plan
            flowScaffold = built.scaffold
            flowFiles = built.files ?? []
            await loadProjects()
            await loadFlow()
        } catch {
            flowMessage = "建项目失败：" + error.localizedDescription
        }
    }

    // 截图当 JD（识图 → 理解 → 入库）
    func runFlowCollectImage(at path: String) async {
        guard let dataUrl = Engine.dataUrlOfImage(at: path) else { flowMessage = "读不出这张图（只支持 PNG/JPEG/WebP/GIF/HEIC）"; return }
        do {
            let saved = try await engine.flowCollectImage(dataUrl: dataUrl)
            flowMessage = saved.ok == true ? ("已入库：" + (saved.job?.company ?? "") + " · " + (saved.job?.position ?? "")) : (saved.error ?? "入库失败")
            await loadFlow()
            await loadJobs()
        } catch {
            flowMessage = "截图入库失败：" + error.localizedDescription
        }
    }

    // 按链接抓 JD：招聘站点要登录，Cookie 用 DSH_LEARN_COOKIE 配一次
    func runFlowCollectUrl(_ url: String) async {
        let target = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if target.isEmpty { flowMessage = "先填岗位链接"; return }
        flowMessage = "抓取中…（登录站点需要先设 DSH_LEARN_COOKIE）"
        do {
            let saved = try await engine.flowCollectUrl(target)
            flowMessage = saved.ok == true ? ("已入库：" + (saved.job?.company ?? "") + " · " + (saved.job?.position ?? "")) : (saved.error ?? "入库失败")
            await loadFlow()
            await loadJobs()
        } catch {
            flowMessage = "抓取失败：" + error.localizedDescription
        }
    }

    func runFlowApply(_ id: String) async {
        do {
            let done = try await engine.flowApply(id: id)
            flowMessage = "已记投递：" + (done.job?.company ?? "") + " · " + (done.job?.position ?? "") + "（" + (done.job?.status ?? "") + "）"
            await loadFlow()
            await loadJobs()
        } catch {
            flowMessage = "记投递失败：" + error.localizedDescription
        }
    }

    // 识图能力：界面上如实显示"这台机器能不能识图、走哪个引擎"
    func loadOcrCapabilities() async {
        do {
            let caps = try await engine.ocrCapabilities()
            if let chosen = caps.chosen, let hit = (caps.engines ?? []).first(where: { $0.id == chosen }) {
                ocrLine = "识图引擎：" + hit.name + "（可用，离线）"
            } else {
                ocrLine = "识图不可用：" + (caps.advice ?? []).joined(separator: "；")
            }
        } catch {
            ocrLine = ""
        }
    }

    // 文字理解：把这段文本读成结构化信息（分类 / 公司 / 岗位 / 级别 / 硬要求 / 加分项 / 技术栈 / 知识点 / 可练题）
    func runUnderstand(_ text: String) async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty { understandingMessage = "先把岗位描述或文档正文粘进来"; return }
        understandingMessage = "理解中…"
        do {
            let result = try await engine.understand(body)
            understanding = result
            understandingMessage = result.summary ?? ""
        } catch {
            understanding = nil
            understandingMessage = "理解失败：" + error.localizedDescription
        }
    }

    // 搜一下（只看结果）
    func runSearch(_ query: String) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { searchMessage = "先写搜索词，例如「kubectl rollout restart 官方文档」"; return }
        searchMessage = "搜索中…"
        researchRows = []
        searchTasks = []
        do {
            let payload = try await engine.search(q)
            if payload.ok {
                searchHits = payload.results ?? []
                searchMessage = "引擎 " + (payload.engine ?? "-") + "　结果 " + String(payload.total ?? searchHits.count) + " 条"
            } else {
                searchHits = []
                searchMessage = "搜索失败：" + (payload.reason ?? "未知原因")
            }
        } catch {
            searchHits = []
            searchMessage = "搜索失败：" + error.localizedDescription
        }
    }

    // 搜索并解析；intoProject=true 时顺手把页面收进当前项目（笔记 + 草案 + 索引）
    func runResearch(_ query: String, intoProject: Bool) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { searchMessage = "先写搜索词"; return }
        if intoProject && projectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            searchMessage = "「解析并收进项目」要先填项目名（下面的项目名输入框）"
            return
        }
        searchMessage = "搜索并逐个抓取解析中…（每页要抓一次，慢一点）"
        searchHits = []
        do {
            let payload = try await engine.research(q, project: intoProject ? effectiveProjectName : "")
            guard payload.ok else { searchMessage = "搜索失败：" + (payload.reason ?? "未知原因"); return }
            researchRows = payload.results ?? []
            searchTasks = payload.tasks ?? []
            var line = "引擎 " + (payload.engine ?? "-") + "　搜到 " + String(payload.searched ?? 0) + " 条，抓到 " + String(payload.fetched ?? 0) + " 页"
            line += "　合并知识点 " + String((payload.points ?? []).count) + " 个 / 可练题 " + String(searchTasks.count) + " 道"
            if let project = payload.project { line += "　已收进项目 " + project + "（" + String(payload.ingested ?? 0) + " 个来源）" }
            searchMessage = line
            if intoProject { await loadProjects(); await loadProjectIndex() }
        } catch {
            searchMessage = "解析失败：" + error.localizedDescription
        }
    }

    // 来源台账 + 原文：点一条来源看完整岗位描述（服务端从 sources/ 读，原封不动）
    // 开练清单：项目涉及哪些题、已通过多少、先练哪几道（与 CLI project drill、网页版同一份）
    func loadDrillPlan(_ name: String) async {
        do {
            let result = try await engine.drillPlan(project: name, limit: 8)
            drillPlan = result.plan
        } catch {
            drillPlan = nil
            draftMessage = "算开练清单失败：" + error.localizedDescription
        }
    }

    func loadProjectSources(_ name: String) async {
        do {
            let envelope = try await engine.projectMeta(name)
            projectSources = envelope.meta?.sources ?? []
        } catch {
            projectSources = []
            draftMessage = "读取来源失败：" + error.localizedDescription
        }
    }

    func loadSourceText(_ name: String, index: Int) async {
        do {
            let result = try await engine.sourceText(name, index: index)
            if result.ok == true {
                sourceText = result.text ?? ""
                sourceTitle = (result.sourceMeta?.source ?? result.source ?? "") + "（" + String(sourceText.count) + " 字）"
            } else {
                sourceText = ""
                sourceTitle = result.error ?? "读不到原文"
            }
        } catch {
            sourceText = ""
            sourceTitle = "读不到原文：" + error.localizedDescription
        }
    }

    // 旧数据补原文（与 CLI project backfill 同一份 core）
    func backfillText(dir: String) async {
        do {
            let result = try await engine.backfillText(dir: dir.trimmingCharacters(in: .whitespaces))
            let filled = (result.projects ?? []).reduce(0) { $0 + ($1.filled ?? 0) }
            draftMessage = "回填完成：补回 " + String(filled) + " 条原文"
            await loadProjects()
            if !projectName.isEmpty { await loadProjectSources(projectName) }
        } catch {
            draftMessage = "回填失败：" + error.localizedDescription
        }
    }

    func hideProject(_ name: String) async {
        hiddenProjects.insert(name)
    }

    func unhideAll() async {
        hiddenProjects.removeAll()
    }

    func renameProject(_ name: String, to: String) async {
        do {
            let result = try await engine.renameProject(name, to: to)
            if result.ok == true {
                if projectName == name { projectName = result.name ?? to }
                draftMessage = "已重命名：" + name + " → " + (result.name ?? to)
                await loadProjects()
                await loadProjectIndex()
            } else {
                draftMessage = "重命名失败：" + (result.error ?? "未知原因")
            }
        } catch {
            draftMessage = "重命名失败：" + error.localizedDescription
        }
    }

    func deleteProject(_ name: String) async {
        do {
            let result = try await engine.deleteProject(name)
            if result.ok == true {
                if projectName == name { projectName = ""; projectIndex = nil; projectSources = []; sourceText = "" }
                draftMessage = "已删除项目：" + name
                await loadProjects()
            } else {
                draftMessage = "删除失败：" + (result.error ?? "未知原因")
            }
        } catch {
            draftMessage = "删除失败：" + error.localizedDescription
        }
    }

    func loadProjectIndex() async {
        let name = effectiveProjectName
        do {
            projectIndex = try await engine.projectIndex(name)
            await loadDrafts()
        } catch {
            projectIndex = nil
            draftMessage = "读取项目索引失败：" + error.localizedDescription
        }
    }

    // ---- 简历投递 ----
    func loadJobs() async {
        do {
            let payload = try await engine.jobs()
            jobs = payload.jobs
            jobsStats = payload.stats
            jobsFollow = payload.follow
            if let rows = payload.statuses { jobStatuses = rows }
            jobsMessage = jobs.isEmpty ? "还没有投递记录：上面填公司 / 岗位就能存一条。" : "共 " + String(jobs.count) + " 条"
        } catch {
            jobsMessage = "读取投递记录失败：" + error.localizedDescription
        }
    }

    func jobStatusLabel(_ status: String) -> String {
        (jobStatuses.first { $0.id == status }?.label) ?? status
    }

    func saveJob(company: String, position: String, url: String, status: String, appliedAt: String, note: String, jd: String) async {
        jobsMessage = "保存中…"
        do {
            let payload = try await engine.saveJob([
                "id": jobEditing,
                "company": company,
                "position": position,
                "url": url,
                "status": status,
                "appliedAt": appliedAt,
                "note": note,
                "jd": jd
            ])
            jobsMessage = (payload.created == true ? "已新增：" : "已更新：") + (payload.job?.company ?? "") + " · " + (payload.job?.position ?? "")
            jobEditing = ""
            await loadJobs()
        } catch {
            jobsMessage = "保存失败：" + error.localizedDescription
        }
    }

    func deleteJob(_ id: String) async {
        do {
            _ = try await engine.deleteJob(id: id)
            jobsMessage = "已删除这条记录"
            if jobEditing == id { jobEditing = "" }
            await loadJobs()
        } catch {
            jobsMessage = "删除失败：" + error.localizedDescription
        }
    }

    func analyzeJob(_ id: String) async {
        jobsMessage = "分析 JD 中…"
        do {
            let payload = try await engine.analyzeJob(id: id)
            let points = payload.analysis?.points.count ?? 0
            let tasks = payload.analysis?.tasks.count ?? 0
            jobsMessage = "分析完成：知识点 " + String(points) + " 个 → 可练题 " + String(tasks) + " 道"
            await loadJobs()
        } catch {
            jobsMessage = "分析失败：" + error.localizedDescription
        }
    }

    // 练相关题：把这条 JD 的可练题换成开练清单（与网页版「练相关题」同一套 jump）
    func drillJob(_ id: String) async {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        let tasks = job.analysis?.tasks ?? []
        if tasks.isEmpty { jobsMessage = "这条还没有可练题：先点「分析 JD」（没存 JD 就把岗位描述粘进去）"; return }
        jump(to: tasks[0])
        engine.note("按投递记录开练：" + job.company + " → " + String(tasks.count) + " 题")
        jobsMessage = "已按这条 JD 开练：" + String(tasks.count) + " 道（第一题已选中）"
    }

    // 建项目并收 JD：项目名用「公司-岗位」，内容就是这份 JD
    func jobToProject(_ id: String) async {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        let name = (job.company + "-" + job.position).replacingOccurrences(of: " ", with: "-")
        let text = (job.jd?.isEmpty == false) ? (job.jd ?? "") : (job.company + " " + job.position)
        do {
            let ingested = try await engine.ingestText(project: String(name.prefix(40)), text: text)
            jobsMessage = "已建项目 " + (ingested.project ?? name) + "：知识点 " + String(ingested.knowledge?.matched ?? 0) + " 个——到「项目」页看它"
            await loadProjects()
        } catch {
            jobsMessage = "建项目失败：" + error.localizedDescription
        }
    }

    func loadDrafts() async {
        do {
            projectDrafts = try await engine.projectDrafts(effectiveProjectName).drafts
            draftMessage = projectDrafts.isEmpty
                ? "这个项目里还没有草案：先收一次仓库或含命令示例的链接（截图/纯文字通常只有知识点）。"
                : "共 " + String(projectDrafts.count) + " 份草案"
        } catch {
            draftMessage = "读取草案失败：" + error.localizedDescription
        }
    }

    // 草案入库：toCatalog=true 进总题库（用户题库目录），false 进项目的 promoted/ 暂存区。
    // 两种都先走 dryRun 预览过——网页版是两步按钮，桌面端用二次确认代替。
    func promoteDraft(_ file: String, toCatalog: Bool, dryRun: Bool) async {
        draftMessage = dryRun ? "校验中…" : (toCatalog ? "写入总题库中…" : "转换中…")
        do {
            let result = try await engine.promoteDraft(project: effectiveProjectName, file: file, toCatalog: toCatalog, dryRun: dryRun)
            if let errors = result.errors, !errors.isEmpty {
                draftMessage = "有 " + String(errors.count) + " 个错误，先修草案：" + errors.prefix(2).joined(separator: "；")
                return
            }
            if dryRun {
                let warns = (result.warnings ?? []).count
                draftMessage = "预览（没有写文件）：" + (result.target ?? "-") + "　" + String(result.taskCount ?? 0) + " 道题"
                    + (warns > 0 ? "；复核提醒 " + String(warns) + " 条" : "")
                return
            }
            draftMessage = toCatalog
                ? "已加入总题库：" + String(result.taskCount ?? 0) + " 道题（" + (result.packId ?? "") + "）——这些题下次启动就能练；撤销就删掉用户题库目录里的这个文件"
                : "已写入项目暂存区 promoted/：" + String(result.taskCount ?? 0) + " 道题（还没进总题库）"
            engine.note("草案入库：" + (result.packId ?? file) + " → " + (result.target ?? "-"))
            await loadDrafts()
        } catch {
            draftMessage = "处理失败：" + error.localizedDescription
        }
    }

    private func runProjectIngest(_ work: @escaping () async throws -> ProjectIngest) async {
        projectBusy = true
        defer { projectBusy = false }
        do {
            projectResult = try await work()
            await loadProjects()
        } catch {
            errorText = error.localizedDescription
        }
    }

    func ingestRepo(path: String?, url: String?) async {
        let name = effectiveProjectName
        await runProjectIngest { try await self.engine.ingestRepo(project: name, repoPath: path, repoUrl: url) }
    }

    func ingestText(_ text: String) async {
        let name = effectiveProjectName
        await runProjectIngest { try await self.engine.ingestText(project: name, text: text) }
    }

    func ingestLink(_ url: String) async {
        let name = effectiveProjectName
        await runProjectIngest { try await self.engine.ingestLink(project: name, url: url) }
    }

    // 截图：选文件 → 读成 dataURL → 交给服务端 Vision OCR → 知识点与草案题。
    // 客户端只负责"把图交出去"，识别逻辑与网页版完全同一条路。
    func ingestScreenshot(path: String) async {
        guard let dataUrl = Engine.dataUrlOfImage(at: path) else {
            errorText = "这个文件不是受支持的图片格式（png / jpg / webp / gif / heic）"
            return
        }
        let name = effectiveProjectName
        // 带上原文件名：服务端用它给 notes/ 与 drafts/ 里的产物起名（否则只会留下 OCR 临时文件名）
        let fileName = (path as NSString).lastPathComponent
        await runProjectIngest { try await self.engine.ingestScreenshot(project: name, dataUrl: dataUrl, fileName: fileName) }
    }

    // 项目里的知识点 → 开练清单（与网页版同一个 action=tasks）：命中哪些题、就跳到第一题
    func drillFromProject(_ name: String) async {
        do {
            let listed = try await engine.projectTasks(name)
            if let first = listed.tasks.first {
                jump(to: first)
                engine.note("按项目开练：" + name + " → " + String(listed.tasks.count) + " 题")
            } else {
                engine.note("按项目开练：" + name + " 没有可练的题（知识点未挂题或记录较早）")
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    // 跑一次只读验证：题目没绑验证项时如实说明，不假装跑过
    func runVerify() async {
        guard let task = selectedTask else { return }
        guard task.verify?.cmd != nil else {
            verifyResult = VerifyResult(ok: nil, ran: false, cmd: nil, runner: nil, output: nil,
                                        reason: "这道题没有绑定只读验证项（可选字段，题库里没写就没有）。", expect: nil, taskId: task.id)
            return
        }
        verifyBusy = true
        defer { verifyBusy = false }
        do {
            verifyResult = try await engine.verify(taskId: task.id, platform: platform).verify
            engine.note("只读验证：" + task.id + " → " + ((verifyResult?.ok ?? false) ? "通过" : "未通过"))
        } catch {
            errorText = error.localizedDescription
        }
    }

    func loadReview() async {
        let payload = try? await engine.review(track: track)
        reviewDue = payload?.due ?? []
        reviewUpcoming = payload?.upcoming ?? []
    }

    // 「跳到某道题」只有这一份实现：每日一题与复习队列都用它。
    // 关键在"被筛选挡住时先清筛选"——否则点了按钮却看不见那道题，看起来像坏了。
    func jump(to taskId: String) {
        guard tasks.contains(where: { $0.id == taskId }) else { return }
        if !visibleTasks.contains(where: { $0.id == taskId }) {
            track = "all"
            level = "all"
            query = ""
            persist()
        }
        select(taskId)
    }

    // 每日一题的理由（"该复习了" / "上次没满分" / "还没练过"）直接显示，别让用户猜为什么是这道
    var dailyReason: String {
        guard let pick = daily else { return "还没有可推荐的题" }
        // 服务端给出的 why 就是给人看的那句话：客户端只负责显示，不再按 pool 自己拼
        if let why = pick.why, !why.isEmpty { return why }
        switch pick.pool {
        // 服务端给的 reason 本身就是完整一句话（"该复习了（已逾期 1 天）"），网页版与命令行都直接用这句。
        // 这里原本又套了一层括号，界面上显示成"该复习了（该复习了（已逾期 1 天））"——真机截图看到的重复。
        case "review":
            if let reason = pick.reason, !reason.isEmpty { return reason }
            return "该复习了"
        case "weak": return "上次没满分" + (pick.best != nil ? "（最好 " + String(pick.best!) + " 分）" : "")
        default: return "还没练过"
        }
    }

    // 开始每日一题：跳转规则与复习队列共用 jump()（挡住就先清筛选）
    func startDaily() async {
        guard let taskId = daily?.taskId else { return }
        jump(to: taskId)
        engine.note("每日一题：" + taskId)
    }

    func startReview(_ taskId: String) async {
        jump(to: taskId)
        engine.note("复习：" + taskId)
    }

    func loadHistory() async {
        guard let taskId = selected else { history = []; return }
        history = (try? await engine.history(taskId: taskId, platform: platform))?.history ?? []
    }

    func loadNote() async {
        guard let taskId = selected else { noteText = ""; return }
        let payload = try? await engine.note(taskId: taskId)
        noteText = payload?.note?.text ?? ""
        noteSavedAt = payload?.note?.updatedAt ?? payload?.note?.at
    }

    // 保存笔记：空内容等于删除（与网页版一致），并给出"已保存"的时间戳
    func saveNote() async {
        guard let taskId = selected else { return }
        do {
            let saved = try await engine.saveNote(taskId: taskId, text: noteText)
            noteSavedAt = saved.note?.updatedAt ?? saved.note?.at
            engine.note("笔记已保存：" + taskId + "（" + String(noteText.count) + " 字）")
        } catch {
            errorText = error.localizedDescription
        }
    }

    func deleteNote() async {
        noteText = ""
        await saveNote()
    }

    func select(_ taskId: String) {
        guard taskId != selected else { return }
        selected = taskId
        answer = ""
        result = nil
        verifyResult = nil
        noteText = ""
        noteSavedAt = nil
        persist()
        Task { await loadHistory() }
        Task { await loadNote() }
    }

    // 轨道 / 难度 / 搜索变化都落盘：下次开窗继续用同一套筛选
    // 当前筛选的文字描述：空列表时显示给用户看，避免"为什么一道题都没有"
    var filterSummary: String {
        var parts: [String] = []
        if track != "all" { parts.append("轨道 " + track) }
        if level != "all" { parts.append("难度 " + levelLabel(level)) }
        if !query.isEmpty { parts.append("搜索「" + query + "」") }
        return parts.isEmpty ? "全部题目" : parts.joined(separator: " · ")
    }

    func resetFilters() {
        track = "all"
        level = "all"
        query = ""
        if let current = selected, !visibleTasks.contains(where: { $0.id == current }) {
            selected = visibleTasks.first?.id
        }
        persist()
    }

    func setFilter(track newTrack: String? = nil, level newLevel: String? = nil, query newQuery: String? = nil) {
        if let value = newTrack { track = value }
        if let value = newLevel { level = value }
        if let value = newQuery { query = value }
        if let current = selected, !visibleTasks.contains(where: { $0.id == current }) {
            selected = visibleTasks.first?.id
        }
        persist()
        // 换轨道要重新问一次"今天该练什么"与"该复习什么"：服务端按轨道挑
        if newTrack != nil { Task { await loadDaily(); await loadReview() } }
    }

    var selectedTask: LearnTask? { tasks.first { $0.id == selected } }

    func submit() async {
        guard let task = selectedTask, !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        // 题目声明了 platforms 且当前平台不在其中：不判分（兜底规则可能是本平台不存在的命令），
        // 也不记录——直接把原因摆出来，别让学员怀疑自己的写法
        if task.supported == false {
            let only = (task.taskPlatforms ?? []).joined(separator: " / ")
            errorText = "这道题只在 " + only + " 上有参考答案，当前平台（" + platform + "）不适用：换平台再练，或看其他平台写法对比着记"
            result = nil
            return
        }
        busy = true
        defer { busy = false }
        do {
            let payload = try await engine.check(taskId: task.id, answer: answer, clientId: clientId, platform: platform, run: runAnswer)
            result = payload
            // 判定结果主动播报一次（与网页版 aria-live 对齐），读屏用户不用自己去右栏找。
            // 播报是主线程 API，而这里在异步提交里，所以显式跳回主 actor。
            Task { @MainActor in announceVerdict(payload) }
            await refreshProgress()
            await loadHistory()
            // 刚做完一道题，"今天该练的"与复习队列都该跟着变（节奏由服务端算）
            await loadDaily()
            await loadReview()
        } catch {
            errorText = error.localizedDescription
        }
    }

    // 判定后自动跳下一题：练习节奏不被打断（右栏的"下一题"按钮走这里）
    func next() async {
        let list = visibleTasks
        guard let current = selected, let index = list.firstIndex(where: { $0.id == current }), index + 1 < list.count else { return }
        select(list[index + 1].id)
    }
}

// MARK: - 判定结果条

struct FlowText: View {
    var items: [String]
    var tint: Color
    var onTap: ((String) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(items, id: \.self) { item in
                Button {
                    onTap?(item)
                } label: {
                    Text(item)
                        .font(.system(.caption, design: .monospaced))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(tint.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help("点一下把它从输入里移除，再判定看看分数怎么变")
                .accessibilityLabel("已命中：" + item + "，点击可从输入中移除")
            }
        }
    }
}

// MARK: - 题目详情与作答

