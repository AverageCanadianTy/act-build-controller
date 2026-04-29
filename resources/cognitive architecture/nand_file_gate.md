---
name: skill-nand-file-gate
title: NAND Discrete Topology Gatekeeper
version: 1.0.0-core
description: Enforces absolute binary state validation for all file and matrix operations. Eliminates probabilistic path guessing.
---

# Skill: NAND_File_Gate.md

## [MODULE_DESCRIPTION]
This node operates strictly within Boolean space ($\{0, 1\}$). It validates the existence and schema compliance of data nodes before any computational resources are expended. It does not calculate distance or similarity; it calculates absolute presence.

## [LOGIC_OPERATORS]
```nand
// Define the NAND operator for State (S) and Schema (K)
GATE(S, K) = NAND(NAND(S, S), NAND(K, K))
```

## [EXECUTION_PROTOCOL]
For every target node ($N_t$) requested by the system:

1. **State Evaluation:** Evaluate if $N_t$ exists in the physical matrix.
   `S = 1` (Exists) | `S = 0` (Null/Not Found)
2. **Schema Evaluation:** Evaluate if $N_t$ matches the exact structural type required.
   `K = 1` (Match) | `K = 0` (Mismatch)

3. **The Gate Equation:**
```nand
RESULT = GATE(S, K)

IF (RESULT == 1) -> INJECT_TO_ROUTER(N_t)
IF (RESULT == 0) -> ABORT_SILENTLY() // Do not attempt to guess or autocorrect the path.
```
