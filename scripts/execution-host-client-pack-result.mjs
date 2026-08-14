/**
 * Normalize the single-package JSON envelopes emitted by npm 10 (array) and
 * npm 12 (object keyed by package name), rejecting ambiguous results.
 */
export function parseNpmPackResult(stdout, expectedPackageName) {
  const parsed = parseJson(stdout);
  const packed = Array.isArray(parsed)
    ? readArrayResult(parsed)
    : readObjectResult(parsed, expectedPackageName);

  if (!isRecord(packed)) {
    throw new Error('npm pack --json returned a non-object package result.');
  }
  if (packed.name !== expectedPackageName) {
    throw new Error(
      `npm pack --json returned ${String(packed.name)} instead of ${expectedPackageName}.`,
    );
  }

  return packed;
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new Error('npm pack --json did not return valid JSON.', { cause });
  }
}

function readArrayResult(results) {
  if (results.length !== 1) {
    throw new Error(
      `npm pack --json returned ${results.length} package results; expected exactly one.`,
    );
  }

  return results[0];
}

function readObjectResult(result, expectedPackageName) {
  if (!isRecord(result)) {
    throw new Error(
      'npm pack --json returned neither an array nor a package-keyed object.',
    );
  }

  const entries = Object.entries(result);
  if (entries.length !== 1) {
    throw new Error(
      `npm pack --json returned ${entries.length} package results; expected exactly one.`,
    );
  }

  const [[packageName, packed]] = entries;
  if (packageName !== expectedPackageName) {
    throw new Error(
      `npm pack --json keyed its result as ${packageName} instead of ${expectedPackageName}.`,
    );
  }

  return packed;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
