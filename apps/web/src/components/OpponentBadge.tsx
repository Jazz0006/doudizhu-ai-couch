import type { Role, Seat } from "@ai-doudizhu/game-core";

interface OpponentBadgeProps {
  readonly seat: Exclude<Seat, "user">;
  readonly role: Role | null;
  readonly remainingCards: number;
  readonly active: boolean;
  readonly thinking: boolean;
}

export function OpponentBadge({
  seat,
  role,
  remainingCards,
  active,
  thinking,
}: OpponentBadgeProps) {
  return (
    <div className={`opponent ${active ? "is-active" : ""}`}>
      <div className="avatar" aria-hidden="true">
        {seat === "left" ? "左" : "右"}
      </div>
      <div>
        <strong>{seat === "left" ? "左侧玩家" : "右侧玩家"}</strong>
        <span>
          {role === "landlord"
            ? "地主"
            : role === "farmer"
              ? "农民"
              : "等待叫分"}
          {` · ${remainingCards} 张`}
        </span>
      </div>
      {active && <i>{thinking ? "思考中" : "当前回合"}</i>}
    </div>
  );
}
