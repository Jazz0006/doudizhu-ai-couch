import type {
  CoachGameContextUpdate,
  HighlightInstruction,
} from "@ai-doudizhu/coach-protocol";

export type CoachTextEvent =
  | { readonly type: "coach.response.started"; readonly generationId: number }
  | {
      readonly type: "coach.tool.called";
      readonly generationId: number;
      readonly name:
        | "get_current_visible_state"
        | "get_legal_actions"
        | "analyze_selected_cards"
        | "highlight_cards";
    }
  | {
      readonly type: "coach.highlight";
      readonly generationId: number;
      readonly instruction: HighlightInstruction;
    }
  | {
      readonly type: "coach.highlight.clear";
      readonly generationId: number;
    }
  | {
      readonly type: "coach.response.delta";
      readonly generationId: number;
      readonly delta: string;
    }
  | {
      readonly type: "coach.response.completed";
      readonly generationId: number;
      readonly text: string;
    }
  | {
      readonly type: "coach.error";
      readonly generationId: number;
      readonly code: string;
      readonly message: string;
      readonly recoverable: boolean;
    };

export interface CoachTextService {
  warmup(): Promise<void>;
  updateGameContext(sessionId: string, update: CoachGameContextUpdate): void;
  respond(
    sessionId: string,
    generationId: number,
    userText: string,
    onEvent: (event: CoachTextEvent) => void,
  ): Promise<void>;
  cancel(sessionId: string): void;
  remove(sessionId: string): void;
  close(): Promise<void>;
}

export function createUnavailableCoachTextService(
  message: string,
): CoachTextService {
  return {
    async warmup() {},
    updateGameContext() {},
    async respond(_sessionId, generationId, _userText, onEvent) {
      onEvent({
        type: "coach.error",
        generationId,
        code: "COACH_UNAVAILABLE",
        message,
        recoverable: false,
      });
    },
    cancel() {},
    remove() {},
    async close() {},
  };
}
