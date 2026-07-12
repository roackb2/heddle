import { BotIcon } from 'lucide-react';
import type { HostedAgentExampleConfiguration } from './configuration.js';
import { HostedAgentUiClient } from './hosted-agent-ui-client.js';
import { useHostedConversation } from './use-hosted-conversation.js';
import { ActivityPanel } from './components/ActivityPanel.js';
import { ConversationComposer } from './components/ConversationComposer.js';
import { ConversationView } from './components/ConversationView.js';
import { ResetConversationButton } from './components/ResetConversationButton.js';

type AppProps = {
  client?: HostedAgentUiClient;
  configuration: HostedAgentExampleConfiguration;
};

export function App({ client, configuration }: AppProps) {
  if (!client) {
    return <ConfigurationRequired />;
  }
  return (
    <ConfiguredApp
      client={client}
      configuration={configuration}
    />
  );
}

type ConfiguredAppProps = {
  client: HostedAgentUiClient;
  configuration: HostedAgentExampleConfiguration;
};

function ConfiguredApp({ client, configuration }: ConfiguredAppProps) {
  const conversation = useHostedConversation(client, configuration.sessionId);
  const status = resolveStatus(conversation);

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900">
              <BotIcon aria-hidden="true" className="size-5 text-sky-400" />
            </span>
            <div className="min-w-0">
              <h1 className="text-balance text-lg font-semibold">Hosted Heddle agent</h1>
              <p className="truncate font-mono text-xs text-slate-500" title={configuration.sessionId}>
                {configuration.sessionId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-live="polite"
              className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300"
            >
              {status}
            </span>
            <ResetConversationButton
              disabled={
                conversation.isLoading
                || conversation.isRunning
                || conversation.isResetting
              }
              isResetting={conversation.isResetting}
              onReset={conversation.reset}
            />
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-h-[32rem] min-w-0 flex-col gap-4">
            <ConversationView
              conversation={conversation.conversation}
              isLoading={conversation.isLoading}
              liveAssistantText={conversation.liveAssistantText}
            />
            <ConversationComposer
              disabled={conversation.isLoading}
              error={conversation.error}
              isRunning={conversation.isRunning}
              isStarting={conversation.isStarting}
              isStopping={conversation.isStopping}
              onRetryConnection={conversation.retryConnection}
              onStop={conversation.stop}
              onSubmit={conversation.submit}
              recoveryWarning={
                conversation.recoveryWarning
                ?? (!configuration.sessionPersistenceAvailable
                  ? 'Conversation identity will not survive a browser reload because storage is unavailable.'
                  : undefined)
              }
            />
          </div>
          <ActivityPanel
            activities={conversation.activities}
            isRunning={conversation.isRunning}
          />
        </section>

        <footer className="mt-6 border-t border-slate-800 pt-4 text-pretty text-xs text-slate-500">
          Heddle owns conversation and run semantics. This host owns identity, public fields,
          HTTP policy, reconnect UX, and rendering.
        </footer>
      </div>
    </main>
  );
}

function ConfigurationRequired() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-100">
      <section className="w-full max-w-xl rounded-lg border border-amber-900 bg-slate-950 p-6" role="alert">
        <h1 className="text-balance text-lg font-semibold">Example bearer token required</h1>
        <p className="mt-2 text-pretty text-sm text-slate-400">
          Set <code className="font-mono text-amber-300">VITE_HEDDLE_EXAMPLE_BEARER_TOKEN</code>
          {' '}to the same local demo token used by the stage-02 server, then restart Vite.
        </p>
        <p className="mt-4 text-pretty text-xs text-slate-500">
          This build-time token is only for the server&apos;s non-production local demo adapter.
          Production browser authentication belongs to the host application.
        </p>
      </section>
    </main>
  );
}

function resolveStatus(conversation: ReturnType<typeof useHostedConversation>): string {
  if (conversation.isLoading) {
    return 'Connecting';
  }
  if (conversation.isStarting) {
    return 'Starting';
  }
  if (conversation.isStopping) {
    return 'Stopping';
  }
  if (conversation.isRunning) {
    return 'Running';
  }
  if (conversation.error) {
    return 'Needs attention';
  }
  return 'Ready';
}
