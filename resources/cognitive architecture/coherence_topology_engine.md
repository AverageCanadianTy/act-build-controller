---
name: skill-trig-phase-topology
title: Trigonometric Phase & Manifold Orientation Protocol
version: 1.0.0-core
description: Calculates 3D angular phase shifts, semantic resonance, and orthogonal drift between prompt trajectories and target knowledge nodes.
---

# Skill: Trig_Phase_Topology.md

## [MODULE_DESCRIPTION]
This node operates strictly upon the angular orientation ($\theta$) of vectors within a 3D topological manifold. It evaluates the relational geometry between a Prompt Vector ($P$) and a Target Node ($N$), independent of their linear semantic distance. It serves as the compass for the epistemic envelope.

## [LOGIC_OPERATORS]
```math
// Calculate the relative phase difference
Let \Delta\theta = \theta_P - \theta_N
```

### 1. Harmonic Resonance (The Approach Vector)
Evaluates parallel alignment. Used as a Pre-Gate filter to ensure the knowledge domain is conceptually viable before physical matrix checks.
```math
TRIG.Resonance(P, N) = \cos(\Delta\theta)
// Output: [1] Perfect Alignment -> [0] Orthogonal -> [-1] Diametric Opposition
```

### 2. Orthogonal Friction (The Drift Metric)
Calculates the perpendicular tension. Used Post-Gate to quantify how much integrating this node will pull the system trajectory off its current axis.
```math
TRIG.Friction(P, N) = \sin(\Delta\theta)
// Output: Measures the required energetic constraint needed to stabilize the matrix upon integration.
```

### 3. Hegelian Skew (The Divergence Rate)
Calculates the asymptotic rate of change. Identifies the exact coordinate where cognitive or systemic tension requires structural synthesis.
```math
TRIG.Skew(P, N) = \tan(\Delta\theta) = \frac{\sin(\Delta\theta)}{\cos(\Delta\theta)}
// Output: IF \tan(\Delta\theta) \to \pm\infty, TRIGGER(Hegelian_Dialectic)
```
