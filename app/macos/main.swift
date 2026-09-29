// dsh-learn 的 macOS 原生客户端。
// 界面全部是系统控件（SwiftUI + AppKit），判定引擎是两个旁边文件里的本地 Node 服务——
// 客户端只说 HTTP，不嵌网页，所以窗口里没有任何 HTML/WebView。
import AppKit
import SwiftUI

let logDir = ("~/Library/Logs/dsh-learn" as NSString).expandingTildeInPath
let logPath = logDir + "/app.log"

func ensureLogFile() {
    try? FileManager.default.createDirectory(at: URL(fileURLWithPath: logDir), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: logPath) {
        FileManager.default.createFile(atPath: logPath, contents: nil)
    }
}

struct RootView: View {
    @ObservedObject var store: Store
    @ObservedObject private var palette = PaletteState.shared
    @ObservedObject private var trend = TrendState.shared
    // 右栏是"支持性面板"：窄窗口下收起来，中栏就能拿到全部宽度（调研结论：支持性面板只在宽屏出现）
    @State private var showVerdict = true

    var body: some View {
        Group {
            if store.bootstrap == nil {
                bootView
            } else {
                VStack(spacing: 0) {
                    pageBar
                    // 与网页版同一套页面划分：学习（全部既有功能）/ 项目 / 简历
                    // 每个分支套 AnyView：这几个页面分支多且异构，编译器在 Group/switch 里推断
                    // 它们时会直接失败（实测报的是 TableColumn 那串泛型错误，且把某个页面拆到
                    // 独立文件后更容易触发）。擦除后推断变成平凡，代价只是页面切换时多一层包装。
                    switch store.page {
                    case "repo", "projects":
                        AnyView(RepoPage())
                    case "jobs":
                        AnyView(JobsPage())
                    case "flow":
                        AnyView(FlowPage())
                    default:
                        OnboardingBox()
                            .padding(.horizontal, 12)
                            .padding(.top, 8)
                        HSplitView {
                            TaskList()
                                .frame(minWidth: 240, idealWidth: 310)
                            TaskDetail()
                                .frame(minWidth: 380)
                            if showVerdict {
                                VerdictPanel()
                                    .frame(minWidth: 300, idealWidth: 350)
                            }
                        }
                    }
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .dshToggleVerdict)) { _ in
            withAnimation(.easeInOut(duration: 0.15)) { showVerdict.toggle() }
        }
        .environmentObject(store)
        .sheet(isPresented: $palette.open) { PaletteSheet().environmentObject(store) }
        .sheet(isPresented: $trend.open) { TrendBox().environmentObject(store) }
        // 最小尺寸按内容需要定，不是按"三栏能塞下"定：三栏 minWidth 之和 240+380+300 加上栏间距
        // 已是 950 上下，980 的窗口一拖就会先牺牲最该看的题单（第 145 轮实测：题单只剩两行半）。
        .frame(minWidth: 1060, minHeight: 700)
    }

    // 右上角那句提示：每个页面在哪个目录上工作
    private var pageHint: String {

        if store.page == "jobs" { return "投递记录：~/.dsh-learn/jobs.json" }
        if store.page == "flow" { return "闭环状态来自练习记录 / 项目目录 / 投递记录" }
        if store.page == "repo" { return "项目目录：~/.dsh-learn/projects/（摄入 → 知识点 → 草案）" }
        return ""
    }

    // 页面切换条：与网页版导航同一件事（学习 / 项目 / 简历 / 流程）
    private var pageBar: some View {
        HStack(spacing: 10) {
            Picker("页面", selection: Binding(get: { store.page }, set: { store.page = $0 })) {
                Text("项目/仓库").tag("repo")
                Text("学习").tag("learn")
                Text("简历").tag("jobs")
                Text("流程").tag("flow")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 320)
            Spacer()
            Text(pageHint)
                .font(.caption).foregroundStyle(.tertiary)
                .font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.06))
    }

    private var bootView: some View {
        VStack(spacing: 14) {
            if store.errorText == nil {
                ProgressView()
                Text(store.status).font(.headline)
                Text("引擎在本机运行，题库、判定与进度都在项目目录里。").font(.callout).foregroundStyle(.secondary)
            } else {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 34)).foregroundStyle(.orange)
                    .accessibilityHidden(true)   // 下方文字已经说明问题，图标是装饰
                Text("启动本地引擎失败").font(.headline)
                Text(store.errorText ?? "").font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    .frame(maxWidth: 520)
                HStack {
                    Button("重试") { Task { await store.start() } }
                    Button("打开日志") { NSWorkspace.shared.open(URL(fileURLWithPath: logPath)) }
                }
            }
        }
        .padding(40)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var store: Store!

    // AppKit 在主线程回调，但编译器不知道，所以这几个回调显式标 @MainActor：
    // Store 的 @Published 只在主线程上更新，SwiftUI 才不会"后台线程改状态"。
    private var activity: NSObjectProtocol?

    @MainActor func applicationDidFinishLaunching(_ notification: Notification) {
        // 命令面板：AppKit 菜单项自带快捷键（⌘K），比监听 KeyDown 可靠
        let paletteMenu = NSMenu()
        let paletteRoot = NSMenuItem()
        paletteRoot.submenu = paletteMenu
        let paletteItem = NSMenuItem(title: "命令面板…", action: #selector(openPalette), keyEquivalent: "k")
        paletteItem.target = self
        paletteMenu.addItem(paletteItem)
        let appearanceMenu = NSMenu()
        let appearanceRoot = NSMenuItem(title: "外观", action: nil, keyEquivalent: "")
        appearanceRoot.submenu = appearanceMenu
        for (title, theme) in [("跟随系统", "auto"), ("浅色", "light"), ("深色", "dark")] {
            let item = NSMenuItem(title: title, action: #selector(applyAppearance(_:)), keyEquivalent: "")
            item.representedObject = theme
            item.target = self
            appearanceMenu.addItem(item)
        }
        paletteMenu.addItem(appearanceRoot)
        let trendItem = NSMenuItem(title: "成绩单…", action: #selector(openTrend), keyEquivalent: "t")
        trendItem.target = self
        paletteMenu.addItem(trendItem)
        if let main = NSApplication.shared.mainMenu {
            main.addItem(paletteRoot)
        } else {
            let main = NSMenu()
            main.addItem(paletteRoot)
            NSApplication.shared.mainMenu = main
        }
        ensureLogFile()
        Engine.appendLog("启动（原生客户端），项目根目录 " + Engine.projectRoot() + "\n", to: logPath)
        // 窗口不在前台时系统会 App Nap 降频，能把启动引擎的等待拖到十几秒——学习工具不该因为"没在前台"就起不来
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: "本地判定引擎需要及时响应")
        buildMenu()

        store = Store(engine: Engine(logPath: logPath))
        let root = RootView(store: store)

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 840),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "dsh-learn · 命令行学习与验证"
        window.center()
        window.setFrameAutosaveName("dsh-learn-main")
        window.minSize = NSSize(width: 980, height: 620)
        window.contentView = NSHostingView(rootView: root)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        Task { await store.start() }
    }

    func buildMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 dsh-learn", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "刷新题库与进度", action: #selector(refresh), keyEquivalent: "r")
        appMenu.addItem(withTitle: "在浏览器中打开网页版", action: #selector(openInBrowser), keyEquivalent: "o")
        appMenu.addItem(withTitle: "打开日志文件", action: #selector(openLog), keyEquivalent: "l")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出 dsh-learn", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // 编辑菜单：响应链要它，文本框的 Cmd+C/V/X/A 才走得到
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        // 难度子菜单：⌘1-⌘4（与网页版的 1-4 对应）
        let levelItem = NSMenuItem()
        mainMenu.addItem(levelItem)
        let levelMenu = NSMenu(title: "难度")
        levelMenu.addItem(withTitle: "全部难度", action: #selector(setLevelAll), keyEquivalent: "1")
        levelMenu.addItem(withTitle: "简单", action: #selector(setLevelEasy), keyEquivalent: "2")
        levelMenu.addItem(withTitle: "中等", action: #selector(setLevelMedium), keyEquivalent: "3")
        levelMenu.addItem(withTitle: "困难", action: #selector(setLevelHard), keyEquivalent: "4")
        levelMenu.addItem(NSMenuItem.separator())
        levelMenu.addItem(withTitle: "搜索框", action: #selector(focusSearch), keyEquivalent: "f")
        levelMenu.addItem(NSMenuItem.separator())
        // 右栏（判定面板）显隐：窄窗口下的主要出路就是把支持性面板收起来
        let verdictItem = levelMenu.addItem(withTitle: "显示 / 隐藏判定面板", action: #selector(toggleVerdict), keyEquivalent: "i")
        verdictItem.keyEquivalentModifierMask = [.command, .option]
        levelItem.submenu = levelMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    // 难度与搜索做成菜单项：原生 App 的快捷键要走菜单，才符合预期（⌘1-⌘4、⌘F）
    @MainActor @objc func setLevelAll() { store.setFilter(level: "all") }
    @MainActor @objc func setLevelEasy() { store.setFilter(level: "easy") }
    @MainActor @objc func setLevelMedium() { store.setFilter(level: "medium") }
    @MainActor @objc func setLevelHard() { store.setFilter(level: "hard") }
    @MainActor @objc func focusSearch() { NotificationCenter.default.post(name: .dshFocusSearch, object: nil) }
    @MainActor @objc func toggleVerdict() { NotificationCenter.default.post(name: .dshToggleVerdict, object: nil) }

    @objc func showAbout() {
        let alert = NSAlert()
        alert.messageText = "dsh-learn"
        alert.informativeText = "跨平台命令行学习与验证的原生 macOS 客户端。\n界面是系统控件，判定、题库与进度由项目目录里的同一个引擎提供。"
        alert.runModal()
    }

    @MainActor @objc func refresh() {
        Task {
            await store.start()
            await store.refreshProgress()
        }
    }

    @MainActor @objc func openInBrowser() {
        guard let base = store.engine.baseURL else { return }
        NSWorkspace.shared.open(base)
    }

    @MainActor @objc func openLog() { NSWorkspace.shared.open(URL(fileURLWithPath: logPath)) }

    @objc func openPalette() { PaletteState.shared.open = true }

    @objc func openTrend() { TrendState.shared.open = true }

    // 外观：立即改本窗口外观，同时把偏好写进共享存储（网页版下次刷新也会用同一个值）
    @objc func applyAppearance(_ sender: NSMenuItem) {
        let theme = (sender.representedObject as? String) ?? "auto"
        switch theme {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
        Task { @MainActor in
            guard let engine = store?.engine else { return }
            _ = try? await engine.setTheme(theme)
        }
    }

    @MainActor func applicationWillTerminate(_ notification: Notification) {
        store?.engine.stop()
        if let token = activity { ProcessInfo.processInfo.endActivity(token) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
