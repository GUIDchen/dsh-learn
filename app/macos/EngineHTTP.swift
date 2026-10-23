// 原生客户端的 HTTP 层：拼 URL、发请求、把非 200 分成「业务错误」与「引擎没起来」。
//
// 从 Engine.swift 拆出（同类职责集中）；extension 里需要访问 baseURL（private(set) 的读取是 internal，够用），
// 所以 request/post/postAny 从 private 改成模块内可见——跨文件 extension 不能访问 fileprivate。
import Foundation

extension Engine {

    func request(_ path: String, query: [URLQueryItem] = [], method: String, body: [String: Any]?) async throws -> Data {
        guard let base = baseURL else { throw EngineError.timeout }
        // 用 URLComponents 拼，不要用 appendingPathComponent：它会把 "?" 转义成 %3F，
        // 于是 /api/history?taskId=x 变成一条不存在的路由（踩过一次，接口 404 而页面只是"没有记录"）。
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw EngineError.timeout }
        comps.path = path
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw EngineError.http("拼不出请求地址：" + path) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let text = String(data: data, encoding: .utf8) ?? ""
            // 非 200 分两种：接口报的业务错误（error 字段）直接照给；其余才当成引擎没起来。
            // 之前一律套上"引擎没起来 + 文稿文件夹权限"的长文案，项目元数据损坏时把人引到完全无关的地方。
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = obj["error"] as? String, !message.isEmpty {
                throw EngineError.api(message)
            }
            throw EngineError.http("HTTP " + String(code) + " " + text.prefix(200))
        }
        return data
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await request(path, query: query, method: "GET", body: nil)
        return try JSONDecoder().decode(T.self, from: data)
    }

    // 有些接口返回的是"给人看的整份文件"（例如备份），不解码成结构体更合适
    func getRaw(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        try await request(path, query: query, method: "GET", body: nil)
    }

    func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        let data = try await request(path, method: "POST", body: body)
        return try JSONDecoder().decode(T.self, from: data)
    }

    // 有些接口的返回结构不值得建模型（例如导入回执），拿 JSON 当字典用就行
    func postAny(_ path: String, body: [String: Any]) async throws -> [String: Any] {
        let data = try await request(path, method: "POST", body: body)
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
