// 原生客户端的引擎侧：拉起本地 Node 服务 + 调它的 HTTP 接口。
// 为什么不是 WebView：桌面端要的是原生控件（列表、文本编辑、结果面板），
// 判定引擎仍然只有一份——在项目目录里的 Node 服务，客户端只说 HTTP。
import Foundation

// MARK: - 本地服务进程

final class Engine {
    private(set) var baseURL: URL?
    private var process: Process?
    private let logPath: String

    init(logPath: String) { self.logPath = logPath }

    // 引擎放哪儿，优先级：
    //   1. DSH_LEARN_ROOT：开发时指到工作区，改完包立刻生效
    //   2. App 内置引擎 Contents/Resources/engine：装到 ~/Applications 后完全不碰项目目录
    //   3. Info.plist 里构建时写入的项目目录：内置引擎缺失时的兜底
    static func projectRoot() -> String {
        let env = ProcessInfo.processInfo.environment
        if let custom = env["DSH_LEARN_ROOT"], !custom.isEmpty { return custom }
        if let bundled = bundledEngineRoot() { return bundled }
        if let baked = Bundle.main.object(forInfoDictionaryKey: "DSHLearnProjectRoot") as? String, !baked.isEmpty { return baked }
        return FileManager.default.currentDirectoryPath
    }

    static func bundledEngineRoot() -> String? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let candidate = resources.appendingPathComponent("engine").path
        let script = candidate + "/src/web/server.mjs"
        if FileManager.default.fileExists(atPath: script) { return candidate }
        return nil
    }

    // node 的解析顺序：环境变量 → Homebrew → 系统 → nvm 里最新的一个 → 问一次登录 shell。
    static func resolveNode() -> String? {
        let env = ProcessInfo.processInfo.environment
        var candidates: [String] = []
        if let custom = env["DSH_LEARN_NODE"], !custom.isEmpty { candidates.append(custom) }
        candidates.append("/opt/homebrew/bin/node")
        candidates.append("/usr/local/bin/node")
        let nvmRoot = ("~/.nvm/versions/node" as NSString).expandingTildeInPath
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmRoot) {
            for version in versions.sorted(by: { $0.compare($1, options: .numeric) == .orderedDescending }) {
                candidates.append(nvmRoot + "/" + version + "/bin/node")
            }
        }
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) { return path }
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
        probe.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        probe.standardOutput = pipe
        probe.standardError = Pipe()
        try? probe.run()
        probe.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return path.isEmpty ? nil : path
    }

    enum EngineError: LocalizedError {
        case noNode
        case noProject(String)
        case launch(String)
        case timeout
        case http(String)
        // 业务拒绝（400/409/413…）：服务端已经把原因写在 error 字段里，原样给人看
        case api(String)

        var errorDescription: String? {
            switch self {
            case .noNode: return "找不到 node。请安装 Node.js 18+，或设置 DSH_LEARN_NODE 指向可执行文件。"
            case .noProject(let root): return "在 " + root + " 找不到 src/web/server.mjs，请设置 DSH_LEARN_ROOT 指向项目目录。"
            case .launch(let detail): return "启动本地引擎失败：" + detail
            case .timeout: return "本地引擎地址不可用，详见日志。"
            case .api(let detail):
                return detail
            case .http(let detail):
                return "引擎没起来：" + detail
                    + "\n\n如果一直这样：项目若放在 ~/Documents 下，从 App 派生的引擎会被系统的「文稿文件夹」权限卡住。"
                    + "两种解法——把 App 装到非受保护目录（bash app/macos/install.sh 会装到 ~/Applications），"
                    + "或在「系统设置 → 隐私与安全性 → 文件与文件夹」里给 dsh-learn 打开文稿访问，然后点重试。"
            }
        }
    }

    func start() async throws -> URL {
        if let url = baseURL, let child = process, child.isRunning { return url }
        // 上一次启动失败会留一个还在跑的引擎；重试前先收掉它，否则每次重试都多一个进程占着端口
        stop()
        baseURL = nil
        guard let node = Engine.resolveNode() else { throw EngineError.noNode }
        let root = Engine.projectRoot()
        let script = root + "/src/web/server.mjs"
        guard FileManager.default.fileExists(atPath: script) else { throw EngineError.noProject(root) }

        // 端口由客户端自己挑：以前依赖解析子进程 stdout 里的 DSH_LEARN_URL，
        // 管道读端在 GUI 进程里会被系统压后（实际观测到晚 20 秒才回调），启动就随机失败。
        // 自己挑端口 → 地址立刻可知，剩下的只是轮询接口，不再依赖管道时序。
        let port = Engine.freePort()
        guard let url = URL(string: "http://127.0.0.1:" + String(port)) else { throw EngineError.timeout }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script, "--host", "127.0.0.1", "--port", String(port)]
        // 引擎的工作目录故意设在 / ：不是洁癖，是躲开 macOS 的 Documents 权限。
        // 项目放在 ~/Documents 下时，从 GUI 进程派生的子进程（没有终端那份授权）调 getcwd()
        // 会卡在 open("..") 上——一路走到 ~/Documents 这一层就等不到 TCC 的裁决，
        // 表现是引擎永远起不来（同样的命令从终端跑却是秒过）。引擎自己用 import.meta.url
        // 定位项目目录，不依赖 cwd，所以把 cwd 挪到保护区之外是安全的。
        process.currentDirectoryURL = URL(fileURLWithPath: "/")
        var env = ProcessInfo.processInfo.environment
        // 这几个设置要显式透传：ProcessInfo.environment 是**进程启动时的快照**，
        // 运行期 setenv 不会反映进去（自检实测：设了 DSH_LEARN_SEARCH_ENDPOINT 却没传给引擎子进程）。
        // 用 getenv 读实时环境；用户从 shell 启动 App 时设的这些变量同样能到达引擎。
        ["DSH_LEARN_SEARCH_ENDPOINT", "DSH_LEARN_PACKS", "DSH_LEARN_OCR", "DSH_LEARN_OCR_LANGS", "DSH_LEARN_GIT_MIRROR"].forEach { key in
            if let raw = getenv(key) { env[key] = String(cString: raw) }
        }
        // 父进程 pid：App 被 kill -9 时服务自己退出，不留孤儿进程占端口
        env["DSH_LEARN_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        process.environment = env

        // 引擎的输出直接写日志文件，不走管道：
        // 管道缓冲区只有 16 KB，读端在 GUI 进程里会被系统压后（后台时几十秒才回调一次），
        // 子进程一写满就卡在 write 上——永远走不到 listen()，表现成"引擎起不来"。写文件没有这个死结。
        let logFD = Engine.openLogFD(logPath)
        var logHandle: FileHandle?
        if let fd = logFD {
            logHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
            process.standardOutput = logHandle
            process.standardError = logHandle
        }

        do { try process.run() } catch { throw EngineError.launch(String(describing: error)) }
        // 子进程已经拿到自己的那份 fd，父进程这份可以关掉（用的是 O_APPEND，两边写不会互相盖）
        if let fd = logFD { close(fd) }
        _ = logHandle
        self.process = process
        baseURL = url
        try await waitUntilReady(url: url)
        return url
    }

    // 让系统分配一个空闲端口：bind 到 0 再问它给了哪个，然后立刻关掉。
    // 理论上存在"关掉到子进程 bind 之间被别人抢走"的窗口，本机自用可以接受（抢到就重试一次）。
    static func freePort() -> UInt16 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return 0 }
        defer { close(fd) }
        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { return 0 }
        var out = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let got = withUnsafeMutablePointer(to: &out) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
        }
        guard got == 0 else { return 0 }
        return UInt16(bigEndian: out.sin_port)
    }

    private func waitUntilReady(url: URL) async throws {
        var lastFailure = "还没有请求成功过"
        // 60 秒：GUI 进程在后台或锁屏时会被系统降频，15 秒会把"慢但能起来"的引擎判死
        for _ in 0..<240 {
            do {
                let _: Bootstrap = try await get("/api/bootstrap")
                return
            } catch {
                // 把真实原因留下来：只说"没返回 bootstrap"会把解码错误也盖掉，排查时白跑一趟
                lastFailure = String(describing: error)
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        throw EngineError.http("接口 60 秒内没拿到 bootstrap（最后一次失败：" + lastFailure + "）")
    }

    func stop() {
        guard let process = process, process.isRunning else { return }
        Engine.appendLog("退出，结束引擎进程 pid=" + String(process.processIdentifier) + "\n", to: logPath)
        process.terminate()
        let deadline = Date().addingTimeInterval(3)
        while process.isRunning && Date() < deadline { usleep(100_000) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }

    func check(taskId: String, answer: String, clientId: String, platform: String = "", run: Bool = false) async throws -> CheckResponse {
        var body: [String: Any] = ["taskId": taskId, "answer": answer, "clientId": clientId]
        // 空 = 不传：服务端按本机默认平台判定（与 CLI 不传 --platform 的行为一致）
        if !platform.isEmpty { body["platform"] = platform }
        // 勾选"实际跑一遍"才让服务端执行（只读白名单内）
        if run { body["run"] = true }
        return try await post("/api/check", body: body)
    }

    // 换了评测平台要重新取一次题库：平台变体题的目标/提示/要素是按平台下发的那一套
    func bootstrap(platform: String = "") async throws -> Bootstrap {
        try await get("/api/bootstrap", query: platform.isEmpty ? [] : [URLQueryItem(name: "platform", value: platform)])
    }

    func progress() async throws -> ProgressResponse { try await get("/api/progress") }

    // 每日一题：与网页版同一个接口与同一套挑选规则（复习优先），平台影响返回的目标/提示
    func daily(track: String = "all", platform: String = "") async throws -> DailyResponse {
        var items = [URLQueryItem(name: "track", value: track)]
        if !platform.isEmpty { items.append(URLQueryItem(name: "platform", value: platform)) }
        return try await get("/api/daily", query: items)
    }

    // 学习目标：GET 看当前值，POST 写新值（0 表示不设）
    func goal() async throws -> GoalResponse {
        try await get("/api/goal")
    }

    func saveGoal(dailyTasks: Int, dailyMinutes: Int) async throws -> GoalResponse {
        try await post("/api/goal", body: ["dailyTasks": dailyTasks, "dailyMinutes": dailyMinutes])
    }

    // 题目笔记：与网页版同一条接口、同一份存储，写在本机、跟题走
    func note(taskId: String) async throws -> NoteResponse {
        try await get("/api/note", query: [URLQueryItem(name: "taskId", value: taskId)])
    }

    @discardableResult
    func saveNote(taskId: String, text: String) async throws -> SaveNoteResponse {
        try await post("/api/note", body: ["taskId": taskId, "text": text])
    }

    // 只读验证：跑该题绑定的只读命令（白名单执行器在服务端），客户端只负责发起与展示
    func verify(taskId: String, platform: String, runner: String = "local") async throws -> VerifyResponse {
        var body: [String: Any] = ["taskId": taskId, "run": true, "runner": runner]
        if !platform.isEmpty { body["platform"] = platform }
        return try await post("/api/verify", body: body)
    }

    // 项目与仓库：桌面端与网页版走同一份 core（core/project.mjs 的 ingestIntoProject）。
    // 仓库地址支持 owner/repo 简写、镜像候选链与复用克隆——这些都在服务端做，客户端只管发起。
    func ingestRepo(project: String, repoPath: String?, repoUrl: String?) async throws -> ProjectIngest {
        var body: [String: Any] = ["name": project, "kind": "repo"]
        if let repoPath = repoPath, !repoPath.isEmpty { body["repoPath"] = repoPath }
        if let repoUrl = repoUrl, !repoUrl.isEmpty { body["repoUrl"] = repoUrl }
        return try await post("/api/project", body: body)
    }

    func ingestText(project: String, text: String) async throws -> ProjectIngest {
        try await post("/api/project", body: ["name": project, "text": text])
    }

    // 截图：桌面端选了文件后编码成 dataURL 交给服务端，OCR 用的是 macOS 自带的 Vision（本机识别、不联网）
    func ingestScreenshot(project: String, dataUrl: String, fileName: String = "") async throws -> ProjectIngest {
        // 带上原文件名：服务端用它给 notes/ 与 drafts/ 里的产物起名（否则只能用 OCR 临时文件名）
        var body: [String: Any] = ["name": project, "dataUrl": dataUrl]
        if !fileName.isEmpty { body["fileName"] = fileName }
        return try await post("/api/project", body: body)
    }

    // 把本机图片读成 dataURL。只允许常见图片后缀，避免把二进制文件当截图递过去。
    static func dataUrlOfImage(at path: String) -> String? {
        let ext = (path as NSString).pathExtension.lowercased()
        let mime: String
        switch ext {
        case "png": mime = "image/png"
        case "jpg", "jpeg": mime = "image/jpeg"
        case "webp": mime = "image/webp"
        case "gif": mime = "image/gif"
        case "heic": mime = "image/heic"
        default: return nil
        }
        guard let data = FileManager.default.contents(atPath: path), !data.isEmpty else { return nil }
        return "data:" + mime + ";base64," + data.base64EncodedString()
    }

    func ingestLink(project: String, url: String) async throws -> ProjectIngest {
        try await post("/api/project", body: ["name": project, "url": url])
    }

    // 项目列表：支持检索与筛选（口径在 core/project.mjs#filterProjects，与 CLI / 网页同一套）
    func projects(query: String = "", missingText: Bool = false, sort: String = "updated") async throws -> ProjectList {
        var items: [URLQueryItem] = []
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        if missingText { items.append(URLQueryItem(name: "missingText", value: "1")) }
        if sort != "updated" { items.append(URLQueryItem(name: "sort", value: sort)) }
        return try await get("/api/project", query: items)
    }

    // 语料检索（与 CLI corpus、GET /api/corpus 同一份 core/corpus.mjs）
    func corpusSearch(q: String, any: Bool, limit: Int = 30) async throws -> CorpusResult {
        // 查询串必须走 get 的 query 参数：直接拼进 path 会被当成路径的一部分编码掉，
        // 实测报 "no route /api/corpus%3Fq=…"——原生端这条检索以前根本没发出去（原生自检抓到的）。
        var items = [URLQueryItem(name: "q", value: q), URLQueryItem(name: "limit", value: String(limit))]
        if any { items.append(URLQueryItem(name: "any", value: "1")) }
        return try await get("/api/corpus", query: items)
    }

    // 刷新知识点（与 CLI project refresh、网页版 action=refresh 同一份 core）
    func refreshProjectPoints(_ name: String) async throws -> RefreshResult {
        try await post("/api/project", body: ["action": "refresh", "name": name])
    }

    // 岗位描述 → 练习清单（与 CLI project jdplan、网页版同一份 core/jdplan.mjs）
    func jdPlan(project: String, max: Int = 10) async throws -> JdPlanResult {
        try await post("/api/project", body: ["action": "jdplan", "project": project, "max": max])
    }

    // 开练清单（与 CLI project drill、网页版同一份 core/project.mjs）
    func drillPlan(project: String, limit: Int = 8) async throws -> DrillPlanResult {
        try await post("/api/project", body: ["action": "drill", "project": project, "limit": limit])
    }

    // 项目的来源台账（点一条看完整原文）；原文由服务端从 sources/ 里读
    func projectMeta(_ name: String) async throws -> ProjectMetaEnvelope {
        try await get("/api/project", query: [URLQueryItem(name: "name", value: name)])
    }

    func sourceText(_ name: String, index: Int) async throws -> SourceTextResult {
        try await get("/api/project", query: [
            URLQueryItem(name: "name", value: name),
            URLQueryItem(name: "source", value: String(index))
        ])
    }

    // 旧数据补原文（与 CLI project backfill 同一条接口）
    func backfillText(dir: String) async throws -> BackfillResult {
        try await post("/api/project", body: ["action": "backfill", "dir": dir])
    }

    func renameProject(_ name: String, to: String) async throws -> ProjectRenameResult {
        try await post("/api/project", body: ["action": "rename", "name": name, "to": to])
    }

    func deleteProject(_ name: String) async throws -> ProjectRenameResult {
        try await post("/api/project", body: ["action": "delete", "name": name, "confirm": true])
    }

    func projectTasks(_ name: String) async throws -> ProjectTasks {
        try await post("/api/project", body: ["action": "tasks", "name": name])
    }

    // 项目里的草案清单（含"是否已入总题库"）
    func projectDrafts(_ name: String) async throws -> ProjectDraftList {
        try await get("/api/draft", query: [URLQueryItem(name: "project", value: name)])
    }

    // 草案入库：scope="catalog" 进总题库（用户题库目录），scope="project" 只进项目的 promoted/ 暂存区
    func promoteDraft(project: String, file: String, toCatalog: Bool, dryRun: Bool, force: Bool = false) async throws -> DraftPromoteResult {
        try await post("/api/draft", body: [
            "project": project,
            "file": file,
            "scope": toCatalog ? "catalog" : "project",
            "dryRun": dryRun,
            "force": force
        ])
    }

    // 项目索引（知识点带名字 + 可练题 + 草案状态）：项目管理页直接用这份
    func projectIndex(_ name: String) async throws -> ProjectIndex {
        try await post("/api/project", body: ["action": "index", "name": name])
    }

    // ---- 七步闭环 ----
    // 数据体检（与 CLI doctor、网页版 /api/doctor 同一份 core/doctor.mjs）
    func doctor() async throws -> DoctorResult {
        try await get("/api/doctor")
    }

    func doctorFix() async throws -> DoctorResult {
        try await post("/api/doctor", body: ["fix": true])
    }

    // 题库体检：packs/ 下每个包过一遍深度校验（与 CLI pack validate --deep 同一套口径）
    func packValidateAll() async throws -> PackAuditResult {
        try await post("/api/pack", body: ["action": "validate-all"])
    }

    // 知识点掌握度（与 CLI mastery、GET /api/mastery 同一份 core/mastery.mjs）
    // 首次运行引导：六步走到哪、下一步跑什么（与 CLI、网页版共用 core/onboarding.mjs）
    struct OnboardingStepRow: Decodable, Identifiable {
        let id: String
        let title: String
        let cli: String
        let why: String
        let done: Bool
    }

    struct OnboardingState: Decodable {
        let done: Int
        let total: Int
        let percent: Int
        let finished: Bool
        let headline: String
        let command: String?
        let next: OnboardingStepRow?
        let steps: [OnboardingStepRow]
    }

    struct OnboardingResult: Decodable {
        let ok: Bool
        let state: OnboardingState
    }

    struct CommandRow: Decodable, Identifiable {
        let id: String
        let title: String
        let group: String
        let shortcut: String?
        let action: String
        let cli: String
    }

    struct CommandsResult: Decodable {
        let ok: Bool
        let commands: [CommandRow]
    }

    struct PrefsResult: Decodable {
        let ok: Bool
        let prefs: Prefs
        struct Prefs: Decodable {
            let version: Int
            let theme: String
        }
    }

    func prefs() async throws -> PrefsResult {
        let data = try await request("/api/prefs", method: "GET", body: nil)
        return try JSONDecoder().decode(PrefsResult.self, from: data)
    }

    @discardableResult
    func setTheme(_ theme: String) async throws -> PrefsResult {
        let data = try await request("/api/prefs", method: "POST", body: ["theme": theme])
        return try JSONDecoder().decode(PrefsResult.self, from: data)
    }

    struct ScorecardRow: Decodable, Identifiable {
        let date: String
        let attempts: Int
        let passed: Int
        var id: String { date }
    }

    struct ScorecardTotals: Decodable {
        let attempts: Int
        let passed: Int
        let passRate: Double
        let tasks: Int
        let activeDays: Int
        let streak: Int
    }

    struct Scorecard: Decodable {
        let days: Int
        let totals: ScorecardTotals
        let series: [ScorecardRow]
    }

    struct ReminderStatus: Decodable {
        let done: Int
        let target: Int
        let remaining: Int
    }

    struct ReminderResult: Decodable {
        let level: String
        let message: String
        let action: String?
        let status: ReminderStatus
    }

    struct ReminderPayload: Decodable {
        let ok: Bool
        let reminder: ReminderResult
    }

    func reminder() async throws -> ReminderPayload {
        let data = try await request("/api/reminder", method: "GET", body: nil)
        return try JSONDecoder().decode(ReminderPayload.self, from: data)
    }

    func scorecard(days: Int) async throws -> Scorecard {
        let data = try await request("/api/scorecard", query: [URLQueryItem(name: "days", value: String(days))], method: "GET", body: nil)
        return try JSONDecoder().decode(Scorecard.self, from: data)
    }

    func commands() async throws -> CommandsResult {
        let data = try await request("/api/commands", method: "GET", body: nil)
        return try JSONDecoder().decode(CommandsResult.self, from: data)
    }

    func onboarding() async throws -> OnboardingResult {
        let data = try await request("/api/onboarding", method: "GET", body: nil)
        return try JSONDecoder().decode(OnboardingResult.self, from: data)
    }

    func mastery(limit: Int = 5) async throws -> MasteryResult {
        try await get("/api/mastery", query: [URLQueryItem(name: "limit", value: String(limit))])
    }

    func flowStatus() async throws -> FlowStatus {
        try await get("/api/flow")
    }

    func flowResume() async throws -> ResumeRow {
        try await post("/api/flow", body: ["action": "resume"])
    }

    // 推荐筛选：地点 / 期望薪资区间 / 只看远程（与 CLI flow recommend 同一份 core/flow.mjs）
    func flowRecommend(limit: Int = 5, location: String = "", salaryMin: Int = 0, salaryMax: Int = 0, remoteOnly: Bool = false) async throws -> FlowRecommend {
        try await post("/api/flow", body: [
            "action": "recommend",
            "limit": limit,
            "location": location,
            "salaryMin": salaryMin,
            "salaryMax": salaryMax,
            "remoteOnly": remoteOnly
        ])
    }

    func flowCollect(text: String, url: String) async throws -> FlowCollectResult {
        try await post("/api/flow", body: ["action": "collect", "text": text, "url": url])
    }

    func flowApply(id: String) async throws -> FlowApplyResult {
        try await post("/api/flow", body: ["action": "apply", "id": id])
    }

    // 按岗位生成「项目 + 学习计划」
    func flowBuild(id: String) async throws -> FlowBuildResult {
        try await post("/api/flow", body: ["action": "build", "id": id])
    }

    // 截图当 JD：识图 → 理解 → 入库（与 CLI flow collect --ocr 同一份）
    func flowCollectImage(dataUrl: String, url: String = "") async throws -> FlowCollectResult {
        try await post("/api/flow", body: ["action": "collect", "image": dataUrl, "url": url])
    }

    // 按目录批量导入语料（与 CLI project import、网页版同一份 core/project.mjs）
    func importTree(dir: String, prefix: String) async throws -> ImportTreeResult {
        try await post("/api/project", body: ["action": "import", "dir": dir, "prefix": prefix])
    }

    // 多岗位调研（与 CLI survey、网页版同一份 core/survey.mjs）
    // 按分类调研：groups 用 [[String: Any]]（JSONSerialization 能直接编码嵌套字典）
    func surveyGroups(_ groups: [[String: Any]]) async throws -> SurveyResult {
        try await post("/api/survey", body: ["groups": groups])
    }

    func survey(texts: [String]) async throws -> SurveyResult {
        try await post("/api/survey", body: ["texts": texts])
    }

    // 描述与提取（与 CLI describe、网页版同一份 core/describe.mjs）
    func describe(text: String) async throws -> DescribeResult {
        try await post("/api/describe", body: ["text": text])
    }

    // 投递材料（与 CLI flow pack、网页版同一份 applicationPack）
    func flowPack(id: String) async throws -> FlowPackRow {
        try await post("/api/flow", body: ["action": "pack", "id": id])
    }

    // 按链接抓 JD（登录站点靠 DSH_LEARN_COOKIE 环境变量，三端共用）
    func flowCollectUrl(_ url: String) async throws -> FlowCollectResult {
        try await post("/api/flow", body: ["action": "collect", "url": url])
    }

    // ---- 文字理解与识图能力 ----
    func understand(_ text: String) async throws -> UnderstandResult {
        try await post("/api/understand", body: ["text": text])
    }

    func ocrCapabilities() async throws -> OcrCapabilities {
        try await get("/api/ocr")
    }

    // ---- 搜索与资料收集：软件自己会搜（多引擎依次回退），再把命中页面解析成知识点与草案题 ----
    func search(_ query: String, limit: Int = 8) async throws -> SearchResult {
        try await post("/api/search", body: ["query": query, "limit": limit])
    }

    func research(_ query: String, limit: Int = 5, project: String = "") async throws -> ResearchResult {
        try await post("/api/research", body: ["query": query, "limit": limit, "project": project])
    }

    // ---- 简历投递：与网页版 / CLI 同一份数据 ----
    func jobs(status: String = "all", query: String = "") async throws -> JobList {
        try await get("/api/jobs", query: [URLQueryItem(name: "status", value: status),
                                            URLQueryItem(name: "q", value: query)])
    }

    // 增改共用这一条：带 id 是改，不带是增；返回存下来的那一行
    func saveJob(_ job: [String: Any]) async throws -> JobMutation {
        try await post("/api/jobs", body: ["action": "save", "job": job])
    }

    func deleteJob(id: String) async throws -> JobMutation {
        try await post("/api/jobs", body: ["action": "delete", "id": id])
    }

    func analyzeJob(id: String) async throws -> JobMutation {
        try await post("/api/jobs", body: ["action": "analyze", "id": id])
    }

    // 整份备份的原始 JSON 字节：写盘交给调用方（App 用 NSSavePanel，自检写临时文件）
    func exportBackupData() async throws -> Data {
        try await getRaw("/api/export")
    }

    // 导入备份：走 /api/import，合并规则在服务端（笔记按更新时间取胜、本机没设目标时才采纳）
    func importBackup(_ data: Data) async throws -> ImportSummary {
        let json = (try? JSONSerialization.jsonObject(with: data)) ?? [:]
        let body = (json as? [String: Any]) ?? [:]
        let response: ImportResponse = try await post("/api/import", body: body)
        return response.`import`
    }

    // 批量导入历史记录（与网页版离线队列同一个接口）：自检里用它造"几天前练过"的状态
    func importRecords(_ rows: [[String: Any]]) async throws {
        let _: [String: Any] = try await postAny("/api/import", body: ["records": rows])
    }

    // 复习队列：间隔重复（未通过 1 天、一次通过 7 天、连续通过 7n 天，上限 30 天）
    func review(track: String = "all", limit: Int = 5) async throws -> ReviewResponse {
        try await get("/api/review", query: [URLQueryItem(name: "track", value: track),
                                             URLQueryItem(name: "limit", value: String(limit))])
    }
    func history(taskId: String, limit: Int = 5, platform: String = "") async throws -> HistoryResponse {
        var items = [URLQueryItem(name: "taskId", value: taskId),
                     URLQueryItem(name: "limit", value: String(limit))]
        if !platform.isEmpty { items.append(URLQueryItem(name: "platform", value: platform)) }
        return try await get("/api/history", query: items)
    }

    // 以 O_APPEND 打开日志：父进程与引擎各写各的，追加语义保证谁都不会盖掉对方（seek+write 做不到）
    static func openLogFD(_ path: String) -> Int32? {
        let fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        return fd >= 0 ? fd : nil
    }

    // 客户端自己想留痕时用（例如"这次开窗恢复了什么筛选"），排查时一句话就够
    func note(_ text: String) {
        Engine.appendLog(text + "\n", to: logPath)
    }

    static func appendLog(_ text: String, to path: String) {
        let line = "[" + ISO8601DateFormatter().string(from: Date()) + "] " + text
        guard let fd = openLogFD(path) else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
            return
        }
        let data = Array(line.utf8)
        _ = data.withUnsafeBufferPointer { write(fd, $0.baseAddress, $0.count) }
        close(fd)
    }
}
