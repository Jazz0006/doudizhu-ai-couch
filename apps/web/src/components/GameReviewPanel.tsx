import type { GameReview, LearningTag } from "@ai-doudizhu/coach-protocol";
import type { Card, Play, Seat } from "@ai-doudizhu/game-core";

export interface GameReviewPanelProps {
  readonly review: GameReview;
  readonly onRestart: () => void;
}

export function GameReviewPanel({ review, onRestart }: GameReviewPanelProps) {
  return (
    <div className="result-card review-card">
      <p className="eyebrow">本局复盘</p>
      <h2>{review.winner === "landlord" ? "地主获胜" : "农民获胜"}</h2>
      <p className="review-intro">
        选取 {review.items.length}{" "}
        个关键节点。评价关注当时决策，不用最终输赢倒推每一步好坏。
      </p>

      <ol className="review-list">
        {review.items.map((item) => (
          <li key={item.actionIndex} className="review-item">
            <div className="review-item-heading">
              <strong>{item.title}</strong>
              <span>{item.impact}</span>
            </div>
            <small>
              第 {item.actionIndex + 1} 步 · {seatLabel(item.seat)}
            </small>
            <dl>
              <div>
                <dt>当时手牌</dt>
                <dd>{cardList(item.userHandBefore)}</dd>
              </div>
              <div>
                <dt>场上牌面</dt>
                <dd>{playLabel(item.tablePlayBefore)}</dd>
              </div>
              <div>
                <dt>实际动作</dt>
                <dd>
                  {item.action === "pass" ? "不出" : cardList(item.playedCards)}
                </dd>
              </div>
              <div>
                <dt>可选替代</dt>
                <dd>
                  {item.alternatives.length > 0
                    ? item.alternatives
                        .map(({ play }) => playLabel(play))
                        .join("；")
                    : "这一节点以观察为主"}
                </dd>
              </div>
            </dl>
            <p>{item.evaluation}</p>
          </li>
        ))}
      </ol>

      {review.learningTags.length > 0 && (
        <div className="learning-tags" aria-label="本局学习标签">
          {review.learningTags.map((tag) => (
            <span key={tag}>{learningTagLabel(tag)}</span>
          ))}
        </div>
      )}

      <button className="primary-button" onClick={onRestart} type="button">
        再来一局
      </button>
    </div>
  );
}

function cardList(cards: readonly Card[]): string {
  return cards.length > 0
    ? cards.map(({ rank }) => rankLabel(rank)).join(" ")
    : "无";
}

function playLabel(play: Play | null): string {
  if (!play) return "自由出牌";
  return `${playTypeLabel(play.type)}：${cardList(play.cards)}`;
}

function rankLabel(rank: Card["rank"]): string {
  if (rank === "small_joker") return "小王";
  if (rank === "big_joker") return "大王";
  return rank;
}

function playTypeLabel(type: Play["type"]): string {
  const labels: Record<Play["type"], string> = {
    single: "单张",
    pair: "对子",
    triple: "三张",
    triple_with_single: "三带一",
    triple_with_pair: "三带二",
    straight: "顺子",
    pair_straight: "连对",
    airplane: "飞机",
    airplane_with_singles: "飞机带单",
    airplane_with_pairs: "飞机带对",
    four_with_two_singles: "四带二",
    four_with_two_pairs: "四带两对",
    bomb: "炸弹",
    rocket: "王炸",
  };
  return labels[type];
}

function seatLabel(seat: Seat): string {
  if (seat === "user") return "你的决定";
  return seat === "left" ? "左侧玩家" : "右侧玩家";
}

function learningTagLabel(tag: LearningTag): string {
  const labels: Record<LearningTag, string> = {
    too_many_singletons: "单牌偏多",
    uses_control_cards_too_early: "控制牌使用偏早",
    breaks_pairs_unnecessarily: "不必要拆对",
    weak_farmer_coordination: "农民配合",
    misses_endgame_threat: "残局威胁判断",
    overuses_bombs: "炸弹使用偏多",
    bids_too_aggressively: "叫分偏激进",
    bids_too_passively: "叫分偏保守",
  };
  return labels[tag];
}
