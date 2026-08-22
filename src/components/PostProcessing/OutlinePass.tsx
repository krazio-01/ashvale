"use client";
import { forwardRef, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { Texture } from "three";
import { OutlineEffect } from "@/world/effects/OutlineEffect";

interface IOutlinePassProps {
    outlineColor: string;
    foliageMask: Texture;
}

const OutlinePass = forwardRef<OutlineEffect, IOutlinePassProps>(
    ({ outlineColor, foliageMask }, ref) => {
        const camera = useThree((state) => state.camera);

        const effect = useMemo(
            () => new OutlineEffect({ camera, foliageMask, outlineColor }),
            [camera, foliageMask, outlineColor]
        );

        return <primitive ref={ref} object={effect} dispose={null} />;
    }
);

OutlinePass.displayName = "OutlinePass";

export default OutlinePass;
