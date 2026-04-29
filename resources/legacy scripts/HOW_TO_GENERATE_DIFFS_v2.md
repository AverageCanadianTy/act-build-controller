---
name: act-code-patcher-diff-skill
title: ACT Build Controller — Code Patcher Diff Generation Skill
version: 2.0.0
target: LLM coding assistant
application: ACT Build Controller — Code Patcher Tab
---

# Skill: ACT Code Patcher — Diff Generation Protocol

## [CONTEXT]
You are operating inside a development workflow that uses the **ACT Build Controller** desktop application. This app has a **Code Patcher** tab that accepts unified diffs via clipboard and applies them atomically to the local codebase.

The patcher uses a **two-tier fuzzy matching engine** to locate and apply hunks:
- **Tier 1:** Full context fuzzy match (before + after context lines combined)
- **Tier 2:** Deletion-only anchor (if Tier 1 finds nothing)

If neither tier finds a unique match the hunk is rejected. Your job is to produce diffs that land on the first attempt. The rules below are not stylistic — they are derived directly from real failure patterns.

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

**One diff block = one file.** If a task requires changes to multiple files, produce one diff block per file. The developer loads each into its own slot.

---

## [THE FILE MATRIX]

You will be provided with a repomix XML file matrix as your source of truth. Every file in the codebase is represented as:

```xml
<file path="src/path/to/file.ext">
    1| import { useState } from 'react'
    2| import something from './somewhere'
    3|
    4| export default function Foo() {
```

**Critical:** The `N|` prefix on each line is a line number annotation added by ACT. It is **not part of the actual file content.** When writing context lines in your diffs, strip these prefixes entirely. A context line from line 42 that reads `   42| const x = 1` becomes ` const x = 1` in the diff (one space prefix, then raw code).

---

## [MANDATORY RULES]

### Rule 1 — Minimum 2 non-blank context lines on each side

Every hunk must have at least **2 non-blank context lines before the change AND 2 non-blank context lines after the change.** Blank lines (empty or whitespace-only) do not count toward this minimum.

**Why:** Single-line anchors like `})`, `}`, `return null`, and `catch` blocks appear dozens of times in a file. The fuzzy engine will find multiple candidates and reject the hunk as ambiguous. Two non-blank lines on each side gives the matcher a unique enough fingerprint.

**If you cannot find 2 non-blank lines after the change** because it's at the end of the file, use as many as exist. But always ensure 2 before.

---

### Rule 2 — Context lines must match the file exactly

Copy context lines directly from the matrix. Do not paraphrase, abbreviate, or reconstruct from memory. Whitespace is significant — the fuzzy matcher normalises whitespace, but missing or extra tokens will break the match.

Strip only the `N|` line number prefix. Preserve everything else including indentation.

---

### Rule 3 — Blank lines mid-hunk are valid — do not remove them

A blank line within a hunk is a valid context line. Do not convert it to a `-/+` pair just to avoid it. Write it as a context line with a single space prefix:

```
 
```
(one space, then nothing — representing a blank line in the file)

---

### Rule 4 — One file per diff block

The patcher extracts the file path from the `+++` header of the entire block. Multiple files in one block will cause the second file's changes to fail as malformed hunk content.

Produce one diff block per file. The developer loads each into a separate slot.

---

### Rule 5 — Hunk headers must be mathematically correct

```
@@ -originalStart,originalLineCount +newStart,newLineCount @@
```

Count carefully:
- `originalLineCount` = context lines before + removed lines + context lines after
- `newLineCount` = context lines before + added lines + context lines after

A wrong line count produces a "line count mismatch" error distinct from a context failure. Both are avoidable.

---

### Rule 6 — Break large changes into atomic single-concern hunks

Never replace a massive block in one hunk. Each hunk should make one logical change. Multiple hunks within the same diff block are fine and preferred.

**Why:** Large single-hunk rewrites duplicate context lines across the change boundary, causing the matcher to find false candidates.

---

## [MAIN_LOGIC: generate_diff]

```pseudocode
FOR EACH file requiring changes:

  IDENTIFY(target_file) {
    USE exact relative path from project root
    STRIP the N| prefix from all matrix lines before using as context
  }

  FOR EACH logical change in that file:
    LOCATE anchor window {
      FIND 2+ non-blank lines BEFORE the change
      FIND 2+ non-blank lines AFTER the change
      IF uniqueness is uncertain: EXPAND to 3+ lines
    }

  GENERATE_PATCH(strict_unified_diff_format) {
    ENCLOSURE:      Wrap in ```diff ... ``` fences
    HEADER_MINUS:   `--- exact/path/to/file.ext`
    HEADER_PLUS:    `+++ exact/path/to/file.ext`
    HUNK_HEADER:    `@@ -start,count +start,count @@` — always mathematical, never a comment
    CONTEXT_BEFORE: 2+ non-blank lines, single space prefix, raw code only
    REMOVALS:       `-` prefix
    ADDITIONS:      `+` prefix
    CONTEXT_AFTER:  2+ non-blank lines, single space prefix, raw code only
  }

  AUDIT {
    ASSERT(context lines stripped of N| prefix)
    ASSERT(2+ non-blank context lines on each side of every hunk)
    ASSERT(hunk header line counts are mathematically correct)
    ASSERT(one file path per diff block)
    ASSERT(hunk header is @@ -N,N +N,N @@ — not a comment)
  }
```

---

## [EXAMPLES]

### ✅ CORRECT — Standard edit with 2 non-blank context lines each side

```diff
--- src/renderer/src/App.jsx
+++ src/renderer/src/App.jsx
@@ -114,7 +114,10 @@
           <button className={activeTab === 'commander' ? 'active' : ''} onClick={() => setActiveTab('commander')}>
             Command Center
           </button>
+          <button className={activeTab === 'patcher' ? 'active' : ''} onClick={() => setActiveTab('patcher')}>
+            Code Patcher
+          </button>
         </div>
         <button className="sidebar-back-btn" onClick={() => { setProject(null); setProjectFilePath(null) }}>
           ← Projects
```

### ✅ CORRECT — Blank line preserved as context

```diff
--- src/main/index.js
+++ src/main/index.js
@@ -201,7 +201,8 @@
   ipcMain.handle('save-project', async (_, args) => {
     try {
       const data = JSON.parse(fs.readFileSync(args.filePath, 'utf-8'))
+      const hash = createHash('md5').update(JSON.stringify(data)).digest('hex')
       return { success: true, data }
     } catch (error) { return { success: false, error: error.message } }
   })
 
   ipcMain.handle('load-project', async (_, filePath) => {
```

Note the blank context line before `ipcMain.handle('load-project'` — written as a single space on its own line, counts as context but not toward the 2 non-blank minimum.

### ✅ CORRECT — New file

```diff
--- /dev/null
+++ src/renderer/src/components/StatusBar.jsx
@@ -0,0 +1,7 @@
+export default function StatusBar({ message, type }) {
+  return (
+    <div className={`status-bar status-bar--${type || 'idle'}`}>
+      <span>{message || 'Ready'}</span>
+    </div>
+  )
+}
```

---

## [ANTI-PATTERNS — WILL CAUSE REJECTION]

### ❌ Line number prefix left in context lines
```diff
   42| const x = useRef(null)
   43| const y = useState(false)
```
**Fix:** Strip the `N|` prefix. Context lines must be raw code with a single space prefix.

### ❌ Fewer than 2 non-blank context lines on one side
```diff
@@ -98,4 +98,5 @@
   })
+  const newThing = true
   ipcMain.handle('load-project',
```
Only one non-blank context line before and after. The patcher will reject this at load time.

### ❌ Comment in hunk header
```diff
@@ // insert below the imports @@
```
The patcher requires `@@ -N,N +N,N @@`. A comment fails validation and the diff is rejected before staging.

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
Produce two separate diff blocks. Load each into its own slot.

### ❌ Ambiguous single-line anchor
```diff
@@ -340,3 +340,4 @@
   })
+  newHandler()
   })
```
`})` appears throughout the file. The fuzzy matcher will find multiple candidates and halt with an ambiguity warning. Expand the context window until the anchor is unique.

---

## [ERROR MESSAGES — WHAT THEY MEAN]

When a hunk fails, the patcher reports one of these:

| Error | Meaning | Fix |
|---|---|---|
| `context not found in file` | The anchor lines don't exist anywhere in the file | Verify context lines match the matrix exactly |
| `N candidate locations found — context is ambiguous` | The anchor matched multiple locations | Expand context window until unique |
| `Hunk rejected at load: fewer than 2 non-blank context lines` | Diff rejected before staging | Add more context lines around the change |
| `Hunk N of M failed` | Specific hunk in a multi-hunk diff failed | Fix only that hunk and reload |

---

## [SLOT MODEL — WHAT THE DEVELOPER SEES]

- **One slot = one file.** Each slot locks to the first file path it receives.
- **Re-loading the same file** into a locked slot merges hunks — useful for corrections.
- **Loading a different file** into a locked slot red-flashes and rejects.
- **Per-slot ▶ button** deploys that slot individually.
- **Deploy All** applies all staged slots atomically.
- **Deployed slots** show a green `✓ Deployed` badge and stay visible until cleared.
- **Failed slots** show a red border with the exact error message inline.

---

## [PRE-OUTPUT CHECKLIST]

- [ ] Wrapped in ` ```diff ``` ` fences
- [ ] `--- path/to/file` header present
- [ ] `+++ path/to/file` header present (same file)
- [ ] Every hunk has a valid `@@ -N,N +N,N @@` header
- [ ] All `N|` line number prefixes stripped from context lines
- [ ] 2+ non-blank context lines before every change
- [ ] 2+ non-blank context lines after every change
- [ ] All context lines prefixed with exactly one space
- [ ] Blank mid-hunk lines written as single space (not removed)
- [ ] Hunk header line counts are mathematically correct
- [ ] One file per diff block
