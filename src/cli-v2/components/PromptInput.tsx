import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type PromptActivity = {
  text: string;
  color: 'blue' | 'green' | 'yellow' | 'red';
};

export function PromptInput({
  activity,
  disabled,
  placeholder,
  onSubmit,
}: {
  activity?: PromptActivity;
  disabled: boolean;
  placeholder: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.return) {
      const submittedValue = value;
      setValue('');
      onSubmit(submittedValue);
      return;
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue((current) => `${current}${input}`);
    }
  }, { isActive: !disabled });

  return (
    <Box flexDirection="column">
      {activity ? <Text color={activity.color}>{activity.text}</Text> : null}
      <Box>
        <Text color="cyan">› </Text>
        <Text>{value || <Text dimColor>{placeholder}</Text>}</Text>
      </Box>
    </Box>
  );
}
