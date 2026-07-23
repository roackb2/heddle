/**
 * Stage 01: the smallest structured, persisted conversation agent.
 *
 * Prerequisite: a configured Heddle model credential.
 * Assumption: agent execution happens in this TypeScript process; the host
 * still owns any UI, transport, authentication, and product transactions.
 * Run: yarn example:sdk:headless "What does this project do?"
 */
import { ConversationAgentService } from '../../src/index.js';

const agent = new ConversationAgentService();
try {
  const result = await agent.send({
    prompt: process.argv.slice(2).join(' ').trim() || 'What does this project do?',
  });

  console.log({
    activityTypes: result.activities.map((activity) => activity.type),
    outcome: result.outcome,
    sessionId: result.session.id,
    summary: result.summary,
  });
} finally {
  await agent.close();
}
