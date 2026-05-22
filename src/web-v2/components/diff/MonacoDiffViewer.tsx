import { useEffect, useMemo, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { ControlPlaneWorkspaceFileDiff } from '@web/api/client';

type ReviewDiffFile = NonNullable<ControlPlaneWorkspaceFileDiff['diff']>;

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker?: (_workerId: string, label: string) => Worker;
  };
  __heddleMonacoCancelHandlerInstalled?: boolean;
  __heddleV2DiffThemeDefined?: boolean;
};

type DiffLineView = {
  content: string;
  lineNumber: string;
  type: 'added' | 'deleted' | 'context' | 'separator';
};

const monacoGlobal = globalThis as MonacoGlobal;
if (!monacoGlobal.MonacoEnvironment?.getWorker) {
  monacoGlobal.MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };
}

if (typeof window !== 'undefined' && !monacoGlobal.__heddleMonacoCancelHandlerInstalled) {
  monacoGlobal.__heddleMonacoCancelHandlerInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: unknown; message?: unknown } | undefined;
    if (reason?.name === 'Canceled' || reason?.message === 'Canceled') {
      event.preventDefault();
    }
  }, { capture: true });
}

export function MonacoDiffViewer({ diff }: { diff: ReviewDiffFile }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const model = useMemo(() => buildDiffModel(diff), [diff]);
  const height = Math.min(520, Math.max(160, model.lines.length * 20 + 24));

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    defineDiffTheme();

    if (!editorRef.current) {
      editorRef.current = monaco.editor.create(node, {
        automaticLayout: true,
        contextmenu: false,
        fixedOverflowWidgets: true,
        folding: false,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        glyphMargin: false,
        guides: {
          indentation: false,
        },
        lineDecorationsWidth: 8,
        lineNumbers: (lineNumber) => model.lines[lineNumber - 1]?.lineNumber ?? '',
        lineNumbersMinChars: 4,
        minimap: {
          enabled: false,
        },
        overviewRulerLanes: 0,
        padding: {
          top: 0,
          bottom: 0,
        },
        readOnly: true,
        renderLineHighlight: 'none',
        scrollbar: {
          alwaysConsumeMouseWheel: false,
          horizontal: 'auto',
          vertical: 'hidden',
          verticalScrollbarSize: 0,
        },
        scrollBeyondLastLine: false,
        theme: 'heddle-v2-diff',
        wordWrap: 'off',
      });
    }
  }, [model.lines]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    modelRef.current?.dispose();
    const nextModel = monaco.editor.createModel(model.text, model.language);
    modelRef.current = nextModel;
    editor.setModel(nextModel);
    editor.updateOptions({
      lineNumbers: (lineNumber) => model.lines[lineNumber - 1]?.lineNumber ?? '',
    });
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(buildLineDecorations(model.lines));

    return () => {
      if (editorRef.current?.getModel() === nextModel) {
        editorRef.current.setModel(null);
      }
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      nextModel.dispose();
      if (modelRef.current === nextModel) {
        modelRef.current = null;
      }
    };
  }, [model]);

  useEffect(() => () => {
    decorationsRef.current?.clear();
    editorRef.current?.setModel(null);
    editorRef.current?.dispose();
    editorRef.current = null;
    modelRef.current?.dispose();
    modelRef.current = null;
  }, []);

  return (
    <div className="v2-monaco-diff-viewer" data-testid="web-v2-monaco-diff-viewer">
      <div ref={containerRef} className="v2-monaco-diff-viewer-editor" style={{ height }} />
    </div>
  );
}

function defineDiffTheme() {
  if (monacoGlobal.__heddleV2DiffThemeDefined) {
    return;
  }

  monacoGlobal.__heddleV2DiffThemeDefined = true;
  monaco.editor.defineTheme('heddle-v2-diff', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#181922',
      'editor.foreground': '#d9dbe7',
      'editorLineNumber.foreground': '#9ca0b4',
      'editorLineNumber.activeForeground': '#d9dbe7',
      'editor.selectionBackground': '#3a3d4f',
    },
  });
}

function buildLineDecorations(lines: DiffLineView[]): monaco.editor.IModelDeltaDecoration[] {
  return lines.flatMap((line, index) => {
    const lineNumber = index + 1;
    const range = new monaco.Range(lineNumber, 1, lineNumber, 1);
    const classNames = {
      added: ['v2-monaco-diff-line-added', 'v2-monaco-diff-gutter-added'],
      deleted: ['v2-monaco-diff-line-deleted', 'v2-monaco-diff-gutter-deleted'],
      context: ['', ''],
      separator: ['v2-monaco-diff-line-separator', 'v2-monaco-diff-gutter-separator'],
    }[line.type];

    if (!classNames[0] && !classNames[1]) {
      return [];
    }

    return [{
      range,
      options: {
        className: classNames[0],
        isWholeLine: true,
        lineNumberClassName: classNames[1],
      },
    }];
  });
}

function buildDiffModel(diff: ReviewDiffFile): {
  text: string;
  language: string;
  lines: DiffLineView[];
} {
  let previousNewLine = 0;
  const lines = diff.hunks.flatMap((hunk): DiffLineView[] => {
    const separator = buildHunkSeparator(hunk.header, previousNewLine);
    previousNewLine = hunk.lines.reduce((lineNumber, line) => (
      Math.max(lineNumber, line.newLineNumber ?? line.oldLineNumber ?? lineNumber)
    ), previousNewLine);

    return [
      ...(separator ? [separator] : []),
      ...hunk.lines.map((line): DiffLineView => ({
        content: stripUnifiedDiffPrefix(line.content, line.type),
        lineNumber: formatDiffLineNumber(line),
        type: line.type === 'unknown' ? 'context' : line.type,
      })),
    ];
  });

  return {
    text: lines.map((line) => line.content).join('\n'),
    language: languageForPath(diff.path),
    lines,
  };
}

function buildHunkSeparator(header: string, previousNewLine: number): DiffLineView | undefined {
  const match = /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/.exec(header);
  const lineNumber = Number(match?.groups?.newStart ?? match?.groups?.oldStart);
  const hiddenLineCount = lineNumber - previousNewLine - 1;
  if (!Number.isFinite(lineNumber) || hiddenLineCount <= 0) {
    return undefined;
  }

  return {
    content: `${hiddenLineCount} unmodified lines`,
    lineNumber: '',
    type: 'separator',
  };
}

function formatDiffLineNumber(line: ReviewDiffFile['hunks'][number]['lines'][number]): string {
  const lineNumber = line.type === 'deleted'
    ? line.oldLineNumber
    : line.newLineNumber ?? line.oldLineNumber;
  return typeof lineNumber === 'number' ? String(lineNumber) : '';
}

function stripUnifiedDiffPrefix(content: string, type: 'context' | 'added' | 'deleted' | 'unknown'): string {
  if ((type === 'added' && content.startsWith('+')) || (type === 'deleted' && content.startsWith('-'))) {
    return content.slice(1);
  }
  if (type === 'context' && content.startsWith(' ')) {
    return content.slice(1);
  }
  return content;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'shell',
  cjs: 'javascript',
  css: 'css',
  cts: 'typescript',
  go: 'go',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  sass: 'scss',
  scss: 'scss',
  sh: 'shell',
  svelte: 'html',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
};

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}
