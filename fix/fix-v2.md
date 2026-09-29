# Crescent 鲸鱼娘额度与模型监控方案

版本：v2  
日期：2026-09-25  
范围：将鲸鱼娘桌宠、可选日期区间的 LiteLLM 用量查询、固定总额度展示和自定义端点模型发现集成到 Crescent。

## 1. 目标与确定输入

- Crescent 启动时自动显示鲸鱼娘；桌宠是 Crescent 自己的窗口/界面，不启动第二个 Electron 应用。
- 使用用户已确认可查询的两个端点：
  - 用量端点：`https://dmxwg.intra.yiducloud.cn/litellm/spend/logs/self`
  - 模型端点：`http://nova.dmxwg.yiducloud.cn/litellm/v1/models`
- 用量查询支持随时选择开始日期和截止日期，默认当前月；接口时区为 `Asia/Shanghai`。
- 额度总量先设为 `200`，允许在设置中修改。剩余额度 = 总额度 - 当前日期区间的 `summary.spend`。
- 模型查询读取 `.data[].id`，排序后按三列展示，支持刷新、复制和选择模型。

当前示例用量：区间 `2026-09-01` 至 `2026-09-30`，`spend=6.2381755411`，`total_tokens=179850093`，`prompt_tokens=168016160`，`completion_tokens=11833933`，`request_count=8912`。按总额度 200 计算，示例剩余额度为 `193.7618244589`。界面按需格式化小数，不改变计算精度。

## 2. 项目选择与复用范围

首选 [`Suiwan/whale-purse`](https://github.com/Suiwan/whale-purse) 作为鲸鱼娘面板和用量 UI 的参考，必要时复用其 MIT 代码并保留 LICENSE/版权声明。它已有桌宠交互、花费统计、历史面板和告警；但依赖 DSH/Cordis client runtime、DSH session projections 和 DeepSeek 官方余额查询，不能作为 Crescent 的即插即用插件。需要复用的是表现形式和可独立的统计展示思路，数据获取、配置持久化与生命周期应接到 Crescent。

鲸鱼娘形象和动画可参考 [`vlln/whale-girl`](https://github.com/vlln/whale-girl)；使用其中素材前保留原许可证和署名。`nayru77mi/deepseek-DesktopPet-Shimeji` 的图像素材采用 CC BY-NC-SA 4.0，不作为默认素材来源，以免引入非商业及相同方式共享约束。独立 Electron 桌宠项目不作为 Crescent 子进程依赖。

## 3. 用户界面

### 3.1 桌宠主视图

- 鲸鱼娘在 Crescent 启动后出现，默认停靠主屏幕右下角；可拖动，位置按显示器工作区保存，重启后恢复。
- 默认是紧凑鲸鱼立绘和额度气泡：`剩余 193.76 / 200`。点击/键盘操作打开详情；低额度或请求失败时显示状态提示。
- 详情采用紧凑的 Crescent 桌面样式，沿用现有主题和 `#13c2c2` 强调色，不照搬 DSH 的浮层、主题 token 或嵌套卡片。
- 提供“隐藏桌宠/显示桌宠”开关。关闭详情只隐藏面板；退出 Crescent 才结束桌宠窗口。主窗口最小化或重新激活时不创建重复桌宠。

### 3.2 额度详情

日期区间可即时编辑，采用开始日期、截止日期和查询按钮。默认值为当前月首日至月末；提交后将日期按 `YYYY-MM-DD` 编码到 `start_date`、`end_date` 参数，并传 `timezone=Asia/Shanghai`。开始日期不得晚于截止日期。

建议显示：

| 指标 | 数据来源 | 展示 |
| --- | --- | --- |
| 总额度 | Crescent 用户设置，默认 `200` | 可编辑数值 |
| 已使用 | `summary.spend` | 按原接口金额单位展示 |
| 剩余额度 | `totalBudget - spend` | 低于零时显示超额值，不把数据钳制成误导性的零 |
| Token 用量 | `total_tokens` | 辅助信息，不参与金额剩余额度计算 |
| 输入/输出 Token | `prompt_tokens` / `completion_tokens` | 辅助信息 |
| 请求数 | `request_count` | 辅助信息 |
| 查询区间及更新时间 | 请求参数、本地时间 | 清晰显示数据对应的周期 |

总额度 200 的单位应跟随接口 `spend` 的单位。初版不做人民币/美元汇率换算，也不把金额 spend 误标成“剩余 token”。当 spend 大于 200，界面显示已超额度金额，并让进度条超过/封顶时保留具体数字。

### 3.3 模型列表

- 从模型端点读取 `.data[].id`，以字符串排序，再按三列等宽排列；窗口变窄时降为两列或一列。
- 每项完整显示模型 ID，例如 `azure/gpt-4.1-mini`、`bailian/deepseek-v4-pro`、`volc/deepseek-v4-pro`，长 ID 可换行或提供复制按钮。
- 列表顶部展示模型总数、上次刷新时间和刷新按钮。请求失败时保留上次成功结果并标注过期；首次失败则显示错误和重试操作。
- 手动刷新查询数据；模型列表可在启动时获取并按可配置间隔刷新。不要因列表刷新自动覆盖用户当前选中的模型，除非所选模型已从端点消失，此时提示用户选择替代项。

## 4. 结构与进程边界

### 4.1 Electron 生命周期

在 `app.whenReady()` 完成配置与 IPC 注册后创建鲸鱼娘窗口，与主窗口共用 Crescent 主进程和 renderer 构建产物。可以将它实现为 Crescent renderer 内的桌宠组件；如果需要独立拖动、透明和置顶，再创建一个由主进程管理的 `BrowserWindow`，仍属于同一个 Crescent 进程。

窗口初始化遵循 Crescent 现有安全设置：`contextIsolation` 开启、`nodeIntegration` 关闭，通过 preload 暴露精确白名单 IPC。主进程统一处理应用退出、窗口销毁、重复创建、屏幕变化和位置边界修正。不要 `spawn` 第二个 Electron、PowerShell 或其他桌宠程序。

### 4.2 数据服务

在 `src/main/` 增加独立的 LiteLLM 额度/模型服务，主进程持有 Bearer 凭据并执行 HTTPS/HTTP 请求；Renderer 不直接请求内网端点，也不接收 API Key。数据流为：

```text
Crescent Renderer → preload 白名单 IPC → Main LiteLLM service → 自定义 LiteLLM endpoints
```

至少提供查询用量、读取模型、刷新模型、保存监控配置和订阅刷新状态的窄接口。主进程校验日期格式与区间、URL 协议、响应大小和超时；查询并发应合并或取消旧请求。日志只能记录端点主机、状态码和安全错误摘要，不记录 Authorization header、完整响应凭据字段或 API Key。

用量接口响应中即使含有 `api_key` 字段，也不得传入 renderer/store、写日志或写入缓存。只挑出 `summary.spend`、token 统计、请求数与区间等白名单字段形成 Crescent 内部 DTO。

### 4.3 配置与凭据

新增监控配置建议包括：

```ts
interface WhaleMonitorConfig {
  enabled: boolean
  spendBaseUrl: string
  modelsBaseUrl: string
  apiKey: string
  totalBudget: number // default: 200
  refreshIntervalSeconds: number
  defaultDateRange: 'current-month' | 'current-day' | 'custom'
  startDate?: string
  endDate?: string
  windowBounds?: { x: number; y: number }
}
```

端点地址和额度可在设置中修改。API Key 沿用 Crescent 配置的加密存储机制；配置读取和保存仅走主进程已有设置 IPC，不将明文凭据放进新的前端 localStorage。两个端点地址分开配置，因为模型服务和用量服务的 host/path 不同。

### 4.4 刷新策略

- 首次启动：用默认日期区间立即查询一次用量和模型列表，完成后再按刷新间隔静默刷新。
- 日期修改：点击查询后立即请求新区间；响应带上请求区间，避免慢请求覆盖更新区间结果。
- 网络错误或超时：保留最近成功数据，明确显示“数据可能已过期”；不将失败视作 `spend=0`。
- 修改总额度：本地立即重算剩余额度，无需重新请求 API。
- Crescent 退出时清理 timer、AbortController 和窗口引用。

## 5. 初始端点映射

```text
GET https://dmxwg.intra.yiducloud.cn/litellm/spend/logs/self
    ?start_date=YYYY-MM-DD
    &end_date=YYYY-MM-DD
    &timezone=Asia/Shanghai
Authorization: Bearer <本地保存的凭据>

使用响应：summary.spend、summary.total_tokens、summary.prompt_tokens、
          summary.completion_tokens、summary.request_count

GET http://nova.dmxwg.yiducloud.cn/litellm/v1/models
Authorization: Bearer <本地保存的凭据>

使用响应：data[].id
```

端点返回结构按本次提供的成功响应适配；配置 UI 中显示两种 endpoint URL，模型服务使用 HTTP 的事实不可被自动改写为 HTTPS。日期参数必须用 URLSearchParams 编码，避免 `&`、时区和日期被错误解析。

## 6. 实施阶段

### P0：数据与设置

1. 增加配置类型、主进程持久化与 API Key 加密读写。
2. 实现两个 endpoint adapter、响应白名单解析、日期校验、错误和 timeout 处理。
3. 实现额度详情 UI：编辑开始/截止日期、总额度默认 200、展示 spend/token/request 指标和剩余额度。
4. 实现模型列表三列展示、刷新、复制和模型选择回写现有 provider 模型配置。

### P1：启动桌宠

1. 设计轻量鲸鱼娘浮窗并接入 Crescent 主窗口启动生命周期。
2. 增加拖动、位置持久化、多显示器边界修正、置顶和隐藏/显示。
3. 启动加载快照后由主进程定时刷新；网络失败时保留最后数据并显示过期状态。

### P2：体验完善

1. 增加额度阈值提醒、刷新间隔设置和日期快捷入口（今天、本月、自定义）。
2. 评估是否支持模型列表搜索/按 provider 分组；初始界面仍按 ID 排序三列呈现。
3. 在打包应用中确认图像资源、preload IPC、第二窗口关闭/重建及显示器切换行为。

## 7. 验收标准

- 启动 Crescent 后最多出现一个鲸鱼娘，窗口可拖动，主窗口激活/最小化/退出不会遗留或重复创建。
- 可编辑日期区间并查询，显示的 spend、token 数、请求数与响应 `summary` 一致；日期顺序错误时不发请求。
- 总额度初始为 200，可编辑；剩余额度精确等于总额度减去 spend，修改总额度后立即更新。
- `api_key` 响应字段和 Authorization 凭据不出现在 UI、日志、renderer 存储和持久化的查询快照中。
- 模型列表 ID 与 `.data[].id` 一致，按排序的三列显示；查询失败时不清空上次成功列表。
- 刷新请求在界面可感知，超时、401、无效 JSON 和断网都有可读提示；失败不伪造零 spend。
- 额度和模型查询在 Electron 主进程执行；Renderer 只能通过 preload 暴露的白名单方法访问数据。

## 8. 本方案涉及的 Crescent 现有位置

- 应用启动和窗口生命周期：`src/main/index.ts`
- 供应商 Base URL、API Key 和模型配置 UI：`src/renderer/src/components/SettingsSheet.tsx`
- 配置凭据加密：`src/main/crescent-store.ts`
- 类型定义：`src/shared/agent-types.ts`
- Electron 设计规范：`docs/UI_DESIGN_SYSTEM.md`
- 架构与 IPC 规则：`.cursor/rules/architecture-first.mdc`、`.cursor/rules/development-standards.mdc`

本文件只定义方案，不直接改动实现。进入编码阶段后应遵循仓库 `AGENTS.md` 的规则，并在提交前运行指定 CI 门禁。
