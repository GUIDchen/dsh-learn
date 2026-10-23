// 原生客户端的接口数据模型（Codable 只声明用得到的字段，多余的键会被忽略）。
//
// 从 Engine.swift 拆出：那里 1504 行里有一半是纯类型声明（111 个类型、788 行、零函数体）。
// 拆开后 Engine.swift 只管「拉起本地服务 + 域方法」，模型改字段也不用在长文件里找。
import Foundation

// MARK: - 数据模型（Codable 只声明用得到的字段，多余的键会被忽略）

struct LearnTask: Codable, Identifiable, Hashable {
    var id: String
    var track: String
    var level: String?
    var title: String
    var goal: String
    var hint: String?
    var sample: String?
    var require: [String]
    // 只读验证项（题库里 60 道题有）：让桌面端能"真跑一次"，而不是只对照答案
    var verify: TaskVerify?
    // 这道题在别的平台怎么写（只有变体题有）：{"linux": "ping -M do …"}
    var others: [String: String]?
    // 题目声明了 platforms 时（只在某些平台上成立）会下发这两项：
    // supported=false 表示当前平台不在这道题的覆盖范围里，判定走兜底规则，界面上要说出来
    var supported: Bool?
    var taskPlatforms: [String]?
}

struct PlatformOption: Codable, Hashable {
    var id: String
    var name: String
}

// 服务端下发的题目里，verify 是一个对象；桌面端不需要整个对象，只要命令与期望
struct TaskVerify: Codable, Hashable {
    var cmd: String?
    var expect: String?
    var note: String?
}

struct Bootstrap: Codable {
    var tracks: [String]
    var levels: [String]
    var levelLabels: [String: String]
    var platform: String
    var platforms: [PlatformOption]
    var tasks: [LearnTask]
}

struct Verdict: Codable {
    var score: Int
    var verdict: String
    var pass: Bool
    var missing: [String]
    var matched: [String]?
    var notes: [String]
    var tips: String
    var scoring: String?
    var answer: String?
}

struct ExecResult: Codable {
    var allowed: Bool?
    var ran: Bool?
    var ok: Bool?
    var cmd: String?
    var exitCode: Int?
    var output: String?
    var reason: String?
}

struct CheckResponse: Codable {
    var result: Verdict
    var previousBest: Int?
    var attempts: Int
    var delta: Int?
    var execution: ExecResult?
}

// 每日一题：服务端挑好的那道题（该复习的 > 练过没满分 > 没练过），带上挑选理由
struct DailyPick: Codable, Equatable {
    var taskId: String
    var title: String?
    var track: String?
    var best: Int?
    var reason: String?
    // why：服务端给的"为什么推荐这道题"展示句（网页/命令行/原生共用同一句）
    var why: String?
    var pool: String?
    var date: String?
    var goal: String?
    var hint: String?
}

struct DailyResponse: Codable {
    var daily: DailyPick?
    var track: String?
}

// 复习队列里的一行：间隔重复的节奏（1 天 / 3 天 / 7n 天）由服务端算好，客户端只负责显示与跳转
struct ReviewRow: Codable, Identifiable, Equatable {
    var taskId: String
    var title: String?
    var track: String?
    var lastScore: Int?
    var lastAt: String?
    var intervalDays: Int?
    var streak: Int?
    var dueAt: String?
    var overdueDays: Int?
    var reason: String?
    var goal: String?
    var id: String { taskId }

    // 到期日只显示到天：复习节奏是按天走的，戳到时分秒反而看不清
    var dueDay: String {
        guard let raw = dueAt else { return "-" }
        return String(raw.prefix(10))
    }
}

struct ReviewResponse: Codable {
    var due: [ReviewRow]
    var upcoming: [ReviewRow]
    var track: String?
}

// 项目/仓库摄入的返回：与网页版 /api/project 同一份结构，桌面端只挑要显示的字段
struct ProjectIngest: Codable {
    var project: String?
    var dir: String?
    var via: String?
    var source: String?
    var files: Int?
    var signals: [ProjectSignal]?
    var knowledge: ProjectKnowledge?
    var tasks: Int?
    var artifacts: [String]?
    var error: String?
    var hint: String?
}

struct ProjectSignal: Codable, Hashable {
    var id: String
    var note: String?
    var files: [String]?
}

struct ProjectKnowledge: Codable {
    var matched: Int
    var modules: [ProjectModule]
}

struct ProjectModule: Codable {
    var name: String
    var points: [String]
}

// 项目列表里的一个项目
struct ProjectMetaSource: Codable, Identifiable {
    var kind: String?
    var source: String?
    var at: String?
    var knowledge: Int?
    var tasks: Int?
    var textChars: Int?
    var textFile: String?
    var id: String { (source ?? "") + "|" + (at ?? "") + "|" + (String(textFile ?? "")) }
}

struct ProjectMeta: Codable {
    var name: String?
    var displayName: String?
    var sources: [ProjectMetaSource]?
}

struct ProjectMetaEnvelope: Codable { var meta: ProjectMeta? }

struct SourceTextResult: Codable {
    var ok: Bool?
    var text: String?
    var file: String?
    var error: String?
    // source 是**文件名**（界面直接显示）；元数据在同级的 sourceMeta。
    // 接口曾经把元数据对象放在 source 里，导致网页显示 [object Object]；统一成"source=展示名"。
    var source: String?
    var sourceMeta: ProjectMetaSource?
}

struct ProjectRenameResult: Codable { var ok: Bool?; var name: String?; var from: String?; var error: String? }
struct DrillPlanTask: Codable, Identifiable {
    var id: String
    var title: String?
    var track: String?
    var level: String?
    var best: Int?
    var passed: Bool?
    var reason: String?
}
struct DrillPlanTrack: Codable, Identifiable {
    var track: String
    var total: Int
    var passed: Int
    var id: String { track }
}
struct DrillPlan: Codable {
    var projects: [String]?
    var total: Int
    var passed: Int
    var missing: Int
    var byTrack: [DrillPlanTrack]
    var rows: [DrillPlanTask]
    var nextUp: [DrillPlanTask]
    var command: String?
}
struct DrillPlanResult: Codable { var ok: Bool?; var plan: DrillPlan?; var error: String? }
struct JdPlanResult: Codable { var ok: Bool?; var markdown: String?; var error: String? }
struct RefreshResult: Codable { var ok: Bool?; var project: String?; var sources: Int?; var changed: Int?; var points: Int?; var tasks: Int?; var error: String? }
struct CorpusHit: Codable, Identifiable {
    var project: String
    var displayName: String?
    var sourceIndex: Int?
    var source: String?
    var lineNo: Int?
    var line: String?
    var id: String { project + "#" + String(sourceIndex ?? 0) + ":" + String(lineNo ?? 0) }
}
struct CorpusProject: Codable, Identifiable { var name: String; var displayName: String?; var hits: Int; var id: String { name } }
struct CorpusScanned: Codable { var sources: Int?; var chars: Int?; var withoutText: Int? }
struct CorpusResult: Codable {
    var ok: Bool?
    var query: String?
    var total: Int?
    var projects: [CorpusProject]?
    var hits: [CorpusHit]?
    var scanned: CorpusScanned?
    var markdown: String?
    var error: String?
}

struct BackfillRow: Codable { var name: String?; var filled: Int?; var missed: Int?; var total: Int?; var error: String? }
struct BackfillResult: Codable { var ok: Bool?; var projects: [BackfillRow]?; var error: String? }

struct ProjectRow: Codable, Identifiable {
    var name: String
    var displayName: String?
    var sources: Int?
    var knowledge: Int?
    var tasks: Int?
    var updatedAt: String?
    var missingText: Int?
    var match: [String]?
    var id: String { name }
}

struct ProjectList: Codable {
    var projects: [ProjectRow]
    var total: Int?
    var filtered: Int?
}

// 项目里的知识点 → 开练清单（与网页版 action=tasks 同一个接口）
struct ProjectTasks: Codable {
    var points: [String]
    var tasks: [String]
}

// 项目里的一份草案（与网页版 /api/draft 同一份结构）
struct ProjectDraft: Codable, Identifiable {
    var file: String
    var packId: String?
    var tasks: Int?
    var inCatalog: Bool?
    var id: String { file }
}

struct ProjectDraftList: Codable {
    var project: String?
    var drafts: [ProjectDraft]
}

// 草案入库的回执：dryRun 时也会返回 target 与 warnings（网页版同一个接口）
struct DraftPromoteResult: Codable {
    var project: String?
    var file: String?
    var scope: String?
    var dryRun: Bool?
    var inCatalog: Bool?
    var packId: String?
    var taskCount: Int?
    var warnings: [String]?
    var errors: [String]?
    var target: String?
}

// 简历投递记录（与网页版 /api/jobs、CLI `jobs` 同一份数据）
struct JobAnalysis: Codable {
    var matched: Int?
    var modules: Int?
    var points: [String]
    var tasks: [String]
}

struct JobHistoryEntry: Codable, Identifiable {
    var status: String
    var at: String?
    var note: String?
    var from: String?
    var id: String { (at ?? "") + status + (note ?? "") }
}

struct JobFollowRow: Codable, Identifiable {
    var id: String
    var company: String
    var position: String
    var statusLabel: String?
    var lastAt: String?
    var days: Int?
    var followUp: Bool?
    var reason: String?
}

struct JobFollow: Codable {
    var now: String?
    var staleDays: Int?
    var waiting: Int?
    var followUps: [JobFollowRow]?
    var rows: [JobFollowRow]?
}

struct JobRecord: Codable, Identifiable {
    var id: String
    var company: String
    var position: String
    var url: String?
    var status: String
    var appliedAt: String?
    var note: String?
    var history: [JobHistoryEntry]?
    var jd: String?
    var analysis: JobAnalysis?
    var createdAt: String?
    var updatedAt: String?
}

struct JobStatusRow: Codable, Identifiable {
    var id: String
    var label: String
}

struct JobStats: Codable {
    var total: Int
    var applied: Int
    var byStatus: [String: Int]
    var latest: String?
}

struct JobList: Codable {
    var jobs: [JobRecord]
    var stats: JobStats?
    var statuses: [JobStatusRow]?
    var follow: JobFollow?
}

struct JobMutation: Codable {
    var ok: Bool?
    var job: JobRecord?
    var created: Bool?
    var deleted: Bool?
    var analysis: JobAnalysis?
    var jobs: [JobRecord]?
    var stats: JobStats?
    var error: String?
}

// 项目索引（/api/project action=index）：知识点带名字 + 可练题 + 草案（含是否已入总题库）
struct ProjectIndexPoint: Codable, Identifiable {
    var id: String
    var name: String
    var module: String?
    var tasks: [String]?
}

struct ProjectIndexTask: Codable, Identifiable {
    var id: String
    var track: String?
    var level: String?
    var title: String?
}

// 索引里的草案：tasks 是**对象数组**（列表接口 /api/draft 给的是数量），
// 两者形状不同，共用一个 DTO 会让整包解码失败——实测项目页因此一直停在空态。
struct ProjectIndexDraft: Codable, Identifiable {
    var file: String
    var packId: String?
    var track: String?
    var name: String?
    var inCatalog: Bool?
    var broken: Bool?
    var reason: String?
    var tasks: [ProjectIndexTask]?
    var id: String { file }
}

struct ProjectIndex: Codable {
    var project: String
    var displayName: String?
    var points: [ProjectIndexPoint]
    var tasks: [ProjectIndexTask]
    var drafts: [ProjectIndexDraft]?
}

// 搜索与资料收集（与 CLI search/research、网页版同一份 core/search.mjs）
struct SearchHit: Codable, Identifiable {
    var url: String
    var title: String
    var snippet: String?
    var id: String { url }
}

struct SearchTried: Codable {
    var engine: String
    var ok: Bool
    var reason: String?
}

struct SearchResult: Codable {
    var ok: Bool
    var query: String?
    var engine: String?
    var total: Int?
    var results: [SearchHit]?
    var tried: [SearchTried]?
    var reason: String?
}

struct ResearchRow: Codable, Identifiable {
    var url: String
    var title: String?
    var ok: Bool
    var matched: Int?
    var points: [String]?
    var tasks: Int?
    var reason: String?
    var id: String { url }
}

struct ResearchResult: Codable {
    var ok: Bool
    var query: String?
    var engine: String?
    var searched: Int?
    var fetched: Int?
    var results: [ResearchRow]?
    var points: [String]?
    var tasks: [String]?
    var reason: String?
    var project: String?
    var ingested: Int?
}

// 文字理解（与 CLI understand、网页版同一份 core/understand.mjs）
struct UnderstandItem: Codable {
    var text: String
    var evidence: String?
}

struct UnderstandPoint: Codable, Identifiable {
    var id: String
    var name: String
    var module: String?
}

struct UnderstandResult: Codable {
    var ok: Bool?
    var via: String?
    var summary: String?
    var kind: String?
    var title: String?
    var company: String?
    var position: String?
    var seniority: String?
    var mustHave: [UnderstandItem]?
    var niceToHave: [UnderstandItem]?
    var stack: [String]?
    var points: [UnderstandPoint]?
    var tasks: [String]?
    var error: String?
}

// 识图能力矩阵（GET /api/ocr）：界面上如实显示"这台机器能不能识图、走哪个引擎"
struct OcrEngine: Codable, Identifiable {
    var id: String
    var name: String
    var available: Bool
    var detail: String?
    var enable: String?
}

struct OcrCapabilities: Codable {
    var platform: String?
    var chosen: String?
    var engines: [OcrEngine]?
    var formats: [String]?
    var advice: [String]?
}

// 七步闭环（与 CLI flow、网页版流程页同一份 core/flow.mjs）
struct FlowAction: Codable { var label: String; var cli: String?; var web: String? }
struct FlowStage: Codable, Identifiable {
    var id: String
    var name: String
    var goal: String?
    var status: String
    var progress: String
    var evidence: String
    var action: FlowAction?
    var blocked: String?
}
struct FlowCounts: Codable { var passed: Int; var attempted: Int; var projects: Int; var jobs: Int; var analyzed: Int; var applied: Int }
struct FlowMatch: Codable, Identifiable {
    var jobId: String
    var company: String
    var position: String
    var match: Int
    var covered: Int
    var total: Int
    var missing: [String]?
    var gapTracks: [String]?
    var url: String?
    var why: [String]?
    var location: String?
    var salary: FlowSalary?
    var postedAt: String?
    var remote: Bool?
    var id: String { jobId }
}
struct PackAuditRow: Codable, Identifiable {
    var packId: String?
    var ok: Bool?
    var tasks: Int?
    var errors: [String]?
    var warnings: [String]?
    var id: String { packId ?? UUID().uuidString }
}
struct PackAuditResult: Codable {
    var ok: Bool?
    var packs: Int?
    var tasks: Int?
    var bad: Int?
    var warnings: Int?
    var rows: [PackAuditRow]?
    var error: String?
}

struct MasteryRow: Codable, Identifiable {
    var id: String
    var name: String
    var passed: Int?
    var total: Int?
    var mastery: Double?
    var level: String?
    var reason: String?
}
struct MasteryNext: Codable, Identifiable { var id: String; var title: String?; var track: String? }
struct MasteryReport: Codable {
    var withTasks: Int?
    var practiced: Int?
    var weakest: [MasteryRow]?
    var nextUp: [MasteryNext]?
}
struct MasteryResult: Codable { var ok: Bool?; var report: MasteryReport?; var markdown: String?; var error: String? }

struct DoctorStats: Codable {
    var total: Int?
    var errors: Int?
    var warns: Int?
    var fixable: Int?
}
struct DoctorResult: Codable {
    var ok: Bool?
    var markdown: String?
    var stats: DoctorStats?
    var after: DoctorStats?
    var error: String?
}

struct FlowStatus: Codable {
    var stages: [FlowStage]
    var current: String?
    var currentName: String?
    var summary: String?
    var counts: FlowCounts?
    var matches: [FlowMatch]?
}
struct ResumeSkill: Codable, Identifiable { var track: String; var level: String; var passed: Int; var total: Int; var percent: Int; var id: String { track } }
struct ResumeHighlight: Codable { var text: String; var evidence: String }
struct FlowGap: Codable, Identifiable { var track: String; var percent: Int; var passed: Int; var total: Int; var id: String { track } }
struct ResumeRow: Codable {
    var headline: String
    var skills: [ResumeSkill]?
    var highlights: [ResumeHighlight]?
    var gaps: [FlowGap]?
}
struct FlowRecommend: Codable { var ok: Bool?; var jobs: [FlowMatch]? }
struct FlowSalary: Codable { var min: Int?; var max: Int?; var unit: String?; var text: String? }
struct DescribeStats: Codable { var terms: Int?; var categories: Int?; var covered: Int?; var uncovered: Int?; var points: Int?; var tasks: Int? }
struct SurveyStats: Codable { var jobs: Int?; var terms: Int?; var categories: Int?; var common: Int?; var covered: Int?; var gaps: Int?; var groups: Int?; var shared: Int?; var unique: Int? }
struct ImportTreeProject: Codable, Identifiable {
    var name: String
    var files: Int?
    var knowledge: Int?
    var tasks: Int?
    var points: [String]?
    var id: String { name }
}
struct ImportTreeResult: Codable { var ok: Bool?; var files: Int?; var projects: [ImportTreeProject]?; var error: String? }
struct SurveyResult: Codable { var ok: Bool?; var markdown: String?; var stats: SurveyStats?; var error: String? }
struct DescribeResult: Codable { var ok: Bool?; var markdown: String?; var stats: DescribeStats?; var error: String? }
struct FlowPlanPoint: Codable, Identifiable { var id: String; var name: String; var missing: [String]?; var tasks: [String]? }
struct FlowPlanRow: Codable {
    var jobId: String?
    var company: String?
    var position: String?
    var match: Int?
    var projectName: String?
    var tracks: [String]?
    var missingTasks: [String]?
    var points: [FlowPlanPoint]?
}
struct FlowScaffoldItem: Codable, Identifiable {
    var requirement: String
    var commands: [String]?
    var tasks: [String]?
    var passed: Int?
    var id: String { requirement }
}
struct FlowScaffoldRow: Codable {
    var deliverables: [FlowScaffoldItem]?
    var commands: [String]?
    var missingTasks: [String]?
    var book: String?
    var checklist: String?
}
struct FlowBuildResult: Codable {
    var ok: Bool?
    var plan: FlowPlanRow?
    var scaffold: FlowScaffoldRow?
    var files: [String]?
    var project: String?
    var dir: String?
    var error: String?
}
struct FlowPackRow: Codable {
    var ok: Bool?
    var jobId: String?
    var company: String?
    var position: String?
    var match: Int?
    var location: String?
    var postedAt: String?
    var mustRows: [FlowPackMust]?
    var gaps: [String]?
    var missingTasks: [String]?
    var markdown: String?
    var error: String?
}
struct FlowPackMust: Codable, Identifiable {
    var text: String
    var evidence: String?
    var status: String
    var passed: Int?
    var total: Int?
    var id: String { text }
}
struct FlowCollectResult: Codable { var ok: Bool?; var summary: String?; var job: JobRecord?; var error: String? }
struct FlowApplyResult: Codable { var ok: Bool?; var job: JobRecord?; var highlights: [ResumeHighlight]?; var error: String? }

// 只读验证的结果：跑的是题库里那条只读命令（白名单之内），不是学员的答案
struct VerifyResult: Codable {
    var ok: Bool?
    var ran: Bool?
    var cmd: String?
    var runner: String?
    var output: String?
    var reason: String?
    var expect: String?
    var taskId: String?
}

struct VerifyResponse: Codable {
    var verify: VerifyResult
}

// 题目笔记：与网页版、命令行共用同一份存储（~/.dsh-learn/notes.json）
struct NoteRow: Codable {
    var text: String?
    var at: String?
    var updatedAt: String?
}

struct NoteResponse: Codable {
    var taskId: String?
    var note: NoteRow?
}

struct SaveNoteResponse: Codable {
    var taskId: String?
    var note: NoteRow?
    var deleted: Bool?
}

// 导入回执：记录数 + 顺带合并了多少笔记、目标有没有被采纳
struct ImportSummary: Codable {
    var added: Int?
    var skipped: Int?
    var total: Int?
    var notes: Int?
    var goals: Bool?
}

// 字段名就叫 import（服务端返回 {"import": {...}}），Swift 里得用反引号包起来
struct ImportResponse: Codable {
    var `import`: ImportSummary
}

struct TaskStat: Codable {
    var best: Int
    var attempts: Int
    var lastVerdict: String?
}

struct GoalProgress: Codable {
    var tasksToday: Int
    var tasksTarget: Int
    var minutesToday: Int
    var minutesTarget: Int
    var summary: String
}

// 按轨道汇总：网页版左栏的「通过/总数」就是它，原生端也用它显示完成度
struct TrackSummary: Codable {
    var track: String
    var total: Int
    var passed: Int
    var attempted: Int
}

struct ProgressSummary: Codable {
    var total: Int?
    var attempted: Int?
    var passed: Int?
    var percent: Int?
    // 服务端下发的是**数组**（每项自带 track 字段）：类型写错会让整个 progress 解码失败，
    // 界面于是"什么都没有"，比任何崩溃都难查——自检里专门跑了一遍这条路径。
    var byTrack: [TrackSummary]?
}

struct ProgressResponse: Codable {
    var byTask: [String: TaskStat]
    var streak: Int
    var passScore: Int
    var records: Int
    var goal: GoalProgress?
    var summary: ProgressSummary?
}

// 学习目标：每天几题、几分钟（0 表示不设）
struct GoalResponse: Codable {
    var goal: Goal
    var progress: GoalProgress?
}

struct Goal: Codable {
    var dailyTasks: Int?
    var dailyMinutes: Int?
    var updatedAt: String?
}

struct HistoryRow: Codable, Identifiable {
    var at: String
    var score: Int
    var verdict: String
    var client: String
    // 平台变体题越来越多：同一条命令在不同平台判定不同，历史里得能看出"那次是在哪个平台判的"
    var platform: String?
    var taskId: String?
    var id: String { at + "-" + String(score) }
}

struct HistoryResponse: Codable {
    var history: [HistoryRow]
    var totalRecords: Int
}

