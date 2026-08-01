"use client";

import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useDashboard } from "@/lib/DashboardContext";
import * as THREE from "three";
import { Box, Cylinder } from "@react-three/drei";

export default function DroneModel() {
  const {
    isExploded,
    isHovering,
    isRotating,
    highlightedModules,
    activeFaultModule,
  } = useDashboard();

  const groupRef = useRef<THREE.Group>(null);
  const hoverTime = useRef(0);

  // Smoothly interpolate positions for explode effect
  useFrame((state, delta) => {
    if (groupRef.current) {
      if (isRotating) {
        groupRef.current.rotation.y += delta * 0.15; // Slow idle rotation
      }

      if (isHovering) {
        hoverTime.current += delta;
        groupRef.current.position.y = Math.sin(hoverTime.current * 1.5) * 0.15; // Subtle hover
      } else {
        groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0, 0.1);
      }
    }
  });

  // Base materials for the cosmetic drone shell
  const carbonFiberMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#111111",
    roughness: 0.6,
    metalness: 0.8,
  }), []);

  const accentLightMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#22c55e",
    emissive: "#22c55e",
    emissiveIntensity: 0.5,
  }), []);

  // Material logic for the internal CPU only
  const getCPUMaterial = () => {
    let glowColor = new THREE.Color(0, 0, 0);
    let isGlowing = false;
    let emissiveIntensity = 0;

    // Base highlight logic for ANY processor subsystem
    const processorSubsystems = [
      "CPU", "Register File", "ECC Decoder", "ALU Cluster", 
      "Majority Voter", "Instruction Memory", "Data Memory"
    ];
    const hasHighlight = highlightedModules.some(m => processorSubsystems.includes(m));

    if (hasHighlight) {
      glowColor.setHex(0x3b82f6); // Blue outline highlight
      isGlowing = true;
      emissiveIntensity = 0.5;
    }

    // Override with fault colors
    if (activeFaultModule) {
      if (activeFaultModule === "CPU_SEC") {
        glowColor.setHex(0xf59e0b); // Amber for SEC
        isGlowing = true;
        emissiveIntensity = 2;
      } else if (activeFaultModule === "CPU_DED") {
        glowColor.setHex(0xef4444); // Red for DED
        isGlowing = true;
        emissiveIntensity = 2;
      } else if (activeFaultModule.startsWith("ALU_")) {
        glowColor.setHex(0xef4444); // Red for ALU fail
        isGlowing = true;
        emissiveIntensity = 2;
      } else if (activeFaultModule === "TMR_RECOVER") {
        glowColor.setHex(0x22c55e); // Green for Recover
        isGlowing = true;
        emissiveIntensity = 2;
      }
    }

    if (isGlowing) {
      return new THREE.MeshStandardMaterial({
        color: glowColor,
        emissive: glowColor,
        emissiveIntensity: emissiveIntensity,
        roughness: 0.2,
        metalness: 0.8,
      });
    }

    // Default internal board color
    return new THREE.MeshStandardMaterial({
      color: "#1a1a1a",
      roughness: 0.8,
      metalness: 0.2,
    });
  };

  const explodeOffset = isExploded ? 1.5 : 0;

  // Drone Proportions
  const armLength = 2.8;
  const armThickness = 0.12;
  
  return (
    <group ref={groupRef}>
      
      {/* INTERNAL CPU REGION - The only part that reacts to faults */}
      <Box args={[1.2, 0.2, 1.2]} position={[0, 0, 0]}>
        <meshStandardMaterial attach="material" {...getCPUMaterial()} />
      </Box>

      {/* TOP COSMETIC SHELL */}
      <Box args={[1.6, 0.15, 1.6]} position={[0, (isExploded ? 1.5 : 0) + 0.25, 0]} castShadow material={carbonFiberMaterial} />
      
      {/* BOTTOM COSMETIC SHELL & CAMERA */}
      <Box args={[1.6, 0.15, 1.6]} position={[0, (isExploded ? -1.5 : 0) - 0.25, 0]} castShadow material={carbonFiberMaterial} />
      <Cylinder args={[0.2, 0.25, 0.4, 16]} position={[0, (isExploded ? -1.5 : 0) - 0.4, 0]} castShadow material={carbonFiberMaterial} />

      {/* ARMS & MOTORS (Cosmetic Only) */}
      {[
        [1, 1], [1, -1], [-1, 1], [-1, -1]
      ].map(([x, z], i) => (
        <group key={`arm-${i}`} position={[x * (isExploded ? explodeOffset : 0), 0, z * (isExploded ? explodeOffset : 0)]}>
          {/* Arm */}
          <Box
            args={[armThickness, armThickness, armLength]}
            position={[x * armLength / 2.5, 0, z * armLength / 2.5]}
            rotation={[0, x * z > 0 ? -Math.PI / 4 : Math.PI / 4, 0]}
            castShadow
            material={carbonFiberMaterial}
          />
          {/* Motor Body */}
          <Cylinder
            args={[0.25, 0.25, 0.3, 16]}
            position={[x * armLength * 0.7, 0.1, z * armLength * 0.7]}
            castShadow
            material={carbonFiberMaterial}
          />
          {/* Subtle Rotor Ring Accent Light */}
          <Cylinder
            args={[0.26, 0.26, 0.05, 16]}
            position={[x * armLength * 0.7, 0.2, z * armLength * 0.7]}
            material={accentLightMaterial}
          />
          {/* Rotor Blades (Abstract transparent disc) */}
          <Cylinder
            args={[0.9, 0.9, 0.02, 32]}
            position={[x * armLength * 0.7, 0.3, z * armLength * 0.7]}
            material={new THREE.MeshStandardMaterial({ color: "#222", transparent: true, opacity: 0.2, side: THREE.DoubleSide })}
          />
        </group>
      ))}
    </group>
  );
}
