# AI 斗地主实时语音教练

本仓库是 AI 斗地主实时语音教练的 npm workspaces monorepo。目前已完成开发规格中的 Task 1 至 Task 8：项目基础设施、完整规则核心、简单电脑玩家、自动对局和移动端牌桌 UI。

## 环境要求

- Node.js 22.12 或更高版本
- npm 10 或更高版本

## 工作区

- `apps/web`：React + Vite Web 应用骨架
- `apps/server`：Node.js 服务端应用骨架
- `packages/game-core`：扑克牌模型、牌组、可复现洗牌、发牌、排序与牌型识别
- `packages/bot-engine`：只读取单个玩家视图的简单传统电脑玩家与自动对局模拟器
- `packages/shared-types`：前后端共享类型包骨架（尚未实现领域类型）

## 常用命令

```bash
npm install
npm run test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

运行一局可复现的三机器人命令行对局：

```bash
npm run simulate --workspace @ai-doudizhu/bot-engine -- demo-seed
```

启动 Web 开发环境：

```bash
npm run dev --workspace @ai-doudizhu/web
```

Vite 会同时显示本机和局域网地址。让手机与电脑连接同一网络，然后在手机浏览器打开终端输出的 `Network` 地址，即可进行真机测试。Windows 防火墙首次询问时需要允许专用网络访问。

Task 1 暂不提供可运行的后端服务；该能力将在规格中的 Task 11 实现。
