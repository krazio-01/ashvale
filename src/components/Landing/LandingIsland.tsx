"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AnimationMixer,
    Box3,
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    Group,
    LoopOnce,
    LoopRepeat,
    SkinnedMesh,
} from "three";
import type { AnimationAction } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { flattenForInstancing, prepareSkinnedModel } from "@/world/assets/AssetLibrary";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { FOLIAGE_LAYER } from "@/world/effects/FoliageMaskPass";
import { FractalNoise } from "@/lib/noise";
import { blendColors, createSeededRandom, FULL_TURN } from "@/lib/helpers";
import { ISLAND, LANDING_CHARACTER, LANDING_PROPS } from "@/constants/landing";
import { CharacterMotion, CHARACTER, MOTION_CLIPS, PLAYER } from "@/constants/characters";
import type { IThemeEnvironment } from "@/types/theme";
import type { IModelTemplate, ISkinnedModel } from "@/types/world";

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

const LandingIsland = ({ environment }: { environment: IThemeEnvironment }) => {
    const islandScene = useMemo(() => buildIslandScene(environment), [environment]);
    const [materialLibrary] = useState(() => new MaterialLibrary());
    const [propTemplates, setPropTemplates] = useState<Map<string, IModelTemplate> | null>(null);
    const [characterModel, setCharacterModel] = useState<ISkinnedModel | null>(null);

    useEffect(() => {
        const loader = new GLTFLoader();
        let isCancelled = false;
        let loadedTemplates: Map<string, IModelTemplate> | null = null;

        const loadProps = async () => {
            const uniquePaths = [...new Set(LANDING_PROPS.modelPaths)];
            const loaded = await Promise.all(
                uniquePaths.map(async (modelPath) => {
                    const gltf = await loader.loadAsync(modelPath);
                    return [modelPath, flattenForInstancing(gltf.scene, materialLibrary)] as const;
                })
            );

            const templates = new Map(loaded);
            if (isCancelled) {
                disposeTemplates(templates);
                return;
            }

            loadedTemplates = templates;
            setPropTemplates(templates);
        };

        void loadProps();

        return () => {
            isCancelled = true;
            if (loadedTemplates) disposeTemplates(loadedTemplates);
        };
    }, [materialLibrary]);

    useEffect(() => {
        const loader = new GLTFLoader();
        let isCancelled = false;
        let loadedModel: ISkinnedModel | null = null;

        const loadCharacter = async () => {
            const gltf = await loader.loadAsync(CHARACTER.modelPath);
            const model = prepareSkinnedModel(gltf, [], materialLibrary);
            if (isCancelled) {
                disposeSkinnedModel(model);
                return;
            }

            loadedModel = model;
            setCharacterModel(model);
        };

        void loadCharacter();

        return () => {
            isCancelled = true;
            if (loadedModel) disposeSkinnedModel(loadedModel);
        };
    }, [materialLibrary]);

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
                    {islandScene.propSlots.map((slot, index) => {
                        const template = propTemplates.get(slot.modelPath);
                        if (!template) return null;

                        return <PropInstance key={index} slot={slot} template={template} />;
                    })}
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
    const [isReacting, setIsReacting] = useState(false);
    const scale = model.height > 0 ? PLAYER.height / model.height : 1;
    const groundOffset = useMemo(
        () => -new Box3().setFromObject(model.scene).min.y * scale,
        [model, scale]
    );

    useEffect(() => {
        const mixer = new AnimationMixer(model.scene);
        const idleClipName = MOTION_CLIPS[CharacterMotion.Idle].clipName;
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
        if (!isReacting) return;

        const mixer = mixerRef.current;
        const reactionClip = model.animations.find(
            (clip) => clip.name === LANDING_CHARACTER.reactionClipName
        );

        if (!mixer || !reactionClip) {
            setIsReacting(false);
            return;
        }

        const reactionAction = mixer.clipAction(reactionClip);
        reactionAction.reset();
        reactionAction.setLoop(LoopOnce, 1);
        reactionAction.clampWhenFinished = true;
        idleActionRef.current?.fadeOut(LANDING_CHARACTER.reactionFadeSeconds);
        reactionAction.fadeIn(LANDING_CHARACTER.reactionFadeSeconds).play();

        const handleFinished = () => {
            reactionAction.fadeOut(LANDING_CHARACTER.reactionFadeSeconds);
            idleActionRef.current?.reset().fadeIn(LANDING_CHARACTER.reactionFadeSeconds).play();
            setIsReacting(false);
        };

        mixer.addEventListener("finished", handleFinished);
        return () => mixer.removeEventListener("finished", handleFinished);
    }, [isReacting, model]);

    useEffect(() => {
        document.documentElement.classList.toggle("landing-character-hovered", isHovered);
        return () => document.documentElement.classList.remove("landing-character-hovered");
    }, [isHovered]);

    const handleClick = useCallback(
        (event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            if (isReacting) return;
            setIsReacting(true);
        },
        [isReacting]
    );

    const handlePointerOver = useCallback((event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setIsHovered(true);
    }, []);

    const handlePointerOut = useCallback(() => setIsHovered(false), []);

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
        <group position={position} rotation={[0, LANDING_CHARACTER.rotationY, 0]}>
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

function disposeTemplates(templates: Map<string, IModelTemplate>): void {
    for (const template of templates.values())
        for (const part of template.parts) part.geometry.dispose();
}

function disposeSkinnedModel(model: ISkinnedModel): void {
    model.scene.traverse((object) => {
        if (object instanceof SkinnedMesh) object.geometry.dispose();
    });
}

function buildIslandScene(environment: IThemeEnvironment): IIslandScene {
    const noise = new FractalNoise(ISLAND.noiseSeed);
    const topSurfaceHeightAt = (x: number, z: number): number =>
        noise.sample(x * ISLAND.surfaceNoiseScale, z * ISLAND.surfaceNoiseScale, 3, 0.5) *
            ISLAND.surfaceNoiseAmplitude -
        ISLAND.surfaceNoiseAmplitude / 2;

    const geometry = buildIslandGeometry(environment, noise, topSurfaceHeightAt);

    const [characterX, , characterZ] = LANDING_CHARACTER.position;
    const characterPosition: [number, number, number] = [
        characterX,
        topSurfaceHeightAt(characterX, characterZ),
        characterZ,
    ];

    const propSlots = scatterProps(topSurfaceHeightAt, [
        { x: characterX, z: characterZ, clearance: LANDING_CHARACTER.reservedClearance },
    ]);

    return { geometry, propSlots, characterPosition };
}

function buildIslandGeometry(
    environment: IThemeEnvironment,
    noise: FractalNoise,
    topSurfaceHeightAt: (x: number, z: number) => number
): BufferGeometry {
    const { terrain } = environment;
    const ringColors = [
        terrain.wildColor,
        terrain.soilColor,
        blendColors(terrain.soilColor, terrain.rockColor, 0.6),
        terrain.rockColor,
    ];

    const rings = ISLAND.ringRadiusRatios.map((radiusRatio, ringIndex) => {
        const baseRadius = ISLAND.topRadius * radiusRatio;
        const y = -(ISLAND.ringDepths[ringIndex] ?? 0);
        const color = new Color(ringColors[ringIndex] ?? terrain.rockColor);

        const points = Array.from({ length: ISLAND.radialSegments }, (_, segment) => {
            const angle = (segment / ISLAND.radialSegments) * FULL_TURN;
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
        a: { x: number; y: number; z: number },
        b: { x: number; y: number; z: number },
        c: { x: number; y: number; z: number },
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
    const capColor = new Color(ringColors[0] ?? terrain.wildColor);
    const rimRing = rings[0];

    if (rimRing)
        for (let segment = 0; segment < ISLAND.radialSegments; segment += 1) {
            const current = rimRing.points[segment];
            const next = rimRing.points[(segment + 1) % ISLAND.radialSegments];
            if (!current || !next) continue;

            pushTriangle(capCenter, next, current, capColor, rimRing.color, rimRing.color);
        }

    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
        const upperRing = rings[ringIndex];
        const lowerRing = rings[ringIndex + 1];
        if (!upperRing || !lowerRing) continue;

        for (let segment = 0; segment < ISLAND.radialSegments; segment += 1) {
            const nextSegment = (segment + 1) % ISLAND.radialSegments;
            const upperCurrent = upperRing.points[segment];
            const upperNext = upperRing.points[nextSegment];
            const lowerCurrent = lowerRing.points[segment];
            const lowerNext = lowerRing.points[nextSegment];
            if (!upperCurrent || !upperNext || !lowerCurrent || !lowerNext) continue;

            pushTriangle(
                upperCurrent,
                lowerNext,
                lowerCurrent,
                upperRing.color,
                lowerRing.color,
                lowerRing.color
            );
            pushTriangle(
                upperCurrent,
                upperNext,
                lowerNext,
                upperRing.color,
                upperRing.color,
                lowerRing.color
            );
        }
    }

    const finalRing = rings[rings.length - 1];
    const apex = { x: 0, y: -ISLAND.apexDepth, z: 0 };
    const apexColor = new Color(terrain.rockColor);

    if (finalRing)
        for (let segment = 0; segment < ISLAND.radialSegments; segment += 1) {
            const current = finalRing.points[segment];
            const next = finalRing.points[(segment + 1) % ISLAND.radialSegments];
            if (!current || !next) continue;

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
    angle: number,
    ringIndex: number,
    noise: FractalNoise
): number {
    const noiseX = Math.cos(angle) * ISLAND.edgeNoiseScale + ringIndex * 11.7;
    const noiseZ = Math.sin(angle) * ISLAND.edgeNoiseScale + ringIndex * 5.3;
    const noiseValue = noise.sample(noiseX, noiseZ, 2, 0.5);
    const jitterStrength = ISLAND.edgeJitterRatio + ringIndex * ISLAND.craggingGrowthPerRing;

    return baseRadius * (1 + (noiseValue - 0.5) * 2 * jitterStrength);
}

interface IReservedSpot {
    x: number;
    z: number;
    clearance: number;
}

function scatterProps(
    topSurfaceHeightAt: (x: number, z: number) => number,
    reservedSpots: IReservedSpot[]
): IPropSlot[] {
    const nextRandom = createSeededRandom(LANDING_PROPS.seed);
    const slots: IPropSlot[] = [];

    for (
        let attempt = 0;
        attempt < LANDING_PROPS.placementAttempts && slots.length < LANDING_PROPS.instanceCount;
        attempt += 1
    ) {
        const angle = nextRandom() * FULL_TURN;
        const radius = Math.sqrt(nextRandom()) * LANDING_PROPS.scatterRadius;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const isFarEnoughFromProps = slots.every(
            (slot) =>
                Math.hypot(slot.position[0] - x, slot.position[2] - z) >= LANDING_PROPS.minSpacing
        );
        const isFarEnoughFromReserved = reservedSpots.every(
            (spot) => Math.hypot(spot.x - x, spot.z - z) >= spot.clearance
        );
        if (!isFarEnoughFromProps || !isFarEnoughFromReserved) continue;

        const [minimumScale, maximumScale] = LANDING_PROPS.scaleRange;
        const modelPath =
            LANDING_PROPS.modelPaths[Math.floor(nextRandom() * LANDING_PROPS.modelPaths.length)];
        if (!modelPath) continue;

        slots.push({
            modelPath,
            position: [x, topSurfaceHeightAt(x, z), z],
            rotationY: nextRandom() * FULL_TURN,
            scale: minimumScale + nextRandom() * (maximumScale - minimumScale),
        });
    }

    return slots;
}

export default LandingIsland;
