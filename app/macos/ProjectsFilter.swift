// 项目筛选栏：从 NativeUI.swift 抽出来的第一个页面级组件。
//
// 抽它的直接原因很实在：加上检索控件后 NativeUI.swift 到了 3003 行、越过 3000 行体量预算。
// 页面拆分的第一步就选它——自包含、只依赖 Store，不牵扯别的视图。
import SwiftUI

struct ProjectsFilterBar: View {
    @ObservedObject var store: Store

    var body: some View {
        HStack(spacing: 8) {
            TextField("检索：项目名 / 来源 / 知识点", text: $store.projectQuery)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
                .onSubmit { Task { await store.loadProjects() } }
            Toggle("只看缺原文", isOn: $store.projectMissingText)
                .onChange(of: store.projectMissingText) { _ in Task { await store.loadProjects() } }
            Picker("排序", selection: $store.projectSort) {
                Text("最近更新").tag("updated")
                Text("名称").tag("name")
                Text("来源数").tag("sources")
                Text("知识点").tag("knowledge")
                Text("草案题").tag("tasks")
            }
            .frame(width: 160)
            .onChange(of: store.projectSort) { _ in Task { await store.loadProjects() } }
        }
    }
}
