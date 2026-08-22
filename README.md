# AI 斗地主教练

本仓库是 AI 斗地主教练的 npm workspaces monorepo。目前已完成本地 HTTPS/WSS 语音闭环、严格脱敏的牌局工具、选牌分析与安全高亮，以及基于 IndexedDB 的恢复和规则驱动复盘。

当前阶段改为**文字交互优先**，集中提升建议的正确性、玩家水平适配和解释忠实度。语音代码继续保留，但暂停功能迭代且不进入核心算法验收路径。项目保留规则引擎作为合法动作唯一来源，使用 DouZero 排序、确定性策略选择适合玩家水平的候选，再由本地通用模型解释结构化依据。详细架构、接口、实施顺序和验收标准见 [DouZero 策略模型集成开发文档](docs/douzero-integration.md)。

## 环境要求

- Node.js 22.12 或更高版本
- npm 10 或更高版本

## 工作区

- `apps/web`：React + Vite Web 应用骨架
- `apps/server`：Node.js HTTPS/WSS 后端、`/health` 健康检查与本地语音识别 worker
- `packages/game-core`：扑克牌模型、牌组、可复现洗牌、发牌、排序与牌型识别
- `packages/bot-engine`：只读取单个玩家可见信息的三档传统电脑玩家与自动对局模拟器
- `packages/coach-protocol`：生成并校验 `PlayerVisibleGameState`，派生公开牌局事件，隔离隐藏手牌并提供公开合法动作
- `packages/shared-types`：前后端共享的二进制 PCM 音频帧协议与类型
- `services/douzero-inference`：DouZero 上游版本锁定、Top-K 推理扩展，以及后续状态适配和常驻推理进程

## DouZero 集成进度

- [x] 锁定 DouZero 官方版本，实现 Top-K 排名并验证 Top-1 与官方行为一致
- [x] 将 `PlayerVisibleGameState` 转换为不包含隐藏手牌分区的 DouZero `InfoSet`
- [x] 对齐项目合法动作并按点数语义去重
- [ ] 接入常驻推理进程、缓存、超时和启发式降级（工程链路与性能基线已完成，生产批准权重待取得）
- [ ] 恢复文字交互主路径，并暂停默认 ASR/TTS 运行
- [ ] 新增 `get_ranked_actions` 教练工具
- [ ] 新增初级、中级、高级玩家水平策略与安全高亮
- [ ] 实现有结构化依据、不可改写决策的文字解释
- [ ] 完成正确性、水平适配、解释忠实度、隐私和性能评测

## 当前产品路线

1. 文字界面作为唯一默认交互入口，语音模块保留为可选适配器；
2. 规则引擎保证动作合法，DouZero 只负责对合法候选评分；
3. 确定性的玩家水平策略从 Top-K 中选择最终教学建议；
4. 通用模型只解释结构化结果，不生成、替换或重新排序动作；
5. 固定局面集和人工盲评达到质量门槛后，再恢复语音交互。

## 常用命令

```bash
npm install
npm run test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

验证当前不依赖模型权重的 DouZero Top-K 排名层：

```powershell
npm.cmd run build --workspace @ai-doudizhu/coach-protocol
python -m unittest discover services/douzero-inference/tests -v
```

运行真实 Python 子进程的 Node 集成测试（使用确定性假后端，不需要模型权重）：

```powershell
$env:DOUZERO_WORKER_TESTS = "1"
npm.cmd run test --workspace @ai-doudizhu/server -- douzero-worker-client.test.ts
```

在已配置真实开发权重的机器上运行 CPU 性能基准：

```powershell
npm.cmd run strategy:benchmark -- --iterations 60 --warmup 5 --cold-starts 3
```

当前 Windows CPU 基线的冷启动 P50 为约 2.55 秒，端到端推理 P50/P95 为约 4.0/9.4ms，详见 [基准报告](services/douzero-inference/benchmarks/2026-08-10-windows-cpu-community-wp.json)。

运行 DouZero 与本地 ASR/TTS、Ollama 的开发机并发基准：

```powershell
npm.cmd run strategy:benchmark:contention
```

本次单样本基线中，本地语音并发令端到端 P95 从 8.02ms 增至 11.02ms；Ollama 请求并发时为 8.65ms。两者均未触发 1 秒推理超时，但该结果只用于发现资源冲突，不替代生产容量测试。详见 [并发基准报告](services/douzero-inference/benchmarks/2026-08-22-windows-cpu-contention.json)。

当前系统 Python 不作为最终 DouZero 生产运行时。真实模型接入阶段会使用独立、固定版本的 Python 环境，避免影响现有 Node.js 和本地语音依赖。

真实模型链路使用 `services/douzero-inference/.runtime/venv` 隔离环境。当前已验证的 DouZero-WP 权重来自固定提交的社区镜像，启动前会按 manifest 校验大小和 SHA-256；该 manifest 明确标记为非生产批准，只能通过测试专用开关加载。配置和验证命令见 [DouZero 推理适配说明](services/douzero-inference/README.md)。

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

模型安装后可运行真实 ASR、牌局教练和 TTS 冒烟测试：

```powershell
npm run voice:smoke:asr
npm run voice:smoke:coach
npm run voice:smoke:tts
```
