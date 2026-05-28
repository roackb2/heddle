import type { Dispatch, SetStateAction } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { PromptActivityView } from '../services/activities/prompt-activity-service.js';

export function PromptInput({
  activity,
  disabled,
  placeholder,
  submitDisabled,
  value,
  onChange,
  onSubmit,
}: {
  activity?: PromptActivityView;
  disabled: boolean;
  placeholder: string;
  submitDisabled?: boolean;
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  onSubmit: (value: string) => void;
}) {
  const { stdout } = useStdout();
  const separator = repeatSeparator((stdout.columns ?? 0) - 2);

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.return) {
      if (submitDisabled) {
        return;
      }

      onSubmit(value);
      return;
    }

    if (key.backspace || key.delete) {
      onChange((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      onChange((current) => `${current}${input}`);
    }
  }, { isActive: !disabled });

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box overflow="hidden">
        <Text dimColor wrap="truncate-end">{separator}</Text>
      </Box>
      {activity ? <Text color={activity.color}>{activity.text}</Text> : null}
      <Box>
        <Text color="cyan">› </Text>
        <Text>{value || <Text dimColor>{placeholder}</Text>}</Text>
      </Box>
      <Box overflow="hidden">
        <Text dimColor wrap="truncate-end">{separator}</Text>
      </Box>
    </Box>
  );
}

function repeatSeparator(width: number): string {
  return '─'.repeat(Math.max(0, width));
}
