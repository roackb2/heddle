export function createMemoryNoteTemplate(options: {
  title: string;
  summary: string;
  confidence?: string;
  sourceRefs?: string[];
  now?: Date;
}): string {
  const updatedAt = (options.now ?? new Date()).toISOString();
  const sourceRefs = options.sourceRefs && options.sourceRefs.length > 0 ? options.sourceRefs : undefined;
  return [
    '---',
    `title: ${quoteYaml(options.title)}`,
    `updated: ${quoteYaml(updatedAt)}`,
    options.confidence ? `confidence: ${quoteYaml(options.confidence)}` : undefined,
    sourceRefs ? 'sourceRefs:' : undefined,
    ...(sourceRefs?.map((sourceRef) => `  - ${quoteYaml(sourceRef)}`) ?? []),
    '---',
    '',
    `# ${options.title}`,
    '',
    options.summary,
    '',
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function slugifyMemoryTitle(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'memory-note';
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
