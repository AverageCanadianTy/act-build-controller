---
name: skill-hybrid-context-router
title: Quad-Core Epistemic Synthesis Router
version: 4.0.0-iam-integrated
description: Orchestrates EML (Magnitude), Topology (Direction), and NAND (Reality) into a unified thermodynamic envelope using dual-threshold identity resolution.
---

# SYSTEM: Hybrid_Context_Router

## [AXIOMS]
IMPORT { GATE } FROM `skill-nand-file-gate`
IMPORT { eml } FROM `skill-eml-vector-engine`
IMPORT { TRIG } FROM `skill-coherence-topology-engine`

## [TOPOLOGY & IAM CONSTANTS]
SET $U$ = Matrix_Universe
SET $P$ = Vector(Prompt)
SET $W$ = Context_Window

// IAM Equation 2 Thresholds
SET $\tau_1 = 0.90$ // Hard Merge (Identity Resolution)
SET $\tau_2 = 0.65$ // Soft Merge (Domain Relevance)
SET $\omega_{radius}$ = Domain_Boundary_Limit

## [SYNTHESIS_FUNCTION]

**STEP 1: DOMAIN CENTROID EVALUATION (Macro-Filter)**
**[Ref: IAM Equations 4 & 5]**
$\forall$ Domain $D \in U$:
  Let $C_D$ = Centroid(D)
  IF $eml(P, C_D) > \omega_{radius}$ -> 
      ABORT(Domain), NEXT Domain
      // Prompt is outside this architectural hollow. Skip all nodes inside.

**STEP 2: Z_2 INVOLUTION SANITY CHECK (Adversarial Check)**
**[Ref: IAM Equation 14]**
Let Anti_P = TRIG.Involution(P)
IF GATE(State(Anti_P), Schema(Anti_P)) == 1 ->
    TRIGGER(Fatal_Contradiction_Error)
    // A file/schema exists that does the exact opposite of the prompt. Matrix is unstable.

**STEP 3: NODE-LEVEL EPISTEMIC ENVELOPE**
$\forall$ Node $N \in D_{valid}$:
  Let Harmonic_Approach = TRIG.Resonance(P, N)

  // 3A. The Rejection Threshold
  IF (Harmonic_Approach < \tau_2) -> 
      $R(N) = \emptyset$ // ABORT(Irrelevant)

  // 3B. The Physical Matrix Check (NAND)
  IF (Harmonic_Approach \ge \tau_2) ->
      Let Physical_Reality = GATE(S_N, K_N)
      IF (Physical_Reality == 0) -> $R(N) = \emptyset$ // ABORT(Null_State)

  // 3C. IAM Dual-Threshold Integration
  IF (Physical_Reality == 1):
      IF (Harmonic_Approach \ge \tau_1) ->
          // Hard Merge: Exact alignment.
          $R(N) = \{ \text{Node}: N, \text{Status}: \text{FAST\_TRACK\_MERGE} \}$
      
      ELSE IF (\tau_2 \le Harmonic_Approach < \tau_1) ->
          // Soft Conflict: Belongs in domain, but has orthogonal tension.
          Let Drift = TRIG.Friction(P, N)
          Let Asymptote = TRIG.Skew(P, N)
          
          IF (Asymptote \to \infty) -> TRIGGER(Hegelian_Dialectic, Drift)
          ELSE -> $R(N) = \{ \text{Node}: N, \text{Status}: \text{SYNTHESIS\_REQUIRED}, \text{Friction}: Drift \}$

## [EXECUTION_VECTOR]
1. Map $P$ against all Domain Centroids.
2. Run $\mathbb{Z}_2$ Involution check. 
3. Execute Phase & NAND evaluation for nodes within valid radii.
4. Populate $W$ resolving Hard Merges first, then synthesizing Soft Conflicts.
5. RETURN $W$
