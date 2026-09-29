# macOS App 的签名与公证

> 版本号与打包现在由 bash scripts/release-mac.sh 一条命令打通：算版本 → 写进 package.json 与 Info.plist → 构建 → 签名/公证 → zip + sha256 → 追加 docs/RELEASES.md 发布记录。
> 常用：bash scripts/release-mac.sh --ad-hoc（本机归档，默认 patch +1）、--bump minor|major、--version 0.3.0、--dry-run、--note "这次改了什么"。

给自己用：什么都不用做，bash app/macos/build.sh 出来的 ad-hoc 签名 App 在本机可以直接运行。
给别人用（发下载链接、拷给同事）：必须 **Developer ID 签名 + 公证 + stapling**，否则对方双击会被 Gatekeeper 拦下。

## 0. 先看本机有什么

~~~bash
bash app/macos/build.sh --identity-list
~~~

本项目的开发机当前状态：**0 valid identities**（只能临时签名），notarytool 1.1.2 已随 Xcode 安装。
所以本机能演练完整流程，但没有证书就产不出可对外分发的版本。

## 1. 拿到 Developer ID 证书

1. 加入 Apple Developer Program。
2. Xcode → Settings → Accounts → 选中团队 → Manage Certificates → 左下 + → **Developer ID Application**。
3. 确认能用：

~~~bash
security find-identity -v -p codesigning
# 期望看到：  "Developer ID Application: 你的名字 (TEAMID)"
~~~

站外分发用 Developer ID Application；只有上架 App Store 才用 Apple Distribution。

## 2. 配置公证凭据（一次即可）

用 App 专用密码（先在 appleid.apple.com 生成，不要用账号主密码）：

~~~bash
xcrun notarytool store-credentials dsh-learn \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "abcd-efgh-ijkl-mnop"
~~~

CI 里常用 App Store Connect API Key：

~~~bash
xcrun notarytool store-credentials dsh-learn \
  --key "/path/AuthKey_XXXX.p8" --key-id "XXXX" --issuer "issuer-uuid"
~~~

凭据存在钥匙串，profile 名（这里是 dsh-learn）之后用 --profile 指定。

## 3. 构建、签名、公证

~~~bash
bash app/macos/build.sh --sign                     # 自动挑第一个 Developer ID
bash app/macos/build.sh --sign --notarize --profile dsh-learn
~~~

脚本按顺序做四件事：

1. codesign --options runtime --timestamp：开 hardened runtime 并打可信时间戳（公证的硬性要求）。
2. ditto -c -k --keepParent 打成 zip，交给 notarytool submit --wait。
3. stapler staple + stapler validate：把公证票据钉进 App，离线也能通过 Gatekeeper。
4. 跑 spctl -a -vv 给出最终结论。

构建采用"先建到临时目录、签完名再原子替换"：签名失败时 dist 下的上一个可用版本保持不变。

## 4. 验证

~~~bash
codesign --verify --verbose=2 dist/dsh-learn.app
codesign -dv --verbose=4 dist/dsh-learn.app | grep -E 'Authority|TeamIdentifier|flags'
spctl -a -vv dist/dsh-learn.app        # 期望：accepted, source=Notarized Developer ID
xcrun stapler validate dist/dsh-learn.app
~~~

## 5. 常见失败

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| spctl 显示 rejected / no usable signature | 只做了 ad-hoc 签名，没公证 | 补上 --sign --notarize |
| notarytool 报 Invalid credentials | 用了账号主密码或密码过期 | 重新生成 App 专用密码并 store-credentials |
| 公证通过但 spctl 仍拒绝 | 没 stapling，离线校验不到票据 | 重跑 --notarize，或手动 stapler staple |
| codesign 报 code object is not signed at all | 签名后又改动过包内容 | 顺序永远是先构建再签名 |
| 对方提示"已损坏" | 下载被加了隔离属性且票据没钉上 | 检查 stapler validate；必要时让对方执行 xattr -dr com.apple.quarantine |

## 6. 在 CI 里发布（tag 触发）

.github/workflows/release.yml：推 v* 标签即在 macos-latest 上跑测试 → 导入证书 → 配置公证凭据 →
bash scripts/release-mac.sh → 上传 zip 与校验和 → 建 Release。需要配置的 secret：

| secret | 内容 | 怎么来 |
| --- | --- | --- |
| MACOS_CERT_P12_BASE64 | Developer ID Application 证书（p12）的 base64 | 钥匙串导出 .p12，再 base64 -i cert.p12 -o - |
| MACOS_CERT_PASSWORD | 导出 p12 时设的密码 | 自己设 |
| ASC_KEY_ID | App Store Connect API Key 的 Key ID | App Store Connect → Users and Access → Integrations → API Key |
| ASC_ISSUER_ID | Issuer ID | 同页面 |
| ASC_KEY_P8 | API Key 私钥文件内容 | 下载 .p8（只能下载一次） |

CI 用 API Key 而不是 App 专用密码，避免把 Apple ID 密码放进 secret。

## 7. 本地一键打包

~~~bash
bash scripts/release-mac.sh --ad-hoc              # 本机归档：dist/dsh-learn-<版本>.zip + .sha256（实测 83 KB）
bash scripts/release-mac.sh                       # 正式：签名 + 公证 + stapling + 打包
bash scripts/release-mac.sh --profile my-profile  # 指定公证凭据 profile
~~~

没有证书时脚本以退出码 1 结束，并明确告诉你下一步（申请证书 / 先看身份 / 改用 --ad-hoc）。

## 8. 版本号

Info.plist.template 里的 CFBundleShortVersionString / CFBundleVersion 就是对外版本号，也是发布包文件名（dsh-learn-<版本>.zip）；
同一版本号不要重复提交公证，改完版本号再构建提交。
