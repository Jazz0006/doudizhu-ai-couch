import { useVoiceAudioSession } from "../audio/useVoiceAudioSession";

export function VoiceControl() {
  const { snapshot, start, stop, playTestTone, stopPlayback } =
    useVoiceAudioSession();
  const active = snapshot.phase === "listening";
  const busy = snapshot.phase === "connecting" || snapshot.phase === "stopping";

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
          停止播放
        </button>
      </div>
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
