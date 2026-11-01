"use client";
import dynamic from "next/dynamic";

export default dynamic(() => import("./Landing/Landing"), { ssr: false });
