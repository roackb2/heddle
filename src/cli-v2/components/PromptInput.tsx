import type { Dispatch, SetStateAction } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptActivityView } from '../services/activities/prompt-activity-service.js';

export function PromptInput({
  activity,
  disabled,
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  activity?: PromptActivityView;
  disabled: boolean;
  placeholder: string;
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  onSubmit: (value: string) => void;
}) {
  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.return) {
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
      {activity ? <Text color={activity.color}>{activity.text}</Text> : null}
      <Box>
        <Text color="cyan">› </Text>
        <Text>{value || <Text dimColor>{placeholder}</Text>}</Text>
      </Box>
    </Box>
  );
}
