import { LIGHT, PALETTE, WORLD } from "@/constants/game";

const SceneLighting = () => (
    <>
        <color attach="background" args={[PALETTE.void]} />
        <fog attach="fog" args={[PALETTE.haze, WORLD.fogNear, WORLD.fogFar]} />

        <hemisphereLight args={[PALETTE.skyFill, PALETTE.bounceFill, LIGHT.hemisphereIntensity]} />

        <directionalLight
            castShadow
            color={PALETTE.keyLight}
            intensity={LIGHT.keyIntensity}
            position={LIGHT.keyPosition}
            shadow-bias={LIGHT.shadowBias}
            shadow-mapSize-width={LIGHT.shadowMapSize}
            shadow-mapSize-height={LIGHT.shadowMapSize}
            shadow-camera-left={-LIGHT.shadowExtent}
            shadow-camera-right={LIGHT.shadowExtent}
            shadow-camera-top={LIGHT.shadowExtent}
            shadow-camera-bottom={-LIGHT.shadowExtent}
            shadow-camera-far={LIGHT.shadowFar}
        />

        <directionalLight
            color={PALETTE.rimLight}
            intensity={LIGHT.rimIntensity}
            position={LIGHT.rimPosition}
        />
    </>
);

export default SceneLighting;
