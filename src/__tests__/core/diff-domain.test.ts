import { describe, expect, it } from 'vitest';
import { parseUnifiedDiffFiles } from '../../core/review/diff-domain.js';

describe('diff domain parser', () => {
  it('parses a modified file patch into hunks and line counts', () => {
    const files = parseUnifiedDiffFiles(`diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
`);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'src/a.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(files[0]?.hunks[0]?.lines.map((line) => line.type)).toEqual([
      'context',
      'deleted',
      'added',
      'added',
    ]);
  });

  it('parses add, delete, and rename metadata', () => {
    const files = parseUnifiedDiffFiles(`diff --git a/new.md b/new.md
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.md
@@ -0,0 +1 @@
+new
diff --git a/old.md b/old.md
deleted file mode 100644
index 1111111..0000000
--- a/old.md
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git a/before.md b/after.md
similarity index 100%
rename from before.md
rename to after.md
`);

    expect(files.map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
    }))).toEqual([
      { path: 'new.md', oldPath: undefined, status: 'added' },
      { path: 'old.md', oldPath: undefined, status: 'deleted' },
      { path: 'after.md', oldPath: 'before.md', status: 'renamed' },
    ]);
  });

  it('parses binary patches without hunks', () => {
    const files = parseUnifiedDiffFiles(`diff --git a/image.png b/image.png
index 1111111..2222222 100644
Binary files a/image.png and b/image.png differ
`);

    expect(files).toEqual([expect.objectContaining({
      path: 'image.png',
      status: 'modified',
      binary: true,
      hunks: [],
    })]);
  });
});
