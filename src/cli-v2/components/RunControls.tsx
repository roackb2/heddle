import { Box, Text, useInput } from 'ink';

type RunControlsProps = {
  running: boolean;
  cancelling: boolean;
  keyboardDisabled?: boolean;
  onCancel: () => void;
};

export function RunControls({ running, cancelling, keyboardDisabled = false, onCancel }: RunControlsProps) {
  useInput((_input, key) => {
    if (!running || cancelling || !key.escape) {
      return;
    }

    onCancel();
  }, { isActive: running && !cancelling && !keyboardDisabled });

  if (running || cancelling) {
    return (
      <Box marginTop={1}>
        <Text color="yellow">
          {cancelling ? 'Stop requested...' : 'Run active · Esc to stop'}
        </Text>
      </Box>
    );
  }

  return null;
}
