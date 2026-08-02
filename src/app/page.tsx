"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, ContactShadows } from "@react-three/drei";
import { DashboardProvider, useDashboard } from "@/lib/DashboardContext";
import DroneModel from "@/components/DroneModel";
import { Activity, Zap, Layers, Settings2, RefreshCcw, Power, Pause, Play, Crosshair, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════════════
   CAMERA CONTROLLER
   Custom orbital camera that replaces OrbitControls so we can implement:
     • Slow continuous auto-orbit (imperceptible frame-to-frame)
     • Gradual push-in over time (sense of inspection)
     • Eased zoom-out when exploded view activates
     • Full user drag-to-orbit + scroll-to-zoom override
═══════════════════════════════════════════════════════════════════════════ */

function DroneCameraController() {
  const { isExploded, cameraResetTrigger } = useDashboard();
  const { camera, gl } = useThree();

  // Spherical coordinates (matches Canvas initial camera: [8,4,8] → r≈12, phi≈0.93, theta≈PI/4)
  const theta      = useRef(Math.PI / 4);
  const phi        = useRef(0.93);         // polar angle from +Y axis
  const radius     = useRef(12.0);         // start at initial canvas camera distance
  const tgtRadius  = useRef(8.5);          // ease toward this

  // User interaction state
  const isDragging = useRef(false);
  const lastXY     = useRef({ x: 0, y: 0 });

  // React to explode/assemble — pull camera back to show all separated parts
  useEffect(() => {
    tgtRadius.current = isExploded ? 11.5 : 8.5;
  }, [isExploded]);

  // Camera reset button — snap back to default framing
  useEffect(() => {
    theta.current     = Math.PI / 4;
    phi.current       = 0.93;
    tgtRadius.current = 8.5;
    // Don't snap radius — let it ease so the reset feels weighted
  }, [cameraResetTrigger]);

  // Pointer + scroll event listeners for user orbit/zoom
  useEffect(() => {
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      isDragging.current = true;
      lastXY.current     = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx   = e.clientX - lastXY.current.x;
      const dy   = e.clientY - lastXY.current.y;
      theta.current -= dx * 0.008;
      phi.current    = THREE.MathUtils.clamp(phi.current + dy * 0.005, 0.15, Math.PI / 2.1);
      lastXY.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { isDragging.current = false; };
    const onWheel = (e: WheelEvent) => {
      tgtRadius.current = THREE.MathUtils.clamp(
        tgtRadius.current + e.deltaY * 0.01, 4.5, 16,
      );
      e.preventDefault();
    };

    el.addEventListener("pointerdown",  onDown);
    el.addEventListener("pointermove",  onMove);
    el.addEventListener("pointerup",    onUp);
    el.addEventListener("pointerleave", onUp);
    el.addEventListener("wheel",        onWheel, { passive: false });

    return () => {
      el.removeEventListener("pointerdown",  onDown);
      el.removeEventListener("pointermove",  onMove);
      el.removeEventListener("pointerup",    onUp);
      el.removeEventListener("pointerleave", onUp);
      el.removeEventListener("wheel",        onWheel);
    };
  }, [gl]);

  useFrame((state, delta) => {
    /* Auto-orbit: very slow, ~2.3°/s — deliberate, premium pace */
    if (!isDragging.current) {
      theta.current += delta * 0.04;

      /* Gradual push-in: drifts from 8.5 → 7.5 over ~25 s.
         Gives a sense of inspection rather than a locked showroom shot. */
      if (!isExploded && tgtRadius.current > 7.5) {
        tgtRadius.current = Math.max(7.5, tgtRadius.current - delta * 0.04);
      }
    }

    /* Ease radius — eased by the lerp coefficient (not linear) */
    radius.current = THREE.MathUtils.lerp(radius.current, tgtRadius.current, delta * 1.2);

    /* Spherical → Cartesian */
    const sinP = Math.sin(phi.current);
    const cosP = Math.cos(phi.current);
    const x    = radius.current * sinP * Math.sin(theta.current);
    const y    = radius.current * cosP;
    const z    = radius.current * sinP * Math.cos(theta.current);

    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCENE
═══════════════════════════════════════════════════════════════════════════ */

/* Subtle 3-D floor grid — created imperatively to avoid R3F extend() requirement */
function FloorGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(40, 40, new THREE.Color("#181820"), new THREE.Color("#141419"));
    g.position.y = -2.8;
    return g;
  }, []);
  return <primitive object={grid} />;
}

function Scene() {

  return (
    <>
      {/* Transparent canvas bg — the page div provides the charcoal colour */}
      <color attach="background" args={["transparent"]} />

      {/* Ambient — keep dim for dramatic contrast */}
      <ambientLight intensity={0.14} />

      {/* Main key light — warm white from front-top-right */}
      <directionalLight
        position={[10, 10, 5]}
        intensity={0.75}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      {/* Warm fill — softens the key-side shadows */}
      <pointLight position={[4, 5, 3]} intensity={0.55} color="#ffe0c0" />

      {/* Cool-neutral fill from rear-left — gives depth without introducing colour cast */}
      <pointLight position={[-4, 3, -3]} intensity={0.18} color="#d0d8ff" />

      {/* Rim / silhouette light — orange-tinted to echo the UI accent */}
      <pointLight position={[0, 1.5, -5]} intensity={0.28} color="#ff9955" />

      {/* City HDRI for natural reflections on the graphite surfaces */}
      <Environment preset="city" />

      {/* GLB model — Suspense boundary swallows the one-frame load stall */}
      <React.Suspense fallback={null}>
        <DroneModel />
      </React.Suspense>

      {/* Ground shadow — slightly intensified to anchor the model */}
      <ContactShadows
        position={[0, -2.8, 0]}
        opacity={0.78}
        scale={15}
        blur={2.5}
        far={4.5}
        color="#000000"
      />

      {/* Subtle 3-D floor grid for spatial depth (barely visible on charcoal) */}
      <FloorGrid />

      {/* Custom camera — replaces OrbitControls */}
      <DroneCameraController />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI PANELS  (unchanged from original — fault logic untouched)
═══════════════════════════════════════════════════════════════════════════ */

function ToastContainer() {
  const { toasts } = useDashboard();
  return (
    <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`
              pointer-events-auto px-4 py-3 rounded-md backdrop-blur-md border shadow-lg flex items-center gap-3 min-w-[300px]
              ${toast.type === "error"   ? "bg-red-500/20 border-red-500/50 text-red-100"     :
                toast.type === "warning" ? "bg-amber-500/20 border-amber-500/50 text-amber-100" :
                toast.type === "success" ? "bg-green-500/20 border-green-500/50 text-green-100" :
                "bg-black/40 border-white/10 text-white"}
            `}
          >
            <div className={`h-2 w-2 rounded-full ${
              toast.type === "error"   ? "bg-red-500"   :
              toast.type === "warning" ? "bg-amber-500" :
              toast.type === "success" ? "bg-green-500" : "bg-blue-500"
            }`} />
            <span className="font-mono text-sm">{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function LiveMonitor() {
  const { liveMonitor } = useDashboard();

  return (
    <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl p-5 pointer-events-auto mb-6">
      <h2 className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-orange-500" /> Live Register / ALU Monitor
      </h2>

      <div className="h-24 flex items-center justify-center border border-white/5 bg-black/40 rounded-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-30" />

        <AnimatePresence mode="wait">
          {liveMonitor.type === "IDLE" && (
            <motion.div key="idle" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="relative z-10">
              <span className="text-3xl font-mono text-white/90">{liveMonitor.value}</span>
            </motion.div>
          )}

          {liveMonitor.type === "SEC_INJECTED" && (
            <motion.div key="sec_inj" initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.9,opacity:0}} className="relative z-10 flex flex-col items-center">
              <span className="text-sm font-mono text-amber-500 mb-1">{liveMonitor.register} [Bit {liveMonitor.bit}]</span>
              <span className="text-3xl font-mono text-amber-500">{liveMonitor.badValue}</span>
            </motion.div>
          )}

          {liveMonitor.type === "SEC_CORRECTED" && (
            <motion.div key="sec_corr" initial={{scale:1.1,opacity:0}} animate={{scale:1,opacity:1}} exit={{opacity:0}} className="relative z-10 flex flex-col items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-1 px-2 py-0.5 bg-amber-500/20 rounded border border-amber-500/30">ECC Corrected</span>
              <span className="text-3xl font-mono text-green-400">{liveMonitor.goodValue}</span>
            </motion.div>
          )}

          {liveMonitor.type === "DED_DETECTED" && (
            <motion.div key="ded" initial={{opacity:0,x:-5}} animate={{opacity:1,x:0}} exit={{opacity:0}} className="relative z-10 flex flex-col items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-red-500 mb-1 px-2 py-0.5 bg-red-500/20 rounded border border-red-500/30 animate-pulse">DED Detected</span>
              <span className="text-3xl font-mono text-red-500 line-through decoration-red-500/50 decoration-2">UNRELIABLE</span>
            </motion.div>
          )}

          {liveMonitor.type === "ALU_INJECTED" && (
            <motion.div key="alu_inj" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="relative z-10 flex gap-4">
              {[0,1,2].map(id => (
                <div key={id} className={`flex flex-col items-center p-2 rounded border ${id === liveMonitor.aluId ? 'border-red-500/50 bg-red-500/10' : 'border-green-500/30 bg-green-500/5'}`}>
                  <span className="text-[10px] text-white/50 mb-1">ALU{id}</span>
                  <span className={`text-sm font-mono ${id === liveMonitor.aluId ? 'text-red-400' : 'text-green-400'}`}>
                    {id === liveMonitor.aluId ? liveMonitor.badValue : liveMonitor.goodValue}
                  </span>
                </div>
              ))}
            </motion.div>
          )}

          {liveMonitor.type === "ALU_RECOVERED" && (
            <motion.div key="alu_rec" initial={{scale:0.8,opacity:0}} animate={{scale:1,opacity:1}} exit={{opacity:0}} className="relative z-10 flex flex-col items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-green-500 mb-1 px-2 py-0.5 bg-green-500/20 rounded border border-green-500/30">TMR Recovered</span>
              <span className="text-3xl font-mono text-green-400">{liveMonitor.goodValue}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function LeftPanel() {
  const { processorState, clock, currentMode, injectFault } = useDashboard();

  return (
    <div className="absolute left-6 top-6 bottom-24 w-[340px] z-10 flex flex-col overflow-y-auto pointer-events-none pb-12 no-scrollbar">
      <LiveMonitor />

      {/* System Status Panel */}
      <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl p-5 pointer-events-auto mb-6">
        <h2 className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-orange-500" /> System Status
        </h2>

        <div className="space-y-4 font-mono text-sm">
          <div className="flex justify-between items-center">
            <span className="text-white/40">Processor</span>
            <span className="text-white text-xs truncate ml-2">RV32E Fault-Tolerant</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-white/40">Clock</span>
            <span className="text-white text-xs">100 MHz</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-white/40">Mode</span>
            <span className="text-orange-500 text-xs">{currentMode}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-white/40">Health</span>
            <span className={`text-xs ${
              processorState === "Running"    ? "text-green-500"  :
              processorState === "Recovering" ? "text-amber-500"  : "text-red-500"
            }`}>
              {processorState}
            </span>
          </div>
        </div>
      </div>

      {/* Fault Injection Panel */}
      <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl p-5 pointer-events-auto">
        <h2 className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-500" /> Fault Injection
        </h2>

        <div className="space-y-3">
          <button
            onClick={() => injectFault("SEC")}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs py-3 px-4 rounded transition-colors text-left flex justify-between group"
          >
            <span>Single-bit ECC</span>
            <span className="text-orange-500/50 group-hover:text-orange-500 text-[10px] font-bold tracking-widest transition-colors">INJECT</span>
          </button>

          <button
            onClick={() => injectFault("DED")}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs py-3 px-4 rounded transition-colors text-left flex justify-between group"
          >
            <span>Double-bit ECC</span>
            <span className="text-orange-500/50 group-hover:text-orange-500 text-[10px] font-bold tracking-widest transition-colors">INJECT</span>
          </button>

          <button
            onClick={() => injectFault("ALU", undefined, undefined, "1")}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs py-3 px-4 rounded transition-colors text-left flex justify-between group"
          >
            <span>ALU Fault</span>
            <span className="text-orange-500/50 group-hover:text-orange-500 text-[10px] font-bold tracking-widest transition-colors">INJECT</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RightPanel() {
  const {
    isExploded, setIsExploded,
    isHovering, setIsHovering,
    isRotating, setIsRotating,
    highlightedModules, toggleHighlightedModule,
  } = useDashboard();

  const subsystems = [
    "CPU", "Register File", "ECC Decoder",
    "ALU Cluster", "Majority Voter",
    "Instruction Memory", "Data Memory",
  ];

  return (
    <div className="absolute right-6 top-6 bottom-24 w-72 z-10 flex flex-col gap-6 pointer-events-none">
      {/* Subsystems Panel */}
      <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl p-5 pointer-events-auto">
        <h2 className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-orange-500" /> Subsystems
        </h2>

        <div className="space-y-3">
          {subsystems.map((sub) => (
            <label key={sub} className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                highlightedModules.includes(sub) ? "border-orange-500 bg-orange-500/20" : "border-white/20 group-hover:border-white/40"
              }`}>
                {highlightedModules.includes(sub) && <div className="w-2 h-2 bg-orange-500 rounded-sm" />}
              </div>
              <span className="text-white/80 font-mono text-xs group-hover:text-white transition-colors">{sub}</span>
              <input
                type="checkbox"
                className="hidden"
                checked={highlightedModules.includes(sub)}
                onChange={() => toggleHighlightedModule(sub)}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Animations Panel */}
      <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl p-5 pointer-events-auto">
        <h2 className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-orange-500" /> Animations
        </h2>

        <div className="space-y-4">
          <label className="flex items-center justify-between cursor-pointer group">
            <span className="text-white/80 font-mono text-xs group-hover:text-white transition-colors">Idle Rotation</span>
            <div className={`w-8 h-4 rounded-full transition-colors relative ${isRotating ? "bg-orange-500" : "bg-white/20"}`}>
              <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${isRotating ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </div>
            <input type="checkbox" className="hidden" checked={isRotating} onChange={(e) => setIsRotating(e.target.checked)} />
          </label>

          <label className="flex items-center justify-between cursor-pointer group">
            <span className="text-white/80 font-mono text-xs group-hover:text-white transition-colors">Hover Animation</span>
            <div className={`w-8 h-4 rounded-full transition-colors relative ${isHovering ? "bg-orange-500" : "bg-white/20"}`}>
              <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${isHovering ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </div>
            <input type="checkbox" className="hidden" checked={isHovering} onChange={(e) => setIsHovering(e.target.checked)} />
          </label>

          <label className="flex items-center justify-between cursor-pointer group">
            <span className="text-white/80 font-mono text-xs group-hover:text-white transition-colors">Exploded View</span>
            <div className={`w-8 h-4 rounded-full transition-colors relative ${isExploded ? "bg-orange-500" : "bg-white/20"}`}>
              <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${isExploded ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </div>
            <input type="checkbox" className="hidden" checked={isExploded} onChange={(e) => setIsExploded(e.target.checked)} />
          </label>
        </div>
      </div>
    </div>
  );
}

function BottomToolbar() {
  const {
    resetDemo,
    isDemoActive, setIsDemoActive,
    triggerCameraReset,
    injectFault,
  } = useDashboard();

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
      <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-full p-2 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={resetDemo}
          className="p-3 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors"
          title="Reset Demo"
        >
          <RefreshCcw className="w-5 h-5" />
        </button>

        <button
          onClick={() => {
            const faults: ("SEC" | "DED" | "ALU")[] = ["SEC", "DED", "ALU"];
            const randomFault = faults[Math.floor(Math.random() * faults.length)];
            injectFault(randomFault, "x5", "0", "0");
          }}
          className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-mono text-xs font-bold tracking-widest rounded-full transition-colors flex items-center gap-2"
        >
          <Zap className="w-4 h-4 fill-white" />
          INJECT RANDOM
        </button>

        <button
          onClick={() => setIsDemoActive(!isDemoActive)}
          className={`p-3 rounded-full transition-colors ${isDemoActive ? "text-orange-500 hover:bg-orange-500/10" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
          title={isDemoActive ? "Pause Auto Demo" : "Start Auto Demo"}
        >
          {isDemoActive ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>

        <button
          onClick={triggerCameraReset}
          className="p-3 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors"
          title="Center Camera"
        >
          <Crosshair className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD ROOT
═══════════════════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  return (
    <DashboardProvider>
      {/* Warm near-black charcoal background (#0d0d10) — not pure black */}
      <div
        className="w-screen h-screen overflow-hidden bg-grid-pattern text-white relative font-sans"
        style={{ backgroundColor: "#0d0d10" }}
      >
        {/* Radial vignette to focus the eye on the 3-D subject */}
        <div className="absolute inset-0 bg-radial-gradient from-transparent to-black/80 pointer-events-none" />

        {/* Title */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
          <h1 className="text-xl font-bold tracking-widest text-white/90 uppercase">Fault Tolerant Processor</h1>
          <p className="text-xs font-mono text-orange-500 mt-1 uppercase tracking-widest">Live Diagnostics</p>
        </div>

        <ToastContainer />
        <LeftPanel />
        <RightPanel />
        <BottomToolbar />

        {/* 3-D Canvas */}
        <div className="absolute inset-0 z-0">
          <Canvas
            shadows={{ type: THREE.PCFShadowMap }}
            camera={{ position: [8, 4, 8], fov: 45 }}
          >
            <Scene />
          </Canvas>
        </div>
      </div>
    </DashboardProvider>
  );
}
