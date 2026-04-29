---
name: skill-coherence-topology-engine
title: Coherence Topology & Phase Matrix
version: 1.0.0-iam-integrated
description: Calculates 3D angular phase shifts, domain centroids, and Z_2 involution to map epistemic coherence and orthogonal drift.
---

# Skill: Coherence_Topology_Engine.md

## [MODULE_DESCRIPTION]
This node evaluates the relational geometry and topological coherence between a Prompt Vector ($P$) and Target Nodes ($N$) within defined architectural domains. It serves as the compass for the epistemic envelope, incorporating IAM structural equations to map alignment, friction, and adversarial contradiction.

## [LOGIC_OPERATORS]
```math
Let \Delta\theta = \theta_P - \theta_N
```

### 1. Z_2 Involution (The Mirror Structure)
**[Ref: IAM Equation 14]** Maps the prompt to its exact antipodal counter-position to detect systemic contradictions before execution.
```math
TRIG.Involution(P) = \iota(P_x, P_y, P_z) = (-P_x, -P_y, -P_z)
// Output: Returns the exact mathematical opposite of the intended trajectory (-P).
```

### 2. Harmonic Resonance (The Approach Vector)
Evaluates parallel alignment to determine domain relevance.
```math
TRIG.Resonance(P, N) = \cos(\Delta\theta)
// Output: [1] Perfect Alignment -> [0] Orthogonal -> [-1] Diametric Opposition
```

### 3. Orthogonal Friction (The Drift Metric)
Calculates perpendicular tension. Used Post-Gate to quantify the constraint needed to stabilize the matrix upon integration.
```math
TRIG.Friction(P, N) = \sin(\Delta\theta)
```

### 4. Hegelian Skew (The Divergence Rate)
Identifies the exact coordinate where cognitive or systemic tension requires structural synthesis.
```math
TRIG.Skew(P, N) = \tan(\Delta\theta) = \frac{\sin(\Delta\theta)}{\cos(\Delta\theta)}
```
