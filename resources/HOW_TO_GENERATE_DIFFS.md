---
name: act-code-patcher-diff-skill
title: ACT Build Controller — Code Patcher Diff Generation Skill
version: 1.0.0
target: LLM coding assistant
application: ACT Build Controller — Code Patcher Tab
---

# Skill: ACT Code Patcher — Diff Generation Protocol

## [CONTEXT]
You are operating inside a development workflow that uses the **ACT Build Controller** desktop application. This app has a **Code Patcher** tab that accepts unified diffs via clipboard and applies them atomically to the local codebase.

Your job is to produce diffs that the Code Patcher can parse, validate, and deploy without failure.

The patcher validates every diff against strict rules before accepting it. A diff that fails validation causes a red flash and is silently rejected — nothing is staged, nothing is applied. Produce clean diffs every time.

---

## [WORKFLOW]

```
Developer requests a code change
  → You produce a strict unified diff
  → Developer copies the diff block to clipboard
  → Developer clicks "Load Diff from Clipboard" in the Code Patcher
  → Patcher validates and locks the slot to the target file
  → Developer deploys when ready (per-slot or Deploy All)
  → Patcher applies atomically and streams output to terminal
```

**One diff block = one file.** If a task requires changes to multiple files, produce one diff block per file. The developer will load each into its own slot.

---

## [MAIN_LOGIC: generate_diff]

### **1. IDENTIFY TARGET FILE**
```pseudocode
IDENTIFY(target_file) {
    USE exact relative path from project root;
    // e.g. src/renderer/src/components/Foo.jsx
    // NOT: ./src/..., /absolute/path/..., or just Foo.jsx
}
```

### **2. ANALYZE CHANGE SCOPE**
```pseudocode
IF (change_affects_multiple_files) {
    SPLIT into one diff block per file;
    LABEL each block clearly so developer knows the order;
}
IF (change_is_large) {
    SPLIT into multiple atomic hunks within the same diff;
    Each hunk = one single-concern edit;
}
```

### **3. GENERATE DIFF**
```pseudocode
GENERATE_PATCH(strict_unified_diff_format) {
    ENCLOSURE:      Wrap in ```diff ... ``` markdown fences.
    HEADER_MINUS:   `--- exact/path/to/file.ext`
    HEADER_PLUS:    `+++ exact/path/to/file.ext`
    HUNK_HEADER:    `@@ -start,count +start,count @@`
    CONTEXT:        Exactly 3 lines of unmodified code before AND after each change.
    CONTEXT_PREFIX: Every context line MUST begin with exactly ONE space character.
    REMOVALS:       Prefix with `-` (no space after the dash).
    ADDITIONS:      Prefix with `+` (no space after the plus).
}
```

### **4. AUDIT BEFORE OUTPUT**
```pseudocode
ASSERT(one file path per diff block);
ASSERT(+++ header contains exact relative path);
ASSERT(every hunk header is a valid @@ -N,N +N,N @@ — never a comment);
ASSERT(3 context lines before and after every change);
ASSERT(context lines match the file exactly — whitespace-sensitive);
ASSERT(no trailing content after the last hunk line);
```

---

## [FORMAT SPECIFICATION]

### File Headers
```
--- src/path/to/file.ext
+++ src/path/to/file.ext
```
Both headers must reference the **same file**. The patcher extracts the file path from the `+++` line. Strip any leading `b/` prefix (git-style paths are accepted but the `b/` will be stripped automatically).

### Hunk Headers
```
@@ -originalStart,originalLineCount +newStart,newLineCount @@
```
- `originalStart`: 1-indexed line number in the original file where the hunk begins
- `originalLineCount`: total lines shown from the original (context + removed lines)
- `newStart`: 1-indexed line number in the modified file where the hunk begins
- `newLineCount`: total lines in the new version (context + added lines)

The patcher uses these numbers as a search hint with ±10 line tolerance. **Context matching is the primary anchor** — if your line numbers are slightly off, the context will still find the right location. If your context lines are wrong, the hunk will fail regardless of line numbers.

### Context Lines
- Must be **exactly 3 unmodified lines** before and after each change
- Must match the file content **character-for-character**, including indentation
- Must begin with a single space: `·` (one space, then the code)
- At the start or end of a file where fewer than 3 lines exist, include as many as are available

### New File Creation
To create a file that does not yet exist:
```diff
--- /dev/null
+++ src/path/to/newfile.ext
@@ -0,0 +1,N @@
+line one of new file
+line two of new file
+...
```
The patcher treats non-existent files as empty and will create them on deploy.

---

## [EXAMPLES]

### ✅ CORRECT — Standard edit

```diff
--- src/renderer/src/components/CommandCenter.jsx
+++ src/renderer/src/components/CommandCenter.jsx
@@ -42,7 +42,8 @@
     return (
       <div className="commander-view">
         <h1>Command Center</h1>
-        <div className="commander-targets">
+        <div className="commander-targets" data-count={targets.length}>
           {targets.map((target) => (
             <TargetRow key={target.id} target={target} />
           ))}
```

### ✅ CORRECT — Multi-hunk diff (two changes, one file)

```diff
--- src/main/index.js
+++ src/main/index.js
@@ -18,6 +18,7 @@
 import { join } from 'path'
 import fs from 'fs'
 import { exec } from 'child_process'
+import { createHash } from 'crypto'
 import http from 'http'
 import net from 'net'
 import { electronApp, optimizer, is } from '@electron-toolkit/utils'
@@ -201,6 +202,7 @@
   ipcMain.handle('save-project', async (_, args) => {
     try {
       const data = JSON.parse(fs.readFileSync(args.filePath, 'utf-8'))
+      const hash = createHash('md5').update(JSON.stringify(data)).digest('hex')
       return { success: true, data }
     } catch (error) { return { success: false, error: error.message } }
   })
```

### ✅ CORRECT — New file

```diff
--- /dev/null
+++ src/renderer/src/components/StatusBar.jsx
@@ -0,0 +1,12 @@
+export default function StatusBar({ message, type }) {
+  return (
+    <div className={`status-bar status-bar--${type || 'idle'}`}>
+      <span className="status-bar-msg">{message || 'Ready'}</span>
+    </div>
+  )
+}
```

---

## [ANTI-PATTERNS — WILL CAUSE REJECTION]

### ❌ Comment in hunk header
```diff
@@ // insert below the imports @@
```
**Why it fails:** The patcher's validator requires `@@ -N,N +N,N @@`. A comment fails the regex and the diff is rejected before any slot is staged.

### ❌ Missing context lines
```diff
@@ -42,3 +42,4 @@
-        <div className="commander-targets">
+        <div className="commander-targets" data-count={targets.length}>
```
**Why it fails:** Zero context lines means the hunk engine cannot locate the edit site. It will fail with a context mismatch error.

### ❌ Multiple files in one diff block
```diff
--- src/main/index.js
+++ src/main/index.js
@@ -18,6 +18,7 @@
 ...
--- src/preload/index.js
+++ src/preload/index.js
@@ -5,6 +5,7 @@
 ...
```
**Why it fails:** The patcher extracts a **single** file path from the `+++` line of the entire block. The second file's changes will be treated as malformed hunk content and fail validation.

**Fix:** Produce two separate diff blocks. The developer loads each into its own slot.

### ❌ Wrong prefix spacing on context lines
```diff
@@ -42,7 +42,8 @@
     return (
       <div className="commander-view">   ← missing leading space
```
**Why it fails:** Context lines with no space prefix are parsed as malformed. The hunk engine will fail to match the context.

---

## [SLOT MODEL — WHAT THE DEVELOPER SEES]

Each diff block you produce maps to one **slot** in the Code Patcher. Understanding this helps you structure your output correctly:

- **One slot = one file.** Each slot locks to the file path it first receives.
- **Re-loading the same file** into the same slot merges the new hunks in — useful if you need to provide a correction.
- **Loading a different file** into a locked slot will red-flash and reject — always use a fresh slot for a different file.
- **Deploy All** applies all staged slots atomically. Individual **▶** buttons deploy one slot at a time.
- **Auto-regen** (checkbox, default on) triggers repomix after a successful deploy to update the file matrix.

---

## [CHECKLIST BEFORE OUTPUTTING A DIFF]

- [ ] Wrapped in ` ```diff ``` ` fences
- [ ] `--- path/to/file` header present
- [ ] `+++ path/to/file` header present (same file as `---`)
- [ ] Every hunk has a valid `@@ -N,N +N,N @@` header
- [ ] Exactly 3 context lines before and after every change (or as many as exist at file boundaries)
- [ ] All context lines prefixed with exactly one space
- [ ] All removal lines prefixed with `-`
- [ ] All addition lines prefixed with `+`
- [ ] Only one file per diff block
- [ ] No trailing blank hunks or orphaned headers
