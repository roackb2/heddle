#!/usr/bin/env node

import { execSync } from 'node:child_process';
import process from 'node:process';

function git(args) {
  return execSync(`git ${args}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

function latestTag() {
  return tryGit('describe --tags --abbrev=0');
}

function resolveRange() {
  const fromRef = process.argv[2] || latestTag();
  const toRef = process.argv[3] || 'HEAD';

  if (!fromRef) {
    process.stderr.write('No previous git tag was found. Pass an explicit base ref, for example: node scripts/release-context.mjs <base-ref> HEAD\n');
    process.exit(1);
  }

  return { fromRef, toRef };
}

function commitSubjects(fromRef, toRef) {
  const raw = git(`log --oneline ${fromRef}..${toRef}`);
  return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

function diffStat(fromRef, toRef) {
  return git(`diff --stat ${fromRef}..${toRef}`);
}

function main() {
  const { fromRef, toRef } = resolveRange();
  const commits = commitSubjects(fromRef, toRef);
  const stat = diffStat(fromRef, toRef);

  process.stdout.write(`# Release Context\n\n`);
  process.stdout.write(`- From: ${fromRef}\n`);
  process.stdout.write(`- To: ${toRef}\n`);
  process.stdout.write(`- Commits: ${commits.length}\n\n`);

  process.stdout.write(`## Commit Subjects\n\n`);
  for (const commit of commits) {
    process.stdout.write(`- ${commit}\n`);
  }

  process.stdout.write(`\n## Diff Stat\n\n`);
  process.stdout.write('```text\n');
  process.stdout.write(`${stat}\n`);
  process.stdout.write('```\n');
}

main();
