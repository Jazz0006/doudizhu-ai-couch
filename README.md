# AI 斗地主实时语音教练

本仓库是 AI 斗地主实时语音教练的 npm workspaces monorepo。目前已完成开发规格中的 Task 1 至 Task 11，并正在实施 Task 12：已具备本地 HTTPS/WSS 会话、浏览器 AudioWorklet 采集/播放和带序号确认的双向 PCM16 通道。

## 环境要求

- Node.js 22.12 或更高版本
- npm 10 或更高版本

## 工作区

- `apps/web`：React + Vite Web 应用骨架
- `apps/server`：可运行的 Node.js HTTP 后端与 `/health` 健康检查
- `packages/game-core`：扑克牌模型、牌组、可复现洗牌、发牌、排序与牌型识别
- `packages/bot-engine`：只读取单个玩家可见信息的三档传统电脑玩家与自动对局模拟器
- `packages/coach-protocol`：生成 `PlayerVisibleGameState`，隔离隐藏手牌并提供公开合法动作
- `packages/shared-types`：前后端共享的二进制 PCM 音频帧协议与类型

## 常用命令

```bash
npm install
npm run test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

运行一局可复现的三机器人命令行对局（难度可选 `easy`、`medium` 或 `hard`）：

```bash
npm run simulate --workspace @ai-doudizhu/bot-engine -- demo-seed medium
```

运行覆盖三档难度的 10,000 局合法性验证：

```bash
npm run validate:10000 --workspace @ai-doudizhu/bot-engine
```

启动 Web 开发环境：

```bash
npm run dev --workspace @ai-doudizhu/web
```

Vite 会同时显示本机和局域网地址。让手机与电脑连接同一网络，然后在手机浏览器打开终端输出的 `Network` 地址，即可进行真机测试。Windows 防火墙首次询问时需要允许专用网络访问。

牌桌默认使用中等难度。通过页首的“对手”选择器切换难度时会自动开启新局，确保整局使用同一套电脑策略。

启动后端（默认监听 `0.0.0.0:3000`）：

```bash
npm run start --workspace @ai-doudizhu/server
```

可通过 `HOST` 和 `PORT` 环境变量修改监听地址。启动后访问 `http://localhost:3000/health`，应获得包含 `ok: true` 和当前 ISO 时间的 JSON。

本地语音开发需要先生成 HTTPS 证书，完整步骤和真机验证方法见 [docs/local-voice.md](docs/local-voice.md)。
