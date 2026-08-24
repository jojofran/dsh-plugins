# 任务通知 (task-notify)

> 为 DSH 提供"任务完成通知"能力 —— Agent 完成任务时，通过可选渠道（声音 / 系统通知 / Hook 扩展）通知你。

## 功能

- **任务完成监听**：Agent（主 Agent 或后台子 Agent）状态变为 idle 时触发通知
- **声音提示**：经典叮声 / 柔和提示音 / 短促双音 / 自定义音频 URL
- **macOS 系统通知**：浏览器 Notification API，通知中心可见
- **右上角快捷开关**：会话头部铃铛按钮，点击即切换（可在设置中隐藏）
- **Hook 扩展引擎**：外部插件可插拔地扩展通知渠道（notification / fetch / console）
- **按项目独立配置**：每个 Workspace 独立记忆设置，切项目自动切换
- **设置持久化**：localStorage，插件更新/页面刷新不丢
- **主题跟随**：设置页对齐系统设置风格（760px、卡片、label-tertiary hint、系统 token）

## 安装

### 方式一：动态插件（快速试用 / 当前运行）

```bash
# 1. 读取 plugin-code.json 中的 host/client 代码（这是当前运行版本的权威备份）
# 2. 执行 cordis_define（plugin.kind: new, idPrefix: ding, name: 任务通知）
# 3. 执行 cordis_run
# 重启后恢复：让 Agent 读取 plugin-code.json 并重建
```

### 方式二：合成配置（持久化，开发中）

```bash
# 1. 将包加入 pnpm workspace
# 2. 复制 cordis preset 并添加 task-notify 行
# 3. 切换到 ding preset
```

## 使用示例

```yaml
# 默认行为：任务完成时响一声
# 开启系统通知：设置 → 任务通知 → 通知渠道 → 系统通知
# 自定义声音：设置 → 任务通知 → 声音设置 → 自定义音频 URL
# 隐藏右上角铃铛：设置 → 任务通知 → 界面 → 显示右上角铃铛
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 声音提示 | boolean | true | 播放提示音 |
| 系统通知 | boolean | false | macOS 原生通知 |
| 声音源 | string | 'bell' | bell 经典 / soft 柔和 / beep 双音 / url 自定义 |
| 音频链接 | string | '' | 声音源为 url 时的音频地址 |
| 显示右上角铃铛 | boolean | true | 会话头部快捷开关显隐 |

所有配置按 Workspace 独立存储，键为 `dsh.ding-chime`。

## Hook 扩展

外部插件通过 Host call 注册回调，任务完成时由 Client 半部执行：

```js
// 注册 onTaskComplete Hook
host.call('ding-chime/hooks/register', {
  event: 'onTaskComplete',
  handler: { type: 'notification', title: '任务完成', body: 'Agent 已完成工作' }
})

// 支持类型
// notification: new Notification(...)
// fetch: POST 到指定 URL（浏览器端，有 CORS 限制）
// console: console.log

// 其他端点
// ding-chime/hooks/clear    — 清空所有 Hook
// ding-chime/hooks/pending  — 取待执行的 Hook（Client 轮询消费）
// task-ding/take            — 取任务完成计数
//
// 注：仓库名已改为 task-notify；运行时标识（hook 端点 / STORAGE_KEY）
// 保持 ding-chime 兼容，避免已存设置丢失、避免外部 Hook 消费者中断。
```

## 文件结构

```
dsh-plugins/task-notify/
├── LICENSE              # MIT
├── package.json         # 包定义
├── CHANGELOG.md         # 变更记录
├── README.md            # 本文件
├── plugin-code.json     # ★ 当前运行版本的权威备份（重启恢复用）
├── src/
│   ├── client.js        # Client 半部（与 plugin-code.json 同步）
│   ├── host-current.js  # Host 半部（与 plugin-code.json 同步）
│   ├── index.js         # Host 半部（ESM 版，含 @Remote 服务，供正式包参考）
│   ├── host.cjs         # Host 半部（内联 CJS，用于 preset）
│   └── host.js          # Host 半部（内联参考）
├── docs/
│   └── cordis-dynamic-plugin-lessons.md
└── DSH-Plugin-Development-Specification.md  # 开发规范（上层目录）
```

## 开发踩坑记录

参见 `docs/cordis-dynamic-plugin-lessons.md`。

## 许可

MIT License — 详见 [LICENSE](./LICENSE)
