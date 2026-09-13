"use client";
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import { useSettings } from "@/settings/SettingsStore";

export function useFov(): void {
    const { fov } = useSettings();
    const camera = useThree((state) => state.camera);

    useEffect(() => {
        if (!(camera instanceof PerspectiveCamera)) return;

        // eslint-disable-next-line react-hooks/immutability
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }, [fov, camera]);
}

export default useFov;
