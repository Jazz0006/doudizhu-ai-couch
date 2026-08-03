import type { PlayerVisibleGameState } from "@ai-doudizhu/coach-protocol";
import {
  DEFAULT_COACH_STYLE,
  parseCoachStyle,
  type CoachStyle,
} from "@ai-doudizhu/coach-protocol";
import { useEffect, useState } from "react";

import { useVoiceAudioSession } from "../audio/useVoiceAudioSession";
import type { CoachHighlight } from "../audio/useVoiceAudioSession";

export interface VoiceControlProps {
  readonly gameState?: PlayerVisibleGameState;
  readonly onHighlightChange?: (highlight: CoachHighlight | undefined) => void;
}

export function VoiceControl({
  gameState,
  onHighlightChange,
}: VoiceControlProps = {}) {
  const [coachStyle, setCoachStyle] = useState<CoachStyle>(loadCoachStyle);
  const { snapshot, start, stop, playTestTone, stopPlayback } =
    useVoiceAudioSession(gameState, onHighlightChange, coachStyle);
  const active = snapshot.phase === "listening";
  const busy = snapshot.phase === "connecting" || snapshot.phase === "stopping";

  useEffect(() => {
    try {
      window.localStorage.setItem("ai-doudizhu-coach-style", coachStyle);
    } catch {
      // The active session still keeps the selected style if storage is blocked.
    }
  }, [coachStyle]);

  return (
    <section className={`voice-control voice-control-${snapshot.phase}`}>
      <div className="voice-status" aria-live="polite">
        <span className="voice-status-dot" aria-hidden="true" />
        <div>
          <strong>{voiceTitle(snapshot.phase)}</strong>
          <span>{snapshot.message}</span>
          {active && (
            <small>
              后端已确认 {snapshot.acknowledgedSeconds.toFixed(1)} 秒
              {snapshot.droppedFrames > 0
                ? ` · 丢弃 ${snapshot.droppedFrames} 帧`
                : ""}
            </small>
          )}
        </div>
      </div>

      <div className="voice-actions">
        <label className="difficulty-selector">
          <span>教练</span>
          <select
            aria-label="教练性格"
            value={coachStyle}
            disabled={busy}
            onChange={(event) =>
              setCoachStyle(event.target.value as CoachStyle)
            }
          >
            <option value="direct">直接型</option>
            <option value="warm">陪练型</option>
            <option value="analytical">分析型</option>
          </select>
        </label>
        {active ? (
          <button
            className="voice-stop-button"
            onClick={() => void stop()}
            type="button"
          >
            停止语音
          </button>
        ) : (
          <button
            className="voice-start-button"
            disabled={busy}
            onClick={() => void start()}
            type="button"
          >
            {snapshot.phase === "connecting" ? "连接中…" : "开启语音"}
          </button>
        )}
        <button disabled={!active} onClick={playTestTone} type="button">
          测试声音
        </button>
        <button disabled={!active} onClick={stopPlayback} type="button">
          {snapshot.ttsPlaying ? "停止语音" : "打断回答"}
        </button>
      </div>

      {(snapshot.transcripts.length > 0 || snapshot.partialTranscript) && (
        <div className="voice-transcript" aria-live="polite">
          <span className="voice-transcript-label">本地转写</span>
          {snapshot.transcripts.map((transcript, index) => (
            <p key={`${index}-${transcript}`}>{transcript}</p>
          ))}
          {snapshot.partialTranscript && (
            <p className="voice-transcript-partial">
              {snapshot.partialTranscript}
            </p>
          )}
        </div>
      )}

      {(snapshot.coachResponses.length > 0 ||
        snapshot.partialCoachResponse) && (
        <div className="voice-transcript coach-response" aria-live="polite">
          <span className="voice-transcript-label">本地教练</span>
          {snapshot.coachResponses.map((response, index) => (
            <p key={`${index}-${response}`}>{response}</p>
          ))}
          {snapshot.partialCoachResponse && (
            <p className="voice-transcript-partial">
              {snapshot.partialCoachResponse}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function voiceTitle(phase: string): string {
  if (phase === "connecting") return "正在连接本地语音";
  if (phase === "listening") return "本地音频通道已连接";
  if (phase === "stopping") return "正在停止";
  if (phase === "error") return "语音连接需要处理";
  return "完整本地语音";
}

function loadCoachStyle(): CoachStyle {
  if (typeof window === "undefined") return DEFAULT_COACH_STYLE;
  try {
    return (
      parseCoachStyle(window.localStorage.getItem("ai-doudizhu-coach-style")) ??
      DEFAULT_COACH_STYLE
    );
  } catch {
    return DEFAULT_COACH_STYLE;
  }
}
