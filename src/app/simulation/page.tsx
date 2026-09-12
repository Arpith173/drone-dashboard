"use client";

import React, { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import Navigation from "@/components/Navigation";
import { motion, AnimatePresence } from "framer-motion";

// ═══════════════════════════════════════════════════════════════════════════
// 3D SCENE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

const Drone = React.forwardRef<THREE.Group, { activeFault: "NORMAL" | "SEC" | "DED" }>((props, ref) => {
  const { scene } = useGLTF("/rc_quadcopter_v3.glb");
  const internalRef = useRef<THREE.Group>(null);
  
  // Expose to parent
  React.useImperativeHandle(ref, () => internalRef.current!);

  const state = useRef<"NORMAL" | "SEC" | "DED">("NORMAL");
  const landingState = useRef<{ active: boolean; startX: number; startZ: number; }>({ active: false, startX: 0, startZ: 0 });
  const secWobbleTime = useRef(0);
  const pathTime = useRef(0);
  const pulseTime = useRef(0);
  
  const { cloned, normScale, normOffset, bodyMaterials } = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.position.set(0, 0, 0);
    cloned.rotation.set(0, 0, 0);
    cloned.scale.set(1, 1, 1);
    cloned.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(cloned);
    const sz = box.getSize(new THREE.Vector3());
    const ct = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z, 0.001);

    const normScale = 4.0 / maxDim;
    const normOffset = ct.clone().negate().multiplyScalar(normScale);

    const GRAPHITE_COLOR = new THREE.Color("#141416");
    const mats: THREE.MeshStandardMaterial[] = [];
    
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // Hide the subsystems that are normally exploded out of the drone
        if (mesh.name.startsWith("Layer_")) {
          mesh.visible = false;
        } else {
          const mat = new THREE.MeshStandardMaterial({
            color: GRAPHITE_COLOR,
            roughness: 0.72,
            metalness: 0.35,
            emissive: new THREE.Color(0, 0, 0),
            emissiveIntensity: 1,
          });
          mesh.material = mat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mats.push(mat);
        }
      }
    });
    return { cloned, normScale, normOffset, bodyMaterials: mats };
  }, [scene]);

  useEffect(() => {
    if (props.activeFault === "DED") {
      if (state.current !== "DED") {
        state.current = "DED";
        if (internalRef.current) {
          landingState.current = {
            active: true,
            startX: internalRef.current.position.x,
            startZ: internalRef.current.position.z,
          };
        }
      }
    } else if (props.activeFault === "SEC") {
      if (state.current !== "DED") {
        state.current = "SEC";
        secWobbleTime.current = 1.5;
      }
    } else {
      if (state.current === "DED") {
        state.current = "NORMAL";
        landingState.current.active = false;
      }
    }
  }, [props.activeFault]);

  useFrame((rootState, delta) => {
    if (!internalRef.current) return;
    
    const isDED = state.current === "DED";
    const landed = isDED && internalRef.current.position.y <= 0.15;
    
    let propSpeed = 20;
    if (isDED) propSpeed = landed ? 0 : 5;
    else if (state.current === "SEC") propSpeed = 20 + Math.sin(rootState.clock.elapsedTime * 20) * 10;
    
    cloned.traverse((child) => {
      if (child.name.toLowerCase().includes("prop")) {
        child.rotation.y += propSpeed * delta;
      }
    });

    if (isDED) {
      pulseTime.current += delta;
      const intensity = (Math.sin(pulseTime.current * 3) + 1) / 2;
      bodyMaterials.forEach(m => {
        m.emissive = new THREE.Color(0xff0000);
        m.emissiveIntensity = intensity * 2;
      });
    } else if (state.current === "SEC" && secWobbleTime.current > 0) {
      bodyMaterials.forEach(m => {
        m.emissive = new THREE.Color(0xffaa00);
        m.emissiveIntensity = 2;
      });
    } else {
      bodyMaterials.forEach(m => {
        m.emissive = new THREE.Color(0x000000);
        m.emissiveIntensity = 0;
      });
    }

    if (isDED) {
      if (internalRef.current.position.y > 0.1) {
        internalRef.current.position.y -= 0.8 * delta;
        if (internalRef.current.position.y < 0.1) internalRef.current.position.y = 0.1;
        internalRef.current.position.x = landingState.current.startX;
        internalRef.current.position.z = landingState.current.startZ;
        internalRef.current.quaternion.slerp(new THREE.Quaternion().identity(), 5 * delta);
      }
    } else {
      pathTime.current += delta * 0.4;
      const a = 8;
      const b = 5;
      const x = Math.cos(pathTime.current) * a;
      const z = Math.sin(pathTime.current) * b;
      
      const hoverBob = Math.sin(rootState.clock.elapsedTime * 2) * 0.15;
      let targetY = 3 + hoverBob;
      
      if (internalRef.current.position.y < 2.8) {
         internalRef.current.position.y = THREE.MathUtils.lerp(internalRef.current.position.y, targetY, delta * 2);
      } else {
         internalRef.current.position.y = targetY;
      }
      
      internalRef.current.position.x = x;
      internalRef.current.position.z = z;
      
      const dx = -Math.sin(pathTime.current) * a;
      const dz = Math.cos(pathTime.current) * b;
      const angle = Math.atan2(dx, dz);
      
      const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      
      if (state.current === "SEC" && secWobbleTime.current > 0) {
        secWobbleTime.current -= delta;
        const wobbleIntensity = (secWobbleTime.current / 1.5) * 0.1;
        const roll = (Math.random() - 0.5) * wobbleIntensity;
        const pitch = (Math.random() - 0.5) * wobbleIntensity;
        const wobbleQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll));
        targetQuat.multiply(wobbleQuat);
      }
      
      internalRef.current.quaternion.slerp(targetQuat, 10 * delta);
    }
  });

  return (
    <group ref={internalRef}>
      <group position={[normOffset.x, normOffset.y, normOffset.z]} scale={normScale}>
        <primitive object={cloned} />
      </group>
    </group>
  );
});
Drone.displayName = "Drone";

useGLTF.preload("/rc_quadcopter_v3.glb");

function Environment() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1.5} />
      
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#1a1a1e" />
      </mesh>
      
      <gridHelper args={[50, 50, "#333333", "#222222"]} position={[0, 0.001, 0]} />
    </>
  );
}

function SceneContainer({ activeFault }: { activeFault: "NORMAL" | "SEC" | "DED" }) {
  const droneRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Group>(null);
  const wasDED = useRef(false);

  useFrame((state, delta) => {
    const isDED = activeFault === "DED";
    if (isDED && !wasDED.current && droneRef.current && markerRef.current) {
      markerRef.current.position.set(
        droneRef.current.position.x,
        0.01,
        droneRef.current.position.z
      );
      markerRef.current.visible = true;
      wasDED.current = true;
    } else if (!isDED && wasDED.current) {
      if (markerRef.current) markerRef.current.visible = false;
      wasDED.current = false;
    }

    // Soft chase camera - update OrbitControls target to drone position
    if (droneRef.current && state.controls) {
      const controls = state.controls as any;
      controls.target.lerp(droneRef.current.position, delta * 2);
      controls.update();
    }
  });

  return (
    <>
      <Environment />
      <group ref={markerRef} visible={false}>
         <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <ringGeometry args={[1.4, 1.5, 32]} />
            <meshBasicMaterial color="#f97316" side={THREE.DoubleSide} />
         </mesh>
         <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[0.1, 3]} />
            <meshBasicMaterial color="#f97316" />
         </mesh>
         <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[3, 0.1]} />
            <meshBasicMaterial color="#f97316" />
         </mesh>
      </group>
      <Drone ref={droneRef} activeFault={activeFault} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE & HUD
// ═══════════════════════════════════════════════════════════════════════════

export default function SimulationPage() {
  const [activeFault, setActiveFault] = useState<"NORMAL" | "SEC" | "DED">("NORMAL");
  const [events, setEvents] = useState<{ id: number, time: string, text: string }[]>([]);
  
  // Track DED descent state
  const [dedState, setDedState] = useState<"DETECTED" | "LANDING" | "LANDED">("DETECTED");

  const activeFaultRef = useRef(activeFault);
  useEffect(() => {
    activeFaultRef.current = activeFault;
  }, [activeFault]);

  const addEvent = (text: string) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setEvents(prev => [...prev, { id: Date.now(), time: timeStr, text }].slice(-5));
  };

  const injectSEC = () => {
    if (activeFaultRef.current === "DED") return; // DED is unrecoverable until reset
    setActiveFault("SEC");
    addEvent("SEC injected, auto-correcting...");
    
    // Auto-recover after 1.5s visual wobble completes
    setTimeout(() => {
      if (activeFaultRef.current !== "DED") {
        setActiveFault("NORMAL");
        addEvent("SEC corrected — flight nominal");
      }
    }, 1500);
  };

  const injectDED = () => {
    if (activeFaultRef.current === "DED") return;
    setActiveFault("DED");
    setDedState("DETECTED");
    addEvent("DED detected, safe land initiated");
    
    setTimeout(() => setDedState("LANDING"), 1000);
    setTimeout(() => setDedState("LANDED"), 4000); // approx landing time
  };

  const resetSim = () => {
    setActiveFault("NORMAL");
    addEvent("Simulation reset to nominal flight");
  };

  // HUD Status text
  let statusText = "STATUS: NOMINAL";
  let statusColor = "text-green-500";
  
  if (activeFault === "DED") {
    statusColor = "text-red-500";
    if (dedState === "DETECTED") statusText = "DED DETECTED — UNCORRECTABLE ERROR";
    else if (dedState === "LANDING") statusText = "INITIATING SAFE LAND";
    else statusText = "LANDED SAFELY";
  } else if (activeFault === "SEC") {
    statusColor = "text-amber-500";
    statusText = "FAULT DETECTED — CORRECTED";
  }

  return (
    <div className="relative w-full h-screen bg-[#0d0d10] overflow-hidden">
      <Navigation />
      
      {/* HUD OVERLAY */}
      <div className="absolute inset-0 pointer-events-none z-10 p-6 flex flex-col justify-between">
        {/* TOP LEFT */}
        <div className="flex flex-col gap-4 items-start">
          <h1 className="text-xl font-bold tracking-[0.2em] text-white/90 uppercase border-b border-orange-500/50 pb-2">
            Fault Response Simulation
          </h1>
          <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-3 rounded-lg shadow-lg">
            <p className={`font-mono text-sm font-bold tracking-wider ${statusColor}`}>
              {statusText}
            </p>
          </div>
        </div>

        {/* BOTTOM LEFT: Event Log */}
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-lg p-3 w-96 shadow-lg">
          <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest mb-2 border-b border-white/10 pb-1">
            Event Log
          </h3>
          <div className="flex flex-col gap-1 font-mono text-xs overflow-hidden h-24">
            <AnimatePresence initial={false}>
              {events.length === 0 ? (
                <p className="text-white/30 italic">No events recorded</p>
              ) : (
                events.map((ev) => (
                  <motion.div
                    key={ev.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-white/70 flex gap-2"
                  >
                    <span className="text-white/40">{ev.time}</span>
                    <span>—</span>
                    <span className={ev.text.includes("DED") ? "text-red-400" : "text-amber-400"}>
                      {ev.text}
                    </span>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* BOTTOM RIGHT: Controls Panel */}
      <div className="absolute bottom-6 right-6 bg-black/60 backdrop-blur-xl border border-white/10 rounded-lg p-4 flex flex-col gap-3 shadow-lg pointer-events-auto z-10">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest mb-1 border-b border-white/10 pb-1">
          Manual Injection
        </h3>
        <button onClick={injectSEC} className="bg-amber-500/10 text-amber-500 border border-amber-500/50 hover:bg-amber-500/20 px-4 py-2 rounded text-xs font-bold tracking-wider transition-colors">
          INJECT SEC / TMR FAULT
        </button>
        <button onClick={injectDED} className="bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20 px-4 py-2 rounded text-xs font-bold tracking-wider transition-colors">
          INJECT DED FAULT
        </button>
        <button onClick={resetSim} className="bg-white/5 text-white/70 border border-white/20 hover:bg-white/10 px-4 py-2 rounded text-xs font-bold tracking-wider transition-colors mt-2">
          RESET FLIGHT
        </button>
      </div>
      
      {/* 3D CANVAS */}
      <Canvas camera={{ position: [0, 8, 15], fov: 50 }}>
        <OrbitControls 
          makeDefault
          enablePan={false}
          maxPolarAngle={Math.PI / 2 - 0.05} // Don't go below ground
          minDistance={5}
          maxDistance={30}
        />
        <SceneContainer activeFault={activeFault} />
      </Canvas>
    </div>
  );
}
