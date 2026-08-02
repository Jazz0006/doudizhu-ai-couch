import { useMemo } from "react";

import { ActionBar } from "./components/ActionBar";
import { BiddingPanel } from "./components/BiddingPanel";
import { CardFan } from "./components/CardFan";
import { DifficultySelector } from "./components/DifficultySelector";
import { GameTable } from "./components/GameTable";
import { SeatPlayArea } from "./components/SeatPlayArea";
import { VoiceControl } from "./components/VoiceControl";
import { getCurrentTrickActions } from "./game/currentTrick";
import { useGameController } from "./game/useGameController";
import "./styles.css";

export function App() {
  const game = useGameController();
  const selectedPlay = useMemo(
    () => game.recognizeSelection(),
    [game.selectedCardIds, game.recognizeSelection],
  );
  const currentActions = useMemo(
    () => getCurrentTrickActions(game.state.history),
    [game.state.history],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI 斗地主教练</p>
          <h1>练牌桌</h1>
        </div>
        <div className="topbar-actions">
          <DifficultySelector
            value={game.difficulty}
            disabled={game.botThinking}
            onChange={game.changeDifficulty}
          />
          <button className="quiet-button" onClick={game.restart} type="button">
            重新开局
          </button>
        </div>
      </header>

      <VoiceControl />

      <section className="game-frame" aria-label="斗地主牌桌">
        <GameTable
          state={game.state}
          botThinking={game.botThinking}
          leftAction={currentActions.left}
          rightAction={currentActions.right}
        />

        <div className="player-zone">
          <div className="player-meta">
            <div>
              <span className="player-label">你</span>
              <strong>{roleLabel(game.state.roles.user)}</strong>
            </div>
            <div className="selection-summary" aria-live="polite">
              {game.state.phase === "playing"
                ? selectionLabel(
                    game.selectedCardIds.length,
                    selectedPlay?.type,
                  )
                : "等待确定地主"}
            </div>
          </div>

          <SeatPlayArea action={currentActions.user} label="你" />

          {game.state.phase === "bidding" ? (
            <BiddingPanel
              currentTurn={game.state.currentTurn}
              highestBid={game.state.highestBid}
              disabled={!game.canUserBid}
              onBid={game.bid}
            />
          ) : (
            <ActionBar
              canAct={game.canUserPlay}
              canClear={game.canUserPlay && game.selectedCardIds.length > 0}
              canPass={game.canUserPass}
              canPlay={game.canSubmitSelection}
              isFinished={game.state.phase === "finished"}
              onHint={game.hint}
              onClear={game.clearSelection}
              onPass={game.pass}
              onPlay={game.play}
              onRestart={game.restart}
            />
          )}

          <p className="notice" aria-live="polite">
            {game.notice}
          </p>

          <CardFan
            cards={game.state.hands.user}
            disabled={!game.canUserPlay}
            selectedCardIds={game.selectedCardIds}
            onSelectionChange={game.changeSelection}
          />
        </div>

        <aside className="orientation-hint" aria-live="polite">
          <span aria-hidden="true">↻</span>
          横屏看牌更清楚
        </aside>

        {game.state.phase === "finished" && (
          <div className="result-overlay" role="dialog" aria-modal="true">
            <div className="result-card">
              <p className="eyebrow">本局结束</p>
              <h2>
                {game.state.winner === "landlord" ? "地主获胜" : "农民获胜"}
              </h2>
              <p>共进行了 {game.state.history.length} 次出牌或过牌。</p>
              <button
                className="primary-button"
                onClick={game.restart}
                type="button"
              >
                再来一局
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function roleLabel(role: "landlord" | "farmer" | null): string {
  if (role === "landlord") return "地主";
  if (role === "farmer") return "农民";
  return "待定";
}

const PLAY_LABELS: Record<string, string> = {
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

function selectionLabel(count: number, type?: string): string {
  if (count === 0) return "点选手牌准备出牌";
  if (!type) return `已选 ${count} 张 · 不是合法牌型`;
  return `已选 ${count} 张 · ${PLAY_LABELS[type] ?? type}`;
}
