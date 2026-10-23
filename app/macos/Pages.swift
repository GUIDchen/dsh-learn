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
