"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    AnimationMixer,
    Box3,
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    Group,
    LoopOnce,
    LoopRepeat,
    Vector3,
} from "three";
import type { AnimationAction, Vector3Tuple } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
    createGltfLoader,
    disposeModelTemplate,
    disposeSkinnedModel,
} from "@/world/assets/AssetLibrary";
import { flattenForInstancing, prepareSkinnedModel } from "@/world/assets/ModelPreparation";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { store } from "@/store/store";
import { worldTierOf } from "@/store/settingsSlice";
import { FractalNoise } from "@/lib/noise";
import {
    blendColors,
    createSeededRandom,
    FULL_TURN,
    pickRandom,
    randomPointInDisc,
    stitchRings,
    valueInRange,
} from "@/lib/helpers";
import { LANDING_ISLAND, LANDING_CHARACTER, LANDING_PROPS } from "@/constants/ui";
import { PLAYER_ASSETS, CLIP } from "@/constants/characters";
import { PLAYER } from "@/constants/player";
import type { IModelTemplate, ISkinnedModel } from "@/types/world";
import type { IThemeEnvironment } from "@/types/themes";
import type { IVector3 } from "@/types/physics";

const HOVERED_CLASS = "landing-character-hovered";

interface IPropSlot {
    modelPath: string;
    position: [number, number, number];
    rotationY: number;
    scale: number;
}

interface IIslandScene {
    geometry: BufferGeometry;
    propSlots: IPropSlot[];
    characterPosition: [number, number, number];
}

interface ILandingModels {
    propTemplates: Map<string, IModelTemplate> | null;
    character: ISkinnedModel | null;
}

const LandingIsland = ({ environment }: { environment: IThemeEnvironment }) => {
    const renderer = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const islandScene = useMemo(() => buildIslandScene(environment), [environment]);
    const materialLibrary = useMemo(() => new MaterialLibrary(), []);
    const [{ propTemplates, character }, setModels] = useState<ILandingModels>({
        propTemplates: null,
        character: null,
    });

    useEffect(
        () =>
            materialLibrary.applyEnvironment(
                environment,
                worldTierOf(store.getState().settings.values).specular
            ),
        [materialLibrary, environment]
    );
    useEffect(() => materialLibrary.followRenderCamera(scene), [materialLibrary, scene]);

    useEffect(() => {
        const loader = createGltfLoader(renderer);
        let isCancelled = false;
        const templates = new Map<string, IModelTemplate>();
        let loadedModel: ISkinnedModel | null = null;

        const loadProps = async () => {
            await Promise.all(
                [...new Set(LANDING_PROPS.modelPaths)].map(async (modelPath) => {
                    const gltf = await loader.loadAsync(modelPath);
                    if (!isCancelled)
                        templates.set(modelPath, flattenForInstancing(gltf.scene, materialLibrary));
                })
            );
            if (!isCancelled) setModels((current) => ({ ...current, propTemplates: templates }));
        };

        const loadCharacter = async () => {
            const [gltf, clipLibraries] = await Promise.all([
                loader.loadAsync(PLAYER_ASSETS.modelPath),
                Promise.all(PLAYER_ASSETS.clipLibraryPaths.map((path) => loader.loadAsync(path))),
            ]);
            if (isCancelled) return;
            loadedModel = prepareSkinnedModel(gltf, clipLibraries, materialLibrary);
            setModels((current) => ({ ...current, character: loadedModel }));
        };

        void loadProps();
        void loadCharacter();

        return () => {
            isCancelled = true;
            templates.forEach(disposeModelTemplate);
            if (loadedModel) disposeSkinnedModel(loadedModel);
        };
    }, [materialLibrary, renderer]);

    useEffect(() => () => materialLibrary.dispose(), [materialLibrary]);
    useEffect(() => () => islandScene.geometry.dispose(), [islandScene]);

    return (
        <group>
            <mesh
                geometry={islandScene.geometry}
                material={materialLibrary.getVertexColorMaterial()}
                castShadow
                receiveShadow
            />

            {propTemplates && (
                <group>
                    {islandScene.propSlots.map((slot, index) => {
                        const template = propTemplates.get(slot.modelPath);
                        return (
                            template && <PropInstance key={index} slot={slot} template={template} />
                        );
                    })}
                </group>
            )}

            {character && (
                <LandingCharacterMesh model={character} position={islandScene.characterPosition} />
            )}
        </group>
    );
};

const PropInstance = ({ slot, template }: { slot: IPropSlot; template: IModelTemplate }) => (
    <group position={slot.position} rotation={[0, slot.rotationY, 0]} scale={slot.scale}>
        {template.parts.map((part, index) => (
            <mesh
                key={index}
                geometry={part.geometry}
                material={part.material}
                castShadow
                receiveShadow
            />
        ))}
    </group>
);

const LandingCharacterMesh = ({
    model,
    position,
}: {
    model: ISkinnedModel;
    position: [number, number, number];
}) => {
    const bounceGroupRef = useRef<Group>(null);
    const mixerRef = useRef<AnimationMixer | null>(null);
    const idleActionRef = useRef<AnimationAction | null>(null);
    const isHovered = useRef(false);
    const isReactingRef = useRef(false);
    const scale = model.height > 0 ? PLAYER.height / model.height : 1;
    const { groundOffset, hitSize, hitCenter } = useMemo(() => {
        const bounds = new Box3().setFromObject(model.scene);
        const offset = -bounds.min.y * scale;
        const center = bounds.getCenter(new Vector3()).multiplyScalar(scale);
        const size = bounds.getSize(new Vector3()).multiplyScalar(scale);
        return {
            groundOffset: offset,
            hitSize: [size.x, size.y, size.z] satisfies Vector3Tuple,
            hitCenter: [center.x, center.y + offset, center.z] satisfies Vector3Tuple,
        };
    }, [model, scale]);

    useEffect(() => {
        const mixer = new AnimationMixer(model.scene);
        const idleClipName = CLIP.idle;
        const idleClip = model.animations.find((clip) => clip.name === idleClipName);

        if (idleClip) {
            const action = mixer.clipAction(idleClip);
            action.setLoop(LoopRepeat, Infinity);
            action.play();
            idleActionRef.current = action;
        }

        mixerRef.current = mixer;

        return () => {
            mixer.stopAllAction();
            mixerRef.current = null;
        };
    }, [model]);

    useEffect(() => () => document.documentElement.classList.remove(HOVERED_CLASS), []);

    const handleClick = (event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const mixer = mixerRef.current;
        const reactionClip = model.animations.find(
            (clip) => clip.name === LANDING_CHARACTER.reactionClipName
        );
        if (isReactingRef.current || !mixer || !reactionClip) return;

        isReactingRef.current = true;
        const reactionAction = mixer.clipAction(reactionClip);
        reactionAction.reset();
        reactionAction.setLoop(LoopOnce, 1);
        reactionAction.clampWhenFinished = true;
        idleActionRef.current?.fadeOut(LANDING_CHARACTER.reactionFadeSeconds);
        reactionAction.fadeIn(LANDING_CHARACTER.reactionFadeSeconds).play();

        const handleFinished = () => {
            mixer.removeEventListener("finished", handleFinished);
            reactionAction.fadeOut(LANDING_CHARACTER.reactionFadeSeconds);
            idleActionRef.current?.reset().fadeIn(LANDING_CHARACTER.reactionFadeSeconds).play();
            isReactingRef.current = false;
        };
        mixer.addEventListener("finished", handleFinished);
    };

    const showHover = (hovered: boolean) => {
        isHovered.current = hovered;
        document.documentElement.classList.toggle(HOVERED_CLASS, hovered);
    };

    const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        showHover(true);
    };

    const handlePointerOut = () => showHover(false);

    useFrame((_, deltaSeconds) => {
        mixerRef.current?.update(deltaSeconds);

        const bounceGroup = bounceGroupRef.current;
        if (!bounceGroup) return;

        if (!isHovered.current && bounceGroup.scale.x === 1) return;
        const bounce = isHovered.current
            ? 1 +
              Math.sin(performance.now() * 0.001 * LANDING_CHARACTER.hoverBounceSpeed) *
                  LANDING_CHARACTER.hoverBounceAmplitude
            : 1;
        bounceGroup.scale.setScalar(bounce);
    });

    return (
        <group position={position}>
            <group ref={bounceGroupRef}>
                <primitive object={model.scene} scale={scale} position={[0, groundOffset, 0]} />
                <mesh
                    visible={false}
                    position={hitCenter}
                    onClick={handleClick}
                    onPointerOver={handlePointerOver}
                    onPointerOut={handlePointerOut}
                >
                    <boxGeometry args={hitSize} />
                </mesh>
            </group>
        </group>
    );
};

function buildIslandScene(environment: IThemeEnvironment): IIslandScene {
    const noise = new FractalNoise(LANDING_ISLAND.noiseSeed);
    const topSurfaceHeightAt = (x: number, z: number): number =>
        noise.sample(
            x * LANDING_ISLAND.surfaceNoiseScale,
            z * LANDING_ISLAND.surfaceNoiseScale,
            3,
            0.5
        ) *
            LANDING_ISLAND.surfaceNoiseAmplitude -
        LANDING_ISLAND.surfaceNoiseAmplitude / 2;

    const geometry = buildIslandGeometry(environment, noise, topSurfaceHeightAt);

    const [characterX, , characterZ] = LANDING_CHARACTER.position;
    const characterPosition: [number, number, number] = [
        characterX,
        topSurfaceHeightAt(characterX, characterZ),
        characterZ,
    ];

    const propSlots = scatterProps(topSurfaceHeightAt);

    return { geometry, propSlots, characterPosition };
}

function buildIslandGeometry(
    environment: IThemeEnvironment,
    noise: FractalNoise,
    topSurfaceHeightAt: (x: number, z: number) => number
): BufferGeometry {
    const { terrain } = environment;
    const ringColors = [
        terrain.grassColor,
        terrain.soilColor,
        blendColors(terrain.soilColor, terrain.rockColor, 0.6),
        terrain.rockColor,
    ];

    const rings = LANDING_ISLAND.ringRadiusRatios.map((radiusRatio, ringIndex) => {
        const baseRadius = LANDING_ISLAND.topRadius * radiusRatio;
        const y = -LANDING_ISLAND.ringDepths[ringIndex];
        const color = new Color(ringColors[ringIndex]);

        const points = Array.from({ length: LANDING_ISLAND.radialSegments }, (_, segment) => {
            const angle = (segment / LANDING_ISLAND.radialSegments) * FULL_TURN;
            const cosAngle = Math.cos(angle);
            const sinAngle = Math.sin(angle);
            const radius =
                ringIndex === 0
                    ? baseRadius
                    : jitteredRadius(baseRadius, cosAngle, sinAngle, ringIndex, noise);
            const x = cosAngle * radius;
            const z = sinAngle * radius;
            const vertexY = ringIndex === 0 ? topSurfaceHeightAt(x, z) : y;

            return { x, y: vertexY, z };
        });

        return { points, color };
    });

    const positions: number[] = [];
    const colors: number[] = [];

    const pushTriangle = (
        a: IVector3,
        b: IVector3,
        c: IVector3,
        colorA: Color,
        colorB: Color,
        colorC: Color
    ): void => {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        colors.push(
            colorA.r,
            colorA.g,
            colorA.b,
            colorB.r,
            colorB.g,
            colorB.b,
            colorC.r,
            colorC.g,
            colorC.b
        );
    };

    const capCenter = { x: 0, y: topSurfaceHeightAt(0, 0), z: 0 };
    const capColor = new Color(ringColors[0]);
    const rimRing = rings[0];

    for (let segment = 0; segment < LANDING_ISLAND.radialSegments; segment += 1) {
        const current = rimRing.points[segment];
        const next = rimRing.points[(segment + 1) % LANDING_ISLAND.radialSegments];

        pushTriangle(capCenter, next, current, capColor, rimRing.color, rimRing.color);
    }

    stitchRings(rings, positions, colors);

    const finalRing = rings[rings.length - 1];
    const apex = { x: 0, y: -LANDING_ISLAND.apexDepth, z: 0 };
    const apexColor = new Color(terrain.rockColor);

    for (let segment = 0; segment < LANDING_ISLAND.radialSegments; segment += 1) {
        const current = finalRing.points[segment];
        const next = finalRing.points[(segment + 1) % LANDING_ISLAND.radialSegments];

        pushTriangle(current, next, apex, finalRing.color, finalRing.color, apexColor);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    return geometry;
}

function jitteredRadius(
    baseRadius: number,
    cosAngle: number,
    sinAngle: number,
    ringIndex: number,
    noise: FractalNoise
): number {
    const noiseX = cosAngle * LANDING_ISLAND.edgeNoiseScale + ringIndex * 11.7;
    const noiseZ = sinAngle * LANDING_ISLAND.edgeNoiseScale + ringIndex * 5.3;
    const noiseValue = noise.sample(noiseX, noiseZ, 2, 0.5);
    const jitterStrength =
        LANDING_ISLAND.edgeJitterRatio + ringIndex * LANDING_ISLAND.craggingGrowthPerRing;

    return baseRadius * (1 + (noiseValue - 0.5) * 2 * jitterStrength);
}

function scatterProps(topSurfaceHeightAt: (x: number, z: number) => number): IPropSlot[] {
    const nextRandom = createSeededRandom(LANDING_PROPS.seed);
    const slots: IPropSlot[] = [];

    for (
        let attempt = 0;
        attempt < LANDING_PROPS.placementAttempts && slots.length < LANDING_PROPS.instanceCount;
        attempt += 1
    ) {
        const [x, z] = randomPointInDisc(nextRandom, LANDING_PROPS.scatterRadius);

        const isFarEnoughFromProps = slots.every(
            (slot) =>
                Math.hypot(slot.position[0] - x, slot.position[2] - z) >= LANDING_PROPS.minSpacing
        );
        const isFarEnoughFromCharacter =
            Math.hypot(LANDING_CHARACTER.position[0] - x, LANDING_CHARACTER.position[2] - z) >=
            LANDING_CHARACTER.reservedClearance;
        if (!isFarEnoughFromProps || !isFarEnoughFromCharacter) continue;

        const modelPath = pickRandom(LANDING_PROPS.modelPaths, nextRandom);

        slots.push({
            modelPath,
            position: [x, topSurfaceHeightAt(x, z), z],
            rotationY: nextRandom() * FULL_TURN,
            scale: valueInRange(LANDING_PROPS.scaleRange, nextRandom()),
        });
    }

    return slots;
}

export default LandingIsland;
