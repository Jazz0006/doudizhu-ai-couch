import type { Difficulty } from "@ai-doudizhu/bot-engine";

interface DifficultySelectorProps {
  readonly value: Difficulty;
  readonly disabled: boolean;
  readonly onChange: (difficulty: Difficulty) => void;
}

export function DifficultySelector({
  value,
  disabled,
  onChange,
}: DifficultySelectorProps) {
  return (
    <label className="difficulty-selector">
      <span>对手</span>
      <select
        aria-label="对手难度"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Difficulty)}
      >
        <option value="easy">简单</option>
        <option value="medium">中等</option>
        <option value="hard">困难</option>
      </select>
    </label>
  );
}
