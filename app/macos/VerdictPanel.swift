// 任务详情的支撑面板：判定面板 / 笔记 / 验证。
//
// 从 NativeUI.swift 拆出来的第一组**叶子视图**（不是整页）：整页跨文件会让编译器推断失败
// （见 COMPLETION-REPORT 5.201 的 RepoPage 尝试），叶子视图则安全——它们只依赖 Store 与自身 @State。
//
import SwiftUI

struct VerdictPanel: View {
    @EnvironmentObject var store: Store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let payload = store.result {
                    ResultSummary(payload: payload, platform: store.platform.isEmpty ? (store.bootstrap?.platform ?? "") : store.platform)
                    if let matched = payload.result.matched, !matched.isEmpty {
                        Text("已命中").font(.subheadline).bold()
                        FlowText(items: matched, tint: .green) { item in store.removeSnippet(item) }
                    }
                    if !payload.result.missing.isEmpty {
                        Text("还差这些").font(.subheadline).bold()
                        ForEach(payload.result.missing, id: \.self) { item in
                            Label(item, systemImage: "exclamationmark.circle")
                                .font(.callout)
                                .foregroundStyle(.orange)
                        }
                    }
                    if !payload.result.notes.isEmpty {
                        Text("写得不对的地方").font(.subheadline).bold()
                        ForEach(payload.result.notes, id: \.self) { item in
                            Label(item, systemImage: "xmark.octagon")
                                .font(.callout)
                                .foregroundStyle(.red)
                        }
                    }
                    if !payload.result.pass, let task = store.selectedTask {
                        Divider()
                        Text("提示").font(.subheadline).bold()
                        Text(task.hint ?? "没有提示").font(.callout).textSelection(.enabled)
                        Text("参考答案").font(.subheadline).bold()
                        Text(task.sample ?? "这道题还没有参考答案").font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                    }
                    Divider()
                    Button("下一题 →") { Task { await store.next() } }
                        .keyboardShortcut(.downArrow, modifiers: [])
                } else {
                    ReviewSection()
                    NoteSection()
                    Image(systemName: "checkmark.seal")
                    .accessibilityHidden(true)
                        .font(.system(size: 34))
                        .foregroundStyle(.tertiary)
                    Text("还没有判定").font(.headline)
                    Text("在中间写完命令，按 ⌘↩ 判定（或点判定按钮）。判定在本机完成，记录写进同一份进度。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if !store.history.isEmpty {
                        Divider()
                        Text("这道题的最近记录").font(.subheadline).bold()
                        ForEach(store.history) { row in
                            HStack(spacing: 6) {
                                Text(String(row.score) + " 分").monospacedDigit()
                                Text(row.verdict).foregroundStyle(.secondary)
                                if let platform = row.platform, !platform.isEmpty {
                                    Text(platform).font(.caption)
                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                        .overlay(Capsule().stroke(Color.secondary.opacity(0.5)))
                                }
                                Spacer()
                                Text(row.at).font(.caption).foregroundStyle(.tertiary)
                            }
                            .font(.callout)
                        }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(.background)
    }
}

// 我的笔记：跟题走的心得。与网页版共用一份存储，写在哪儿都能看到。
struct NoteSection: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "square.and.pencil")
                .accessibilityHidden(true)
                Text("我的笔记").font(.subheadline).bold()
                Spacer()
                if let at = store.noteSavedAt {
                    Text("已保存 " + String(at.replacingOccurrences(of: "T", with: " ").prefix(16)))
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
            TextEditor(text: Binding(get: { store.noteText }, set: { store.noteText = $0 }))
                .font(.callout)
                .frame(minHeight: 90)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack(spacing: 8) {
                Button("保存笔记") { Task { await store.saveNote() } }
                    .controlSize(.small)
                    .disabled(store.selected == nil)
                Button("删除笔记") { Task { await store.deleteNote() } }
                    .controlSize(.small)
                    .disabled(store.selected == nil || store.noteText.isEmpty)
                Spacer()
                Text("空内容保存即删除").font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// 只读验证结果的展示：命令、结论、输出。失败时把原因摆在最前面，不让人猜。
struct VerifyBox: View {
    var result: VerifyResult

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: result.ok == true ? "checkmark.seal" : (result.ran == true ? "exclamationmark.triangle" : "info.circle"))
                    .foregroundStyle(result.ok == true ? .green : .orange)
                    .accessibilityHidden(true)   // 状态下一条文字已经说清楚了
                Text(result.ok == true ? "只读验证通过" : (result.ran == true ? "只读验证未通过" : "没有跑"))
                    .font(.subheadline).bold()
                Spacer()
                if let runner = result.runner { Text("后端 " + runner).font(.caption).foregroundStyle(.tertiary) }
            }
            if let cmd = result.cmd {
                Text(cmd).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            }
            if let note = result.reason, !note.isEmpty {
                Text(note).font(.callout).foregroundStyle(.secondary)
            }
            if let output = result.output, !output.isEmpty {
                Text(output.prefix(600)).font(.system(.callout, design: .monospaced))
                    .foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
        .padding(8)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// 项目/仓库页（最左一段）：与网页版「项目/仓库」页同一件事——摄入、仓库解析、草案。
// 单独成页的原因：这些操作跟"今天练哪道"没关系，混在学习页里既挤又难找。
// 草案接口只收文件名（拒绝路径是安全契约）；项目索引里存的是 drafts/xxx.json，取最后一段再发。
// 放在文件级：RepoPage 与 ProjectSection 两处都要用。
func baseName(_ file: String) -> String {
    guard let at = file.lastIndex(of: "/") else { return file }
    return String(file[file.index(after: at)...])
}

func resultTitle(_ result: ProjectIngest) -> String {
    let name = result.project ?? "-"
    if let via = result.via { return "项目 " + name + "　来源方式 " + String(describing: via) }
    return "项目 " + name
}
