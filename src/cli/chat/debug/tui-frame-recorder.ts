import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TUI_SNAPSHOT_DIR = 'debug/tui-snapshots';
const MAX_CAPTURE_CHARS = 200_000;
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g',
);

export type SavedTuiSnapshot = {
  capturedAt: string;
  txtPath: string;
  ansiPath: string;
  jsonPath: string;
};

export type TuiSnapshotMetadata = {
  sessionId?: string;
  model?: string;
  status?: string;
  terminalColumns?: number;
  terminalRows?: number;
  textSnapshot?: string;
};

export type TuiFrameRecorder = {
  record: (chunk: string) => void;
  saveSnapshot: (metadata?: TuiSnapshotMetadata) => SavedTuiSnapshot;
};

export function createTuiFrameRecorder(stateRoot: string): TuiFrameRecorder {
  let latestChunk = '';
  let streamTail = '';

  return {
    record(chunk) {
      if (!chunk) {
        return;
      }

      latestChunk = chunk;
      streamTail = truncateTail(`${streamTail}${chunk}`);
    },
    saveSnapshot(metadata = {}) {
      const capturedAt = new Date().toISOString();
      const outputDir = join(stateRoot, TUI_SNAPSHOT_DIR);
      mkdirSync(outputDir, { recursive: true });

      const basename = capturedAt.replaceAll(':', '-');
      const bestCapture = selectBestCapture(latestChunk, streamTail);
      const ansiOutput = bestCapture.ansiOutput;
      const textOutput = normalizeTerminalText(metadata.textSnapshot ?? bestCapture.textOutput);
      const txtPath = join(outputDir, `${basename}.txt`);
      const ansiPath = join(outputDir, `${basename}.ansi`);
      const jsonPath = join(outputDir, `${basename}.json`);

      writeFileSync(txtPath, textOutput.endsWith('\n') ? textOutput : `${textOutput}\n`, 'utf8');
      writeFileSync(ansiPath, ansiOutput, 'utf8');
      writeFileSync(jsonPath, `${JSON.stringify({
        capturedAt,
        txtPath,
        ansiPath,
        latestChunkLength: latestChunk.length,
        streamTailLength: streamTail.length,
        ...metadata,
        textSnapshot: undefined,
      }, null, 2)}\n`, 'utf8');

      return {
        capturedAt,
        txtPath,
        ansiPath,
        jsonPath,
      };
    },
  };
}

function truncateTail(value: string): string {
  return value.length <= MAX_CAPTURE_CHARS ? value : value.slice(-MAX_CAPTURE_CHARS);
}

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_PATTERN, '');
}

function normalizeTerminalText(value: string): string {
  return value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\u0007', '')
    .replaceAll('\u001B]8;;', '')
    .trimEnd();
}

function selectBestCapture(
  latestChunk: string,
  streamTail: string,
): { ansiOutput: string; textOutput: string } {
  const latestText = normalizeTerminalText(stripAnsi(latestChunk));
  if (latestText.length > 0) {
    return {
      ansiOutput: latestChunk,
      textOutput: latestText,
    };
  }

  return {
    ansiOutput: streamTail || latestChunk,
    textOutput: normalizeTerminalText(stripAnsi(streamTail || latestChunk)),
  };
}
