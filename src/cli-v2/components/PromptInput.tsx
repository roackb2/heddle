import { Box, Text, useInput } from 'ink';

export function PromptInput({
  value,
  disabled,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
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
      onChange(value.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      onChange(`${value}${input}`);
    }
  }, { isActive: !disabled });

  return (
    <Box>
      <Text color="cyan">› </Text>
      <Text>{value || <Text dimColor>{placeholder}</Text>}</Text>
    </Box>
  );
}
