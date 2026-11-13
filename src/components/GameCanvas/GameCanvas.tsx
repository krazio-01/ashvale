"use client";
import dynamic from "next/dynamic";

export default dynamic(() => import("@/components/Scene/Scene"), { ssr: false });
