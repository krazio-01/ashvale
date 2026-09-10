"use client";
import dynamic from "next/dynamic";

const Landing = dynamic(() => import("./Landing/Landing"), { ssr: false });

const LandingCanvas = () => <Landing />;

export default LandingCanvas;
