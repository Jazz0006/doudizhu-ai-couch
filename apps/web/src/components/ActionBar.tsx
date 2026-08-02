interface ActionBarProps {
  readonly canAct: boolean;
  readonly canPass: boolean;
  readonly canPlay: boolean;
  readonly canClear: boolean;
  readonly isFinished: boolean;
  readonly onHint: () => void;
  readonly onClear: () => void;
  readonly onPass: () => void;
  readonly onPlay: () => void;
  readonly onRestart: () => void;
}

export function ActionBar({
  canAct,
  canPass,
  canPlay,
  canClear,
  isFinished,
  onHint,
  onClear,
  onPass,
  onPlay,
  onRestart,
}: ActionBarProps) {
  if (isFinished) {
    return (
      <div className="action-bar single-action">
        <button className="primary-button" onClick={onRestart} type="button">
          再来一局
        </button>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <button disabled={!canAct} onClick={onHint} type="button">
        提示
      </button>
      <button disabled={!canClear} onClick={onClear} type="button">
        清空
      </button>
      <button disabled={!canPass} onClick={onPass} type="button">
        不出
      </button>
      <button
        className="primary-button"
        disabled={!canPlay}
        onClick={onPlay}
        type="button"
      >
        出牌
      </button>
    </div>
  );
}
