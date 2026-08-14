import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  executionHostConversationPostgresMigrationSqlUrls,
} from './migrations.js';

it('ships one ordered lifecycle migration without runtime execution', async () => {
  expect(executionHostConversationPostgresMigrationSqlUrls).toHaveLength(1);
  const sql = await readFile(
    executionHostConversationPostgresMigrationSqlUrls[0]!,
    'utf8',
  );
  expect(sql).toContain('execution_host_conversation_turns');
  expect(sql).toContain('execution_host_conversation_turns_state_shape_valid');
  expect(sql).not.toContain('CREATE DATABASE');
});
