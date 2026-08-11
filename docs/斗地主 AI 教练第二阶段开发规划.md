# 斗地主 AI 教练第二阶段开发规划
## —— 人类受限记牌模型 + 个性化自适应教学系统

### 1. 项目阶段定位

当前阶段的首要任务仍然是完善斗地主底层 AI 算法，使其能够稳定完成：

- 正确维护完整牌局状态；
- 生成所有合法动作；
- 对候选动作进行可靠评估；
- 输出最佳动作以及 Top-K 候选动作；
- 在地主、上家农民、下家农民三个位置均达到足够高的实战水平；
- 对叫地主阶段和完整对局流程提供稳定支持。

在底层算法达到可用水平以后，下一阶段不再单纯追求“AI 打得更强”，而是重点建设真正具有产品差异化价值的：

**AI Coaching System（斗地主智能教练系统）**

这一阶段有两个核心方向：

1. **Human-Limited Decision Model**
   - 限制 AI 使用超出普通人类能力的完美记牌信息；
   - 给出人类能够真正复现的策略。

2. **Adaptive Player Coaching**
   - 先观察玩家实际水平；
   - 建立长期玩家能力画像；
   - 根据不同玩家的弱点和成长阶段进行针对性教学。

最终目标不是：

> 告诉玩家 AI 会怎么打。

而是：

> 判断这个玩家当前为什么这样打、他的真正弱点在哪里，以及下一步最值得学习什么。

---

# 2. 产品核心理念

传统斗地主 AI 优化的是：

**在当前信息下找到最大期望收益动作。**

AI 教练需要解决的是另一个问题：

**在一个特定玩家当前能够掌握、理解和复现的信息范围内，什么打法最值得推荐？**

因此产品中应该长期保留两个不同的参考标准。

## 2.1 Oracle AI

Oracle AI 拥有机器的完整能力，包括：

- 精确记住所有已出牌；
- 精确统计剩余牌；
- 完整牌局历史；
- 完整合法动作集合；
- 对所有候选动作进行模型评估。

它回答：

> 理论上，这个局面的最佳动作是什么？

Oracle AI 主要用于：

- Benchmark；
- 评估玩家真实决策质量；
- 判断 Human Coach 与理论最优解之间的差异；
- 训练和验证后续 Coaching Model。

---

## 2.2 Human Coach AI

Human Coach 不应天然拥有普通玩家无法实现的全部机器能力。

它需要模拟：

> 一个真正优秀、但仍然是“人类”的斗地主玩家。

例如它可能准确记得：

- 大小王；
- 已经出现几个 2；
- 大部分 A；
- 是否出现炸弹；
- 最近几轮关键牌；
- 谁曾经拆过对子、顺子或三张。

但可能无法准确记住：

- 十几轮以前所有 5、6、7、8 的准确数量；
- 每一张普通中小牌；
- 所有历史牌型细节。

因此 Human Coach 回答的是：

> 如果一个与你当前水平相符的优秀人类玩家坐在这里，他应该怎样思考？

---

# 3. Human Memory Model

## 3.1 不采用随机遗忘

第一版绝不能简单实现成：

`randomlyForget(50% of history)`

因为人类记忆不是随机的。

斗地主玩家通常更容易记住：

- 大王；
- 小王；
- 2；
- A；
- 炸弹；
- 火箭；
- 长顺子；
- 飞机；
- 最近几轮牌；
- 地主打出的关键牌；
- 非常反常的出牌行为。

而容易遗忘：

- 很早以前出现的普通小牌；
- 普通对子；
- 中间张的准确数量；
- 已经过去很多轮的非关键细节。

因此需要实现：

**Salience-Based Memory Model**

即基于“信息重要程度”的记忆模型。

---

# 4. 建议的记牌能力分级

第一版可以定义四档。

## Level 1：初级记牌

主要记忆：

- 大小王；
- 2；
- 已知炸弹；
- 最近非常明显的重要出牌。

适合：

- 初学者；
- 30～50 分玩家。

---

## Level 2：中级记牌

增加：

- A；
- 部分 K；
- 关键对子；
- 明显的顺子和三张拆分；
- 最近若干轮重要出牌；
- 谁剩牌较少。

适合：

- 50～70 分玩家。

---

## Level 3：高级记牌

增加：

- 大部分大牌准确张数；
- 重要中牌；
- 已拆牌型；
- 对手潜在剩牌结构；
- 更长时间范围内的关键历史。

适合：

- 70～90 分玩家。

---

## Level 4：Oracle

完整记录：

- 所有牌；
- 所有历史动作；
- 所有精确剩余牌；
- 不发生记忆错误。

主要用于：

- Benchmark；
- 理论分析；
- 高级玩家研究。

---

# 5. 第二阶段记忆模型

第一版本可以采用确定性规则。

例如：

```text
大王 / 小王     极高重要性
2               极高重要性
A               高重要性
K               中高
Q/J             中等
10以下           较低

炸弹             极高
火箭             极高
最近两轮         提高权重
地主出的牌       提高权重
异常拆牌         提高权重
时间越久         权重逐渐下降
```

后续版本再引入：

**Memory Confidence**

即不是简单：

> 记得 / 不记得

而是：

> 我认为还有一张 2，但并不完全确定。

内部例如：

```text
P(剩余0张2) = 0.15
P(剩余1张2) = 0.70
P(剩余2张2) = 0.15
```

Human Coach 的决策需要考虑这种不确定性。

---

# 6. Player Model

AI 教练需要为每一位玩家维护长期能力画像。

外部可以显示一个简单的：

**斗地主水平：1～100**

但内部必须是多维评分。

建议初始能力模型：

| 维度 | 说明 |
|---|---|
| Rules | 基础规则和牌型能力 |
| Hand Planning | 整手牌的组织和规划 |
| Tempo / Initiative | 牌权判断能力 |
| Farmer Cooperation | 农民之间的合作 |
| Landlord Attack | 地主进攻能力 |
| Control Management | 王、2、A 等控制牌管理 |
| Card Memory | 记牌能力 |
| Opponent Modeling | 对手剩余牌推断 |
| Risk Management | 风险与收益判断 |
| Endgame | 残局能力 |

后续可以增加：

- Bidding；
- Bomb Management；
- Leading Strategy；
- Passing Strategy；
- Partner Reading。

---

# 7. 综合评分

玩家看到：

```text
总体水平：68 / 100
```

但系统内部可能是：

```text
Rules               94
Hand Planning       72
Tempo               81
Farmer Cooperation  58
Landlord Attack     77
Control Management  64
Card Memory         43
Opponent Modeling   51
Risk Management     70
Endgame              84
```

AI 最重要的任务不是告诉玩家：

> 你只有 68 分。

而是：

> 当前阻碍你进一步提升的主要因素是：
> 1. 农民配合
> 2. 关键牌记忆

---

# 8. 初始诊断阶段

新玩家第一次使用 Coach Mode 时，不应立刻开始大量教学。

推荐：

## Observation Mode

前 3～5 局主要观察。

系统记录：

- 玩家每一步实际动作；
- Oracle AI 最佳动作；
- Human Coach 推荐动作；
- Top-K 动作估值；
- 玩家位置；
- 当前牌局阶段；
- 玩家是否掌握关键牌信息；
- 最终结果。

教练只在特别明显的问题出现时进行少量提示。

完成诊断后生成：

**Initial Player Profile**

例如：

```text
当前评分：61

优势：
- 基础规则很好
- 地主打法积极
- 残局处理不错

主要问题：
- 农民合作偏弱
- 经常过早消耗2和王
- 大牌记忆较弱

当前训练目标：
1. 不抢队友牌权
2. 只练习记王、2、A
```

---

# 9. Error Attribution

这是 Coaching Engine 最重要的模块之一。

不能仅仅记录：

> 玩家没有选择 AI 第一推荐动作，因此这是错误。

必须进一步判断：

**为什么错？**

同一个错误动作可能对应完全不同的问题。

例如玩家用 2 压住队友。

可能是：

### 原因 A：合作意识问题

玩家知道队友已经控制局面，但是仍然习惯主动拿牌权。

分类：

`Farmer Cooperation`

---

### 原因 B：记牌问题

玩家错误认为地主仍然有两张 A。

实际上之前已经出了三张。

分类：

`Card Memory`

---

### 原因 C：局面判断问题

玩家准确知道剩余牌，但错误判断地主马上要结束。

分类：

`Opponent Modeling / Risk`

---

### 原因 D：长期规划问题

玩家只考虑这一轮，没有意识到 2 是后续唯一控制牌。

分类：

`Hand Planning / Control Management`

---

# 10. 关键决策追问

对于特别有价值的教学场景，可以让 AI 主动问玩家：

> 你刚才为什么决定用 2 压？

可以提供快速选项：

- 担心地主马上跑完；
- 想重新取得牌权；
- 认为队友接下来不好走；
- 没有特别考虑。

也允许玩家直接语音回答。

这样系统就能区分：

**决策过程错误**

与

**信息掌握错误**

这是建立准确玩家画像的重要数据来源。

---

# 11. Teaching Policy

教练系统必须有一个独立模块决定：

> 哪些东西现在值得告诉玩家？

而不是发现任何非最优动作就立刻纠正。

Teaching Policy 需要综合：

- 玩家水平；
- 当前训练目标；
- 动作价值损失；
- 错误是否反复出现；
- 当前是否关键局面；
- 玩家近期是否已经收到大量提示；
- 该知识是否适合当前水平。

---

# 12. Teaching Threshold

例如：

## 40 分玩家

如果：

```text
最佳动作价值：0.81
玩家动作价值：0.25
```

明显严重失误。

可以中断：

> 这里值得看一下。

如果：

```text
最佳：0.72
玩家：0.68
```

不需要教学。

---

## 85 分玩家

0.72 与 0.68 的区别反而可能很值得研究。

AI 可以解释：

> 你的打法完全合理，不过模型稍微偏向 Pass。
> 原因主要来自地主剩牌结构，而不是当前牌型本身。

因此：

**教学阈值必须随着玩家水平提高而降低。**

---

# 13. 教练永远只领先玩家半步

核心教学原则：

**Coach Difficulty ≈ Player Level + 5～15**

例如：

```text
玩家 40
→ 使用约 50 分水平能够理解和执行的策略

玩家 65
→ 教授约 75 分水平的内容

玩家 85
→ 开始讲高级记牌和对手牌型推断

玩家 95
→ 接近 Oracle 分析
```

避免：

> 用职业级分析去教育初学者。

---

# 14. 动态记牌能力

Human Coach 的记牌能力也应随玩家成长。

例如：

### 玩家 35 分

训练：

> 王 + 2

---

### 玩家 50 分

训练：

> 王 + 2 + A

---

### 玩家 65 分

开始增加：

> K + 关键对子

---

### 玩家 80 分

开始训练：

> 中张分布 + 拆牌信息

---

### 玩家 90+

进入：

> 精确张数 + 对手剩牌范围推断

这样记牌本身成为可渐进训练的技能，而不是 AI 隐藏在后台的超能力。

---

# 15. 三层决策评价

每次玩家动作可以同时得到三种评价。

## Layer 1：Oracle Decision

机器完整信息下：

> 理论最优动作。

---

## Layer 2：Human-Limited Decision

在人类合理记牌能力下：

> 推荐动作。

---

## Layer 3：Player Decision

玩家实际选择：

> 实际动作。

这样能够区分：

### 情况一

```text
Player = Human Coach ≠ Oracle
```

说明：

> 玩家做出了非常合理的人类决策。

不应该处罚。

---

### 情况二

```text
Player ≠ Human Coach = Oracle
```

说明：

> 明显策略错误。

---

### 情况三

```text
Player ≠ Human Coach ≠ Oracle
```

需要进一步分析：

> 信息、记忆、风险偏好或者策略理解的问题。

---

# 16. 每局后的 Coaching Report

不推荐给玩家输出二十个错误。

每局只总结：

### 做得最好的 1～2 件事

例如：

> 你这局两次主动让牌给队友都非常好。

### 最值得修正的 1～2 个问题

例如：

> 第 8 手过早使用 2，是这局最大损失。

### 一个训练重点

例如：

> 下一局只关注一件事：
> **队友有牌权时不要轻易抢回来。**

---

# 17. 长期 Player Progress

系统需要保存：

```text
PlayerProfile
```

建议主要字段：

```text
playerId
overallRating

skillRatings
playStyle

strengths
weaknesses

currentTrainingGoals

gamesPlayed
decisionsAnalyzed

recentErrors
recurringErrors

memoryLevel

preferredCoachIntensity

ratingConfidence
```

---

# 18. Rating Confidence

评分不能假装非常精确。

例如：

```text
水平：68
评估置信度：低
```

打 5 局以后：

```text
水平：69
评估置信度：中
```

打 30 局以后：

```text
水平：71
评估置信度：高
```

内部可以保存：

```text
rating = 71
confidence = 0.86
```

---

# 19. 分角色能力

建议至少区分：

```text
Overall
Landlord
FarmerUp
FarmerDown
```

例如：

```text
总体       71
地主       79
上家农民   62
下家农民   70
```

这很容易发现玩家特征。

例如：

> 地主进攻能力很强，但作为上家农民合作明显偏弱。

这比单纯胜率有价值得多。

---

# 20. 教练交互模式

建议最终提供三个模式。

## Quiet Coach

玩家正常玩。

AI 只在非常严重的错误时提示。

适合娱乐。

---

## Training Coach

AI 根据当前训练目标适度提示。

推荐作为默认模式。

---

## Deep Analysis

玩家可以随时问：

> 为什么？

查看：

- 推荐动作；
- Top-K；
- 自己动作；
- AI 极限打法；
- 人类现实打法；
- 深度解释。

适合认真学习。

---

# 21. 系统总体架构

```text
                    Game Engine
                        │
                        ▼
                 Complete Game State
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
          Oracle AI          Memory Model
              │                   │
              │                   ▼
              │             Human Belief State
              │                   │
              │                   ▼
              │            Human-Limited AI
              │                   │
              └─────────┬─────────┘
                        │
                  Player Action
                        │
                        ▼
                Decision Analyzer
                        │
                        ▼
                 Error Attribution
                        │
                        ▼
                   Player Model
                        │
             ┌──────────┼───────────┐
             ▼          ▼           ▼
           Level      Weakness      Style
             │          │           │
             └──────────┼───────────┘
                        ▼
                 Teaching Policy
                        │
                        ▼
                     LLM
                        │
                        ▼
                   AI Coach
```

---

# 22. LLM 的职责边界

LLM 不应该负责：

- 判断合法动作；
- 精确维护剩余牌；
- 独立决定最佳动作；
- 独立计算胜率；
- 代替底层斗地主模型。

LLM 应该负责：

- 把模型结论转换成人类语言；
- 分析玩家为什么犯错；
- 根据玩家水平控制解释深度；
- 生成针对性的训练建议；
- 与玩家进行语音讨论；
- 每局结束生成总结；
- 长期解释玩家成长趋势。

原则：

> **算法负责正确性，LLM 负责理解与教学。**

---

# 23. 推荐 API 边界

底层模型统一暴露：

```text
evaluateState()
```

返回：

```json
{
  "recommendedMove": "...",
  "alternatives": [
    {
      "move": "...",
      "value": 0.72
    },
    {
      "move": "...",
      "value": 0.68
    }
  ]
}
```

---

Human Memory 模块：

```text
buildHumanBeliefState()
```

输入：

```text
FullGameState
PlayerMemoryLevel
PlayerProfile
```

输出：

```text
HumanBeliefState
```

---

Decision Analyzer：

```text
analyzeDecision()
```

输入：

```text
OracleResult
HumanCoachResult
PlayerMove
PlayerProfile
```

输出：

```json
{
  "severity": "medium",
  "likelySkill": "farmer_cooperation",
  "confidence": 0.76,
  "teachingValue": 0.81
}
```

---

Teaching Engine：

```text
shouldIntervene()
```

决定：

- 是否提示；
- 什么时候提示；
- 讲多深；
- 是否追问玩家原因。

---

# 24. 开发实施顺序

## Phase A — 底层 AI 完成

当前阶段。

完成：

- AI engine；
- 完整牌局状态；
- Top-K；
- Action Value；
- Benchmark；
- 叫地主。

---

## Phase B — Decision Logging

这是 Coaching 系统的第一步。

每局完整保存：

```text
State
PlayerAction
LegalActions
AI Top-K
Position
GameResult
```

即使暂时没有 Coaching UI，也应该先把这些数据记录下来。

**这是非常重要的工程决定。**

因为以后所有 Player Model 都依赖这些历史数据。

---

## Phase C — Player Rating V1

先不做复杂 AI。

实现：

- 5～10 个能力维度；
- 规则式评分；
- 1～100 综合分；
- 地主/农民分别评分；
- Confidence。

先做到：

> 系统能够稳定描述一个玩家。

---

## Phase D — Human Memory V1

实现简单规则：

```text
Beginner
Intermediate
Advanced
Oracle
```

先用 deterministic salience filter。

不需要一开始建立复杂 probabilistic model。

---

## Phase E — Adaptive Teaching V1

实现：

- Teaching Threshold；
- 当前 Training Goal；
- 每局最多提示若干次；
- 每局只总结 1～2 个关键问题。

---

## Phase F — LLM Coach

将：

```text
PlayerProfile
DecisionAnalysis
CurrentTrainingGoal
Top-K
Game Context
```

提供给 LLM。

实现：

> 为什么？
> 我哪里错了？
> 应该注意什么？
> 下一局练什么？

---

## Phase G — Memory Confidence

增加：

- 不确定记忆；
- Belief State；
- 概率剩牌。

这是第二代 Human Memory。

---

## Phase H — Personalized Curriculum

根据大量历史自动决定：

> 玩家下一阶段学习什么。

最终形成真正的长期 AI 私教。

---

# 25. 第一版 MVP 必须控制范围

不要一开始实现完整理论。

Coaching MVP 只需要：

### 必须

- Top-K AI 动作；
- 玩家动作记录；
- 5～8 个技能维度；
- Overall 1～100；
- 初始 5 局诊断；
- Rule-based Human Memory；
- 每局一个重点建议；
- LLM 解释；
- 长期 Player Profile。

### 暂缓

- 精确概率记忆模型；
- 神经网络 Player Model；
- 自动课程生成；
- 复杂心理/打法风格模型；
- Reinforcement Learning Coach；
- Human-limited Student Model。

先验证：

> 玩家是否真的觉得这种教学方式有帮助。

---

# 26. 第一阶段建议能力维度

为避免过度设计，V1 可以只保留七项：

```text
1. Hand Planning
2. Initiative
3. Farmer Cooperation
4. Control Management
5. Card Memory
6. Opponent Reading
7. Endgame
```

再根据这些生成：

```text
Overall Rating
```

等收集真实玩家数据后，再拆分维度。

---

# 27. 产品核心指标

这个产品不应该主要看：

> 玩家赢了多少局。

因为斗地主的发牌随机性太强。

应该重点观察：

### Decision Quality

玩家动作与 Human Coach 推荐动作之间的差距。

### Critical Error Rate

每 100 次关键决策的严重错误数。

### Repeated Error Rate

同类问题是否不断重复。

### Skill Improvement

某项能力随时间变化。

例如：

```text
Farmer Cooperation

Week 1   54
Week 2   59
Week 3   65
Week 4   71
```

### Coaching Effectiveness

系统给出某项训练目标后：

> 对应错误是否真正下降。

这将成为以后最有价值的数据。

---

# 28. 一个完整用户体验示例

第一次使用：

> 先正常玩几局，我会了解你的打法。

第 5 局以后：

> 初步评分：63 / 100
>
> 你的地主打法不错，但是作为农民时比较喜欢主动抢牌权。
>
> 接下来几局我们只练一个东西：
>
> **队友已经掌握主动时，不要轻易接管牌权。**

玩家继续。

某局发生关键动作：

> 你刚才选择用 2 接队友。
>
> 这里值得看一下。
>
> 你当时是担心地主下一手会跑掉吗？

玩家：

> 是，我以为他还有两个 A。

教练：

> 那你的思路其实是合理的。
>
> 这手真正的问题是记牌：之前已经出了三张 A。
>
> 所以下一阶段先不用记所有牌，只练：
>
> **王、2、A。**

十局以后：

> 农民配合：58 → 70
>
> 很明显进步了。
>
> 下一训练目标：
>
> **控制牌管理。**

这就是最终希望达到的 AI 教练体验。

---

# 29. 产品竞争壁垒

底层 AI 模型未来可以更换：

```text
DouZero
DouRN
AlphaDou
Custom Model
```

LLM 同样可以更换：

```text
OpenAI
其他云模型
本地模型
```

真正应该长期积累的是：

```text
Player Model
+
Decision Analysis
+
Human Memory Model
+
Teaching Policy
+
Player Progress Data
```

尤其是：

> 某一类玩家在某一种错误以后，怎样的教学方式最容易真正改善他的下一次决策？

这部分随着真实玩家数量增加，会逐渐形成比单纯斗地主 AI 更难复制的核心价值。

---

# 30. 最终产品定位

项目不应该被定义成：

**“一个能陪你斗地主的 AI。”**

更合适的定位是：

> **一个真正了解你斗地主水平、知道你为什么输，并且能够长期把你教得越来越好的 AI 私人教练。**

核心循环：

```text
观察
↓
评估
↓
建立玩家画像
↓
发现最大短板
↓
选择一个训练目标
↓
观察新的决策
↓
针对性反馈
↓
重新评估
↓
进入下一阶段
```

而 Human-Limited AI 保证：

> 教练教给玩家的不是只有机器才能做到的打法，而是真正可以被人学会并应用到现实牌局中的能力。

这两个模块——

**Human Memory Model**

和

**Adaptive Player Model / Teaching Policy**

应该作为底层斗地主算法完善以后，下一阶段开发的最高优先级。