import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export function PromptInput({
  disabled,
  placeholder,
  onSubmit,
}: {
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
    <Box>
      <Text color="cyan">› </Text>
      <Text>{value || <Text dimColor>{placeholder}</Text>}</Text>
    </Box>
  );
}
