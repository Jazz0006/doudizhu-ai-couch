import type {
  CoachGameContextUpdate,
  CoachStyle,
  HighlightInstruction,
} from "@ai-doudizhu/coach-protocol";

export type CoachTextEvent =
  | {
      readonly type: "coach.response.started";
      readonly generationId: number;
      readonly context?: CoachResponseContext;
    }
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
      readonly context?: CoachResponseContext;
    }
  | {
      readonly type: "coach.error";
      readonly generationId: number;
      readonly code: string;
      readonly message: string;
      readonly recoverable: boolean;
    };

export interface CoachResponseContext {
  readonly gameId: string;
  readonly revision: number;
  readonly actionIndex: number;
  readonly stateChecksum: string;
}

export type CoachContextUpdateResult =
  | {
      readonly status: "accepted" | "idempotent";
      readonly gameId: string;
      readonly revision: number;
      readonly actionIndex: number;
      readonly stateChecksum: string;
    }
  | {
      readonly status: "stale" | "conflict";
      readonly gameId: string;
      readonly revision: number;
      readonly stateChecksum: string;
    };

export interface CoachTextService {
  warmup(): Promise<void>;
  updateStyle(sessionId: string, style: CoachStyle): void;
  updateGameContext(
    sessionId: string,
    update: CoachGameContextUpdate,
  ): CoachContextUpdateResult;
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
    updateStyle() {},
    updateGameContext(_sessionId, update) {
      return {
        status: "accepted",
        gameId: update.state.gameId,
        revision: update.revision,
        actionIndex: update.actionIndex,
        stateChecksum: update.stateChecksum,
      };
    },
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
