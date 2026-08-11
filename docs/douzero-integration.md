# DouZero 策略模型集成开发文档

## 1. 文档目的

本文定义 DouZero 在本项目中的职责边界、接口、状态转换、实施顺序和验收标准。后续实现如偏离本文，应先更新设计和对应测试，避免规则引擎、策略模型与语言模型重新耦合。

当前进度：阶段 1–3 已完成；阶段 4 的进程协议、生命周期、缓存、超时和降级已经实现，隔离 Python 运行时与真实模型端到端推理也已验证。下一步是取得生产批准的权重并完成性能和资源基线。

## 2. 目标与非目标

### 目标

- 用成熟的斗地主策略模型替代当前简单候选动作启发式；
- 从项目规则引擎生成的合法动作中返回稳定的 Top-K 排名；
- 保留现有隐藏信息边界、状态版本校验、语音链路和安全高亮；
- 为实时教练和对局复盘提供同一套结构化策略结果；
- 模型不可用时自动回退，不影响牌局和基础教练功能。

### 非目标

- 不用 DouZero 替换 `packages/game-core`；
- 不允许 DouZero 或通用语言模型自行生成项目规则之外的动作；
- 第一版不替换电脑玩家策略；
- 第一版不处理叫分策略；
- 不把模型原始分值描述为精确胜率或置信度；
- 不向实时教练或推理服务提供任一对手的独立隐藏手牌。

## 3. 总体架构

策略决策拆为四层：

1. `game-core`：识别牌型、比较牌型并生成项目规则下的合法动作；
2. DouZero 策略层：对规则引擎提供的候选动作评分和排序；
3. 确定性解释层：计算剩余手数、拆牌、控制牌消耗等可解释特征；
4. Ollama 教练层：根据结构化结果组织自然语言，不参与合法性判定和最终排序。

数据流：

```text
PlayerVisibleGameState + 状态版本
                │
                ▼
     项目规则引擎生成合法动作
                │
                ▼
      按点数语义规范化与去重
                │
                ▼
   转换为 DouZero InfoSet 并批量评分
                │
                ▼
     Top-K + 确定性候选动作特征
                │
                ├── Top-1：界面安全高亮
                └── Top-3/5：交给教练比较和解释
```

`get_legal_actions` 与 `get_ranked_actions` 必须并存：前者回答规则和合法性，后者只回答策略选择。

## 4. DouZero 上游基线

上游仓库和提交记录在 `services/douzero-inference/upstream.lock.json`：

- 仓库：`https://github.com/kwai/DouZero.git`
- 提交：`718a5c920bf3361e34178a38f3b80458e176b351`
- 许可证：Apache-2.0

官方推理路径为：

1. `GameEnv.get_legal_card_play_actions()` 生成 `InfoSet.legal_actions`；
2. `get_obs(infoset)` 为每个合法动作生成一行状态—动作特征；
3. 对应座位模型批量输出 `values`；
4. `DeepAgent.act()` 用 `argmax` 下标取回最佳合法动作。

本项目的 `RankedDeepAgent` 只扩展第 4 步：按 `values` 降序返回 Top-K，并保证 Top-1、同分处理与官方 `argmax` 一致。上游源码不在原位修改。

## 5. 对外接口

内部 TypeScript 策略接口计划如下：

```ts
interface RankedAction {
  rank: number;
  action: PublicLegalAction;
  modelScore: number | null;
  deltaFromBest: number | null;
  features: {
    remainingMoveEstimate: number;
    remainingSingles: number;
    breaksPair: boolean;
    breaksTriple: boolean;
    breaksBomb: boolean;
    usesControlCard: boolean;
    takesInitiative: boolean;
  };
}

interface RankedActionsResult {
  gameId: string;
  revision: number;
  actionIndex: number;
  stateChecksum: string;
  position: "landlord" | "landlord_up" | "landlord_down";
  modelVersion: string;
  objective: "adp" | "wp";
  source: "douzero" | "heuristic";
  actions: RankedAction[];
  latencyMs: number;
  degradedReason?: string;
}
```

服务内部调用接收已校验的 `PlayerVisibleGameState` 和状态版本。提供给 Ollama 的工具只暴露：

```ts
get_ranked_actions(top_k?: number): RankedActionsResult
```

Ollama 无权传入或覆盖牌局状态。`top_k` 默认 5，服务端限制在 1–20。

## 6. 状态适配规则

### 6.1 牌点映射

| 项目牌点      | DouZero 整数 |
| ------------- | -----------: |
| `3`–`A`       |     `3`–`14` |
| `2`           |         `17` |
| `small_joker` |         `20` |
| `big_joker`   |         `30` |

DouZero 不使用花色或物理牌 ID。过牌表示为空数组 `[]`。

### 6.2 座位映射

- 地主映射为 `landlord`；
- 按项目行动顺序，地主的下一家映射为 `landlord_down`；
- 剩余座位映射为 `landlord_up`。

映射必须由 `landlord` 和 `nextSeat()` 推导，禁止按 `user/left/right` 写死。

### 6.3 InfoSet 字段来源

| DouZero 字段           | 项目来源                                         |
| ---------------------- | ------------------------------------------------ |
| `player_position`      | 当前用户相对地主的位置                           |
| `player_hand_cards`    | `state.userHand` 的点数表示                      |
| `legal_actions`        | 项目合法动作去重后的点数表示                     |
| `num_cards_left_dict`  | `state.remainingCardCounts` 经座位映射           |
| `card_play_action_seq` | `state.publicHistory`，过牌转 `[]`               |
| `played_cards`         | 按座位聚合公开历史中的已出牌                     |
| `last_move`            | `state.currentWinningPlay`                       |
| `last_move_dict`       | 每个座位最近一次公开动作                         |
| `bomb_num`             | 历史中的炸弹和王炸次数                           |
| `other_hand_cards`     | 完整牌堆减去自己当前手牌和所有已出牌后的点数合集 |

`other_hand_cards` 只能表示两名其他玩家剩余牌的合并集合，不能包含各自分配。`all_handcards` 等带隐藏分区的信息不得构造或传输。

## 7. 合法动作规范化

项目规则引擎保留物理牌 ID，因此同一种点数组合可能有多个花色组合。DouZero 只按点数编码；若不去重，Top-K 可能被语义相同的动作占满。

推理前必须：

1. 使用排序后的点数 multiset 生成语义签名；
2. 同签名只向 DouZero 发送一次；
3. 保存签名到 `PublicLegalAction` 的反向映射；
4. 返回结果时选择 `actionId` 字典序最小的物理动作，保证可复现；
5. 过牌使用独立签名，不能与空的非法出牌混淆。

合法动作始终来自项目规则引擎。当前项目对飞机单翼和四带二单采用严格规则，而 DouZero 上游规则更宽松，因此不能直接采用 DouZero 的动作生成结果。

## 8. 推理进程与降级

第一版采用由 Node 后端管理的常驻 Python 子进程：

- 使用独立的受支持 Python 环境；
- 通过 stdin/stdout NDJSON 通信，stderr 仅输出诊断日志；
- 进程启动时加载三个座位模型，避免逐请求加载；
- 每个请求携带 request ID、状态版本和模型版本；
- 按 `stateChecksum + modelVersion + objective` 缓存完整排序；
- 调用方再对缓存结果截取 Top-K；
- 超时、进程退出、非法输出或非有限模型分值时回退当前启发式；
- 推理失败不得阻塞牌局、合法性回答或普通教练对话。

开发阶段先用 CPU 建立延迟基线，避免与 Ollama 争用显存；只有测量证明需要时才启用 GPU。

## 9. 模型和供应链安全

- 模型、代码和下载地址必须固定版本；
- 每个 checkpoint 记录 SHA-256、目标类型、来源和许可证信息；
- 运行时不加载未经校验的任意 PyTorch pickle；
- 优先使用 `weights_only=True`，或把受信任 checkpoint 转换成安全权重格式；
- 模型文件不提交到 Git，使用显式下载脚本和 manifest 管理；
- 诊断日志只记录版本、状态引用、延迟和错误类别，不记录用户语音、转写文本或隐藏牌。

## 10. 实施阶段与验收标准

### 阶段 1：上游锁定与 Top-K 扩展——已完成

- 锁定官方提交；
- 实现 `RankedDeepAgent`；
- Top-1 与锁定版本官方 `DeepAgent.act()` 一致；
- 同分时保持原始动作顺序；
- 排名核心测试不依赖 PyTorch 和真实权重。

### 阶段 2：状态适配——已完成

- 实现 `PlayerVisibleGameState → InfoSet DTO`；
- 覆盖三个相对座位、自由出牌、跟牌、连续过牌和恢复牌局；
- 证明未知牌合并集合可由可见信息推导；
- DTO 中不存在对手独立手牌字段。
- 拒绝隐藏字段、重复物理牌、超出标准牌堆和剩余牌数冲突；
- 自动校验 DTO 覆盖锁定版本 `get_obs()` 读取的全部 `InfoSet` 字段。

### 阶段 3：合法动作对齐与去重——已完成

- 只使用项目合法动作；
- 同点数动作只评分一次；
- 反向映射稳定且可复现；
- 在批量可达局面中，返回动作 100% 属于项目合法动作。
- 过牌使用独立签名并固定排在出牌动作之后；
- 拒绝重复 `actionId`、牌外动作、动作与 `play.cards` 冲突，以及与物理牌不一致的 `actionId`。
- 使用项目真实规则引擎生成并验证 138 个可达局面、1,425 个原始合法动作，覆盖三个相对座位。

### 阶段 4：常驻推理服务

- Node 能启动、探活、请求、取消并关闭 Python worker；
- 模型只加载一次；
- 缓存命中不重复推理；
- 超时、崩溃和无效输出均能回退启发式；
- 记录冷启动、P50 和 P95 延迟。

当前已完成：

- Python NDJSON worker、请求 ID、`ping`、`rank_actions` 和 `shutdown`；
- Node 子进程启动、正常关闭、异常退出处理和严格响应校验；
- 将模型启动超时与单次推理超时分离，默认分别为 15 秒和 1 秒；
- 以 `stateChecksum + modelVersion + objective` 为键的 128 项 LRU 缓存；
- 请求超时、畸形响应和不可用 worker 的启发式降级；
- 对过期状态、非当前回合和非法请求不执行静默降级；
- 使用确定性假后端完成真实子进程集成测试。
- 建立项目内忽略的隔离 Python 环境，并记录已验证的精确依赖版本；
- 新增 checkpoint manifest，启动时校验三个位置模型的文件大小和 SHA-256；
- 使用 `torch.load(..., weights_only=True)` 加载校验后的 state dictionary；
- 使用固定社区镜像提交的 DouZero-WP 三位置权重完成 Python 真实推理；
- 完成 Node → 常驻 Worker → `get_obs()` → 模型评分 → 项目动作 ID 的端到端测试；
- 未获生产批准的 manifest 默认拒绝加载，测试必须显式传入允许开关。
- 新增可重复运行的真实模型基准工具和机器可读 JSON 报告；
- 在 55 个未缓存可达局面上测得 Windows CPU 端到端 P50/P95 为 4.00/9.42ms；
- 三次冷启动 P50/P95 为 2.55/2.79 秒，运行后 Worker RSS 约 245MiB；

阶段完成前仍需：

- 取得并校验可批准用于生产的三个座位 checkpoint；
- 将生产 manifest 切换为默认可加载，社区镜像继续只用于开发验证；
- 测量与 Ollama、本地 ASR/TTS 并发时的 CPU/GPU 资源冲突。

### 阶段 5：教练工具接入

- 新增 `get_ranked_actions`，保留 `get_legal_actions`；
- 策略问题确定性调用排序工具；
- Top-1 驱动安全高亮，不能自动出牌；
- 通用模型只能解释返回候选，不能改写动作 ID 或排名；
- 状态版本过期时拒绝使用旧结果。

### 阶段 6：质量与回归评测

- 增加状态适配、规则差异、隐私和模型异常测试；
- 在固定局面集对比 DouZero 与当前启发式；
- 复盘中记录模型版本和当时可见状态；
- 通过人工盲评确认建议质量提升，而不仅是模型分数变化。

## 11. 当前文件布局

```text
services/douzero-inference/
├─ benchmarks/
│  └─ 2026-08-10-windows-cpu-community-wp.json
├─ README.md
├─ model-manifest.community-wp.json
├─ requirements-runtime.txt
├─ requirements-runtime.lock.txt
├─ upstream.lock.json
├─ worker.py
├─ src/douzero_inference/
│  ├─ __init__.py
│  ├─ action_adapter.py
│  ├─ model_manifest.py
│  ├─ ranked_agent.py
│  └─ state_adapter.py
└─ tests/
   ├─ export_project_action_cases.mjs
   ├─ test_action_adapter.py
   ├─ test_project_action_contract.py
   ├─ test_ranked_agent.py
   ├─ test_state_adapter.py
   └─ test_upstream_parity.py
```

Node 端策略客户端位于 `apps/server/src/strategy`。后续仍需增加模型 manifest，并在真实权重验证通过后接入生产教练路径。

## 12. 阶段 1 验证

不安装 PyTorch 即可运行纯排序测试：

```powershell
npm.cmd run build --workspace @ai-doudizhu/coach-protocol
python -m unittest discover services/douzero-inference/tests -v
```

若本地已有锁定版本的 DouZero 源码，可同时验证真实上游 `DeepAgent` 路径：

```powershell
$env:DOUZERO_UPSTREAM_PATH = "C:\path\to\DouZero"
python -m unittest discover services/douzero-inference/tests -v
```
