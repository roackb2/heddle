import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState, PendingSessionApproval } from '../../../../lib/api';

export type SessionDetailValue = Exclude<ChatSessionDetail, null>;
export type SessionTurn = SessionDetailValue['turns'][number];

export type SessionsScreenState = {
  activeSession?: ControlPlaneState['sessions'][number];
  selectedSessionId?: string;
  setSelectedSessionId: (sessionId: string) => void;
  sessionDetail: ChatSessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError?: string;
  sendingPrompt: boolean;
  runInFlight: boolean;
  memoryUpdating: boolean;
  sendPromptError?: string;
  sendPrompt: (prompt: string) => Promise<void>;
  creatingSession: boolean;
  sessionNotice?: string;
  createSession: () => Promise<void>;
  continueSession: () => Promise<void>;
  cancelSessionRun: () => Promise<void>;
  updateSessionSettings: (settings: { model?: string; driftEnabled?: boolean }) => Promise<void>;
  pendingApproval: PendingSessionApproval;
  resolveApproval: (approved: boolean) => Promise<void>;
  selectedTurnId?: string;
  setSelectedTurnId: (turnId: string) => void;
  selectedTurn?: SessionTurn;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
};
