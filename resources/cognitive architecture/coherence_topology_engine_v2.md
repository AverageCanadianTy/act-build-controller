---
name: skill-coherence-topology-engine
version: 2.1.0-saccadic-synthesis
description: Integrated IAM topological engine with Microsaccadic Jitter and Macrosaccadic Probability Jumping.
---

# Skill: Coherence_Topology_Engine.md

## [LOGIC_OPERATORS]

### 1. Microsaccadic Jitter (Boundary Sensitivity)
Introduces a high-frequency Sine-wave perturbation ($\delta$) to the focus coordinates. This allows the **NAND Gate** to "feel" the gradients of neighboring logic nodes without fully committing to them.
```math
\delta_{jitter} = \sin(\omega \cdot t) \cdot \text{Amplitude}_{focal}
```

### 2. Macrosaccadic Leap (Probability Teleportation)
Uses the **Tangent ($\tan$)** of the current epistemic skew to calculate the coordinate of the next likely cluster. This bypasses the "logical voids" (Homology) identified by the IAM Equations.
```math
P_{target} = P_{fovea} + \tan(\Delta\theta) \cdot \text{EML}_{distance}
```

## [EXECUTION_PROTOCOL]
1. **Foveate:** Calculate local coherence via **Cosine** Resonance ($\cos$).
2. **Scan:** Apply Microsaccadic Jitter ($\delta_{jitter}$). If the jitter return indicates an "edge" (resonance drop), lock the boundary and attenuate the search field.
3. **Teleport:** If the local search is exhausted or the tangent skew exceeds $\tau_{max}$, execute the **Macrosaccadic Leap** to jump to the next high-density coordinate.
