/**
 * Stage 01: the smallest persisted conversational agent.
 *
 * Prerequisite: a configured Heddle model credential.
 * Assumption: Heddle may own the local prompt loop and plain-text output.
 * Shows: the default SDK experience before the host customizes capabilities,
 * presentation, lifecycle, transport, or storage.
 * Run: yarn example:sdk:interactive
 */
import { runQuickstartConversationCli } from '../../src/index.js';

await runQuickstartConversationCli();
