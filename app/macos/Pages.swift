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

// 学习页的子视图（ProjectSection / TaskDetail / TaskRow / TaskList）：与整页同类的子区块外移

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
