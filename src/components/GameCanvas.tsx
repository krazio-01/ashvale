"use client";
import dynamic from "next/dynamic";

const Scene = dynamic(() => import("./Scene/Scene"), { ssr: false });

const GameCanvas = ({ owner, name }: { owner: string; name: string }) => (
    <Scene owner={owner} name={name} />
);

export default GameCanvas;
