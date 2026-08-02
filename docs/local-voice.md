# 完整本地语音实施记录

## 目标

在断开互联网且未配置 DeepSeek API key 时，手机浏览器仍能通过局域网完成：

1. 麦克风 PCM 采集；
2. 本地 VAD 与流式语音识别；
3. Ollama 本地教练回答；
4. 本地中文语音合成与流式播放；
5. 点击或直接说话打断旧回复。

DeepSeek 只能作为用户明确开启的云端备用，不能自动接收本地转写。

## 选定架构

```text
Browser AudioWorklet
  -> HTTPS / same-origin WSS / binary PCM
  -> Node voice session coordinator
  -> sherpa-onnx Silero VAD + streaming Paraformer ASR
  -> Ollama qwen3.5:9b
  -> sherpa-onnx MeloTTS
  -> WSS / binary PCM / Browser AudioWorklet playback
```

浏览器发送设备的实际采样率，服务端统一重采样到 ASR 所需的 16kHz。模型只在启动时加载一次，并放在 worker thread 中，避免阻塞 HTTP 和 WebSocket 事件循环。

## Task 12.0 探针结果

测试机器：24 逻辑处理器、16GB RAM、RTX 4070 Laptop 8GB。

| 组件                 | 配置                              | 结果                                       |
| -------------------- | --------------------------------- | ------------------------------------------ |
| sherpa-onnx-node     | 1.13.4 / Node 24.18 / Windows x64 | 原生插件加载成功                           |
| Streaming Paraformer | int8 / CPU 2 threads              | 官方 WAV RTF 0.10–0.13                     |
| Kokoro               | CPU 4 threads                     | 短句首块约 1.32s，RTF 0.57，有未知标记警告 |
| MeloTTS              | CPU 4 threads                     | 短句首块约 0.48s，RTF 0.34，无警告         |
| qwen3.5:9b           | 8K / warm                         | 首文本约 1.15s，约 28.5 token/s            |
| qwen3.5:9b           | 4K / warm                         | 首文本约 1.14s，约 31 token/s              |

结论：默认使用 Streaming Paraformer、MeloTTS、qwen3.5:9b 4K。LLM 必须在服务启动时预热；8K 首次冷启动约 92 秒，不能让用户请求承担该延迟。

ASR 回灌测试把“连对”识别成了“联队”或“链队”。正式实现需要斗地主术语归一化，并在真机阶段使用真人录音验证。性能数据不能代替领域准确率测试。

## 本地模型管理

模型目录 `models/voice` 被 Git 忽略。应用运行时绝不自动下载模型。

```powershell
npm run voice:download -- -Model vad
npm run voice:download -- -Model asr
npm run voice:download -- -Model tts
npm run voice:download -- -Model melo
```

下载支持断点续传、自动重试和 SHA-256 输出。固定 URL、期望文件、哈希和许可证记录在 `scripts/voice/models.json`。

探针命令：

```powershell
npm run voice:probe:runtime
npm run voice:probe:asr
npm run voice:probe:tts -- --model=melo
npm run voice:benchmark:ollama
```

## 默认运行参数

```text
COACH_PROVIDER=ollama
CLOUD_FALLBACK_ENABLED=false
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_NUM_CTX=4096
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
```

DeepSeek key 只能存放在后端环境变量中，不能使用 `VITE_` 前缀，也不能发送到浏览器。

## 本地 HTTPS

```powershell
npm run voice:setup:https
npm run build --workspace @ai-doudizhu/server
npm run voice:smoke:https
```

证书覆盖 localhost、当前电脑名和生成时发现的局域网 IPv4 地址。局域网地址改变后需要重新运行生成命令。测试手机还需要安装 mkcert `rootCA.pem`；该文件位置会由生成命令输出。根 CA 私钥和服务器私钥不得提交、分享或复制到手机。

检测到 `certs/local/local-cert.pem` 与 `local-key.pem` 时，Vite 自动启用 HTTPS，并将同源 `/api` 和 WebSocket 请求代理到 `VOICE_SERVER_ORIGIN`。没有证书时仍保留普通 HTTP 开发模式，但该模式只适合桌面 UI，不保证手机麦克风可用。

## Task 12.1：安全会话骨架

已实现短期会话 token、同源检查、协议版本协商、HTTPS/WSS 服务，以及本地证书生成和安全通道冒烟测试。会话 token 只使用一次并在短时间后失效；原始音频不会写入磁盘。

## Task 12.2：浏览器双向音频通道

已实现以下基础设施：

- 浏览器 `AudioWorklet` 单声道采集，按约 20ms 分帧；
- 前后端共享的带版本、序号、方向、采样率和 generation ID 的 PCM16 二进制帧协议；
- WebSocket 输入启动、音频确认、停止事件和严格序号校验；
- 浏览器端采样率转换、音频播放队列、背压丢帧统计和 generation 级停止播放；
- 移动端语音状态栏、开启/停止、测试声音和停止播放按钮；
- 390×844 响应式界面验收，无横向溢出和控制台错误。

Task 12.2 只验证麦克风到服务端及服务端到扬声器的通道，不会把声音误标为“已识别”。VAD 和 ASR 已在 Task 12.3 接入；LLM 和 TTS 仍将在后续阶段逐个接入。

本地联调：

```powershell
# 终端 1
npm run voice:dev:server

# 终端 2
npm run voice:dev:web
```

两个进程必须同时保持运行：`voice:dev:web` 只负责网页和同源代理，真正创建语音会话的是监听 `3000` 端口的 `voice:dev:server`。Web 启动脚本会自动把 mkcert 根证书加入 Node.js 信任链，并把代理固定到 IPv4 回环地址，避免 Windows 上的本地证书校验和 `localhost` IPv6 解析问题。修改证书或启动脚本后，需要停止并重新运行两个命令。

如果页面提示 HTTP 502，先在电脑上检查：

```powershell
netstat -ano | Select-String ":3000"
```

没有 `LISTENING` 结果就表示语音后端未运行。重新构建并启动：

```powershell
npm run build --workspace @ai-doudizhu/server
npm run voice:dev:server
```

用手机打开 Vite 输出的 `Network` HTTPS 地址，点击“开启语音”并允许麦克风。状态进入“麦克风已开启”后说话，界面中的服务端确认时长应持续增加；“测试声音”用于单独验证浏览器播放链路，“停止播放”用于验证 generation 取消。

自动验证安全会话与首个 20ms 二进制音频帧：

```powershell
npm run build --workspace @ai-doudizhu/server
npm run voice:smoke:https
```

## Task 12.3：本地 VAD 与流式 ASR

已完成以下实现：

- 单个 worker thread 启动时加载 Silero VAD 和 Streaming Paraformer，HTTP/WSS 事件循环不执行原生推理；
- 使用 sherpa-onnx `LinearResampler` 将浏览器实际采样率持续重采样到 16kHz；
- 按 Silero 要求缓冲为 512-sample 窗口，产生 `speech.started`、`speech.ended`、`transcript.partial` 和 `transcript.final`；
- 每个 WSS 会话拥有独立的重采样器、VAD 和识别流，停止、断线和重连时清理；
- 主线程限制待处理音频消息数，积压时丢弃过期帧并向浏览器报告；
- 对“联队/链队”“三代一”等常见误识别进行确定性术语归一化，同时保留原始文本；
- 浏览器显示当前 partial 和最近 6 条 final 转写；
- 模型缺失或加载失败时后端仍可启动并提供 `/health`，开启语音后返回明确的识别不可用错误；
- 真实模型冒烟覆盖模型加载、VAD 端点和 final 转写。

自动验证：

```powershell
npm run voice:smoke:asr
```

也可以把真人录音 WAV 路径作为额外参数传入。自动冒烟不能替代手机麦克风验收；进入下一阶段前仍应在 Android Chrome 和 iPhone Safari 上各验证连续两句话的分段、术语准确率和实际延迟。

## Task 12.4：Ollama 流式文本教练

已完成以下实现：

- final 转写自动发送给本地 Ollama `qwen3.5:9b`，通过 NDJSON 事件向浏览器流式返回文本；
- 服务启动时预热模型，普通回答使用独立 45 秒超时，冷启动预热最多等待 120 秒；
- 每个语音会话保留最近 10 条用户/教练消息，断线时删除上下文；
- 新说话触发 VAD 后自动取消旧回答，点击“打断回答”也会取消当前请求；
- 所有事件携带 generation ID，客户端忽略迟到的旧回答；
- 系统提示落实简洁、承认不确定、禁止编造隐藏牌等规则；
- 此阶段尚未接入牌局状态；该限制已在 Task 13 由只读牌局工具替代；
- `OLLAMA_BASE_URL` 只允许 `localhost`、`127.0.0.1` 或 `::1`，当前构建不会把本地转写发送给 DeepSeek 或其他远程地址；
- Ollama 不可用时后端和牌局仍可运行，浏览器会显示明确错误。

真实模型冒烟：

```powershell
npm run voice:smoke:coach
```

这一阶段仍不接 TTS，浏览器只展示文本回答。

## Task 12.5：MeloTTS 与完整语音闭环

已完成以下实现：

- 独立 TTS worker 启动时加载 MeloTTS，主线程不执行语音合成；
- Ollama 流式文本按中文标点和换行切句，已完成句子立即进入串行合成队列；
- 清理常见 Markdown 标记后再朗读，不改变界面显示的原始教练文本；
- MeloTTS PCM 按 2,048 samples 切成带 sequence/generation 的二进制输出帧；
- 浏览器按设备采样率重采样，通过 AudioWorklet 连续播放并在队列排空时更新状态；
- 新说话和“停止语音/打断回答”会同时取消 Ollama、待合成句子、当前 TTS 和浏览器播放；
- generation 隔离迟到音频，输出 WebSocket 积压超过 1MiB 时停止当前语音；
- 模型缺失或 TTS 失败不会影响牌局和文字教练回答；
- 集成测试覆盖转写、文本、TTS 控制事件、PCM 数据帧和 EOS 完整顺序。

真实模型冒烟：

```powershell
npm run voice:smoke:tts
```

当前机器上测试句首个 PCM 块约 0.82 秒，3.25 秒音频合成约耗时 1.63 秒。自动数据不能代替手机扬声器、回声消除和真人插话验收。

## Task 13：牌局状态事件和只读 AI 工具

已完成以下实现：

- Web 端从 `FullGameState` 生成独立的 `PlayerVisibleGameState`，同时派生开局、地主确定、出牌、过牌、回合变化和结束事件；
- 语音协议升级为 v2，通过 `game.context` 同步带修订号的最新快照和公开增量事件；
- 服务端不信任浏览器类型，重新解析并重建允许字段，附带的 `hands`、`randomSeed` 等完整牌局字段会被丢弃；
- Ollama 每次牌局回答前由服务端强制执行 `get_current_visible_state`，不依赖模型自行决定是否读取状态；
- 用户询问如何出牌、候选动作或合法性时，额外执行 `get_legal_actions`，候选牌只来自用户手牌和规则引擎；
- 最近公开事件保存在单个语音会话中，旧修订不会覆盖新状态，断开会话时一并清除；
- `coach.tool.called` 控制事件让浏览器显示“读取当前牌局”或“检查合法出牌”；
- 单元和集成测试覆盖上下文校验、事件派生、WebSocket 确认、工具结果及对手隐藏牌隔离。

真实 Ollama 牌局工具冒烟：

```powershell
npm run voice:smoke:coach
```

当前机器上，教练正确读取到“用户是地主、手牌 20 张”，首段文本约 1.86 秒，完整回答约 3.90 秒。工具只接收用户可见牌面；任何性能或自动测试数据都不能代替真人局面提问和隐藏信息泄漏检查。

## Task 14：选牌询问和高亮建议

已完成以下实现：

- `analyze_selected_cards` 使用规则引擎返回选中的牌、牌型、是否合法和明确警告，不让模型自行判断规则；
- 用户说“这样出可以吗”“这些牌行吗”时，教练会分析当前选择并高亮同一组牌；
- 用户询问“该出什么牌”时，规则引擎从合法动作中优先选择避免炸弹、牌数较多且点数较低的候选，再交给教练解释；
- `highlight_cards` 会再次过滤 ID，只允许高亮用户当前手牌，电脑玩家隐藏牌无法通过高亮事件泄露；
- 高亮与用户选中状态使用不同视觉样式，不会改变选牌，也绝不会自动出牌；
- 新建议会替换旧高亮，打断回答会清除高亮；默认保留 8 秒，并限制在 5–10 秒；
- 用户可以点击“清除高亮”或牌桌空白位置立即清除；新局开始时也会自动清除；
- 测试覆盖合法选牌分析、隐藏牌过滤、工具结果、WebSocket 事件和卡牌高亮渲染。

真实 Ollama 选牌冒烟仍使用：

```powershell
npm run voice:smoke:coach
```

当前机器上，教练正确判断选中的单张 3 合法，发出 8 秒安全高亮，并明确使用已经公开的底牌信息；首段文本约 1.87 秒，完整回答约 3.23 秒。

## Task 15：本地存档、恢复和对局复盘

已完成以下实现：

- 每次牌局或难度变化后 250ms 节流写入 IndexedDB，不保存原始语音、转写或设备敏感信息；
- 存档保存 schema 版本、初始随机种子、叫分记录和公开动作记录，而不是直接信任一份完整可变状态；
- 刷新恢复时由规则引擎从初始牌局重放每次叫分、出牌和过牌，同时验证版本、当前回合、发牌轮次、历史长度、胜负和更新时间；
- 损坏、截断、非法动作或未来版本的存档会被拒绝，并安全开启新局；
- 对手难度随牌局恢复；完成的牌局摘要按 game ID 保存，最近保留 10 局；
- 对局结束后通过同一条重放时间线选取 3–5 个关键节点，包括炸弹/王/2 的使用、对手残局威胁和胜负前动作；
- 每个复盘节点显示当时用户手牌、场上牌面、实际动作、最多两个合法替代动作、规则评价和影响等级；
- 复盘明确区分“当时决策质量”和“最终输赢”，不会因为输了就把所有动作判错；
- 学习标签覆盖控制牌使用偏早、错过残局威胁和炸弹使用偏多；复盘工具只允许在牌局结束后调用。

真机恢复验证：进行若干次叫分或出牌后刷新网页，应看到“已恢复上次未完成的牌局”；完成一局后刷新，应恢复结果和 3–5 个复盘节点。

## 下一阶段：AI 教练质量优化

Task 1–15 的 MVP 功能链路已经完成。下一阶段不再继续堆功能，而是针对真机测试中“回答不够智能”的问题建立局面评测集，分析提示词、工具结果、候选动作排序和模型能力，再决定优化本地模型、加入确定性策略评估，还是采用混合教练架构。
