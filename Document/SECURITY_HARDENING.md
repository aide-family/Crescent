# 审计问题修复记录（2026-10-02）

本次按参考对话中的全部 15 类问题修改 Crescent-test，保持现有产品能力和 Pi / Electron 主进程边界。

| 原问题                    | 落实的修改                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地数据权限过宽          | 启动时设置私有 umask，修复 Crescent 自己的数据目录为 700、普通文件为 600；保留 Skill 脚本执行权限，不跟随符号链接。配置使用私有临时文件原子写入。                            |
| safeStorage 失败退回明文  | 加密不可用、Linux basic_text 或解密失败时明确拒绝读写；不静默清空密钥。可读的历史明文配置自动迁移，登录动作也加密落盘。                                                      |
| MCP 绕过审批              | 所有第三方工具调用都进入现有审批；不信任 readOnlyHint。执行前复核窗口、运行、终端和目标；缺少授权、拒绝、取消和目标漂移均不调用服务。                                        |
| Renderer 返回明文凭据     | Provider Key、MCP env/headers 使用保存值占位符；SSH 密码、root 密码和识别为密码的登录动作使用主进程引用。编辑、清空、连接复制仍可用；引用只在绑定 PTY 的实时密码提示中消费。 |
| Mermaid HTML 注入         | 更新 Mermaid / DOMPurify，生成的 SVG 在展示和导出边界再次清洗，移除脚本、事件、foreignObject 和危险协议；正常 SVG 标签保留。                                                 |
| 已知依赖漏洞              | 更新 Electron、Axios、Mermaid、DOMPurify、Vitest 等；Pi 三包统一官方 1.0.3（brace-expansion 5.0.12），已移除旧的本地安全重打包；构建依赖 http-cache-semantics 更新至 4.3.0，干净安装审计为 0 漏洞。   |
| CI 无测试却返回绿色       | npm test 改为实际执行安全边界政策检查。遵守当前 AGENTS.md：行为单测仍本地运行且不进入 Git；CI 明确不宣称单测覆盖。                                                           |
| 审批和控制未绑定窗口      | command approval、cancel、supplement、compact、reload、子终端确认校验 owner；会话重建前校验归属，取消只影响该运行的等待者。                                                  |
| 日志最终落盘未脱敏        | 文件日志 sink 和 console 镜像统一执行敏感文本脱敏，日志文件权限收紧；Renderer 诊断同样脱敏。                                                                                 |
| media 权限过宽            | 仅允许明确的 audio 请求；拒绝 video、混合和未声明类型的 media，删除相机用途描述。                                                                                            |
| macOS entitlement 过宽    | 删除 unsigned executable memory、DYLD 环境和 disable-library-validation；保留 JIT、音频输入和用户选择文件权限。                                                              |
| SSH options 拼接注入      | 分词、校验 SSH 标志并逐参数 shell 引用，目的地址前加 --；表单阻止无效参数，主进程保存也验证。保留有效的 ProxyJump / ProxyCommand。                                           |
| IPC payload 无统一上限    | 所有主进程 IPC 注册经过来源、主 frame 和载荷复杂度校验；普通载荷 4 MiB、附件通道 32 MiB，base64 解码前限制为 20 MiB。                                                        |
| OpenAPI / legacy 描述陈旧 | 修正 README、安全模型、默认工具说明和中英文首次引导；不再引导添加已停用的 OpenAPI 工具。legacy agentMode / maxActiveTools 继续兼容读取，但不再写入配置。                     |
| 大文件职责混杂            | 拆出附件/图片导出、终端输出格式化、连接登录序列、IPC 安全和 Renderer 密钥视图模块；沿用现有 IPC 接口。                                                                       |

## 验证结果

- `npm run ci`：通过（lint、239 项安全边界政策检查、Node/Web 类型检查、生产构建）。lint 剩余 2 项既有格式警告，位于未修改的组件。
- `npm run test:local`：5 个本地测试文件、50 项行为测试通过；覆盖命令分类、加密迁移/失败、权限、日志、密钥保存/清空、审批 owner、MCP 拒绝/取消/目标漂移及 SSH 注入。
- `npm audit`：全量依赖 0 漏洞。
- 隔离目录执行 `npm ci --ignore-scripts --omit=dev`：通过，安装后审计 0 漏洞；证明 Pi 修补依赖可以干净安装，未把 Node_modules 的临时修改当成修复。
- Pi 1.0 + Electron 41.10.7 的实际应用回归：使用本地模型流服务和本地 stdio MCP，不调用付费模型。bash 的 PTY 工具结果正常，MCP 拒绝时调用数为 0，批准后为 1；模型暴露工具中没有新引入的 powershell / codemode / tool_search。
- 实际应用验证 sandbox / contextIsolation / Node 禁用、无通用 IPC、配置和连接密钥脱敏、编辑/复制、载荷上限、SSH 注入拒绝和 PTY 交互；密码引用在裸 shell 被拒绝，在模拟的实时密码提示中成功消费且不回显明文。
- 独立 Electron 渲染验证 SVG 清洗和 Mermaid 正常文本标签。
- 新 Electron 下载的 SHA-256 与官方 npm 包的 checksums.json 相符。

## 真实钥匙串验收（2026-10-02）

系统授权恢复后，在 Electron 41.10.7 实际应用中完成以下验收。测试使用隔离的数据目录，直接调用原生 safeStorage；未替换其加密、解密或可用性检查函数，未使用 AES-GCM 存储替身。

- Provider Key、MCP env/headers、SSH/root 密码和登录动作加密保存，文件内无测试凭据明文，Renderer 返回值保持脱敏。
- 连续三次启动独立 Electron 进程，验证重启解密、占位符编辑、连接复制及清空后持久化；复制连接的凭据保持独立。
- 损坏密文同时触发读取和保存拒绝，原配置文件字节保持不变；恢复有效密文后可继续使用。
- 历史明文配置自动迁移，主进程读取的凭据保持一致；历史目录 755 / 文件 644 修正为 700 / 600，登录命令和密码均加密落盘。
- 密码引用在裸 shell 中被拒绝，在模拟的实时密码提示中准确消费且不回显明文。
- 使用真实钥匙串保存模型配置后，Pi 1.0 SDK 的可见 PTY bash 与本地 MCP 审批流程通过；即使 MCP 声明 readOnlyHint，拒绝时调用数仍为 0，批准后为 1。
- 重跑完整 `npm run ci`、50 项本地行为测试和 239 项安全边界政策检查，全部通过；全量依赖审计仍为 0 漏洞。

## 验证边界

首次新版回归因系统钥匙串授权未完成，曾使用隔离存储替身。上述后续验收已使用 Electron 41.10.7 原生 safeStorage 重新验证，真实钥匙串加密、迁移和跨进程解密已通过。

未连接生产 SSH / 多跳目标。本地模拟密码提示只能验证引用消费和不回显逻辑。未持有 Developer ID 证书，收紧 entitlement 后的签名、公证、原生模块加载和麦克风仍需要正式签名包验收。

新增行为测试保持 Git 忽略；测试入口、截图和下载缓存未放入提交内容。修改保留在当前工作区，本次未提交或推送 Git，也未同步其他目录。
