// 记住上次的筛选与选中的题：原生 App 重开应该回到上次的位置，而不是每次都从头找。
// 用 UserDefaults（标准做法）；可测试的部分与界面无关，所以能被 headless 自检直接跑。
import Foundation

struct NativePrefs: Codable, Equatable {
    var track: String = "all"
    var level: String = "all"
    var query: String = ""
    var taskId: String?
    // 评测平台：空字符串表示"跟随服务端默认"。题库里有平台变体题（同一件事 mac/linux/win 写法不同），
    // 选定平台后判定才按那个平台的口径来——与网页版的平台下拉框是同一件事。
    var platform: String = ""

    static let empty = NativePrefs()
}

final class PrefsStore {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "dsh-learn.native.prefs") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> NativePrefs {
        guard let data = defaults.data(forKey: key),
              let prefs = try? JSONDecoder().decode(NativePrefs.self, from: data) else {
            return NativePrefs.empty
        }
        // 只认四档难度取值，避免旧版本写坏的值把界面卡在空列表
        if !["all", "easy", "medium", "hard"].contains(prefs.level) { return NativePrefs.empty }
        // 平台同理：认不出来的取值当没设过，免得拿着一个无效平台去判定
        if !["", "darwin", "linux", "win32"].contains(prefs.platform) { return NativePrefs.empty }
        return prefs
    }

    func save(_ prefs: NativePrefs) {
        guard let data = try? JSONEncoder().encode(prefs) else { return }
        defaults.set(data, forKey: key)
    }

    func reset() {
        defaults.removeObject(forKey: key)
    }
}
