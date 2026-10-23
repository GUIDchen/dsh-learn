// 流程页（七步闭环）：从 NativeUI.swift 整块搬出，视图代码原样。
//
// 为什么先搬它：FlowPage 只依赖 Store（@EnvironmentObject）与 store 上的字段，不引用 NativeUI 里的其它视图/函数，
// 是最安全的整页外移对象。NativeUI 仍保留学习页 / 项目页 / 投递页，后续可以一次搬一个。
import SwiftUI

struct FlowPage: View {
    @EnvironmentObject var store: Store
    @State private var jd = ""
    @State private var jdUrl = ""
    @State private var filterLocation = ""
    @State private var filterSalaryMin = ""
    @State private var filterSalaryMax = ""
    @State private var filterRemoteOnly = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("求职学习闭环").font(.title2).bold()

                VStack(alignment: .leading, spacing: 5) {
                    Text("数据体检").font(.subheadline).bold()
                    Text("检查项目元数据 / 索引 / 原文 / 草案 / 练习记录是否自洽；修复只做「能从现有数据重算」的事。")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Button("跑一次体检") { Task { await store.runDoctor(fix: false) } }
                            .buttonStyle(.link).font(.caption)
                        Button("修复可自动修的") { Task { await store.runDoctor(fix: true) } }
                            .buttonStyle(.link).font(.caption)
                    }
                    Text(store.doctorMessage).font(.caption2).foregroundStyle(.secondary)
                    if !store.doctorText.isEmpty {
                        Text(String(store.doctorText.prefix(600))).font(.caption2).foregroundStyle(.secondary).lineLimit(10)
                    }
                }
                Text("学习 → 项目解析学习 → 生成简历 → 搜集招聘信息 → 按岗位补知识点 → 岗位推荐 → 投递。每一步的状态都由真实数据推出。")
                    .font(.callout).foregroundStyle(.secondary)
                if !store.flowMessage.isEmpty {
                    Text(store.flowMessage).font(.callout).foregroundStyle(.secondary)
                }
                stageList
                Divider()
                resumeSection
                Divider()
                collectSection
                Divider()
                recommendSection
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { Task { await store.loadFlow() } }
    }

    private var stageList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("七步").font(.headline)
            ForEach(store.flow?.stages ?? []) { stage in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(mark(stage.status) + " " + stage.name).font(.callout).bold()
                        Text(stage.progress).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        if stage.status != "done" {
                            Text(stage.action?.label ?? "").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    Text(stage.evidence).font(.caption).foregroundStyle(.secondary)
                    if let blocked = stage.blocked, !blocked.isEmpty {
                        Text("⚠ " + blocked).font(.caption).foregroundStyle(.orange)
                    }
                }
                .padding(6)
                .background(Color.secondary.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private var resumeSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("简历要点（只写真实做过的事）").font(.headline)
            HStack(spacing: 8) {
                Button("生成简历要点") { Task { await store.runFlowResume() } }
                Text("技能清单 + 亮点（带依据）+ 项目经历 + 待补方向").font(.caption).foregroundStyle(.tertiary)
            }
            if let resume = store.flowResume {
                Text(resume.headline).font(.callout)
                resumeSkills(resume.skills ?? [])
                resumeHighlights(resume.highlights ?? [])
                resumeGaps(resume.gaps ?? [])
            }
        }
    }

    private var collectSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("搜集招聘信息").font(.headline)
            Text("招聘站点多半反爬：抓得到就用搜索面板，抓不到就把 JD 正文粘进来——识别、入库、算匹配度走同一套。")
                .font(.caption).foregroundStyle(.tertiary)
            HStack(spacing: 8) {
                TextField("岗位链接 https://…（登录站点靠 DSH_LEARN_COOKIE）", text: $jdUrl)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await store.runFlowCollectUrl(jdUrl) } }
                Button("按链接抓 JD") { Task { await store.runFlowCollectUrl(jdUrl) } }
                    .buttonStyle(.link).font(.caption)
            }
            TextEditor(text: $jd)
                .font(.system(.callout, design: .monospaced))
                .frame(minHeight: 70)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack(spacing: 8) {
                Button("粘 JD 入库（识别 + 存投递记录 + 算可练题）") {
                    Task { await store.runFlowCollect(jd) ; jd = "" }
                }
                .buttonStyle(.link).font(.caption)
                Button("选择 JD 截图…") { pickJdScreenshot() }
                    .buttonStyle(.link).font(.caption)
                Button("描述并抽全技术栈") { Task { await store.runDescribe(jd) } }
                    .buttonStyle(.link).font(.caption)
                Button("多岗位调研") { Task { await store.runSurvey(jd) } }
                    .buttonStyle(.link).font(.caption)
                Button("按分类调研") { Task { await store.runGroupSurvey(jd) } }
                    .buttonStyle(.link).font(.caption)
            }
            if !store.describeReport.isEmpty {
                Text(store.describeReport).font(.system(.caption, design: .monospaced)).textSelection(.enabled).lineLimit(20)
            }
            if let plan = store.flowPlan {
                Text(planSummary(plan)).font(.caption).foregroundStyle(.secondary)
                planPoints(plan)
            }
            if !store.flowFiles.isEmpty {
                Text("产出文件：" + store.flowFiles.joined(separator: "、")).font(.caption).foregroundStyle(.tertiary)
            }
            if let scaffold = store.flowScaffold {
                scaffoldPreview(scaffold)
            }
        }
    }

    private var recommendSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("岗位推荐").font(.headline)
            HStack(spacing: 8) {
                Button("按匹配度算一遍") { Task { await runFilteredRecommend() } }
                Text("匹配度 = 覆盖 55% + 硬要求 30% + 方向广度 15%；同级里新发布的排前面").font(.caption).foregroundStyle(.tertiary)
            }
            HStack(spacing: 8) {
                TextField("地点（如 深圳）", text: $filterLocation).textFieldStyle(.roundedBorder).frame(width: 120)
                TextField("最低 K", text: $filterSalaryMin).textFieldStyle(.roundedBorder).frame(width: 60)
                TextField("最高 K", text: $filterSalaryMax).textFieldStyle(.roundedBorder).frame(width: 60)
                Toggle("只看远程", isOn: $filterRemoteOnly).toggleStyle(.checkbox)
                Text("地点/薪资是硬门槛；没写薪资的岗位不会被筛掉").font(.caption).foregroundStyle(.tertiary)
            }
            ForEach(store.flowMatches) { row in
                matchRow(row)
            }
            if let pack = store.flowPack {
                packPreview(pack)
            }
        }
    }

    // 拆成小视图：SwiftUI 对"多层 ForEach + 可选链 + 长字符串拼接"的组合会报 type-check 超时（这轮第四次踩）
    @ViewBuilder
    private func resumeSkills(_ skills: [ResumeSkill]) -> some View {
        ForEach(skills) { skill in
            Text(skillLine(skill)).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func skillLine(_ skill: ResumeSkill) -> String {
        skill.track + "：" + skill.level + "　" + String(skill.passed) + "/" + String(skill.total) + "（" + String(skill.percent) + "%）"
    }

    @ViewBuilder
    private func resumeHighlights(_ rows: [ResumeHighlight]) -> some View {
        ForEach(Array(rows.prefix(6).enumerated()), id: \.offset) { pair in
            Text("· " + pair.element.text + "——" + pair.element.evidence).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
    }

    @ViewBuilder
    private func resumeGaps(_ gaps: [FlowGap]) -> some View {
        ForEach(gaps) { gap in
            Text("待补：" + gap.track + " " + String(gap.percent) + "%").font(.caption).foregroundStyle(.orange)
        }
    }

    // 项目书预览：交付项逐条 + 全文可选中复制（与网页版的「复制项目书」同一份内容）
    @ViewBuilder
    private func scaffoldPreview(_ scaffold: FlowScaffoldRow) -> some View {
        Text("项目书：交付标准 " + String((scaffold.deliverables ?? []).count) + " 条　命令 " + String((scaffold.commands ?? []).count) + " 条")
            .font(.caption).foregroundStyle(.secondary)
        ForEach(scaffold.deliverables ?? []) { item in
            Text(scaffoldLine(item)).font(.caption).foregroundStyle(.tertiary).lineLimit(2)
        }
        if let book = scaffold.book {
            Text(book).font(.system(.caption, design: .monospaced)).textSelection(.enabled).lineLimit(18)
        }
    }

    private func scaffoldLine(_ item: FlowScaffoldItem) -> String {
        "· " + item.requirement + "（命令 " + String((item.commands ?? []).count) + " 条 / 已通过 " + String(item.passed ?? 0) + "/" + String((item.tasks ?? []).count) + "）"
    }

    private func planSummary(_ plan: FlowPlanRow) -> String {
        let name = plan.projectName ?? ""
        let missing = (plan.missingTasks ?? []).count
        return "学习计划：" + name + "　匹配度 " + String(plan.match ?? 0) + "%　待练 " + String(missing) + " 道"
    }

    @ViewBuilder
    private func planPoints(_ plan: FlowPlanRow) -> some View {
        ForEach(Array((plan.points ?? []).prefix(6))) { point in
            Text(pointLine(point)).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
        }
    }

    private func pointLine(_ point: FlowPlanPoint) -> String {
        point.name + "：待练 " + String((point.missing ?? []).count) + "/" + String((point.tasks ?? []).count)
    }

    // 投递材料预览：先给硬要求逐条对比（最有用），全文靠 textSelection 让用户自己复制
    @ViewBuilder
    private func packPreview(_ pack: FlowPackRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(packTitle(pack)).font(.callout).bold()
            ForEach(pack.mustRows ?? []) { row in
                Text(mustLine(row)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            if let markdown = pack.markdown {
                Text(markdown).font(.system(.caption, design: .monospaced)).textSelection(.enabled).lineLimit(24)
            }
        }
        .padding(6)
        .background(Color.secondary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func mustLine(_ row: FlowPackMust) -> String {
        row.status + "　" + row.text + "（" + String(row.passed ?? 0) + "/" + String(row.total ?? 0) + "）"
    }

    private func packTitle(_ pack: FlowPackRow) -> String {
        let who = (pack.company ?? "") + " · " + (pack.position ?? "")
        return "投递材料：" + who + "　匹配度 " + String(pack.match ?? 0) + "%"
    }

    // 推荐行拆成独立视图：四个按钮 + 可选 + 长拼接放一起会 type-check 超时（这轮第五次踩）
    @ViewBuilder
    private func matchRow(_ row: FlowMatch) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(matchLine(row)).font(.callout).bold()
                Text(row.company + " · " + row.position).font(.caption)
                matchButtons(row)
            }
            if !attrLine(row).isEmpty { Text(attrLine(row)).font(.caption).foregroundStyle(.tertiary) }
            matchWhy(row.why ?? [])
        }
        .padding(6)
        .background(Color.secondary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func runFilteredRecommend() async {
        await store.runFlowRecommend(
            location: filterLocation,
            salaryMin: Int(filterSalaryMin) ?? 0,
            salaryMax: Int(filterSalaryMax) ?? 0,
            remoteOnly: filterRemoteOnly
        )
    }

    // 岗位属性行：地点 / 薪资 / 发布时间（解析不出来就不显示）
    private func attrLine(_ row: FlowMatch) -> String {
        var parts: [String] = []
        if let location = row.location, !location.isEmpty { parts.append(location + (row.remote == true ? "（可远程）" : "")) }
        else if row.remote == true { parts.append("远程") }
        if let salary = row.salary, let text = salary.text, !text.isEmpty { parts.append(text) }
        if let posted = row.postedAt, !posted.isEmpty { parts.append("发布 " + posted) }
        return parts.joined(separator: "　")
    }

    private func matchLine(_ row: FlowMatch) -> String {
        String(row.match) + "%　" + String(row.covered) + "/" + String(row.total) + " 题"
    }

    // 按钮单独一个视图：五个按钮挤在 HStack 里会让 type-check 超时（这轮第七次）
    @ViewBuilder
    private func matchButtons(_ row: FlowMatch) -> some View {
        Button("生成学习项目") { Task { await store.runFlowBuild(row.jobId) } }
            .buttonStyle(.link).font(.caption)
        Button("投递材料") { Task { await store.runFlowPack(row.jobId) } }
            .buttonStyle(.link).font(.caption)
        Button("记投递") { Task { await store.runFlowApply(row.jobId) } }
            .buttonStyle(.link).font(.caption)
        if let missing = row.missing, let first = missing.first {
            Button("练差的题") { store.jump(to: first) }.buttonStyle(.link).font(.caption)
        }
    }

    @ViewBuilder
    private func matchWhy(_ rows: [String]) -> some View {
        ForEach(Array(rows.enumerated()), id: \.offset) { pair in
            Text("· " + pair.element).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    // JD 截图选择器：与项目面板的截图选择器同一个思路（原生 NSOpenPanel，不是网页 input）
    private func pickJdScreenshot() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = "选择岗位描述（JD）截图：本机识别，离线"
        panel.allowedContentTypes = [.png, .jpeg, .webP, .gif, .heic]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await store.runFlowCollectImage(at: url.path) }
    }

    private func mark(_ status: String) -> String {
        if status == "done" { return "✓" }
        if status == "doing" { return "…" }
        return "·"
    }
}

// 投递页：与 FlowPage 同样的整页外移（只依赖 Store 与 store 字段）
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
