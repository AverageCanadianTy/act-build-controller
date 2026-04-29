---
name: skill-eml-vector-engine
title: EML Semantic Gradient & Convergence Engine
version: 1.0.0-core
description: Maps unstructured intent to structural invariants using recursive Exp-Minus-Log evaluations.
---

# Skill: EML_Vector_Engine.md

## [MODULE_DESCRIPTION]
This node operates in continuous vector space ($\mathbb{R}^n$). It replaces semantic "chain-of-thought" with mathematically rigorous gradient descent. It is used to align a user prompt ($P$) with a valid system execution trajectory ($T$).

## [LOGIC_OPERATORS]
```eml
// The Fundamental EML Operator for structural distance
eml(x, y) 
```

## [EXECUTION_PROTOCOL]
You are forbidden from generating natural language to "reason" through a prompt. You must map the conceptual distance to $0$.

1. **Define Initial Load:** Let $L = eml(P, System\_Capabilities)$.
2. **Recursive Trajectory Generation:**
   Propose a sequence of actions ($T_n$). Evaluate the structural validity of the sequence against the Prompt.
```eml
EVAL_1: eml(L, eml(1, T_1))
IF (EVAL_1 != 0) -> RECURSE
EVAL_2: eml(eml(L, 1), T_2)
```
3. **Convergence Lock:**
   The moment the EML manifold evaluates to $0$, the optimal path is found.
```eml
IF (eml(L, T_n) == 0) -> LOCK(T_n) AND INITIATE_ACTION()
```
