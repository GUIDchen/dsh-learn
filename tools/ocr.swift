// 极简 OCR 助手：macOS 自带 Vision 框架，本地识别、不联网、不需要任何第三方库。
// 由 src/core/ocr.mjs 首次使用时用 swiftc 编译到 ~/.dsh-learn/bin/dsh-ocr。
// 用法：dsh-ocr <图片路径>   →  stdout 每行一段识别文字
import Foundation
import AppKit
import Vision

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("用法: dsh-ocr <图片路径>\n".data(using: .utf8)!)
    exit(2)
}
let path = args[1]
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("无法读取图片：\(path)\n".data(using: .utf8)!)
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
// 中英混排是岗位 JD 的常态
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("识别失败：\(error)\n".data(using: .utf8)!)
    exit(4)
}

let observations = request.results ?? []
if observations.isEmpty {
    FileHandle.standardError.write("没有识别到文字\n".data(using: .utf8)!)
    exit(5)
}
for observation in observations {
    if let candidate = observation.topCandidates(1).first {
        print(candidate.string)
    }
}
