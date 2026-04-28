import { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { RouterOutputs } from '../../../lib/api';

type ReviewDiffFile = NonNullable<RouterOutputs['controlPlane']['workspaceFileDiff']['diff']>;

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker?: (_workerId: string, label: string) => Worker;
  };
  __heddleMonacoCancelHandlerInstalled?: boolean;
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
    // Monaco rejects in-flight diff worker jobs with Canceled when the view unmounts.
    if (reason?.name === 'Canceled' || reason?.message === 'Canceled') {
      event.preventDefault();
    }
  }, { capture: true });
}

export default function MonacoDiffViewer({ diff }: { diff: ReviewDiffFile }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const [sideBySide, setSideBySide] = useState(true);

  const model = useMemo(() => buildSnippetModel(diff), [diff]);
  const height = Math.min(620, Math.max(220, model.lineCount * 20 + 48));

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const updateLayoutMode = () => {
      const width = node.getBoundingClientRect().width;
      setSideBySide(width >= 720);
    };

    updateLayoutMode();
    const resizeObserver = new ResizeObserver(updateLayoutMode);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }

      const scrollTarget = findScrollableAncestor(node);
      if (!scrollTarget) {
        return;
      }

      scrollTarget.scrollTop += event.deltaY;
      event.preventDefault();
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    if (!editorRef.current) {
      editorRef.current = monaco.editor.createDiffEditor(node, {
        automaticLayout: true,
        contextmenu: false,
        diffAlgorithm: 'legacy',
        enableSplitViewResizing: true,
        fixedOverflowWidgets: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        glyphMargin: false,
        hideUnchangedRegions: {
          enabled: false,
        },
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 3,
        minimap: {
          enabled: false,
        },
        originalEditable: false,
        readOnly: true,
        renderOverviewRuler: false,
        renderSideBySide: sideBySide,
        scrollBeyondLastLine: false,
        theme: 'vs-dark',
        wordWrap: 'off',
      });
    }

    editorRef.current.updateOptions({
      renderSideBySide: sideBySide,
    });
  }, [sideBySide]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    const original = monaco.editor.createModel(model.originalText, model.language);
    const modified = monaco.editor.createModel(model.modifiedText, model.language);
    originalModelRef.current = original;
    modifiedModelRef.current = modified;
    editor.setModel({ original, modified });

    return () => {
      if (editorRef.current?.getModel()?.original === original) {
        editorRef.current.setModel(null);
      }
      original.dispose();
      modified.dispose();
      if (originalModelRef.current === original) {
        originalModelRef.current = null;
      }
      if (modifiedModelRef.current === modified) {
        modifiedModelRef.current = null;
      }
    };
  }, [model]);

  useEffect(() => () => {
    editorRef.current?.setModel(null);
    editorRef.current?.dispose();
    editorRef.current = null;
    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();
    originalModelRef.current = null;
    modifiedModelRef.current = null;
  }, []);

  return (
    <div className="monaco-diff-viewer" data-testid="monaco-diff-viewer">
      <div className="monaco-diff-viewer-toolbar">
        <span>{model.kind}</span>
        <span>{model.language}</span>
      </div>
      <div
        ref={containerRef}
        className="monaco-diff-viewer-editor"
        style={{ height }}
      />
    </div>
  );
}

function findScrollableAncestor(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function buildSnippetModel(diff: ReviewDiffFile): {
  originalText: string;
  modifiedText: string;
  language: string;
  lineCount: number;
  kind: string;
} {
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  const language = languageForPath(diff.path);

  for (const [index, hunk] of diff.hunks.entries()) {
    if (index > 0) {
      originalLines.push('');
      modifiedLines.push('');
    }
    originalLines.push(formatHunkHeader(hunk.header, language));
    modifiedLines.push(formatHunkHeader(hunk.header, language));

    for (const line of hunk.lines) {
      const content = stripUnifiedDiffPrefix(line.content, line.type);
      if (line.type === 'added') {
        modifiedLines.push(content);
        continue;
      }
      if (line.type === 'deleted') {
        originalLines.push(content);
        continue;
      }
      originalLines.push(content);
      modifiedLines.push(content);
    }
  }

  return {
    originalText: originalLines.join('\n'),
    modifiedText: modifiedLines.join('\n'),
    language,
    lineCount: Math.max(originalLines.length, modifiedLines.length),
    kind: 'Changed hunks',
  };
}

function formatHunkHeader(header: string, language: string): string {
  switch (language) {
    case 'html':
    case 'xml':
    case 'markdown':
      return `<!-- ${header} -->`;
    case 'css':
    case 'scss':
    case 'less':
      return `/* ${header} */`;
    case 'plaintext':
      return `# ${header}`;
    default:
      return `// ${header}`;
  }
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

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
  switch (extension) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'javascript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'css':
      return 'css';
    case 'scss':
    case 'sass':
      return 'scss';
    case 'less':
      return 'less';
    case 'html':
    case 'htm':
    case 'svelte':
    case 'vue':
      return 'html';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'yaml':
    case 'yml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}
