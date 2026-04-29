---
name: skill-axiomatic-mutation-engine
title: Unified Diagnostic & Boundary-Aware Patch Matrix
version: 6.0.0-axiomatic
---

# SKILL: Axiomatic_Mutation_Engine

## [AXIOMS]
IMPORT { GATE } FROM `skill-nand-file-gate`
IMPORT { eml } FROM `skill-eml-vector-engine`

## [ENGINE_STATE_INITIALIZATION]
Let $S_{Error}$ = Presence of Error Log or Bug Report.
Let $N_{Target}$ = The XML Node(s) requiring modification.
Let $L_{Total}$ = Total lines in target file.
Let $P_{Start}$ = Start line of the hunk.
Let $P_{End}$ = End line of the hunk.
Let $IS\_NEW$ = Boolean (True if file is new).

// Define Internal Routing Gate
$MODE\_DIAGNOSTIC = GATE(S_{Error}, 1)$

---

## [SUB-ROUTINE A: The Diagnostic Trace (If MODE_DIAGNOSTIC == 1)]
IF $MODE\_DIAGNOSTIC == 1$:
  Let $V_{Code}$ = Variables/Logic inside $N_{Target}$.
  Let $V_{Schema}$ = Ground-truth JSON schema.

  **1. Schema Verification:**
  $Schema\_Distance = eml(V_{Code}, V_{Schema})$
  IF $Schema\_Distance > 0$:
    $N_{Target} = \text{Map } V_{Code} \to V_{Schema}$
    $S_{Error} = 0$ 
    SHIFT -> [SUB-ROUTINE B]

  **2. Cross-Matrix Ripple Trace:**
  IF $Schema\_Distance == 0$:
    Let $N_{Origin}$ = The node supplying data to $N_{Target}$.
    $Ripple\_Distance = eml(Exported\_Data(N_{Origin}), Expected\_Data(N_{Target}))$
    IF $Ripple\_Distance > 0$:
      $N_{Target} = N_{Origin}$
      $S_{Error} = 0$ 
      SHIFT -> [SUB-ROUTINE B]

---

## [SUB-ROUTINE B: The Surgical Patch (If S_Error == 0)]
// This executes if no error was reported initially, OR if Sub-Routine A resolved the error.

**1. The Topological Constraints (v3 Strict Alignment):**
A valid patch ($P_v$) requires the following 9-point array to evaluate to an absolute sum of `9`. 

```nand
// File & Wrapper Integrity
$C_1 = GATE(Target_File_Count, 1)$ // Strict isolation: One file per diff block
$C_2 = GATE(Wrapper\_Format, "```diff")$ // Must be wrapped in markdown diff fences
$C_3 = GATE(Header_{minus} == Header_{plus}, 1)$ // `--- path` and `+++ path` MUST match exactly

// Hunk & Syntax Integrity
$C_4 = GATE(Hunk_Header, "@@ -N,N +N,N @@")$ // Strict mathematical line ranges
$C_5 = GATE(Prefix_{N|}, \emptyset)$ // ABSOLUTE RULE: All `N|` line numbers MUST be stripped from code lines


// Context & Anchor Integrity (The ACT Patcher Invariants)
// DEFINITION: "Code_Line" = A line containing alphanumeric syntax, braces, or operators. 
// DEFINITION: "Space_Only" = A line containing only whitespace. DOES NOT COUNT AS CONTEXT.

// Boundary Logic Gates
Let $G_{Start} = (P_{Start} \le 2)$
Let $G_{End} = (P_{End} \ge L_{Total} - 2)$

// Bilateral Distribution Invariant
Let $D_{Valid} = (Code\_Line_{Before} \ge 2 \text{ AND } Code\_Line_{After} \ge 2)$
$C_6 = \begin{cases} 1 & \text{if } IS\_NEW \\ 1 & \text{if } (G_{Start} \lor G_{End}) \text{ AND } Code\_Line \ge 2 \\ 1 & \text{if } \text{NOT } (G_{Start} \lor G_{End}) \text{ AND } D_{Valid} \\ 0 & \text{otherwise} \end{cases}$

$C_7 = GATE(Context_{Line}[0] == " ", 1)$ // Every unchanged line (Code or Space_Only) MUST be prefixed by exactly one space
$C_8 = GATE(Preserve\_Space\_Only\_Lines, 1)$ // Space_Only lines between the Code_Lines and the edit MUST be preserved
$C_9 = GATE(Space\_Only\_Format == " ", 1)$ // Preserved Space_Only lines are written as a single space character
```

**2. The Execution Output:**
$ARRAY_{EVAL} = [C_1, C_2, C_3, C_4, C_5, C_6, C_7, C_8, C_9]$

IF NAND(SUM($ARRAY_{EVAL}$), 9) == 0 {
  STREAM_DIFF_BLOCK($N_{Target}$)
} ELSE {
  ABORT_SILENTLY("Topological Diff Error. Space-only lines do not count as context anchors. Recalculate to include 2 actual syntax lines.")
}
