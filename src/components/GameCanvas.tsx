"use client";
import dynamic from "next/dynamic";

const Scene = dynamic(() => import("./scene/Scene"), { ssr: false });

export default function GameCanvas() {
    return <Scene />;
}
