"use client";
import dynamic from "next/dynamic";

const isPerfOverlayEnabled = process.env.NEXT_PUBLIC_ENABLE_PERF === "true";

const Perf = isPerfOverlayEnabled
    ? dynamic(() => import("r3f-webgpu-perf").then((module) => module.Perf), { ssr: false })
    : null;

const PerformanceOverlay = () => (Perf ? <Perf position="top-left" /> : null);

export default PerformanceOverlay;
