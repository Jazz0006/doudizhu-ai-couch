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

这一阶段只验证麦克风到服务端及服务端到扬声器的通道，不会把声音误标为“已识别”。ASR、VAD、LLM 和 TTS 将在后续阶段逐个接入。

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

## 下一步：Task 12.3

把已下载的 Silero VAD 和 Streaming Paraformer 放入独立 worker thread，完成服务端重采样、端点检测、流式 partial/final 转写和斗地主术语归一化。浏览器 UI 将显示真实转写，但这一阶段仍不接 LLM 或 TTS，便于单独验证识别准确率和延迟。
