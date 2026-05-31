import type { ControlPlaneSessionRuntimeContext } from '@web/api/client';

type ConversationWelcomePanelProps = {
  welcomeGuide: ControlPlaneSessionRuntimeContext['welcomeGuide'];
};

export function ConversationWelcomePanel({ welcomeGuide }: ConversationWelcomePanelProps) {
  return (
    <section className="v2-conversation-welcome" aria-label="Welcome to Heddle">
      <div className="v2-conversation-welcome-copy">
        <p className="v2-conversation-welcome-kicker">Heddle</p>
        <h2 className="v2-conversation-welcome-title text-balance">
          Ask about this workspace
        </h2>
        <p className="v2-conversation-welcome-body text-pretty">
          Each turn runs the agent with this session&apos;s context and carries the conversation forward.
        </p>
        {!welcomeGuide.hasProviderCredential ? (
          <p className="v2-conversation-welcome-note text-pretty">
            Connect a provider credential before running model-backed turns.
          </p>
        ) : null}
      </div>
    </section>
  );
}
