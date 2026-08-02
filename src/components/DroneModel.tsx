"use client";

import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import { useDashboard } from "@/lib/DashboardContext";
import * as THREE from "three";
import anime from "animejs";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS — colour scheme matched to reference video
   • Background: near-black charcoal (page handles this via #0d0d10)
   • Floor grid: faint thin lines (page handles this via FloorGrid)
   • Model base: matte dark graphite/charcoal, NOT pure black
   • Accent: orange (#f97316) on mechanical joints, hinges, internal components
   • Rim lighting & ground shadow: handled in page.tsx Scene
═══════════════════════════════════════════════════════════════════════════ */

const ORANGE = "#f97316";
const GRAPHITE_COLOR = new THREE.Color("#e8e8ea");  // off-white / light grey
const JOINT_ACCENT_COLOR = new THREE.Color(ORANGE); // orange accent for mechanical joints/hinges

/**
 * Explode displacement vectors in NORMALISED groupRef space.
 * (The normWrapper scales the model to ~4 units across, so these
 *  ~2-unit offsets feel proportionally correct.)
 */
const EXPLODE_OFF: Record<string, [number, number, number]> = {
  SHELL_TOP:    [0,  1.85, 0],
  SHELL_BOTTOM: [0, -1.65, 0.35],
  CAMERA:       [0, -2.45, 0.58],
  ARM_PP:       [ 2.25, -0.4,  2.25],
  ARM_PN:       [ 2.25, -0.4, -2.25],
  ARM_NP:       [-2.25, -0.4,  2.25],
  ARM_NN:       [-2.25, -0.4, -2.25],
  CPU_BOARD:    [0,  0.6, 0],
  ROOT:         [0,  0,   0],
};

/**
 * Stagger delays (seconds) before each part starts animating.
 * Explode order: arms first → CPU last.
 * Assemble order: mirrored (CPU first → arms last).
 */
const STAGGER: Record<string, number> = {
  ARM_PP: 0.00, ARM_PN: 0.05, ARM_NP: 0.09, ARM_NN: 0.14,
  SHELL_TOP: 0.20, SHELL_BOTTOM: 0.25, CAMERA: 0.29,
  CPU_BOARD: 0.35, ROOT: 0,
};
const MAX_STAGGER = 0.35;

/** Display info per part category. */
interface LabelInfo { text: string; hero: boolean }
const LABELS: Record<string, LabelInfo> = {
  CPU_BOARD:    { text: "CPU  ·  Register File  ·  ALU Cluster", hero: true },
  SHELL_TOP:    { text: "Shell Panel",     hero: false },
  SHELL_BOTTOM: { text: "Frame Assembly",  hero: false },
  CAMERA:       { text: "Camera Housing",  hero: false },
  ARM_PP:       { text: "Rotor Arm",       hero: false },
  ARM_PN:       { text: "Rotor Arm",       hero: false },
  ARM_NP:       { text: "Rotor Arm",       hero: false },
  ARM_NN:       { text: "Rotor Arm",       hero: false },
};

/* ═══════════════════════════════════════════════════════════════════════════
   PART CATEGORISATION
   Classifies top-level GLB children by name patterns first, then by
   bounding-box centroid position relative to the model's overall centre.
═══════════════════════════════════════════════════════════════════════════ */

function categorize(
  obj: THREE.Object3D,
  centroid: THREE.Vector3,
  center: THREE.Vector3,
  size: THREE.Vector3,
): string {
  const n = obj.name;

  // Hard-mapped explicit Object_N identifiers to specific components based on centroid analysis
  switch (n) {
    case "Object_7":  return "CPU_BOARD";
    case "Object_8":  return "SHELL_TOP";
    case "Object_4":
    case "Object_6":  return "ARM_PP";
    case "Object_2":
    case "Object_3":  return "ARM_PN";
    case "Object_9":
    case "Object_10": return "ARM_NP";
    case "Object_5":
    case "Object_11": return "ARM_NN";
  }

  // Fallback for any other GLBs
  const nLower = n.toLowerCase();
  const rx = centroid.x - center.x;
  const rz = centroid.z - center.z;
  const ry = centroid.y - center.y;
  const dxz = Math.hypot(rx, rz);
  const quad = () => (rx >= 0 ? (rz >= 0 ? "ARM_PP" : "ARM_PN") : (rz >= 0 ? "ARM_NP" : "ARM_NN"));

  if (/cpu|processor|board|computer|logic|mainboard/.test(nLower)) return "CPU_BOARD";
  if (/camera|cam|gimbal|lens/.test(nLower))                        return "CAMERA";
  if (/top|lid|upper|cover/.test(nLower))                           return "SHELL_TOP";
  if (/bottom|base|lower|land|chassis/.test(nLower))                return "SHELL_BOTTOM";
  if (/arm|rotor|prop|motor|blade/.test(nLower))                    return quad();

  const yT  = size.y * 0.18;
  const xzT = Math.max(size.x, size.z) * 0.28;
  if (dxz > xzT)        return quad();
  if (ry >  yT)         return "SHELL_TOP";
  if (ry < -yT * 1.8)   return "CAMERA";
  if (ry < -yT * 0.4)   return "SHELL_BOTTOM";
  return "CPU_BOARD";
}

/* ═══════════════════════════════════════════════════════════════════════════
   CPU FAULT GLOW MATERIAL
   Reacts to activeFaultModule exactly as the original procedural version.
═══════════════════════════════════════════════════════════════════════════ */

function makeCPUMat(fault: string | null, highlighted: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color:            new THREE.Color("#1c2030"),
    roughness:        0.25,
    metalness:        0.7,
    emissive:         new THREE.Color(0, 0, 0),
    emissiveIntensity: 0,
  });
  if (fault === "CPU_SEC")             { mat.emissive.set("#f59e0b"); mat.emissiveIntensity = 2.0; }
  else if (fault === "CPU_DED")        { mat.emissive.set("#ef4444"); mat.emissiveIntensity = 2.0; }
  else if (fault?.startsWith("ALU_"))  { mat.emissive.set("#ef4444"); mat.emissiveIntensity = 1.8; }
  else if (fault === "TMR_RECOVER")    { mat.emissive.set("#22c55e"); mat.emissiveIntensity = 2.0; }
  else if (highlighted)                { mat.emissive.set(ORANGE);    mat.emissiveIntensity = 0.35; }
  return mat;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface Part {
  category:      string;
  object:        THREE.Object3D;
  /** Position in clonedScene local space (= normWrapper local space). */
  origPos:       THREE.Vector3;
  /** Current displacement in the same local space as origPos. */
  currentOffset: THREE.Vector3;
}

const PROC_SUBS = [
  "CPU", "Register File", "ECC Decoder",
  "ALU Cluster", "Majority Voter",
  "Instruction Memory", "Data Memory",
];

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function DroneModel() {
  const {
    isExploded, isHovering, isRotating,
    highlightedModules, activeFaultModule,
  } = useDashboard();

  const { scene: rawScene } = useGLTF("/rc_quadcopter.glb");

  /* ── 1. Clone, reset root transform, normalise, apply graphite ─────────── */
  const { cloned, normScale, normOffset, modelCenter } = useMemo(() => {
    const cloned = rawScene.clone(true);

    // Reset root transform so all child positions use a consistent coordinate space
    cloned.position.set(0, 0, 0);
    cloned.rotation.set(0, 0, 0);
    cloned.scale.set(1, 1, 1);
    cloned.updateMatrixWorld(true);

    // Compute bounding box of the reset clone
    const box    = new THREE.Box3().setFromObject(cloned);
    const sz     = box.getSize(new THREE.Vector3());
    const ct     = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z, 0.001);

    // normScale: brings model to ~4 screen units wide
    const normScale = 4.0 / maxDim;

    // normOffset: applied to normWrapper so model's bounding centre sits at world origin
    // In groupRef local space: pos = normScale * origPos + normOffset
    // → centre maps to 0 when normOffset = -normScale * ct
    const normOffset = ct.clone().negate().multiplyScalar(normScale);

    // Apply matte graphite to all meshes — machined metal/plastic with subtle specular
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const isJoint = /joint|hinge|pin|bolt|screw|rivet|bearing|shaft|rotor|prop|motor/i.test(child.name);
        const isInternal = /cpu|board|processor|memory|alu|register|decoder|voter|ecc|logic|chip|die/i.test(child.name);
        
        child.material = new THREE.MeshStandardMaterial({
          color:           isJoint ? JOINT_ACCENT_COLOR : (isInternal ? new THREE.Color("#1a1a1e") : GRAPHITE_COLOR),
          roughness:       isJoint ? 0.3 : 0.72,
          metalness:       isJoint ? 0.85 : 0.35,
          emissive:        isJoint ? JOINT_ACCENT_COLOR : new THREE.Color(0, 0, 0),
          emissiveIntensity: isJoint ? 0.15 : 0,
          envMapIntensity: 0.5,
        });
        child.castShadow    = true;
        child.receiveShadow = true;
      }
    });

    return { cloned, normScale, normOffset, modelCenter: ct };
  }, [rawScene]);

  /* ── 2. Explode offsets converted to scene-local space ─────────────────── */
  const localExplodeOff = useMemo(() => {
    const result: Record<string, THREE.Vector3> = {};
    for (const [k, v] of Object.entries(EXPLODE_OFF)) {
      result[k] = new THREE.Vector3(v[0] / normScale, v[1] / normScale, v[2] / normScale);
    }
    return result;
  }, [normScale]);

  /* ── 3. Extract separable parts ────────────────────────────────────────── */
  const parts: Part[] = useMemo(() => {
    // Collect top-level children; drill deeper until we find multiple children
    let cands = cloned.children;
    while (cands.length === 1 && cands[0].children.length > 0) {
      cands = cands[0].children;
    }
    // Filter valid objects for parts
    cands = cands.filter((c) => c.type === "Mesh" || c.type === "Group" || c.type === "Object3D");

    // Fallback: model is a single unified mesh — animate as one piece
    if (cands.length <= 1) {
      return [{
        category: "ROOT",
        object:   cloned,
        origPos:  new THREE.Vector3(),
        currentOffset: new THREE.Vector3(),
      }];
    }

    const box    = new THREE.Box3().setFromObject(cloned);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());

    return cands.map((obj): Part => {
      const b       = new THREE.Box3().setFromObject(obj);
      const centroid = b.getCenter(new THREE.Vector3());
      return {
        category:      categorize(obj, centroid, center, size),
        object:        obj,
        origPos:       obj.position.clone(),
        currentOffset: new THREE.Vector3(),
      };
    });
  }, [cloned]);

  /* ── 4. Guide-line geometry (Three.js objects, updated imperatively) ───── */
  const guideGroup = useMemo(() => {
    const g = new THREE.Group();
    parts.forEach((part, i) => {
      // CPU_BOARD is the hero — no guide line, it stays visually prominent
      if (part.category === "CPU_BOARD" || part.category === "ROOT") return;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      // Faint guide lines — barely visible, matching the floor grid aesthetic
      const mat  = new THREE.LineBasicMaterial({ color: "#1a1a1f", opacity: 0, transparent: true });
      const line = new THREE.Line(geom, mat);
      (line as unknown as { __pi: number }).__pi = i;
      g.add(line);
    });
    return g;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts]);

  /* ── 5. CPU fault glow (reactive, rebuilt only when fault state changes) ─ */
  const hasHL  = highlightedModules.some((m) => PROC_SUBS.includes(m));
  const cpuMat = useMemo(
    () => makeCPUMat(activeFaultModule, hasHL),
    [activeFaultModule, hasHL],
  );

  useEffect(() => {
    parts.forEach((p) => {
      if (p.category === "CPU_BOARD") {
        p.object.traverse((c) => {
          if (c instanceof THREE.Mesh) c.material = cpuMat;
        });
      }
    });
  }, [cpuMat, parts]);

  /* ── 6. Animation refs ──────────────────────────────────────────────────── */
  const groupRef  = useRef<THREE.Group>(null);
  const hoverTime = useRef(0);
  const tStart    = useRef<number | null>(null);
  const prevExp   = useRef(isExploded);

  /* ── 6.5. Anime.js Explosion Physics ───────────────────────────────────── */
  useEffect(() => {
    parts.forEach((part) => {
      const sd    = STAGGER[part.category] ?? 0;
      const delay = isExploded ? sd * 1000 : (MAX_STAGGER - sd) * 1000;
      const target = isExploded
        ? (localExplodeOff[part.category] ?? new THREE.Vector3())
        : new THREE.Vector3();

      anime({
        targets: part.currentOffset,
        x: target.x,
        y: target.y,
        z: target.z,
        duration: isExploded ? 1400 : 800,
        delay: delay,
        easing: isExploded ? "easeOutElastic(1, .6)" : "easeOutExpo",
      });
    });
  }, [isExploded, parts, localExplodeOff]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Detect explode/assemble toggle → record transition start time
    if (prevExp.current !== isExploded) {
      tStart.current = t;
      prevExp.current = isExploded;
    }

    /* ── Idle rotation + hover bob ──────────────────────────────────────── */
    if (groupRef.current) {
      if (isRotating) groupRef.current.rotation.y += delta * 0.04; // ~2.3°/s
      if (isHovering) {
        hoverTime.current += delta;
        groupRef.current.position.y = Math.sin(hoverTime.current * 1.5) * 0.1;
      } else {
        groupRef.current.position.y = THREE.MathUtils.lerp(
          groupRef.current.position.y, 0, delta * 2,
        );
      }
    }

    /* ── Per-part staggered explosion (Now driven by Anime.js) ──────────── */
    parts.forEach((part) => {
      // Apply displacement to the object (in its parent = clonedScene local space)
      part.object.position.copy(part.origPos).add(part.currentOffset);
    });

    /* ── Guide-line imperative updates ─────────────────────────────────── */
    guideGroup.children.forEach((child) => {
      const line = child as unknown as THREE.Line & { __pi: number };
      const part = parts[line.__pi];
      if (!part) return;

      const mat        = line.material as THREE.LineBasicMaterial;
      const displaced  = part.currentOffset.length();
      const targetOp   = isExploded && displaced > 0.04 ? 0.28 : 0;
      mat.opacity      = THREE.MathUtils.lerp(mat.opacity, targetOp, delta * 3);
      line.visible     = mat.opacity > 0.005;

      if (line.visible) {
        const attr = (line.geometry as THREE.BufferGeometry)
          .attributes.position as THREE.BufferAttribute;
        // Both points in clonedScene / normWrapper local space
        attr.setXYZ(0, part.origPos.x, part.origPos.y, part.origPos.z);
        const end = part.origPos.clone().add(part.currentOffset);
        attr.setXYZ(1, end.x, end.y, end.z);
        attr.needsUpdate = true;
      }
    });
  });

  /* ── 7. Label positions (final exploded state, in groupRef space) ───────
   *
   *  Coordinate conversion:
   *    groupRefPos = normScale × (origPos − modelCenter) + EXPLODE_OFF
   *
   *  This is because normWrapper applies:
   *    pos_groupRef = normScale × origPos + normOffset
   *               = normScale × origPos − normScale × modelCenter
   *               = normScale × (origPos − modelCenter)
   *  Then we add the EXPLODE_OFF (already in normalised groupRef space).
   */
  const labelPosns = useMemo((): [number, number, number][] =>
    parts.map((p) => {
      const off  = EXPLODE_OFF[p.category] ?? [0, 0, 0];
      const info = LABELS[p.category];
      const yX   = info?.hero ? 0.65 : 0.32;
      return [
        (p.origPos.x - modelCenter.x) * normScale + off[0],
        (p.origPos.y - modelCenter.y) * normScale + off[1] + yX,
        (p.origPos.z - modelCenter.z) * normScale + off[2],
      ];
    }),
  [parts, normScale, modelCenter]);

  /* ── 8. JSX ─────────────────────────────────────────────────────────────── */
  return (
    <group ref={groupRef}>
      {/* Normalisation wrapper — brings any size GLB to ~4 scene units */}
      <group
        position={[normOffset.x, normOffset.y, normOffset.z]}
        scale={normScale}
      >
        <primitive object={cloned}      />
        {/* Guide lines live in the same local space as the cloned scene */}
        <primitive object={guideGroup}  />
      </group>

      {/* Floating labels — positioned in groupRef space, fade in with explode */}
      {isExploded &&
        parts.map((part, i) => {
          const info = LABELS[part.category];
          if (!info) return null;
          return (
            <Html
              key={`label-${i}`}
              position={labelPosns[i]}
              center
              distanceFactor={9}
              style={{ pointerEvents: "none" }}
            >
              <span
                style={{
                  fontFamily:    "monospace",
                  fontSize:      info.hero ? "10px" : "8px",
                  textTransform: "uppercase",
                  letterSpacing: info.hero ? "0.18em" : "0.11em",
                  color:         info.hero ? ORANGE : "rgba(255,255,255,0.30)",
                  whiteSpace:    "nowrap",
                  fontWeight:    info.hero ? 700 : 400,
                  userSelect:    "none",
                  textShadow:    info.hero
                    ? "0 0 10px rgba(249,115,22,0.95), 0 0 22px rgba(249,115,22,0.55)"
                    : "none",
                  /* Fade in slightly after the stagger animation starts */
                  animation:     `fadeInLabel 0.4s ease forwards ${((STAGGER[part.category] ?? 0) * 1) + 0.3}s`,
                  opacity:       0,
                }}
              >
                {info.text}
              </span>
            </Html>
          );
        })}
    </group>
  );
}

/* Preload so there's no Suspense pop on first render */
useGLTF.preload("/rc_quadcopter.glb");
