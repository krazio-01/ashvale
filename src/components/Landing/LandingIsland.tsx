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
} from "three";
import type { AnimationAction } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
    flattenForInstancing,
    prepareSkinnedModel,
    createGltfLoader,
    disposeModelTemplate,
    disposeSkinnedModel,
} from "@/world/assets/AssetLibrary";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { FOLIAGE_LAYER } from "@/constants/world";
import { FractalNoise } from "@/lib/noise";
import {
    blendColors,
    createSeededRandom,
    FULL_TURN,
    pickRandom,
    randomPointInDisc,
    valueInRange,
} from "@/lib/helpers";
import { LANDING_ISLAND, LANDING_CHARACTER, LANDING_PROPS } from "@/constants/ui";
import { PLAYER_ASSETS, CLIP } from "@/constants/characters";
import { PLAYER } from "@/constants/player";
import type { IThemeEnvironment, IModelTemplate, ISkinnedModel } from "@/types/world";
import type { IVector3 } from "@/types/physics";

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

export interface ILandingRing {
    points: readonly IVector3[];
    color?: Color;
}

const LandingIsland = ({ environment }: { environment: IThemeEnvironment }) => {
    const renderer = useThree((state) => state.gl);
    const islandScene = useMemo(() => buildIslandScene(environment), [environment]);
    const [materialLibrary] = useState(() => new MaterialLibrary());
    const [propTemplates, setPropTemplates] = useState<Map<string, IModelTemplate> | null>(null);
    const [characterModel, setCharacterModel] = useState<ISkinnedModel | null>(null);

    useEffect(() => {
        const loader = createGltfLoader(renderer);
        let isCancelled = false;
        let loadedTemplates: Map<string, IModelTemplate> | null = null;
        let loadedModel: ISkinnedModel | null = null;

        const loadProps = async () => {
            const uniquePaths = [...new Set(LANDING_PROPS.modelPaths)];
            const loaded = await Promise.all(
                uniquePaths.map(async (modelPath) => {
                    const gltf = await loader.loadAsync(modelPath);
                    return [modelPath, flattenForInstancing(gltf.scene, materialLibrary)] as const;
                })
            );
            loadedTemplates = new Map(loaded);
            if (isCancelled) loadedTemplates.forEach(disposeModelTemplate);
            else setPropTemplates(loadedTemplates);
        };

        const loadCharacter = async () => {
            const [gltf, clipLibraries] = await Promise.all([
                loader.loadAsync(PLAYER_ASSETS.modelPath),
                Promise.all(PLAYER_ASSETS.clipLibraryPaths.map((path) => loader.loadAsync(path))),
            ]);
            loadedModel = prepareSkinnedModel(gltf, clipLibraries, materialLibrary);
            if (isCancelled) disposeSkinnedModel(loadedModel);
            else setCharacterModel(loadedModel);
        };

        void loadProps();
        void loadCharacter();

        return () => {
            isCancelled = true;
            loadedTemplates?.forEach(disposeModelTemplate);
            if (loadedModel) disposeSkinnedModel(loadedModel);
        };
    }, [materialLibrary, renderer]);

    useEffect(() => () => materialLibrary.dispose(), [materialLibrary]);
    useEffect(() => () => islandScene.geometry.dispose(), [islandScene]);

    return (
        <group>
            <mesh
                geometry={islandScene.geometry}
                material={materialLibrary.getVertexColorToonMaterial()}
                castShadow
                receiveShadow
            />

            {propTemplates && (
                <group>
                    {islandScene.propSlots.map((slot, index) => (
                        <PropInstance
                            key={index}
                            slot={slot}
                            template={propTemplates.get(slot.modelPath)!}
                        />
                    ))}
                </group>
            )}

            {characterModel && (
                <LandingCharacterMesh
                    model={characterModel}
                    position={islandScene.characterPosition}
                />
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
                ref={(mesh) => {
                    if (part.isFoliage) mesh?.layers.enable(FOLIAGE_LAYER);
                }}
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
    const [isHovered, setIsHovered] = useState(false);
    const isReactingRef = useRef(false);
    const scale = model.height > 0 ? PLAYER.height / model.height : 1;
    const groundOffset = useMemo(
        () => -new Box3().setFromObject(model.scene).min.y * scale,
        [model, scale]
    );

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

    useEffect(() => {
        document.documentElement.classList.toggle("landing-character-hovered", isHovered);
        return () => document.documentElement.classList.remove("landing-character-hovered");
    }, [isHovered]);

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

    const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setIsHovered(true);
    };

    const handlePointerOut = () => setIsHovered(false);

    useFrame((_, deltaSeconds) => {
        mixerRef.current?.update(deltaSeconds);

        const bounceGroup = bounceGroupRef.current;
        if (!bounceGroup) return;

        const bounce = isHovered
            ? 1 +
              Math.sin(performance.now() * 0.001 * LANDING_CHARACTER.hoverBounceSpeed) *
                  LANDING_CHARACTER.hoverBounceAmplitude
            : 1;
        bounceGroup.scale.setScalar(bounce);
    });

    return (
        <group position={position}>
            <group
                ref={bounceGroupRef}
                onClick={handleClick}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
            >
                <primitive object={model.scene} scale={scale} position={[0, groundOffset, 0]} />
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
            const radius =
                ringIndex === 0 ? baseRadius : jitteredRadius(baseRadius, angle, ringIndex, noise);
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
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

export function stitchRings(
    rings: readonly ILandingRing[],
    positions: number[],
    colors: number[]
): void {
    const pushCorner = (ring: ILandingRing, segment: number): void => {
        const point = ring.points[segment % ring.points.length]!;
        positions.push(point.x, point.y, point.z);
        if (ring.color) colors.push(ring.color.r, ring.color.g, ring.color.b);
    };

    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
        const upper = rings[ringIndex]!;
        const lower = rings[ringIndex + 1]!;
        for (let segment = 0; segment < upper.points.length; segment += 1) {
            pushCorner(upper, segment);
            pushCorner(lower, segment + 1);
            pushCorner(lower, segment);
            pushCorner(upper, segment);
            pushCorner(upper, segment + 1);
            pushCorner(lower, segment + 1);
        }
    }
}

function jitteredRadius(
    baseRadius: number,
    angle: number,
    ringIndex: number,
    noise: FractalNoise
): number {
    const noiseX = Math.cos(angle) * LANDING_ISLAND.edgeNoiseScale + ringIndex * 11.7;
    const noiseZ = Math.sin(angle) * LANDING_ISLAND.edgeNoiseScale + ringIndex * 5.3;
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
