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

struct RepoPage: View {
    @EnvironmentObject var store: Store

    @State private var importDir = "docs/samples/boss"
    @State private var importPrefix = "boss-"
    @State private var filterText = ""
    @State private var sortBy = "updated"
    @State private var sourceFilter = ""
    @State private var backfillDir = "docs/samples/boss"
    @State private var corpusQuery = ""
    @State private var corpusAny = false

    var body: some View {
        // 左：摄入与项目列表；右：选中项目的索引与草案。
        // 之前是把整页项目视图（内部 HSplitView + List + ScrollView）塞进外层 ScrollView，
        // 嵌套滚动让列表塌成一行、标题与说明文字重叠——改成两侧各自独立滚动，别再嵌套。
        HSplitView {
            leftColumn
            rightColumn
        }
        .onAppear {
            Task {
                await store.loadProjects()
                await store.loadProjectIndex()
                await store.loadDrafts()
                if !store.projectName.isEmpty { await store.loadDrillPlan(store.projectName) }
            }
        }
        .alert("重命名项目", isPresented: Binding(get: { store.renameTarget != nil }, set: { if !$0 { store.renameTarget = nil } })) {
            TextField("新名字", text: $store.renameText)
            Button("取消", role: .cancel) { store.renameTarget = nil }
            Button("改名") {
                if let target = store.renameTarget {
                    Task { await store.renameProject(target, to: store.renameText) }
                }
                store.renameTarget = nil
            }
        } message: {
            Text("会同时改项目目录名与元数据；同名项目已存在时会拒绝。")
        }
        .confirmationDialog(
            "删除项目「" + (store.deleteTarget ?? "") + "」？",
            isPresented: Binding(get: { store.deleteTarget != nil }, set: { if !$0 { store.deleteTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("删除（不可撤销）", role: .destructive) {
                if let target = store.deleteTarget { Task { await store.deleteProject(target) } }
                store.deleteTarget = nil
            }
            Button("取消", role: .cancel) { store.deleteTarget = nil }
        } message: {
            Text("会删掉这个项目的目录：来源台账、原文、草案都在里面。只想从列表里拿掉就用「移除」。")
        }
    }

    private var leftColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("项目 / 仓库").font(.title2).bold()
                Text("把项目、仓库、截图、链接、文字里的知识点收进项目目录，并生成题目草案；草案确认后才进题库。")
                    .font(.callout).foregroundStyle(.secondary)
                importRow
                ProjectSection()
                Divider()
                projectListBlock
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 360, idealWidth: 420)
    }

    private var importRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("按目录导入语料（每个子目录一个项目）").font(.headline)
            HStack(spacing: 8) {
                TextField("目录，例如 docs/samples/boss", text: $importDir).textFieldStyle(.roundedBorder)
                TextField("前缀", text: $importPrefix).textFieldStyle(.roundedBorder).frame(width: 80)
                Button("导入") { Task { await store.runImportTree(dir: importDir, prefix: importPrefix) } }
                    .buttonStyle(.link).font(.caption)
            }
        }
    }

    private var projectListBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("项目列表").font(.headline)
                Text(String(visibleProjects.count) + " / " + String(store.projects.count) + " 个").font(.caption).foregroundStyle(.secondary)
                Spacer()
                ProjectsFilterBar(store: store)
Button("刷新列表") { Task { await store.loadProjects() } }
                Button("题库体检") { Task { await store.loadPackAudit() } }
                    .buttonStyle(.link).font(.caption)
            }
            HStack(spacing: 8) {
                TextField("筛选项目名", text: $filterText).textFieldStyle(.roundedBorder).frame(width: 160)
                Picker("排序", selection: $sortBy) {
                    Text("更新时间").tag("updated")
                    Text("来源数").tag("sources")
                    Text("知识点").tag("knowledge")
                    Text("草案题").tag("tasks")
                    Text("名字").tag("name")
                }
                .pickerStyle(.menu).labelsHidden().frame(width: 110)
                TextField("回填目录", text: $backfillDir).textFieldStyle(.roundedBorder).frame(width: 150)
                Button("回填原文") { Task { await store.backfillText(dir: backfillDir) } }
                Button("刷新知识点") { Task { await store.refreshPoints(store.projectName) } }
                    .buttonStyle(.link).font(.caption)
                    .help("补了题包后，让老项目用上新增的知识点与题")
                    .buttonStyle(.link).font(.caption)
                    .help("旧来源没有原文时，用这个目录把原文补回来")
            }
            if !store.hiddenProjects.isEmpty {
                HStack(spacing: 8) {
                    Text("已移除 " + String(store.hiddenProjects.count) + " 个（只隐藏，磁盘没动）")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("显示并恢复") { Task { await store.unhideAll() } }
                        .buttonStyle(.link).font(.caption)
                }
            }
            if store.projects.isEmpty {
                Text("还没有项目：用上面的「按目录导入语料」或建一个项目、收一次来源。")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(visibleProjects) { row in
                    projectRow(row)
                }
            }
            Text("收来源（截图 / 文字 / 链接 / 仓库）也在这一页的上半部分。")
                .font(.caption).foregroundStyle(.tertiary)
        }
    }

    // 筛选（项目名）+ 排序（更新时间/来源/知识点/草案/名字）；hiddenProjects 里的不显示
    private var visibleProjects: [ProjectRow] {
        let keyword = filterText.trimmingCharacters(in: .whitespaces).lowercased()
        var rows = store.projects.filter { !store.hiddenProjects.contains($0.name) }
        if !keyword.isEmpty {
            rows = rows.filter { ($0.name + " " + ($0.displayName ?? "")).lowercased().contains(keyword) }
        }
        switch sortBy {
        case "sources": rows.sort { ($0.sources ?? 0) > ($1.sources ?? 0) }
        case "knowledge": rows.sort { ($0.knowledge ?? 0) > ($1.knowledge ?? 0) }
        case "tasks": rows.sort { ($0.tasks ?? 0) > ($1.tasks ?? 0) }
        case "name": rows.sort { $0.name < $1.name }
        default: rows.sort { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
        }
        return rows
    }

    private var filteredSources: [ProjectMetaSource] {
        let keyword = sourceFilter.trimmingCharacters(in: .whitespaces).lowercased()
        guard !keyword.isEmpty else { return store.projectSources }
        return store.projectSources.filter { ($0.source ?? "").lowercased().contains(keyword) }
    }

    @ViewBuilder
    private func projectRow(_ row: ProjectRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                store.projectName = row.name
                Task { await store.loadProjectIndex(); await store.loadProjectSources(row.name); await store.loadDrillPlan(row.name) }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.displayName ?? row.name).font(.callout)
                    Text(projectRowLine(row)).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            HStack(spacing: 8) {
                Button("重命名") { store.renameTarget = row.name; store.renameText = row.name }
                    .buttonStyle(.link).font(.caption)
                Button("移除") { Task { await store.hideProject(row.name) } }
                    .buttonStyle(.link).font(.caption)
                    .help("只从这个列表里移除，不删磁盘上的文件")
                Button("删除") { store.deleteTarget = row.name }
                    .buttonStyle(.link).font(.caption).foregroundStyle(.red)
                    .help("删除项目目录，不可撤销")
            }
        }
        .padding(6)
        .background(rowBackground(row))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }


    private func indexTitle(_ index: ProjectIndex) -> String {
        "项目索引：" + (index.displayName ?? index.project)
    }

    private func indexSummary(_ index: ProjectIndex) -> String {
        "知识点 " + String(index.points.count) + " 个 → 可练题 " + String(index.tasks.count) + " 道"
    }

    private func indexPointNames(_ index: ProjectIndex) -> String {
        index.points.prefix(12).map { $0.name }.joined(separator: "、")
    }

    private func rowBackground(_ row: ProjectRow) -> Color {
        store.projectName == row.name ? Color.secondary.opacity(0.14) : Color.secondary.opacity(0.05)
    }

    private func projectRowLine(_ row: ProjectRow) -> String {
        "来源 " + String(row.sources ?? 0) + "　知识点 " + String(row.knowledge ?? 0) + "　草案题 " + String(row.tasks ?? 0)
    }

    private var rightColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let index = store.projectIndex {
                    Text(indexTitle(index)).font(.title3).bold()
                    Text(indexSummary(index)).font(.callout).foregroundStyle(.secondary)
                    if !index.points.isEmpty {
                        Text(indexPointNames(index)).font(.caption).foregroundStyle(.secondary)
                    }
                    if !index.tasks.isEmpty {
                        Button("练这些题（" + String(index.tasks.count) + " 道）") {
                            if let first = index.tasks.first { store.jump(to: first.id) }
                        }
                        .buttonStyle(.link)
                    }
                    Divider()
                    corpusBlock
                    Divider()
                    jdPlanBlock
                    Divider()
                    drillBlock
                    Divider()
                    sourcesBlock
                    Divider()
                    draftsBlock
                } else {
                    Text("左边点一个项目，这里会显示它的索引与草案。")
                        .font(.callout).foregroundStyle(.secondary)
                    if !store.draftMessage.isEmpty {
                        Text(store.draftMessage).font(.callout).foregroundStyle(.tertiary)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 380)
    }

    // 拼成 String 再交给 Text：直接在 Text 里拼可选值会 type-check 超时（老问题）
    private func corpusHitLine(_ hit: CorpusHit) -> String {
        let name = hit.displayName ?? hit.project
        let source = hit.source ?? ""
        return name + " · " + source + " · 第 " + String(hit.lineNo ?? 0) + " 行"
    }

    // 语料检索：跨项目在来源原文里找关键词
    @ViewBuilder
    private var corpusBlock: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("语料检索").font(.subheadline).bold()
            HStack(spacing: 8) {
                TextField("关键词（如 PostgreSQL、示波器）", text: $corpusQuery).textFieldStyle(.roundedBorder).frame(width: 220)
                Toggle("任一词命中", isOn: $corpusAny).font(.caption)
                Button("检索") { Task { await store.runCorpusSearch(corpusQuery, any: corpusAny) } }
                    .buttonStyle(.link).font(.caption)
            }
            Text(store.corpusMessage).font(.caption2).foregroundStyle(.secondary)
            ForEach(store.corpusHits.prefix(12)) { hit in
                Button {
                    Task { await store.loadSourceText(hit.project, index: hit.sourceIndex ?? 1) }
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(corpusHitLine(hit))
                            .font(.caption2).foregroundStyle(.secondary)
                        Text(hit.line ?? "").font(.caption).lineLimit(2)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    // 岗位描述 → 练习清单：点一下把 JD 的技术点映射到题库已有的题
    @ViewBuilder
    private var jdPlanBlock: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("岗位描述 → 练习清单").font(.subheadline).bold()
            HStack(spacing: 8) {
                Button("从 JD 生成练习清单") { Task { await store.runJdPlan(store.projectName) } }
                    .buttonStyle(.link).font(.caption)
                if !store.jdPlanText.isEmpty {
                    Button("按清单开练") {
                        if let first = store.drillPlan?.nextUp.first { store.jump(to: first.id) }
                    }
                    .buttonStyle(.link).font(.caption)
                }
            }
            if !store.jdPlanText.isEmpty {
                Text(String(store.jdPlanText.prefix(400))).font(.caption2).foregroundStyle(.secondary).lineLimit(8)
            }
        }
    }

    // 开练清单：先练哪几道 + 一键开练（与网页版同一份 projectDrillPlan）
    @ViewBuilder
    private var drillBlock: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("开练清单").font(.subheadline).bold()
            if let plan = store.drillPlan, plan.total > 0 {
                Text(planSummary(plan)).font(.callout).foregroundStyle(.secondary)
                Text(planTrackLine(plan)).font(.caption).foregroundStyle(.secondary)
                Text("先练这几道（差一点的先补 → 没练过的从易到难）：").font(.caption).foregroundStyle(.tertiary)
                ForEach(plan.nextUp) { row in
                    Text(planRowLine(row)).font(.caption).lineLimit(2)
                }
                HStack(spacing: 8) {
                    Button("先练这些（" + String(plan.nextUp.count) + " 道）") {
                        if let first = plan.nextUp.first { store.jump(to: first.id) }
                    }
                    .buttonStyle(.link).font(.caption)
                    Button("按清单全练（" + String(plan.total) + " 道）") {
                        if let first = plan.rows.first { store.jump(to: first.id) }
                    }
                    .buttonStyle(.link).font(.caption)
                }
            } else {
                Text("这个项目还没挂上题：来源里没有命中知识点的内容。").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func planSummary(_ plan: DrillPlan) -> String {
        "共 " + String(plan.total) + " 道　已通过 " + String(plan.passed) + "　待练 " + String(plan.missing)
    }

    private func planTrackLine(_ plan: DrillPlan) -> String {
        plan.byTrack.map { $0.track + " " + String($0.passed) + "/" + String($0.total) }.joined(separator: "　")
    }

    private func planRowLine(_ row: DrillPlanTask) -> String {
        row.id + "　" + (row.title ?? "") + "　（" + (row.reason ?? "") + "）"
    }

    private var sourcesBlock: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("来源与原文").font(.subheadline).bold()
            Text("点一条来源看它的完整原文（岗位描述 / 文档原封不动）").font(.caption).foregroundStyle(.tertiary)
            TextField("筛选来源", text: $sourceFilter).textFieldStyle(.roundedBorder).frame(width: 200)
            Text(sourceSummaryLine).font(.caption2).foregroundStyle(.secondary)
            ForEach(Array(filteredSources.enumerated()), id: \.offset) { pair in
                Button {
                    Task { await store.loadSourceText(store.projectName, index: sourceIndexOf(pair.element)) }
                } label: {
                    Text(sourceLine(pair.element, index: sourceIndexOf(pair.element)))
                        .font(.caption).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
            if !store.sourceText.isEmpty || !store.sourceTitle.isEmpty {
                Text(store.sourceTitle).font(.caption2).foregroundStyle(.secondary)
                Text(store.sourceText)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .lineLimit(20)
            }
        }
    }

    // 拼成 String 再交给 Text：直接在 Text 里拼可选 + 三元会 type-check 超时
    private var sourceSummaryLine: String {
        let total = store.projectSources.count
        if sourceFilter.isEmpty { return "共 " + String(total) + " 条" }
        return "共 " + String(total) + " 条（筛出 " + String(filteredSources.count) + " 条）"
    }

    // 检索后列表下标会变，但接口要的是原始序号：按 id 反查
    private func sourceIndexOf(_ row: ProjectMetaSource) -> Int {
        let at = store.projectSources.firstIndex { $0.id == row.id }
        return (at ?? 0) + 1
    }

    private func sourceLine(_ row: ProjectMetaSource, index: Int) -> String {
        let name = row.source ?? "（无名字）"
        let chars = (row.textFile == nil || row.textFile == "") ? "（旧数据，无原文）" : ("原文 " + String(row.textChars ?? 0) + " 字")
        return String(index) + ". " + name + "　" + chars
    }

    private var draftsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("草案 → 总题库").font(.subheadline).bold()
            Text(store.draftMessage).font(.callout).foregroundStyle(.secondary)
            ForEach(store.projectIndex?.drafts ?? []) { row in
                draftRow(row)
            }
        }
    }

    private func draftRow(_ row: ProjectIndexDraft) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.file).font(.caption).lineLimit(1).truncationMode(.middle)
            HStack(spacing: 8) {
                Text(String((row.tasks ?? []).count) + " 题").font(.caption).foregroundStyle(.secondary)
                if row.inCatalog == true {
                    Text("已在总题库").font(.caption).foregroundStyle(.green)
                } else {
                    Button("预览") { Task { await store.promoteDraft(baseName(row.file), toCatalog: true, dryRun: true) } }
                        .buttonStyle(.link).font(.caption)
                    Button("加入总题库") { store.confirmCatalogDraft = row.file }
                        .buttonStyle(.link).font(.caption)
                }
                Button("暂存到项目") { Task { await store.promoteDraft(baseName(row.file), toCatalog: false, dryRun: false) } }
                    .buttonStyle(.link).font(.caption)
            }
        }
        .padding(6)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// 项目 / 仓库：把"一个项目涉及哪些知识点"收进项目目录，与网页版同一套接口。
// 桌面端只做本地路径与 Git 地址两种输入——截图 OCR 走服务端 Vision，留到需要时再加。
struct ProjectSection: View {
    @EnvironmentObject var store: Store
    @State private var repoPath = ""
    @State private var repoUrl = ""
    @State private var text = ""
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 6) {
                TextField("项目名（默认：我的项目）", text: Binding(get: { store.projectName }, set: { store.projectName = $0 }))
                    .textFieldStyle(.roundedBorder)
                HStack(spacing: 6) {
                    TextField("仓库本地路径 /path/to/repo", text: $repoPath)
                        .textFieldStyle(.roundedBorder)
                    Button("解析本地仓库") {
                        Task { await store.ingestRepo(path: repoPath.trimmingCharacters(in: .whitespacesAndNewlines), url: nil) }
                    }
                    .disabled(store.projectBusy || repoPath.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                HStack(spacing: 6) {
                    TextField("Git 地址或 owner/repo", text: $repoUrl)
                        .textFieldStyle(.roundedBorder)
                    Button("克隆并解析") {
                        Task { await store.ingestRepo(path: nil, url: repoUrl.trimmingCharacters(in: .whitespacesAndNewlines)) }
                    }
                    .disabled(store.projectBusy || repoUrl.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                HStack(spacing: 6) {
                    TextField("或贴一段岗位描述 / 文档文字", text: $text)
                        .textFieldStyle(.roundedBorder)
                    Button("收进去") {
                        Task { await store.ingestText(text) }
                    }
                    .disabled(store.projectBusy || text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                HStack(spacing: 6) {
                    Button("选择截图…") { pickScreenshot() }
                        .disabled(store.projectBusy)
                    Text(store.ocrLine.isEmpty ? "岗位要求 / 终端记录截图" : store.ocrLine)
                        .font(.caption).foregroundStyle(.tertiary)
                }
                // 文字描述理解：自由文本 → 结构化信息（与网页版「理解这段文本」、CLI understand 同一份）
                UnderstandBox()
                // 软件自己会搜：搜到之后可以直接解析成知识点与草案题（与网页版、CLI 同一份 core/search.mjs）
                SearchBox()
                if store.projectBusy { ProgressView().controlSize(.small) }
                if let result = store.projectResult {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(resultTitle(result)).font(.caption).bold()
                        if let signals = result.signals, !signals.isEmpty {
                            Text("技术信号：" + signals.map { $0.id }.joined(separator: "、"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let knowledge = result.knowledge {
                            Text(knowledgeLine(knowledge, tasks: result.tasks ?? 0))
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        if let error = result.error {
                            Text(error).font(.callout).foregroundStyle(.red)
                        }
                        if let hint = result.hint, !hint.isEmpty {
                            Text(hint).font(.caption).foregroundStyle(.tertiary)
                        }
                        Button("用这些知识点开练") {
                            Task { await store.drillFromProject(result.project ?? store.effectiveProjectName) }
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                    }
                    .padding(6)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                if !store.projects.isEmpty {
                    Text("已有项目：" + store.projects.prefix(4).map { $0.name + "（知识点 " + String($0.knowledge ?? 0) + "）" }.joined(separator: "、"))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                // 草案 → 总题库：桌面端也能做同一件事（网页版是两步按钮，这里用二次确认代替）
                HStack(spacing: 6) {
                    Button("列出草案") { Task { await store.loadDrafts() } }
                        .disabled(store.projectBusy)
                    Text("草案是待改写的题：先预览看复核提醒，再决定要不要加入总题库")
                        .font(.caption).foregroundStyle(.tertiary)
                }
                if !store.projectDrafts.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(store.projectDrafts) { row in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.file).font(.caption).lineLimit(1).truncationMode(.middle)
                                HStack(spacing: 8) {
                                    Text(String(row.tasks ?? 0) + " 题").font(.caption).foregroundStyle(.secondary)
                                    if row.inCatalog == true {
                                        Text("已在总题库").font(.caption).foregroundStyle(.green)
                                    } else {
                                        Button("预览") { Task { await store.promoteDraft(baseName(row.file), toCatalog: true, dryRun: true) } }
                                            .buttonStyle(.link).font(.caption)
                                        Button("加入总题库") { store.confirmCatalogDraft = row.file }
                                            .buttonStyle(.link).font(.caption)
                                    }
                                    Button("暂存到项目") { Task { await store.promoteDraft(baseName(row.file), toCatalog: false, dryRun: false) } }
                                        .buttonStyle(.link).font(.caption)
                                }
                            }
                        }
                    }
                    .padding(6)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                if !store.draftMessage.isEmpty {
                    Text(store.draftMessage).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
            .padding(.top, 4)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "folder.badge.gearshape")
                .accessibilityHidden(true)
                Text("项目 / 仓库").font(.subheadline).bold()
                Spacer()
                if !store.projects.isEmpty { Text(String(store.projects.count) + " 个").font(.caption).foregroundStyle(.tertiary) }
            }
        }
        .padding(8)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onAppear {
            Task {
                await store.loadOcrCapabilities()
                await store.loadProjects()
                // 草案也一起列出来："这个项目有哪些题可以入库"是打开面板就想知道的事，
                // 不该再点一次「列出草案」才显示（网页版是分开的，桌面端面板小，合并更省事）
                await store.loadDrafts()
            }
        }
        // 加入总题库会改变"可练题库"，进来之前再问一句；撤销方式是删掉用户题库目录里的文件
        .confirmationDialog(
            "把「" + (store.confirmCatalogDraft ?? "") + "」加入总题库？",
            isPresented: Binding(get: { store.confirmCatalogDraft != nil }, set: { if !$0 { store.confirmCatalogDraft = nil } }),
            titleVisibility: .visible
        ) {
            Button("加入总题库") {
                let file = store.confirmCatalogDraft
                store.confirmCatalogDraft = nil
                if let file { Task { await store.promoteDraft(file, toCatalog: true, dryRun: false) } }
            }
            Button("取消", role: .cancel) { store.confirmCatalogDraft = nil }
        } message: {
            Text("写进用户题库目录（~/.dsh-learn/packs/）：所有客户端下次启动就能练到这些题；写错了删掉那个文件即可恢复。")
        }
    }

    // 原生文件选择器：桌面端该有的样子（不是网页里的 <input type=file>）
    private func pickScreenshot() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = "选择岗位要求或终端记录的截图"
        panel.allowedContentTypes = [.png, .jpeg, .webP, .gif, .heic]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await store.ingestScreenshot(path: url.path) }
    }

    // 拆成独立函数：SwiftUI 的表达式类型推断很容易在长字符串拼接上超时
    private func knowledgeLine(_ knowledge: ProjectKnowledge, tasks: Int) -> String {
        let points = String(knowledge.matched)
        let modules = String(knowledge.modules.count)
        let drafts = String(tasks)
        return "知识点 " + points + " 个 / " + modules + " 个模块　草案题 " + drafts + " 道"
    }

    private func viaText(_ via: String) -> String {
        if via == "local" { return "本地目录" }
        if via == "reuse" { return "复用上次的克隆" }
        if via == "direct" { return "直连 GitHub" }
        if via.hasPrefix("mirror:") { return "镜像 " + String(via.dropFirst("mirror:".count)) }
        return via
    }
}

// 复习队列：间隔重复的到期列表。节奏与原因都由服务端算好，这里只显示 + 一键跳过去。
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

struct TaskDetail: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if store.selectedTask != nil {
                ScrollView { detailHeader }
                    .frame(maxHeight: 190)

                Divider()

                answerArea
            } else {
                emptyState
            }
        }
    }

    // 题目头部：轨道/难度/历史、标题、目标、平台与变体说明、要素条数。
    // 拆成独立子表达式是编译器明确建议的——整段 body 一起推断会直接
    // 报 "unable to type-check this expression in reasonable time"。
    @ViewBuilder
    private var detailHeader: some View {
        if let task = store.selectedTask {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(task.track).font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.15)).clipShape(Capsule())
                    Text(store.levelLabel(task.level)).font(.caption).bold()
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.12)).clipShape(Capsule())
                    Spacer()
                    if let stat = store.stat(task.id), stat.attempts > 0 {
                        Text("历史最好 " + String(stat.best) + " 分 / " + String(stat.attempts) + " 次")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(task.title).font(.title2).bold()
                Text(task.goal).font(.body).foregroundStyle(.secondary)
                // 题目声明了 platforms 时：当前平台不在覆盖范围里，判定走兜底规则——必须说出来
                if task.supported == false, let only = task.taskPlatforms, !only.isEmpty {
                    Text("这道题只在 " + only.joined(separator: " / ") + " 上有参考答案，当前平台的判定按兜底规则来")
                        .font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                }
                // 变体题：把"同一条命令在别的平台怎么写"摆出来（与网页版同一份数据）
                if let others = task.others, !others.isEmpty {
                    Text("其他平台写法：" + others.keys.sorted().map { $0 + " → " + (others[$0] ?? "") }.joined(separator: "　"))
                        .font(.callout).foregroundStyle(.tertiary).textSelection(.enabled)
                }
                Text("判定要素 " + String(task.require.count) + " 条")
                    .font(.caption).foregroundStyle(.tertiary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // 作答区：命令输入 + 动作按钮 + 只读验证结果 + 要素说明
    @ViewBuilder
    private var answerArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("你的命令").font(.subheadline).bold()
            TextEditor(text: $store.answer)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 120)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack {
                Button {
                    Task { await store.submit() }
                } label: {
                    Label("判定", systemImage: "checkmark.circle")
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(store.busy || store.answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Toggle("实际跑一遍（只读白名单）", isOn: $store.runAnswer).font(.caption)
                Button("清空") { store.answer = "" }
                // 提示：只给思路（题库每道题都有 hint），不显示参考答案；换题自动收起
                Button {
                    store.showTaskHint.toggle()
                } label: {
                    Label("提示", systemImage: "lightbulb")
                }
                .help("给思路，不给答案")
                if store.showTaskHint, let hint = store.selectedTask?.hint, !hint.isEmpty {
                    Text("提示：" + hint).font(.callout).foregroundStyle(.secondary)
                } else if store.showTaskHint {
                    Text("这道题没有提示，先看题目目标与「只读验证」那一行。").font(.callout).foregroundStyle(.secondary)
                }
                // 只读验证：跑题库里那条只读命令，验证"这台机器与这道题的假设"对不对得上
                Button {
                    Task { await store.runVerify() }
                } label: {
                    Label("只读验证", systemImage: "terminal")
                }
                .help("执行该题绑定的只读命令（白名单之内），不会执行你写的答案")
                .disabled(store.verifyBusy || store.selectedTask?.verify?.cmd == nil)
                if store.busy || store.verifyBusy { ProgressView().controlSize(.small) }
                Spacer()
                // 右栏是可折叠的支持性面板：窄窗口下把它收起来，中栏就能拿到全部宽度
                Button {
                    NotificationCenter.default.post(name: .dshToggleVerdict, object: nil)
                } label: {
                    Label("判定面板", systemImage: "sidebar.right")
                }
                .help("显示或隐藏右侧判定面板（⌥⌘I）")
                Text("⌘↩ 判定　⌘K 搜索").font(.caption).foregroundStyle(.tertiary)
            }
            if let verify = store.verifyResult { VerifyBox(result: verify) }
            if let task = store.selectedTask, !task.require.isEmpty {
                Text("这道题 " + String(task.require.count) + " 条判定要素：全中 100 分，缺一项 60 分，踩禁止写法扣 30。")
                    .font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(16)
    }

    // 没选题时的空状态
    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "list.bullet.rectangle").font(.system(size: 34)).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text("从左栏选一道题").font(.headline)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 左栏：筛选 + 题单

struct TaskList: View {
    @EnvironmentObject var store: Store
    @FocusState private var searchFocused: Bool
    // 左侧栏在窗口被拖小时会把题单挤到只剩两行（实测：1320 → 980 宽的窗口下，题单只露出两行半，
    // 第三行还被裁在中间）。所以把"按轨道完成度 / 学习目标 / 备份"收进折叠区，默认收起，
    // 与网页版各面板的"收起"一致；摘要那两行（今日通过 / 累计）始终可见。
    @State private var showMore = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                // 项目 / 仓库已拆成独立页面（最左那一段）：学习页只留学习相关的东西
                // 每日一题：先给"今天练哪道"，再谈筛选。理由写清楚（该复习 / 上次没满分 / 还没练过）
                if let pick = store.daily {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Image(systemName: "sun.max")
                            .accessibilityHidden(true)
                            Text("每日一题").font(.caption).bold()
                            Spacer()
                            Text(store.dailyReason).font(.callout).foregroundStyle(.secondary)
                        }
                        Text(pick.title ?? pick.taskId).font(.callout).lineLimit(2)
                        Button("开始这道题") { Task { await store.startDaily() } }
                            .buttonStyle(.link)
                            .font(.caption)
                    }
                    .padding(8)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                TextField("搜索题号 / 标题 / 目标", text: Binding(
                    get: { store.query },
                    set: { store.setFilter(query: $0) }
                ))
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                // Esc 清空搜索：与网页版同一套手感
                .onExitCommand { store.setFilter(query: ""); searchFocused = false }
                // ⌘F 来自菜单，菜单只能发通知；这里收
                .onReceive(NotificationCenter.default.publisher(for: .dshFocusSearch)) { _ in searchFocused = true }
                Picker("难度", selection: Binding(
                    get: { store.level },
                    set: { store.setFilter(level: $0) }
                )) {
                    Text("全部难度").tag("all")
                    ForEach(store.bootstrap?.levels ?? ["easy", "medium", "hard"], id: \.self) { code in
                        Text(store.levelLabel(code) + "（" + String(store.levelCount(code)) + "）").tag(code)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                HStack(spacing: 6) {
                    Spacer()
                    Text("显示 " + String(store.visibleTasks.count) + " / " + String(store.tasks.count) + " 题")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                Picker("轨道", selection: Binding(
                    get: { store.track },
                    set: { store.setFilter(track: $0) }
                )) {
                    Text("全部轨道（" + String(store.tasks.count) + "）").tag("all")
                    ForEach(store.bootstrap?.tracks ?? [], id: \.self) { name in
                        Text(name + "（" + String(store.trackCount(name)) + "）").tag(name)
                    }
                }
                .labelsHidden()
                // 评测平台：平台变体题（同一件事 mac/linux/win 写法不同）靠它决定按哪套答案判定。
                // 空值 = 跟随服务端，也就是与命令行不传 --platform 时完全一致的行为。
                Picker("评测平台", selection: Binding(
                    get: { store.platform },
                    set: { value in Task { await store.setPlatform(value) } }
                )) {
                    Text("跟随服务端（" + (store.bootstrap?.platform ?? "?") + "）").tag("")
                    ForEach(store.platforms, id: \.id) { item in
                        Text(item.name).tag(item.id)
                    }
                }
                .labelsHidden()
            }
            .padding(12)

            Divider()

            List(selection: Binding(get: { store.selected }, set: { if let id = $0 { store.select(id) } })) {
                ForEach(store.visibleTasks) { task in
                    TaskRow(task: task, stat: store.stat(task.id), levelLabel: store.levelLabel(task.level))
                        .tag(task.id)
                }
                // 筛到空必须说清原因并给出路：恢复上次筛选时三条叠加很容易一条都不命中
                if store.visibleTasks.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("当前筛选没有匹配的题").font(.callout)
                        Text(store.filterSummary).font(.callout).foregroundStyle(.secondary)
                        Button("重置筛选") { store.resetFilters() }
                            .controlSize(.small)
                    }
                    .padding(.vertical, 6)
                }
            }
            .listStyle(.inset)
            // 题单是左栏的主入口：给它一个下限，宁可让下面的面板折叠，也不让它被挤没
            .frame(minHeight: 220)

            if let progress = store.progress {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text(progress.goal?.summary ?? "今日通过 0 题")
                        .font(.callout).bold()
                    Text("累计判定 " + String(progress.records) + " 条　连续 " + String(progress.streak) + " 天")
                        .font(.caption).foregroundStyle(.secondary)
                    if let goal = progress.goal, goal.tasksTarget > 0 {
                        ProgressView(value: Double(goal.tasksToday), total: Double(max(1, goal.tasksTarget)))
                            .accessibilityLabel("今日目标")
                            .accessibilityValue(String(goal.tasksToday) + " / " + String(goal.tasksTarget) + " 题")
                    }
                    DisclosureGroup(isExpanded: $showMore) {
                        VStack(alignment: .leading, spacing: 6) {
                            if !store.trackRows.isEmpty {
                                Text("按轨道完成度（低的在前）").font(.caption).bold()
                                ForEach(store.trackRows.prefix(5), id: \.track) { row in
                                    HStack(spacing: 6) {
                                        Text(row.track).font(.caption).frame(width: 74, alignment: .leading)
                                        ProgressView(value: Double(row.passed), total: Double(max(1, row.total)))
                                            .controlSize(.small)
                                            .accessibilityLabel(row.track + " 轨道完成度")
                                            .accessibilityValue(String(row.passed) + " / " + String(row.total))
                                        Text(String(row.passed) + "/" + String(row.total))
                                            .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                                    }
                                }
                                Divider()
                            }
                            goalAndBackup
                        }
                        .padding(.top, 4)
                    } label: {
                        Text("更多：轨道完成度 / 学习目标 / 备份").font(.caption)
                    }
                    .accessibilityLabel("更多设置")
                    Divider()
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // 学习目标 + 备份：与网页版/命令行同一份数据（goals.json 与备份文件）。
    // 从左侧栏主体里搬出来，收进“更多”折叠区——它们不是每次都要看的东西，
    // 而题单是（窗口被拖小时，题单曾被这两块挤到只剩两行）。
    @ViewBuilder private var goalAndBackup: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 学习目标：与网页版/命令行同一份 goals.json（0 表示不设）
            HStack(spacing: 6) {
                Text("每天").font(.caption)
                TextField("题", value: Binding(get: { store.goalTasks }, set: { store.goalTasks = $0 }), format: .number)
                    .frame(width: 52).textFieldStyle(.roundedBorder)
                Text("题").font(.caption)
                TextField("分钟", value: Binding(get: { store.goalMinutes }, set: { store.goalMinutes = $0 }), format: .number)
                    .frame(width: 52).textFieldStyle(.roundedBorder)
                Text("分钟").font(.caption)
                Button("保存目标") { Task { await store.saveGoal() } }.controlSize(.small)
                Spacer()
            }
            if !store.goalMessage.isEmpty {
                Text(store.goalMessage).font(.callout).foregroundStyle(.secondary)
            }
            Divider()
            // 备份：换机器/重装时把记录、笔记、目标一起搬走（与网页版同一份内容）
            HStack(spacing: 8) {
                Button("导出备份…") { Task { await store.exportBackup() } }
                    .controlSize(.small)
                Button("导入备份…") { Task { await store.importBackup() } }
                    .controlSize(.small)
                Spacer()
            }
            if !store.backupMessage.isEmpty {
                Text(store.backupMessage).font(.callout).foregroundStyle(.secondary)
            }
        }
    }
}


struct TaskRow: View {
    var task: LearnTask
    var stat: TaskStat?
    var levelLabel: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).font(.callout).lineLimit(1)
                Text(task.id).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            // 平台不适用的题（windows 轨在 macOS 上、launchctl 在 Windows 上等）：列表里就标出来，
            // 别等点进去提交了才发现不给判分
            if task.supported == false, let only = task.taskPlatforms, !only.isEmpty {
                Text("仅限 " + only.joined(separator: "/"))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let stat = stat, stat.attempts > 0 {
                Text(String(stat.best)).font(.caption).monospacedDigit().foregroundStyle(stat.best >= 100 ? .green : .secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(task.supported == false ? task.title + "（仅限 " + (task.taskPlatforms ?? []).joined(separator: "/") + "，当前平台不判分）" : task.title)
    }

    // 三档难度用颜色 + 点位区分：不靠颜色也能读（列表里还有 levelLabel 文本）
    private var color: Color {
        switch task.level ?? "medium" {
        case "easy": return .green
        case "hard": return .red
        default: return .orange
        }
    }
}

// 项目页（原生）：项目列表 + 索引（知识点 → 可练题）+ 草案入库。与网页版「项目管理」页同一件事。
// 简历投递页（原生）：新增 / 编辑 / 删除 + JD 分析 → 开练 / 建项目。与网页版同一份数据。
struct JobsPage: View {
    @EnvironmentObject var store: Store
    @State private var company = ""
    @State private var position = ""
    @State private var url = ""
    @State private var status = "todo"
    @State private var appliedAt = ""
    @State private var note = ""
    @State private var jd = ""

    private let fallbackStatuses = [("todo", "待投"), ("applied", "已投"), ("interview", "面试中"), ("offer", "已录用"), ("closed", "已结束")]

    private var statusOptions: [(String, String)] {
        store.jobStatuses.isEmpty ? fallbackStatuses : store.jobStatuses.map { ($0.id, $0.label) }
    }

    // 统计行拼成一个 String 再交给 Text：直接在 Text 里拼 map/join/可选链会 type-check 超时
    private var statsLine: String {
        guard let stats = store.jobsStats else { return "" }
        var parts: [String] = []
        parts.append("共 " + String(stats.total) + " 条（已投 " + String(stats.applied) + "）")
        for row in statusOptions {
            parts.append(row.1 + " " + String(stats.byStatus[row.0] ?? 0))
        }
        if let latest = stats.latest, !latest.isEmpty { parts.append("最近投递 " + latest) }
        return parts.joined(separator: "　")
    }

    // 待跟进：接口已算好（与 CLI jobs follow、网页版同一份 core）
    private var followLine: String {
        guard let follow = store.jobsFollow else { return "" }
        let waiting = follow.waiting ?? 0
        if waiting == 0 { return "投递跟进：当前没有在等消息的投递（已投 / 面试中 才需要跟进）。" }
        let stale = (follow.followUps ?? []).count
        let days = follow.staleDays ?? 5
        if stale == 0 { return "投递跟进：在等消息 " + String(waiting) + " 条（都还在 " + String(days) + " 天等待期内）。" }
        return "投递跟进：在等消息 " + String(waiting) + " 条，其中 " + String(stale) + " 条超过 " + String(days) + " 天没动静——先跟这几家。"
    }

    private func timelineText(_ job: JobRecord) -> String {
        let history = job.history ?? []
        if history.isEmpty { return "还没有跟进记录" }
        let last = history.suffix(3).map { entry in
            let from = (entry.from ?? "").isEmpty ? "" : (label(entry.from ?? "") + " → ")
            return (entry.at ?? "") + " " + from + label(entry.status) + ((entry.note ?? "").isEmpty ? "" : "（" + (entry.note ?? "") + "）")
        }
        return "跟进：" + last.joined(separator: "；")
    }

    private func label(_ id: String) -> String {
        statusOptions.filter { $0.0 == id }.first?.1 ?? id
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("简历投递").font(.title2).bold()
                Text("记录与网页版「简历投递」页、命令行 jobs 是同一份数据（~/.dsh-learn/jobs.json），随备份一起走。")
                Text(followLine).font(.callout).foregroundStyle(.secondary)
                    .font(.callout).foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 6) {
                    Text(store.jobEditing.isEmpty ? "新增记录" : "编辑记录").font(.subheadline).bold()
                    HStack(spacing: 8) {
                        TextField("公司", text: $company).textFieldStyle(.roundedBorder)
                        TextField("岗位", text: $position).textFieldStyle(.roundedBorder)
                        Picker("状态", selection: $status) {
                            ForEach(statusOptions, id: \.0) { row in Text(row.1).tag(row.0) }
                        }
                        .frame(width: 120)
                    }
                    HStack(spacing: 8) {
                        TextField("投递日期 YYYY-MM-DD（留空=今天）", text: $appliedAt).textFieldStyle(.roundedBorder)
                        TextField("岗位链接 https://…", text: $url).textFieldStyle(.roundedBorder)
                        TextField("备注：内推人 / 面试反馈", text: $note).textFieldStyle(.roundedBorder)
                    }
                    Text("JD（岗位描述：存下来就能一键分析出知识点与可练题）").font(.caption).foregroundStyle(.tertiary)
                    TextEditor(text: $jd)
                        .font(.system(.callout, design: .monospaced))
                        .frame(minHeight: 90)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
                    HStack(spacing: 8) {
                        Button("保存") {
                            Task { await store.saveJob(company: company, position: position, url: url, status: status, appliedAt: appliedAt, note: note, jd: jd) }
                        }
                        Button("清空表单") {
                            company = ""; position = ""; url = ""; status = "todo"; appliedAt = ""; note = ""; jd = ""
                            store.jobEditing = ""
                        }
                        Text(store.jobsMessage).font(.callout).foregroundStyle(.secondary)
                    }
                }
                .padding(10)
                .background(Color.secondary.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 8))

                if store.jobsStats != nil {
                    Text(statsLine).font(.callout).foregroundStyle(.secondary)
                }

                ForEach(store.jobs) { job in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(store.jobStatusLabel(job.status)).font(.caption)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12))
                                .clipShape(Capsule())
                            Text(job.company + " · " + job.position).font(.headline)
                            Text(job.appliedAt?.isEmpty == false ? (job.appliedAt ?? "") : "未投")
                                .font(.caption).foregroundStyle(.tertiary)
                        }
                        // 状态时间线：与网页版「跟进记录（N 条）」同一份数据（core/jobs.mjs）
                        Text(timelineText(job)).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                        if let follow = store.jobsFollow, let row = (follow.rows ?? []).first(where: { $0.id == job.id }), row.followUp == true {
                            Text("待跟进：已 " + String(row.days ?? 0) + " 天没动静").font(.caption).foregroundStyle(.orange)
                        }
                        if let analysis = job.analysis {
                            Text("JD 分析：知识点 " + String(analysis.points.count) + " 个 → 可练题 " + String(analysis.tasks.count) + " 道")
                                .font(.callout).foregroundStyle(.secondary)
                        } else {
                            Text(job.jd?.isEmpty == false ? "还没分析 JD" : "这条没存 JD").font(.callout).foregroundStyle(.tertiary)
                        }
                        if let note = job.note, !note.isEmpty {
                            Text("备注：" + note).font(.callout).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 10) {
                            Button("分析 JD") { Task { await store.analyzeJob(job.id) } }.buttonStyle(.link).font(.caption)
                            Button("练相关题") { Task { await store.drillJob(job.id) } }.buttonStyle(.link).font(.caption)
                            Button("建项目并收 JD") { Task { await store.jobToProject(job.id) } }.buttonStyle(.link).font(.caption)
                            Button("编辑") {
                                store.jobEditing = job.id
                                company = job.company; position = job.position; url = job.url ?? ""
                                status = job.status; appliedAt = job.appliedAt ?? ""; note = job.note ?? ""; jd = job.jd ?? ""
                                store.jobsMessage = "正在编辑「" + job.company + " · " + job.position + "」——改完点保存"
                            }.buttonStyle(.link).font(.caption)
                            Button("删除") { Task { await store.deleteJob(job.id) } }.buttonStyle(.link).font(.caption)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
            .padding(16)
        }
        .onAppear { Task { await store.loadJobs() } }
    }
}

// 搜索并解析（原生）：与网页版「搜索 / 搜索并解析 / 解析并收进项目」三个动作一一对应。
// 单开一个 View 而不是塞进项目面板：SwiftUI 对超长表达式的 type-check 有上限（这轮踩过两次）。
struct UnderstandBox: View {
    @EnvironmentObject var store: Store
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("文字理解").font(.caption).bold()
            TextEditor(text: $text)
                .font(.system(.callout, design: .monospaced))
                .frame(minHeight: 70)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack(spacing: 8) {
                Button("理解这段文本") {
                    Task { await store.runUnderstand(text) }
                }
                .buttonStyle(.link).font(.caption)
                Button("收进项目") {
                    Task {
                        await store.ingestText(text)
                        await store.loadProjectIndex()
                    }
                }
                .buttonStyle(.link).font(.caption)
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                if !store.understandingMessage.isEmpty {
                    Text(store.understandingMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let result = store.understanding {
                if let kind = result.kind {
                    Text("分类：" + kind + kindLabel(result)).font(.caption).foregroundStyle(.secondary)
                }
                if let stack = result.stack, !stack.isEmpty {
                    Text("技术栈：" + stack.joined(separator: "、")).font(.caption).foregroundStyle(.secondary)
                }
                if let points = result.points, !points.isEmpty {
                    Text("知识点：" + points.map { $0.name }.joined(separator: "、")).font(.caption).foregroundStyle(.secondary)
                }
                if let must = result.mustHave, !must.isEmpty {
                    Text("硬要求 " + String(must.count) + " 条：").font(.caption).foregroundStyle(.tertiary)
                    ForEach(Array(must.prefix(6).enumerated()), id: \.offset) { pair in
                        Text("· " + pair.element.text + "　[" + (pair.element.evidence ?? "") + "]")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                if let nice = result.niceToHave, !nice.isEmpty {
                    Text("加分项 " + String(nice.count) + " 条：").font(.caption).foregroundStyle(.tertiary)
                    ForEach(Array(nice.prefix(4).enumerated()), id: \.offset) { pair in
                        Text("· " + pair.element.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                if let tasks = result.tasks, !tasks.isEmpty {
                    Button("练这些题（" + String(tasks.count) + " 道）") {
                        if let first = tasks.first { store.jump(to: first) }
                    }
                    .buttonStyle(.link).font(.caption)
                }
            }
        }
    }

    private func kindLabel(_ result: UnderstandResult) -> String {
        let object = (result.company ?? "?") + " · " + (result.position ?? "?")
        if let seniority = result.seniority, !seniority.isEmpty { return "　对象：" + object + "　级别：" + seniority }
        return "　对象：" + object
    }
}

// 流程页（原生）：七步闭环。与网页版「流程」页、CLI flow 同一份数据与判断。
