import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { evalCaseSchema, type EvalCase } from './schema.js';

export function loadEvalCases(args: {
  casesDir: string;
  ids?: string[];
}): EvalCase[] {
  const selectedIds = new Set(args.ids?.filter(Boolean));
  const files = listCaseFiles(resolve(args.casesDir));
  const cases = files.map((file) => loadEvalCase(file));
  const filtered = selectedIds.size > 0 ? cases.filter((testCase) => selectedIds.has(testCase.id)) : cases;
  const missing = [...selectedIds].filter((id) => !filtered.some((testCase) => testCase.id === id));
  if (missing.length > 0) {
    throw new Error(`Eval case not found: ${missing.join(', ')}`);
  }
  return filtered.sort((left, right) => left.id.localeCompare(right.id));
}

export function loadEvalCase(path: string): EvalCase {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const result = evalCaseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid eval case ${path}: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return result.data;
}

function listCaseFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listCaseFiles(path);
    }
    return extname(path) === '.json' ? [path] : [];
  });
}
