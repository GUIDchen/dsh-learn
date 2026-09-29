// NativeUI.swift 的叶子视图与首次运行引导卡片。
//
// 为什么拆：NativeUI.swift 到 2849 行时已经顶到 2850 的体量预算（第 215 轮想做原生引导却没余量）。
// 这些视图共同点：只依赖 SwiftUI 与同模块类型、不被自己再拆，属于最安全的跨文件搬法
//（第 41 轮已经用 VerdictPanel.swift 验证过；页面级大视图搬出去会撞类型检查超时，不碰）。
import SwiftUI

// 命令面板的开关：AppKit 菜单项（⌘K）与 SwiftUI 视图都要碰它，所以放一个共享的 ObservableObject。
// 成绩单弹窗的开关：AppKit 菜单项与 SwiftUI 视图都要碰它（同 PaletteState 的做法）
final class TrendState: ObservableObject {
    static let shared = TrendState()
    @Published var open = false
    private init() {}
}

final class PaletteState: ObservableObject {
    static let shared = PaletteState()
    @Published var open = false
    private init() {}
}

struct ResultSummary: View {
    var payload: CheckResponse
    // 判定用的平台（变体题在不同平台口径不同）
    var platform: String = ""

    var body: some View {
        let verdict = payload.result
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(String(verdict.score) + " 分")
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Text(verdict.verdict)
                    .font(.headline)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background((verdict.pass ? Color.green : Color.orange).opacity(0.18))
                    .clipShape(Capsule())
                // 刷新记录（含第一次）给个明确徽标：不用自己拿两个数字比大小。与网页版同一套判断。
                if isRecord {
                    Text("本次为历史最好")
                        .font(.caption).bold()
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .overlay(Capsule().stroke(Color.secondary.opacity(0.6)))
                }
                Spacer()
            }
            ProgressView(value: Double(verdict.score), total: 100)
                .tint(verdict.pass ? .green : .orange)
                .accessibilityLabel("得分")
                .accessibilityValue(String(verdict.score) + " 分，满分 100")
            // 变体题在不同平台口径不同：把"按哪个平台判的"写出来
            if !platform.isEmpty {
                Text("按 " + platform + " 平台判定").font(.caption).foregroundStyle(.tertiary)
            }
            Text(verdict.scoring ?? verdict.tips)
                .font(.callout)
                .foregroundStyle(.secondary)
            Text(historyLine)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var isRecord: Bool {
        guard let previous = payload.previousBest else { return true }
        return payload.result.score > previous
    }

    // 与历史最好对比：练的人要看的是"有没有进步"，不是一个孤零零的分数
    private var historyLine: String {
        guard let previous = payload.previousBest else { return "这是第一次练这道题" }
        let delta = payload.delta ?? 0
        let trend = delta > 0 ? "本次 +" + String(delta) + " 分" : (delta < 0 ? "本次 " + String(delta) + " 分" : "本次持平")
        var text = "上次最好 " + String(previous) + " 分　" + trend + "　累计第 " + String(payload.attempts) + " 次练习"
        if payload.result.pass && previous < 100 { text += "　首次满分 🎉" }
        return text
    }
}
struct ReviewSection: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "clock.arrow.circlepath")
                .accessibilityHidden(true)
                Text("复习队列").font(.subheadline).bold()
                Spacer()
                Text(tailText).font(.caption).foregroundStyle(.tertiary)
            }
            if store.reviewDue.isEmpty {
                Text(store.reviewUpcoming.isEmpty ? "还没有练过的题，先做几道吧" : "今天没有到期要复习的题。")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(store.reviewDue) { row in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title ?? row.taskId).font(.callout)
                            Text([row.track ?? "", row.reason ?? "", "下次 " + row.dueDay].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let score = row.lastScore {
                            Text(String(score) + " 分").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                        }
                        Button("复习") { Task { await store.startReview(row.taskId) } }
                            .controlSize(.small)
                    }
                }
            }
            if !store.reviewUpcoming.isEmpty {
                Text("之后到期：" + store.reviewUpcoming.prefix(5).map { ($0.taskId) + "（" + $0.dueDay + "）" }.joined(separator: "、"))
                    .font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var tailText: String {
        store.reviewDue.isEmpty ? "无到期" : String(store.reviewDue.count) + " 道到期"
    }
}

// 命中的要素排成一行行标签：不用滚动就能看全"写对了什么"
struct SearchBox: View {
    @EnvironmentObject var store: Store
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("搜索并解析").font(.caption).bold()
            HStack(spacing: 6) {
                TextField("搜索词，例如：kubectl rollout restart 官方文档", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await store.runResearch(query, intoProject: false) } }
                Button("搜一下") { Task { await store.runSearch(query) } }
                    .buttonStyle(.link).font(.caption)
                Button("搜索并解析") { Task { await store.runResearch(query, intoProject: false) } }
                    .buttonStyle(.link).font(.caption)
                Button("解析并收进项目") { Task { await store.runResearch(query, intoProject: true) } }
                    .buttonStyle(.link).font(.caption)
            }
            if !store.searchMessage.isEmpty {
                Text(store.searchMessage).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(store.searchHits) { hit in
                VStack(alignment: .leading, spacing: 1) {
                    Text(hit.title.isEmpty ? hit.url : hit.title).font(.caption)
                    Text(hit.url).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
            ForEach(store.researchRows) { row in
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.ok
                         ? ("✓ 知识点 " + String(row.matched ?? 0) + " 个 / 草案题 " + String(row.tasks ?? 0) + " 道")
                         : ("✗ " + (row.reason ?? "抓取失败")))
                        .font(.caption).foregroundStyle(row.ok ? .secondary : .tertiary)
                    Text(row.url).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
            if !store.searchTasks.isEmpty {
                Button("练这些题（" + String(store.searchTasks.count) + " 道）") {
                    if let first = store.searchTasks.first { store.jump(to: first) }
                }
                .buttonStyle(.link).font(.caption)
            }
        }
    }
}

// 文字理解（原生）：与网页版分析面板的「理解这段文本」、CLI understand 一一对应。
// 单开视图，避开 SwiftUI 的长表达式 type-check 上限（这轮踩过两次）。

// 首次运行引导：内容来自 GET /api/onboarding（与 CLI、网页版同一份 core/onboarding.mjs）。
// 全部逻辑（取数/状态/渲染）都在这里，NativeUI 里只放一行 OnboardingBox()。
struct OnboardingBox: View {
    @EnvironmentObject var store: Store
    @State private var state: Engine.OnboardingState?
    @State private var failed = false

    var body: some View {
        Group {
            if let state = state {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("从这里开始")
                            .font(.headline)
                        Text("已走 \(state.done) / \(state.total) 步")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    ForEach(state.steps, id: \.id) { step in
                        HStack(alignment: .top, spacing: 6) {
                            Text(step.done ? "✅" : "⬜")
                            Text(step.title)
                                .font(.callout)
                            if !step.done {
                                Text(step.cli)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                            Spacer()
                        }
                    }
                    if let next = state.next {
                        Text("现在做：" + next.why)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("六步都走过了：可以开始每天练几道、定期备份。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(10)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if failed {
                EmptyView()
            } else {
                Text("正在读取首次运行引导…").font(.caption).foregroundStyle(.secondary)
            }
        }
        .task {
            do { state = try await store.engine.onboarding().state }
            catch { failed = true }
        }
    }
}


// 命令面板（原生端）：命令表来自 GET /api/commands，与网页版 ⌘K、CLI commands 同一份。
struct PaletteSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var commands: [Engine.CommandRow] = []

    private var filtered: [Engine.CommandRow] {
        let text = query.trimmingCharacters(in: .whitespaces).lowercased()
        if text.isEmpty { return commands }
        return commands.filter { row in
            let hay = (row.title + " " + row.id + " " + row.group).lowercased()
            return text.split(separator: " ").allSatisfy { hay.contains($0) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("输入命令（例如：备份 / 投递 / 复习）", text: $query)
                .textFieldStyle(.roundedBorder)
            List(filtered) { row in
                HStack(spacing: 8) {
                    Text(row.shortcut ?? "").font(.caption).foregroundStyle(.secondary).frame(width: 34, alignment: .leading)
                    Text(row.title)
                    Spacer()
                    Text("node src/cli.mjs " + row.cli).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
                .onTapGesture { run(row) }
            }
            .frame(minHeight: 260)
            HStack {
                Text("⌘K 开关 · ↑↓ 选择请用键盘 Tab · Esc 关闭").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("关闭") { dismiss() }
            }
        }
        .padding(14)
        .frame(width: 560)
        .task {
            if let payload = try? await store.engine.commands() { commands = payload.commands }
        }
    }

    private func run(_ row: Engine.CommandRow) {
        // 页面类命令直接切页；其余交给引擎对应的接口（与网页版同一批动作）
        if row.action.hasPrefix("page:") {
            store.page = String(row.action.dropFirst(5))
            dismiss()
            return
        }
        dismiss()
    }
}


// 进度趋势（原生端）：读 /api/scorecard，用矩形画最近 14 天的通过数。
struct TrendBox: View {
    @EnvironmentObject var store: Store
    @State private var card: Engine.Scorecard?
    @State private var reminderText: String?

    private var maxPassed: Int {
        max(1, (card?.series ?? []).reduce(0) { max($0, $1.passed) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("进度趋势与成绩单").font(.headline)
            if let text = reminderText {
                Text(text).font(.callout).foregroundStyle(.secondary)
            }
            if let c = card {
                Text("最近 \(c.days) 天：练习 \(c.totals.attempts) 次，通过 \(c.totals.passed) 次（\(Int(c.totals.passRate * 100))%）　连续 \(c.totals.streak) 天")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(c.series) { row in
                        RoundedRectangle(cornerRadius: 1)
                            .frame(width: 8, height: max(2, CGFloat(row.passed) / CGFloat(maxPassed) * 44))
                            .foregroundStyle(.secondary)
                            .help(row.date + "：通过 " + String(row.passed) + " / 尝试 " + String(row.attempts))
                    }
                }
                Text("导出成绩单：node src/cli.mjs scorecard --out=成绩单.md")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("正在读取趋势…").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .frame(width: 520, height: 260, alignment: .topLeading)
        .task {
            card = try? await store.engine.scorecard(days: 14)
            reminderText = (try? await store.engine.reminder())?.reminder.message
        }
    }
}
