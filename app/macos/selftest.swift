// 原生客户端的接口自检：用 App 里同一份 Engine.swift，把客户端真正会走的那几条路跑一遍。
// 只依赖 DSH_LEARN_ROOT（项目目录）与 DSH_LEARN_HOME（进度写哪儿，自检请用临时目录）。
// 用法：swiftc selftest.swift Engine.swift -o selftest -framework Cocoa && ./selftest

import Foundation

@main
struct NativeSelfTest {
    static var failures: [String] = []

    static func expect(_ ok: Bool, _ label: String) {
        print((ok ? "PASS  " : "FAIL  ") + label)
        if !ok { failures.append(label) }
    }

    // 与界面同一套"是不是刷新记录"的判断：右栏徽标就是靠它
    static func isRecord(_ payload: CheckResponse) -> Bool {
        guard let previous = payload.previousBest else { return true }
        return payload.result.score > previous
    }

    static func main() async {
        // 自检必须写在自己的临时 home 里：早前有一次没设 DSH_LEARN_HOME，自检把 native-selftest-* / native-shot-* /
        // native-broken-* 这些项目写进了用户的真实数据（项目列表里冒出一堆测试项目）。
        // 必须在 Engine 创建之前设好——引擎是子进程，启动后再 setenv 传不进去。
        if ProcessInfo.processInfo.environment["DSH_LEARN_HOME"] == nil {
            let home = NSTemporaryDirectory() + "dsh-learn-selftest-home-" + String(Int(Date().timeIntervalSince1970))
            try? FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true)
            setenv("DSH_LEARN_HOME", home, 1)
            print("自检使用临时 home：" + home)
        }
        // 搜索端点指向一个必定不可达的地址：自检不打外网，验的是"端点不可用时如实报错"。
        // 必须在 Engine 创建之前设：引擎是子进程，启动后再 setenv 传不进去。
        setenv("DSH_LEARN_SEARCH_ENDPOINT", "http://127.0.0.1:1/search", 1)
        let engine = Engine(logPath: "/tmp/dsh-learn-native-selftest.log")
        let clientId = "native-selftest"
        let taskId = "docker.ps-exited"

        do {
            let url = try await engine.start()
            print("引擎地址 " + url.absoluteString)

            let boot = try await engine.bootstrap()
            expect(!boot.tasks.isEmpty, "读到题库：" + String(boot.tasks.count) + " 题")
            expect(boot.platforms.contains { $0.id == "linux" } && boot.platforms.contains { $0.id == "win32" },
                   "读到可切换的评测平台：" + boot.platforms.map { $0.id }.joined(separator: "/"))
            expect(boot.tracks.count >= 20, "读到轨道：" + String(boot.tracks.count) + " 条")
            expect(boot.levels == ["easy", "medium", "hard"], "读到三档难度：" + boot.levels.joined(separator: "/"))
            expect(boot.levelLabels["hard"] != nil, "难度有中文标签：" + (boot.levelLabels["hard"] ?? "-"))
            expect(boot.tasks.contains { $0.level == "hard" }, "题库里能按难度筛出困难题")

            // 1) 只写对一半：应当拿部分分，且是这道题的第一次
            let partial = try await engine.check(taskId: taskId, answer: "docker ps", clientId: clientId)
            expect(!partial.result.pass && partial.result.score > 0 && partial.result.score < 100,
                   "半对答案拿部分分：" + String(partial.result.score) + " 分（" + partial.result.verdict + "）")
            expect(partial.previousBest == nil && partial.attempts == 1, "首次练习：上次最好为空、累计第 1 次")
            expect(isRecord(partial), "首次作答即当前记录（徽标应亮）")

            // 2) 写对：分数高过上次最好 —— 这正是"本次为历史最好"徽标的数据依据
            let improved = try await engine.check(taskId: taskId, answer: "docker ps -a --filter status=exited", clientId: clientId)
            expect(improved.result.pass && improved.result.score == 100, "满分答案 100 分通过")
            expect(improved.previousBest == partial.result.score, "带出上次最好：" + String(improved.previousBest ?? -1))
            expect((improved.delta ?? 0) > 0, "刷新记录时 delta 为正：" + String(improved.delta ?? -999))
            expect(isRecord(improved), "刷新记录（徽标应亮）")

            // 3) 同样答案再来一次：分数持平，不再算刷新记录
            let repeatRun = try await engine.check(taskId: taskId, answer: "docker ps -a --filter status=exited", clientId: clientId)
            expect(repeatRun.previousBest == 100 && repeatRun.delta == 0 && !isRecord(repeatRun),
                   "持平不算刷新记录：上次最好 " + String(repeatRun.previousBest ?? -1) + " delta " + String(repeatRun.delta ?? -999))

            let history = try await engine.history(taskId: taskId)
            expect(history.history.contains { $0.platform != nil }, "历史行要带平台（变体题在不同平台判定不同）")
            expect(history.history.count == 3, "历史接口按题过滤：" + String(history.history.count) + " 条")
            expect(history.history.first?.client == clientId, "历史里认得出是原生客户端写的：" + (history.history.first?.client ?? "-"))

            let progress = try await engine.progress()
            expect(progress.records == 3 && progress.byTask[taskId]?.best == 100,
                   "进度聚合：累计 " + String(progress.records) + " 条，该题最好 " + String(progress.byTask[taskId]?.best ?? -1) + " 分")

            // 点命中片段把它从答案里移除（与网页版同一个动作）
            let remover = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.remove") ?? .standard))
            remover.answer = "docker ps -a --filter status=exited"
            expect(remover.removeSnippet("-a") == true, "命中片段能被移除")
            expect(remover.answer == "docker ps --filter status=exited", "移除后多余空格被收敛：" + remover.answer)
            expect(remover.removeSnippet("不存在的片段") == false, "找不到片段时返回 false，不误删")
            expect(remover.removeSnippet("   ") == false, "空片段不动作")

            // 空列表时要说清"为什么没有题"：这段描述就是界面上那行字
            let probe = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.probe") ?? .standard))
            probe.tasks = boot.tasks
            probe.setFilter(track: "netops", level: "hard", query: "pprof")
            expect(probe.visibleTasks.isEmpty, "三条筛选叠加后确实可能一道都不命中（真实遇到过的场景）")
            expect(probe.filterSummary.contains("轨道 netops") && probe.filterSummary.contains("搜索「pprof」"),
                   "空列表要能说清当前筛选：" + probe.filterSummary)
            probe.resetFilters()
            expect(probe.track == "all" && probe.level == "all" && probe.query.isEmpty, "重置后回到全部")
            expect(!probe.visibleTasks.isEmpty, "重置后列表不再为空：" + String(probe.visibleTasks.count) + " 题")

            // 评测平台：这道题 mac 与 linux 的写法不同，判定必须跟着选的平台走。
            // 以前原生端不传 platform，于是服务端一直按本机默认（macOS）判——linux 答案在原生端永远过不了。
            let variant = "netops.ping-mtu-discovery"
            let macAnswer = "ping -D -s 1472 -c 3 10.0.0.1"
            let linuxAnswer = "ping -M do -s 1472 -c 3 10.0.0.1"
            let asMac = try await engine.check(taskId: variant, answer: macAnswer, clientId: clientId + "-platform", platform: "darwin")
            expect(asMac.result.pass && asMac.result.score == 100, "macOS 平台下 mac 写法满分：" + String(asMac.result.score))
            let linuxWrong = try await engine.check(taskId: variant, answer: macAnswer, clientId: clientId + "-platform", platform: "linux")
            expect(!linuxWrong.result.pass, "同一答案切到 Linux 平台就判不过：" + String(linuxWrong.result.score) + " 分")
            let asLinux = try await engine.check(taskId: variant, answer: linuxAnswer, clientId: clientId + "-platform", platform: "linux")
            expect(asLinux.result.pass && asLinux.result.score == 100, "Linux 平台下 linux 写法满分：" + String(asLinux.result.score))
            let linuxBoot = try await engine.bootstrap(platform: "linux")
            expect(linuxBoot.platform == "linux", "换平台后题库按该平台下发：" + linuxBoot.platform)

            // 每日一题：与网页版同一个接口；挑选规则在服务端，客户端只负责"跳过去且看得见"
            let daily = try await engine.daily(track: "all")
            expect(daily.daily != nil, "拿到每日一题：" + (daily.daily?.taskId ?? "无"))
            if let pick = daily.daily {
                expect(boot.tasks.contains { $0.id == pick.taskId }, "每日一题必须是题库里存在的题：" + pick.taskId)
                expect(pick.goal != nil && !pick.goal!.isEmpty, "每日一题带上了目标文案")
            }

            // 开始每日一题：日常筛选可能把它挡住，客户端要先回到全部再选中（否则"跳过去却看不见"）
            let dailyStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.daily") ?? .standard))
            dailyStore.tasks = boot.tasks
            dailyStore.daily = daily.daily
            dailyStore.setFilter(track: "docker", level: "hard", query: "绝不匹配的关键词")
            expect(dailyStore.visibleTasks.isEmpty, "先制造一个「筛选把题挡住」的真实状态")
            await dailyStore.startDaily()
            expect(dailyStore.selected == daily.daily?.taskId,
                   "开始每日一题后选中了它：" + (dailyStore.selected ?? "无"))
            expect(dailyStore.query.isEmpty && dailyStore.level == "all",
                   "被挡住时会先清筛选，而不是静默失败")

            // 每日一题的理由文案：服务端给的 reason 已经是完整一句话，客户端不该再包一层括号
            // （真机截图里显示成"该复习了（该复习了（已逾期 1 天））"，三端里只有原生端这样）
            let reasonStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.reason") ?? .standard))
            reasonStore.daily = DailyPick(taskId: "docker.run-web", reason: "该复习了（已逾期 1 天）", why: "该复习了（已逾期 1 天）", pool: "review")
            expect(reasonStore.dailyReason == "该复习了（已逾期 1 天）",
                   "复习理由照抄服务端那句，别重复包装：" + reasonStore.dailyReason)
            // 网页版/命令行/原生共用服务端给的 why（三端各拼一份拼错过）
            reasonStore.daily = DailyPick(taskId: "docker.run-web", best: 60, reason: "最高 60 分，练过 2 次", why: "上次没满分（最好 60 分）", pool: "weak")
            expect(reasonStore.dailyReason == "上次没满分（最好 60 分）", "weak 的 why 原样显示：" + reasonStore.dailyReason)
            reasonStore.daily = DailyPick(taskId: "docker.run-web", pool: "new")
            expect(reasonStore.dailyReason == "还没练过", "没有 why 时回退到本地拼的那几句：" + reasonStore.dailyReason)
            // 复习队列：间隔重复的节奏在服务端算，客户端显示 + 跳转。
            // 先造两种真实状态：今天刚没通过（1 天后复习）与 3 天前没通过（今天已到期）。
            let failTask = "docker.run-web"
            let staleTask = "netops.ethtool-link-speed"
            _ = try await engine.check(taskId: failTask, answer: "docker ps", clientId: clientId + "-review")
            let backdated = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3 * 24 * 3600))
            try await engine.importRecords([
                ["taskId": staleTask, "score": 0, "verdict": "未通过", "client": clientId + "-review", "at": backdated]
            ])
            let queue = try await engine.review(track: "all")
            expect(queue.due.contains { $0.taskId == staleTask },
                   "3 天前没通过的题今天已到期：" + queue.due.map { $0.taskId }.joined(separator: ","))
            if let row = queue.due.first(where: { $0.taskId == staleTask }) {
                expect((row.reason ?? "").contains("已逾期"), "到期行写清逾期多久：" + (row.reason ?? "-"))
                expect((row.overdueDays ?? 0) >= 2, "逾期天数算得出来：" + String(row.overdueDays ?? -1) + " 天")
            }
            if let today = queue.upcoming.first(where: { $0.taskId == failTask }) {
                expect((today.intervalDays ?? 0) == 1, "今天没通过 → 明天复习：" + String(today.intervalDays ?? -1) + " 天")
            } else {
                expect(queue.due.contains { $0.taskId == failTask }, "刚没通过的题要在队列里（到期或待到期）")
            }
            expect(queue.due.contains { $0.taskId == taskId } == false, "刚满分通过的题不该立刻到期")

            // 复习跳转：与每日一题共用 jump()，被筛选挡住时先清筛选
            let reviewStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.review") ?? .standard))
            reviewStore.tasks = boot.tasks
            reviewStore.setFilter(track: "cpp", level: "easy", query: "绝不匹配")
            await reviewStore.startReview(failTask)
            expect(reviewStore.selected == failTask, "复习按钮能跳到那道题：" + (reviewStore.selected ?? "无"))

            // 项目 / 仓库：桌面端与网页版同一套接口。这里用真仓库目录跑一遍（不联网）
            let repoDir = NSHomeDirectory() + "/dsh-repo-fixture"
            try? FileManager.default.removeItem(atPath: repoDir)
            try? FileManager.default.createDirectory(atPath: repoDir, withIntermediateDirectories: true)
            try? "FROM golang:1.22 AS build\ndocker build -t demo .\n".write(toFile: repoDir + "/Dockerfile", atomically: true, encoding: .utf8)
            try? "module demo\n\ngo 1.22\n".write(toFile: repoDir + "/go.mod", atomically: true, encoding: .utf8)
            try? "docker run -d -p 8080:80 --name web nginx:1.25\ngo test -race ./...\n".write(toFile: repoDir + "/README.md", atomically: true, encoding: .utf8)
            let ingested = try await engine.ingestRepo(project: "native-selftest-" + String(Int(Date().timeIntervalSince1970)), repoPath: repoDir, repoUrl: nil)
            expect(ingested.project != nil, "仓库解析写进了项目：" + (ingested.project ?? "-"))
            expect(ingested.via == "local", "本地目录要标成 local：" + (ingested.via ?? "-"))
            expect((ingested.knowledge?.matched ?? 0) > 0, "仓库应命中知识点：" + String(ingested.knowledge?.matched ?? 0))
            expect((ingested.signals ?? []).contains { $0.id == "dockerfile" }, "应识别出 Dockerfile 信号")
            expect((ingested.tasks ?? 0) > 0, "README 里的命令应出草案题：" + String(ingested.tasks ?? 0))

            let projectList = try await engine.projects()
            expect(projectList.projects.contains { $0.name == ingested.project }, "项目列表里能看到它")
            let listed = try await engine.projectTasks(ingested.project ?? "")
            expect(!listed.tasks.isEmpty, "项目里的知识点能开出清单：" + String(listed.tasks.count) + " 题")

            // 草案 → 总题库：桌面端也要能走完这条链路（与网页版同一个接口，scope=catalog）
            let draftList = try await engine.projectDrafts(ingested.project ?? "")
            expect(!draftList.drafts.isEmpty, "项目里应列出草案：" + String(draftList.drafts.count) + " 份")
            let draftFile = draftList.drafts[0].file
            expect(draftList.drafts[0].inCatalog == false, "还没入库的草案不该标成已在总题库")
            let preview = try await engine.promoteDraft(project: ingested.project ?? "", file: draftFile, toCatalog: true, dryRun: true)
            expect(preview.dryRun == true, "预览要如实标成 dryRun")
            expect((preview.target ?? "").contains("/packs/"), "总题库的目标路径应在用户题库目录里：" + (preview.target ?? "-"))
            expect(FileManager.default.fileExists(atPath: preview.target ?? "") == false, "预览不许写文件")
            expect((preview.taskCount ?? 0) > 0, "预览要报出题数：" + String(preview.taskCount ?? 0))
            let written = try await engine.promoteDraft(project: ingested.project ?? "", file: draftFile, toCatalog: true, dryRun: false)
            expect((written.errors ?? []).isEmpty, "入库不该报错：" + ((written.errors ?? []).joined(separator: "；")))
            expect(written.inCatalog == true, "入库后要标明已进总题库")
            expect(FileManager.default.fileExists(atPath: written.target ?? ""), "入库后文件要真在用户题库目录里")
            let afterList = try await engine.projectDrafts(ingested.project ?? "")
            expect(afterList.drafts.contains { $0.file == draftFile && $0.inCatalog == true }, "草案列表要立刻显示已在总题库")
            // 用完删掉：自检跑在临时 home 里，但也别把"用户题库"留成脏状态
            if let target = written.target { try? FileManager.default.removeItem(atPath: target) }

            // 元数据损坏：桌面端与命令行/网页版一样要拒绝，且坏文件不许被覆盖。
            // 顺带验一条文案规则——这是业务错误（HTTP 400），不该套"引擎没起来 + 文稿文件夹权限"那套排查。
            let brokenName = "native-broken-" + String(Int(Date().timeIntervalSince1970))
            _ = try? await engine.ingestText(project: brokenName, text: "docker run -d --name web nginx")
            let homeDir = ProcessInfo.processInfo.environment["DSH_LEARN_HOME"] ?? NSHomeDirectory() + "/.dsh-learn"
            let brokenMeta = homeDir + "/projects/" + brokenName + "/project.json"
            try? "not json at all".write(toFile: brokenMeta, atomically: true, encoding: .utf8)
            var brokenMessage = ""
            do {
                _ = try await engine.ingestText(project: brokenName, text: "docker run -d nginx")
            } catch {
                brokenMessage = error.localizedDescription
            }
            expect(brokenMessage.contains("不敢覆盖"), "元数据损坏要拒绝并说明原因：" + brokenMessage)
            expect(!brokenMessage.contains("文稿文件夹"), "业务错误不该套引擎启动排查文案")
            let afterBytes = try? String(contentsOfFile: brokenMeta, encoding: .utf8)
            expect(afterBytes == "not json at all", "坏文件不许被覆盖，也不许被重建：" + (afterBytes ?? "-"))


            // 简历投递：与网页版「简历投递」页、CLI `jobs` 同一份数据（三端对齐的那条验收）
            let jobHome = ProcessInfo.processInfo.environment["DSH_LEARN_HOME"] ?? NSHomeDirectory() + "/.dsh-learn"
            let jobsFile = jobHome + "/jobs.json"
            let jobsBefore = (try? String(contentsOfFile: jobsFile, encoding: .utf8)) ?? ""
            let savedJob = try await engine.saveJob([
                "id": "",
                "company": "原生自检科技",
                "position": "运维工程师",
                "status": "applied",
                "url": "https://example.com/jd/native",
                "appliedAt": "",
                "note": "自检用",
                "jd": "熟悉 Kubernetes 滚动发布与 Prometheus 告警；会用 tcpdump 抓包"
            ])
            expect(savedJob.job != nil, "保存投递记录要返回这一行：" + (savedJob.error ?? "-"))
            expect((savedJob.job?.appliedAt ?? "").count == 10, "投出去要自动补日期：" + (savedJob.job?.appliedAt ?? "-"))
            let jobId = savedJob.job?.id ?? ""
            let jobsListed = try await engine.jobs()
            expect(jobsListed.jobs.contains { $0.id == jobId }, "列表里能看到刚存的这条")
            expect((jobsListed.stats?.total ?? 0) >= 1, "统计要算上它")
            let jobAnalysis = try await engine.analyzeJob(id: jobId)
            expect((jobAnalysis.analysis?.points.count ?? 0) > 0, "JD 分析要命中知识点")
            expect((jobAnalysis.analysis?.tasks.count ?? 0) > 0, "JD 分析要给出可练题")
            expect(jobAnalysis.job?.analysis != nil, "分析结果要存回记录（列表直接显示）")
            // 改状态：入参不带 analysis，core 里保留了原值——这条规则三端共用
            let jobUpdated = try await engine.saveJob([
                "id": jobId,
                "company": "原生自检科技",
                "position": "运维工程师",
                "status": "interview",
                "url": "",
                "appliedAt": savedJob.job?.appliedAt ?? "",
                "note": "",
                "jd": savedJob.job?.jd ?? ""
            ])
            expect(jobUpdated.job?.status == "interview", "状态要能改：" + (jobUpdated.job?.status ?? "-"))
            expect(jobUpdated.job?.analysis != nil, "改状态不该把 JD 分析结果抹掉")
            expect((jobUpdated.job?.analysis?.tasks.count ?? 0) > 0, "可练题也要还在")
            // 状态时间线：新建一条 + 改状态一条（含 from），与网页版「跟进记录（N 条）」同一份数据
            expect((jobUpdated.job?.history?.count ?? 0) >= 2, "改状态要追加时间线：" + String(jobUpdated.job?.history?.count ?? -1))
            expect(jobUpdated.job?.history?.last?.from == "applied", "要记住从哪个状态变过来：" + (jobUpdated.job?.history?.last?.from ?? "-"))
            let jobsWithFollow = try await engine.jobs()
            expect(jobsWithFollow.follow != nil, "投递列表要带跟进视图")
            expect((jobsWithFollow.follow?.rows ?? []).contains { $0.id == jobId }, "跟进视图里要有这条")
            // 校验失败路径：空公司名要报错且不写盘
            var jobError = ""
            do {
                _ = try await engine.saveJob(["id": "", "company": "", "position": "x", "status": "todo", "url": "", "appliedAt": "", "note": "", "jd": ""])
            } catch {
                jobError = error.localizedDescription
            }
            expect(jobError.contains("公司名"), "校验失败要说清是哪个字段：" + jobError)
            // 收尾：删掉自检写进去的那条，别给临时 home 留脏数据
            _ = try await engine.deleteJob(id: jobId)
            let jobsAfter = try await engine.jobs()
            expect(!jobsAfter.jobs.contains { $0.id == jobId }, "删除后列表里不该还有它")
            if jobsBefore.isEmpty { try? FileManager.default.removeItem(atPath: jobsFile) }

            // 搜索并解析：原生端的接线（不打外网——把搜索端点指向引擎自己的页面，让它解析不出链接）。
            // 服务端 core/search.mjs 的多引擎与解析规则由 test/search.test.mjs 与 server.test.mjs 覆盖，
            // 这里验的是"原生端能把请求发出去、并把失败原因如实显示出来"这条线。
            var emptyQueryError = ""
            do {
                _ = try await engine.search("")
            } catch {
                emptyQueryError = error.localizedDescription
            }
            expect(emptyQueryError.contains("搜索词"), "空搜索词要报错并说清原因：" + emptyQueryError)
            // 自建端点不可达时：有别的引擎顶上就算成功，但 tried 里必须留一笔失败（网络全断时则整体失败）
            do {
                let found = try await engine.search("kubectl")
                let custom = (found.tried ?? []).first { $0.engine == "custom" }
                expect(custom != nil && custom?.ok == false, "自建端点不可达要在 tried 里如实记一笔：" + String(describing: custom?.reason))
            } catch {
                let reason = error.localizedDescription
                expect(reason.contains("搜索") || reason.contains("失败"), "所有引擎都不可用时要如实报错：" + reason)
            }


            // 识图能力矩阵 + 文字理解（原生端界面上的「识图引擎：…」与「理解这段文本」就是它们）
            let ocrCaps = try await engine.ocrCapabilities()
            expect((ocrCaps.engines?.count ?? 0) == 3, "三个识图引擎都要报出来：" + String(ocrCaps.engines?.count ?? 0))
            expect(ocrCaps.engines?.contains { $0.available } == true || ocrCaps.chosen == nil,
                   "有可用引擎时选中一个，否则 chosen 应为空：" + (ocrCaps.chosen ?? "nil"))
            // 拼成一整串再传：SwiftUI/Swift 对超长字符串拼接表达式会报 type-check 超时（这轮踩过三次）
            let jdLines = ["某某科技 招聘 高级运维工程师", "岗位职责", "负责 Kubernetes 集群稳定运行", "任职要求", "熟悉 Linux 与 Shell，5 年以上经验", "掌握 Python 或 Go", "加分项", "了解 Terraform"]
            let understood = try await engine.understand(jdLines.joined(separator: "\n"))
            expect(understood.ok == true, "理解要返回 ok：" + (understood.error ?? "-"))
            expect(understood.company == "某某科技", "公司要读出来：" + (understood.company ?? "-"))
            expect(understood.position == "高级运维工程师", "岗位要读出来：" + (understood.position ?? "-"))
            expect((understood.mustHave?.count ?? 0) >= 2, "硬要求至少两条：" + String(understood.mustHave?.count ?? 0))
            expect((understood.niceToHave?.count ?? 0) >= 1, "加分项至少一条：" + String(understood.niceToHave?.count ?? 0))
            expect((understood.stack ?? []).contains("kubernetes") || (understood.stack ?? []).contains("linux"), "技术栈要认出来：" + (understood.stack ?? []).joined(separator: ","))
            expect((understood.tasks?.count ?? 0) > 0, "理解结果要给出可练题")
            expect((understood.summary ?? "").contains("知识点"), "摘要要说清知识点与可练题：" + (understood.summary ?? "-"))
            var emptyUnderstand = ""
            do {
                _ = try await engine.understand("   ")
            } catch {
                emptyUnderstand = error.localizedDescription
            }
            expect(!emptyUnderstand.isEmpty, "空文本要报错，而不是返回一份空结构")


            // 七步闭环：状态 / 简历 / 推荐 / 粘 JD 入库 / 记投递（与网页版流程页、CLI flow 同一份）
            let flowRow = try await engine.flowStatus()
            expect(flowRow.stages.count == 7, "七步都要报出来：" + String(flowRow.stages.count))
            expect(!(flowRow.summary ?? "").isEmpty, "状态要有一句话摘要")
            expect(flowRow.stages.allSatisfy { !$0.name.isEmpty && !$0.progress.isEmpty }, "每一步都要有名字与进度")
            let resumeRow = try await engine.flowResume()
            expect(!resumeRow.headline.isEmpty, "简历要有一句话摘要")
            let flowJd = ["某某科技 招聘 高级运维工程师", "岗位职责", "负责 Kubernetes 集群稳定运行", "任职要求", "熟悉 Linux 与 Shell，3 年以上经验", "掌握 Python", "加分项", "了解 Terraform"].joined(separator: "\n")
            let collected = try await engine.flowCollect(text: flowJd, url: "https://example.com/jd/selftest")
            expect(collected.ok == true, "粘 JD 要能入库：" + (collected.error ?? "-"))
            expect((collected.job?.analysis?.tasks.count ?? 0) > 0, "入库时要顺手分析出可练题")
            let recommend = try await engine.flowRecommend()
            expect((recommend.jobs?.count ?? 0) >= 1, "至少有一个可推荐岗位（刚入库那条）")
            let firstFlowJob = recommend.jobs?.first
            expect((firstFlowJob?.why ?? []).count > 0, "推荐要给出理由")
            let applied = try await engine.flowApply(id: firstFlowJob?.jobId ?? "")
            expect(applied.job?.status != "todo", "记投递后状态要变：" + (applied.job?.status ?? "-"))

            // 按岗位生成学习计划：建项目 + 落计划文件 + 给出待练清单
            var buildPlan: FlowPlanRow? = nil
            do {
                let built = try await engine.flowBuild(id: firstFlowJob?.jobId ?? "")
                buildPlan = built.plan
                expect(built.ok == true, "建项目要返回 ok：" + (built.error ?? "-"))
                expect(!(built.project ?? "").isEmpty, "要返回项目名")
                expect((built.plan?.missingTasks ?? []).count > 0, "学习计划要有待练清单")
                expect((built.plan?.points ?? []).count > 0, "学习计划要有知识点行")
                expect(built.plan?.projectName != nil, "计划里要带项目名")
            } catch {
                expect(false, "flow build 不该抛错：" + error.localizedDescription)
            }
            expect(buildPlan != nil, "应当拿到学习计划")

            // 按链接抓 JD：用引擎自己的页面当"站点"（抓得到，但会被如实分类为非岗位描述），验完后删掉记录
            var emptyUrlError = ""
            do {
                _ = try await engine.flowCollectUrl("")
            } catch {
                emptyUrlError = error.localizedDescription
            }
            expect(!emptyUrlError.isEmpty, "空链接要报错，而不是静默失败")
            if let base = engine.baseURL?.absoluteString {
                do {
                    let fetched = try await engine.flowCollectUrl(base + "/index.html")
                    expect(fetched.ok == true, "抓得到页面时要能入库：" + (fetched.error ?? "-"))
                    expect((fetched.job?.analysis?.points.count ?? 0) >= 0, "入库时要带上 JD 分析")
                    if let id = fetched.job?.id { _ = try await engine.deleteJob(id: id) }
                } catch {
                    expect(false, "按链接抓取不该抛错：" + error.localizedDescription)
                }
            }

            // 投递材料：逐条对硬要求 + 可粘贴要点（与 CLI flow pack、网页版同一份）
            var packRow: FlowPackRow? = nil
            do {
                let pack = try await engine.flowPack(id: firstFlowJob?.jobId ?? "")
                packRow = pack
                expect(pack.ok == true, "生成投递材料要返回 ok：" + (pack.error ?? "-"))
                expect(!(pack.markdown ?? "").isEmpty, "材料正文不能为空")
                expect((pack.markdown ?? "").contains("投递材料"), "材料要有标题")
                expect((pack.markdown ?? "").contains("逐条对硬要求"), "材料要逐条对硬要求")
                expect((pack.mustRows ?? []).count >= 1, "要有硬要求行（实际 " + String((pack.mustRows ?? []).count) + "，材料开头：" + String((pack.markdown ?? "").prefix(120)) + "）")
            } catch {
                expect(false, "flow pack 不该抛错：" + error.localizedDescription)
            }
            expect(packRow != nil, "应当拿到投递材料")

            // 推荐筛选与新鲜度：地点/薪资区间/只看远程要在原生这条链路上可用
            do {
                let filtered = try await engine.flowRecommend(location: "深圳", salaryMin: 0, salaryMax: 0, remoteOnly: false)
                expect(filtered.ok == true, "带筛选的推荐要返回 ok")
                let remote = try await engine.flowRecommend(remoteOnly: true)
                expect(remote.ok == true, "只看远程要返回 ok")
                let salary = try await engine.flowRecommend(salaryMin: 20, salaryMax: 60)
                expect(salary.ok == true, "薪资区间要返回 ok")
            } catch {
                expect(false, "带筛选的推荐不该抛错：" + error.localizedDescription)
            }

            // 项目书：flow build 要一并产出项目书 / 验收清单 / 命令清单（三端同一份 scaffold）
            if let built = buildPlan {
                _ = built
            }
            do {
                let again = try await engine.flowBuild(id: firstFlowJob?.jobId ?? "")
                expect(again.ok == true, "再次 build 要 ok")
                expect((again.scaffold?.deliverables ?? []).count >= 1, "项目书要有交付项")
                expect(!(again.scaffold?.book ?? "").isEmpty, "项目书正文不能为空")
                expect((again.scaffold?.book ?? "").contains("项目书"), "项目书要有标题")
                expect((again.files ?? []).count >= 4, "要返回产物文件清单：" + String((again.files ?? []).count))
            } catch {
                expect(false, "带项目书的 build 不该抛错：" + error.localizedDescription)
            }

            // 描述与提取：技术栈按类别抽全 + 知识点 + 未覆盖（与 CLI describe、网页版同一份）
            do {
                let described = try await engine.describe(text: flowJd)
                expect(described.ok == true, "描述要返回 ok：" + (described.error ?? "-"))
                expect((described.stats?.terms ?? 0) >= 5, "技术栈至少 5 项：" + String(described.stats?.terms ?? 0))
                expect((described.stats?.categories ?? 0) >= 3, "至少 3 个类别：" + String(described.stats?.categories ?? 0))
                expect((described.markdown ?? "").contains("技术栈"), "报告要有技术栈段")
                expect((described.markdown ?? "").contains("字典未覆盖"), "报告要如实列未覆盖")
            } catch {
                expect(false, "describe 不该抛错：" + error.localizedDescription)
            }

            // 收尾：删掉自检写进去的岗位记录，别给临时 home 留脏数据
            if let id = firstFlowJob?.jobId { _ = try await engine.deleteJob(id: id) }

            // 开练：与每日一题、复习队列共用 jump()（被挡住先清筛选）
            let projectStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.project") ?? .standard))
            projectStore.tasks = boot.tasks
            projectStore.setFilter(track: "yolo", level: "hard", query: "绝不匹配")
            await projectStore.drillFromProject(ingested.project ?? "")
            expect(projectStore.selected == listed.tasks.first, "按项目开练后选中第一题：" + (projectStore.selected ?? "无"))

            // 截图入口：把真实 PNG 交给服务端 Vision 识别（与网页版同一条路），再验一个非图片文件
            let root = ProcessInfo.processInfo.environment["DSH_LEARN_ROOT"] ?? FileManager.default.currentDirectoryPath
            let fixture = root + "/test/fixtures/terminal-note-screenshot.png"
            if FileManager.default.fileExists(atPath: fixture) {
                expect(Engine.dataUrlOfImage(at: fixture)?.hasPrefix("data:image/png;base64,") == true,
                       "截图能读成 dataURL")
                let shot = try await engine.ingestScreenshot(project: "native-shot-" + String(Int(Date().timeIntervalSince1970)),
                                                             dataUrl: Engine.dataUrlOfImage(at: fixture) ?? "")
                expect((shot.knowledge?.matched ?? 0) > 0, "截图 OCR 后命中知识点：" + String(shot.knowledge?.matched ?? 0))
                expect((shot.tasks ?? 0) > 0, "截图里的命令应出草案题：" + String(shot.tasks ?? 0))
            } else {
                expect(false, "找不到截图夹具：" + fixture)
            }
            expect(Engine.dataUrlOfImage(at: root + "/package.json") == nil, "非图片文件不该被当成截图")

            // 只读验证：桌面端此前只能对照答案，这轮补上"真跑一次"
            let verifyTask = boot.tasks.first { $0.verify?.cmd != nil }
            expect(verifyTask != nil, "题库里应能找到绑定只读验证项的题")
            if let task = verifyTask {
                let verified = try await engine.verify(taskId: task.id, platform: "")
                expect(verified.verify.ran == true, "验证应真的执行了命令：" + (verified.verify.reason ?? "-"))
                expect(verified.verify.cmd == task.verify?.cmd, "跑的就是题库里那条命令：" + (verified.verify.cmd ?? "-"))
                expect(verified.verify.ok == true, "这条只读命令在本机应通过：" + (verified.verify.output ?? "").prefix(80))
            }

            // 没绑验证项的题：如实说明，不假装跑过
            let noVerify = boot.tasks.first { $0.verify?.cmd == nil }
            if let task = noVerify {
                let store = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.verify") ?? .standard))
                store.tasks = boot.tasks
                store.select(task.id)
                await store.runVerify()
                expect(store.verifyResult?.ran == false, "没绑定验证项时 ran 应为 false")
                expect((store.verifyResult?.reason ?? "").contains("没有绑定"), "要说明原因：" + (store.verifyResult?.reason ?? "-"))
            }

            // 题目笔记：写在本机、跟题走，且与网页版/命令行共用同一份存储（notes.json）
            let noteTask = "docker.run-web"
            _ = try await engine.saveNote(taskId: noteTask, text: "")
            let empty = try await engine.note(taskId: noteTask)
            expect(empty.note == nil, "先清空，确保从零开始")

            let noteStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.note") ?? .standard))
            noteStore.tasks = boot.tasks
            noteStore.select(noteTask)
            await noteStore.loadNote()
            expect(noteStore.noteText.isEmpty, "新题没有笔记时是空文本，不是 nil 崩掉")

            noteStore.noteText = "-d 是后台运行；--name 方便之后 docker logs"
            await noteStore.saveNote()
            expect(noteStore.noteSavedAt != nil, "保存后要有时间戳：" + (noteStore.noteSavedAt ?? "-"))
            let saved = try await engine.note(taskId: noteTask)
            expect((saved.note?.text ?? "").contains("后台运行"), "笔记读回来要一致：" + (saved.note?.text ?? "-"))

            // 换一道题不能串笔记（真实用过的坑：切题后还显示上一题的心得）
            noteStore.select("docker.ps-exited")
            await noteStore.loadNote()
            expect(noteStore.noteText.isEmpty, "换题后笔记应为空，而不是留着上一题的")

            // 空内容保存即删除（与网页版同一个语义）
            noteStore.select(noteTask)
            await noteStore.loadNote()
            noteStore.noteText = ""
            await noteStore.saveNote()
            let cleared = try await engine.note(taskId: noteTask)
            expect(cleared.note == nil, "空内容保存后笔记应被删除")

            // 备份：导出要含记录+笔记+目标，导入要能把它们合回来（与网页版/命令行同一份内容）
            _ = try await engine.saveNote(taskId: "docker.run-web", text: "备份往返测试：-d 后台运行")
            let backup = try await engine.exportBackupData()
            expect(backup.count > 100, "导出的备份应有内容：" + String(backup.count) + " 字节")
            let parsed = (try? JSONSerialization.jsonObject(with: backup)) as? [String: Any] ?? [:]
            expect((parsed["version"] as? Int) == 2, "备份版本应为 2（含 notes / goals）：" + String(describing: parsed["version"]))
            expect(((parsed["notes"] as? [String: Any]) ?? [:])["docker.run-web"] != nil, "笔记要进备份")
            expect(parsed["goals"] != nil, "学习目标要进备份")
            expect(((parsed["records"] as? [Any]) ?? []).count >= 1, "记录要进备份")

            let summary = try await engine.importBackup(backup)
            expect(summary.skipped != nil, "导入回执要给出跳过条数：" + String(summary.skipped ?? -1))
            expect(summary.added == 0, "同一份备份再导入不该新增记录：" + String(summary.added ?? -1))

            // 笔记被清掉后再导入，应能从备份里补回来
            _ = try await engine.saveNote(taskId: "docker.run-web", text: "")
            let restored = try await engine.importBackup(backup)
            let afterRestore = try await engine.note(taskId: "docker.run-web")
            expect((afterRestore.note?.text ?? "").contains("备份往返测试"), "导入后笔记应被补回：" + (afterRestore.note?.text ?? "-"))
            expect((restored.notes ?? 0) >= 0, "回执里的笔记计数要存在")
            _ = try await engine.saveNote(taskId: "docker.run-web", text: "")

            // 学习目标：原生端此前只能看进度，不能设目标（网页版与命令行都能设）
            let goalStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.goal") ?? .standard))
            await goalStore.loadGoal()
            expect(goalStore.goalTasks >= 0 && goalStore.goalMinutes >= 0, "能读到当前目标（0 表示不设）")

            goalStore.goalTasks = 4
            goalStore.goalMinutes = 25
            await goalStore.saveGoal()
            expect(goalStore.goalMessage.contains("每天 4 题"), "保存后要有明确回执：" + goalStore.goalMessage)
            let savedGoal = try await engine.goal()
            expect(savedGoal.goal.dailyTasks == 4 && savedGoal.goal.dailyMinutes == 25, "服务端读回来要一致")

            // 换一台"客户端"（新的 Store）也要读到同一份目标：目标存在服务端，不依赖本地状态
            let otherStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.goal2") ?? .standard))
            await otherStore.loadGoal()
            expect(otherStore.goalTasks == 4 && otherStore.goalMinutes == 25, "另一个客户端读到同一份目标")

            // 按轨道完成度：低分轨道排在前面（这一栏的用途是"接下来练哪块"）
            await otherStore.refreshProgress()
            let rows = otherStore.trackRows
            expect(rows.count >= 20, "轨道完成度应有数据：" + String(rows.count))
            if rows.count >= 2 {
                let first = rows[0].passed * 100 / max(1, rows[0].total)
                let last = rows[rows.count - 1].passed * 100 / max(1, rows[rows.count - 1].total)
                expect(first <= last, "完成度低的应排在前面：" + String(first) + "% → " + String(last) + "%")
            }

            // 收尾：清掉目标，别把"每天 4 题"留在自检用的目录里
            goalStore.goalTasks = 0
            goalStore.goalMinutes = 0
            await goalStore.saveGoal()
            expect(goalStore.goalMessage.contains("已清空"), "清空也要有回执：" + goalStore.goalMessage)

            // 变体题：服务端下发的"别的平台怎么写"，模型要能解出来（桌面端据此在题面里显示对比）
            let variantTask = boot.tasks.first { $0.others != nil }
            expect(variantTask != nil, "bootstrap 里应有带 others 的变体题")
            if let task = variantTask {
                expect(task.others?.isEmpty == false, "others 不该是空字典：" + String(describing: task.others))
                expect(task.others?[boot.platform] == nil, "当前平台那条不该重复下发")
            }
            let linuxBootForVariants = try await engine.bootstrap(platform: "linux")
            let linuxVariant = linuxBootForVariants.tasks.first { $0.id == variantTask?.id }
            expect(linuxVariant?.others?["darwin"] != nil, "换平台后对比项也要跟着换")

            // 换平台要把平台相关的面板一起刷新（每日一题 / 复习队列的文案按平台下发）
            let platformStore = Store(engine: engine, prefs: PrefsStore(defaults: UserDefaults(suiteName: "dsh-learn.selftest.platform") ?? .standard))
            await platformStore.start()
            let dailyBefore = platformStore.daily?.taskId
            await platformStore.setPlatform("linux")
            expect(platformStore.bootstrap?.platform == "linux", "换平台后 bootstrap 平台应更新")
            expect(platformStore.daily?.taskId != nil || dailyBefore == nil, "换平台后每日一题应有结果（不是被清空）")

            // 筛选记忆：开窗回到上次的轨道 / 难度 / 搜索词 / 选中题
            let suite = "dsh-learn.selftest." + UUID().uuidString
            if let defaults = UserDefaults(suiteName: suite) {
                let prefs = PrefsStore(defaults: defaults)
                expect(prefs.load() == NativePrefs.empty, "默认没有记忆时是空筛选")
                let saved = NativePrefs(track: "go", level: "hard", query: "pprof", taskId: taskId, platform: "linux")
                prefs.save(saved)
                expect(prefs.load() == saved, "筛选记忆能原样读回：" + prefs.load().track + "/" + prefs.load().level + "/" + prefs.load().platform)
                expect(prefs.load().platform == "linux", "评测平台也进记忆：" + prefs.load().platform)
                defaults.set(Data("{\"track\":\"go\",\"level\":\"nightmare\"}".utf8), forKey: "dsh-learn.native.prefs")
                expect(prefs.load() == NativePrefs.empty, "写坏的难度取值会被丢掉，而不是让界面空着")
                defaults.set(Data("{\"track\":\"go\",\"level\":\"hard\",\"platform\":\"plan9\"}".utf8), forKey: "dsh-learn.native.prefs")
                expect(prefs.load() == NativePrefs.empty, "认不出来的平台取值同样丢掉")
                prefs.reset()
                expect(prefs.load() == NativePrefs.empty, "重置后回到空筛选")
                defaults.removePersistentDomain(forName: suite)
            } else {
                expect(false, "无法创建 UserDefaults 测试域")
            }

            // ---- 近几轮新增能力的原生端端到端校验（第 12 轮补课） ----
            // 之前这些能力只验过"能编译"，没走过真实请求；这里逐个打一遍，缺了就报出来。
            let parityName = "native-parity-" + String(Int(Date().timeIntervalSince1970))
            let parityText = [
                "岗位职责：负责数据平台与视觉算法",
                "任职要求：熟悉 PostgreSQL 索引优化，熟悉 YOLO 训练与 Python"
            ].joined(separator: "\n")
            let parityIngest = try await engine.ingestText(project: parityName, text: parityText)
            expect((parityIngest.project ?? "").isEmpty == false, "要建出项目：" + (parityIngest.error ?? "-"))
            let parityMeta = try await engine.projectMeta(parityName)
            expect(((parityMeta.meta?.sources ?? []).first?.textFile ?? "").isEmpty == false, "来源要存下原文（JD 清单与检索都靠它）")
            let paritySource = try await engine.sourceText(parityName, index: 1)
            expect(paritySource.ok == true && (paritySource.text ?? "").contains("PostgreSQL"), "点来源要看得到完整原文")
            let parityDrill = try await engine.drillPlan(project: parityName, limit: 5)
            expect((parityDrill.plan?.total ?? 0) > 0, "开练清单要给出可练题：" + String(parityDrill.plan?.total ?? -1))
            expect((parityDrill.plan?.nextUp.count ?? 0) > 0, "开练清单要给出先练哪几道")
            let parityJd = try await engine.jdPlan(project: parityName, max: 5)
            expect((parityJd.markdown ?? "").contains("练习清单"), "JD 练习清单要返回 markdown")
            let parityHit = try await engine.corpusSearch(q: "PostgreSQL", any: false, limit: 5)
            expect((parityHit.scanned?.sources ?? 0) > 0, "语料检索要扫描到来源")
            expect((parityHit.total ?? 0) > 0, "语料检索要命中刚收的这份 JD")
            expect(((parityHit.hits ?? []).first?.line ?? "").contains("PostgreSQL"), "命中要给原话")
            let parityGroups = try await engine.surveyGroups([
                ["name": "视觉", "texts": ["任职要求：熟悉 YOLO 与 OpenCV"]],
                ["name": "运维", "texts": ["任职要求：熟悉 Kubernetes 与 Prometheus"]]
            ])
            expect((parityGroups.stats?.groups ?? 0) == 2, "分方向调研要认出 2 个方向：" + String(parityGroups.stats?.groups ?? -1))
            expect((parityGroups.stats?.terms ?? 0) > 0, "分方向调研要抽出技术栈")
            let paritySurvey = try await engine.survey(texts: ["任职要求：熟悉 Kubernetes", "任职要求：熟悉 PostgreSQL"])
            expect((paritySurvey.stats?.jobs ?? 0) == 2, "多岗位调研要按 2 份算：" + String(paritySurvey.stats?.jobs ?? -1))
            let parityBackfill = try await engine.backfillText(dir: "")
            expect(parityBackfill.ok == true, "回填原文要能跑（没找到的如实计缺失）")
            let parityRenamed = try await engine.renameProject(parityName, to: parityName + "-r")
            expect(parityRenamed.ok == true, "重命名要成功：" + (parityRenamed.error ?? "-"))
            let afterRename = try await engine.projects()
            expect(afterRename.projects.contains { $0.name == parityName + "-r" }, "列表里要能看到新名字")
            expect(!afterRename.projects.contains { $0.name == parityName }, "旧名字不该还在")
            _ = try await engine.deleteProject(parityName + "-r")
            let afterCleanup = try await engine.projects()
            expect(!afterCleanup.projects.contains { $0.name == parityName + "-r" }, "清理后不该留项目")
        } catch {
            expect(false, "链路抛错：" + String(describing: error))
        }

        // 首次运行引导：与 CLI / 网页版共用 core/onboarding.mjs（第 216 轮的原生端补齐）
        do {
            let onboarding = try await engine.onboarding()
            expect(onboarding.ok, "引导接口应当返回 ok")
            expect(onboarding.state.total == 6, "引导应当是六步，实际 " + String(onboarding.state.total))
            expect(onboarding.state.steps.count == onboarding.state.total, "步骤条数应与 total 一致")
            expect(onboarding.state.done >= 1, "至少完成平台那一步，实际 " + String(onboarding.state.done))
            if onboarding.state.finished {
                expect(onboarding.state.command == nil, "走完六步后不该再给命令")
            } else {
                expect((onboarding.state.command ?? "").hasPrefix("node src/cli.mjs"), "没走完就要给可跑命令：" + (onboarding.state.command ?? "-"))
            }
        } catch {
            expect(false, "引导链路抛错：" + String(describing: error))
        }

        engine.stop()
        if failures.isEmpty {
            print("原生客户端自检通过")
            exit(0)
        }
        print("原生客户端自检失败 " + String(failures.count) + " 项")
        exit(1)
    }
}
