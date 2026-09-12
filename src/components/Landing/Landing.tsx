"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { NoToneMapping } from "three";
import SkyDome from "@/components/SkyDome";
import SceneLighting from "@/components/SceneLighting";
import PostProcessing from "@/components/PostProcessing/PostProcessing";
import PerformanceOverlay from "@/components/PerformanceOverlay";
import LandingIsland from "@/components/Landing/LandingIsland";
import {
    LandingEmbers,
    LandingFireflies,
    LandingStars,
} from "@/components/Landing/LandingParticles";
import LandingMountains from "@/components/Landing/LandingMountains";
import LandingClouds from "@/components/Landing/LandingClouds";
import LandingCameraRig from "@/components/Landing/LandingCameraRig";
import type { IOrbitInput } from "@/components/Landing/LandingCameraRig";
import LandingHero from "@/components/Landing/LandingHero";
import LandingHud from "@/components/Landing/LandingHud";
import { useFrameLimit } from "@/hooks/useFrameLimit";
import { useRenderPixelRatio } from "@/hooks/useRenderPixelRatio";
import { FrameRateMeter } from "@/components/Hud/FrameRateMeter";
import { PauseMenu } from "@/components/PauseMenu/PauseMenu";
import { resolveThemeManifest } from "@/themes/ThemeManifests";
import { parseRepoInput } from "@/lib/githubRepoInput";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { HttpMethod } from "@/constants/strings";
import { QUICK_PLAY_FALLBACK_REPOS } from "@/constants/realm";
import { LANDING_CAMERA, LANDING_SKY } from "@/constants/landing";
import { POST_PROCESSING } from "@/constants/rendering";
import { ChapterSeason, ChapterTheme } from "@/types/realm";
import type { FeaturedRealmResponse } from "@/responses/realm/RealmResponse";
import { clamp } from "@/lib/helpers";
import { InlineLoader } from "generative-loaders";
import "generative-loaders/styles.css";
import "./landing.scss";

const INVALID_REPO_MESSAGE = "Enter a GitHub URL or owner/repo, like facebook/react";

const buildLandingManifest = () => {
    const baseManifest = resolveThemeManifest(ChapterTheme.Woodland, ChapterSeason.Summer);

    return {
        ...baseManifest,
        environment: {
            ...baseManifest.environment,
            sky: {
                ...baseManifest.environment.sky,
                zenith: LANDING_SKY.zenith,
                middle: LANDING_SKY.middle,
                horizon: LANDING_SKY.horizon,
                abyss: LANDING_SKY.abyss,
                glow: LANDING_SKY.glow,
                sun: LANDING_SKY.sun,
                sunElevation: LANDING_SKY.sunElevation,
                sunAzimuth: LANDING_SKY.sunAzimuth,
                sunSize: LANDING_SKY.sunSize,
                glowFalloff: LANDING_SKY.glowFalloff,
                hazeStrength: LANDING_SKY.hazeStrength,
            },
            lighting: {
                ...baseManifest.environment.lighting,
                keyColor: LANDING_SKY.keyColor,
                keyIntensity: LANDING_SKY.keyIntensity,
                rimColor: LANDING_SKY.rimColor,
                rimIntensity: LANDING_SKY.rimIntensity,
                skyFill: LANDING_SKY.skyFill,
                groundFill: LANDING_SKY.groundFill,
                hemisphereIntensity: LANDING_SKY.hemisphereIntensity,
            },
            fogDensity: LANDING_SKY.fogDensity,
            outlineColor: LANDING_SKY.outlineColor,
        },
    };
};

const LandingFrameLimitDriver = () => {
    useFrameLimit();
    return null;
};

const Landing = () => {
    const router = useRouter();
    const { isPending: isLoadingFeatured, sendRequest } = useRequest();
    const [repoInputValue, setRepoInputValue] = useState("");
    const [validationError, setValidationError] = useState<string | null>(null);
    const [enteringRealmLabel, setEnteringRealmLabel] = useState<string | null>(null);
    const [isDiving, setIsDiving] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const pixelRatio = useRenderPixelRatio();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "F10") {
                e.preventDefault();
                setIsSettingsOpen((prev) => !prev);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);
    const hasNavigatedRef = useRef(false);
    const pendingRealmRef = useRef<{ owner: string; name: string } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const heroRef = useRef<HTMLDivElement>(null);
    const bearingLabelRef = useRef<HTMLSpanElement>(null);
    const compassRingRef = useRef<HTMLDivElement>(null);
    const orbitInputRef = useRef<IOrbitInput>({
        angleOffset: 0,
        velocity: 0,
        isDragging: false,
        lastPointerX: 0,
        lastPointerTime: 0,
    });

    const manifest = useMemo(() => buildLandingManifest(), []);

    const enterRealm = useCallback(
        (owner: string, name: string) => {
            if (hasNavigatedRef.current) return;

            hasNavigatedRef.current = true;
            pendingRealmRef.current = { owner, name };
            setEnteringRealmLabel(`${owner}/${name}`);
            setIsDiving(true);
            // Start fetching the destination route's JS during the dive animation, so the
            // fade-mask below has nothing left to wait on by the time it hides the swap.
            router.prefetch(`/realm/${owner}/${name}`);
        },
        [router]
    );

    const handleDiveComplete = useCallback(() => {
        const pendingRealm = pendingRealmRef.current;
        if (pendingRealm) router.push(`/realm/${pendingRealm.owner}/${pendingRealm.name}`);
    }, [router]);

    const handleRepoSubmit = useCallback(
        (event: FormEvent) => {
            event.preventDefault();

            const parsedRepo = parseRepoInput(repoInputValue);
            if (!parsedRepo) {
                setValidationError(INVALID_REPO_MESSAGE);
                return;
            }

            setValidationError(null);
            enterRealm(parsedRepo.owner, parsedRepo.name);
        },
        [repoInputValue, enterRealm]
    );

    const handleQuickPlay = useCallback(async () => {
        setValidationError(null);

        try {
            const featuredRealms = await sendRequest<FeaturedRealmResponse[]>(
                HttpMethod.Get,
                "/realms/featured"
            );
            const pool = featuredRealms.length > 0 ? featuredRealms : QUICK_PLAY_FALLBACK_REPOS;
            const picked = pool[Math.floor(Math.random() * pool.length)];

            if (picked) enterRealm(picked.owner, picked.name);
        } catch (caughtError) {
            if (isRequestCancellation(caughtError)) return;

            const picked =
                QUICK_PLAY_FALLBACK_REPOS[
                    Math.floor(Math.random() * QUICK_PLAY_FALLBACK_REPOS.length)
                ];
            if (picked) enterRealm(picked.owner, picked.name);
        }
    }, [sendRequest, enterRealm]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();

            const input = orbitInputRef.current;
            input.velocity = clamp(
                input.velocity + event.deltaY * LANDING_CAMERA.wheelSensitivity,
                -LANDING_CAMERA.maxInputVelocity,
                LANDING_CAMERA.maxInputVelocity
            );
        };

        const handlePointerDown = (event: PointerEvent) => {
            if (
                (event.target as HTMLElement).closest(
                    ".landing-hero, .landing-settings-trigger, .pause-menu-backdrop"
                )
            )
                return;

            const input = orbitInputRef.current;
            input.isDragging = true;
            input.velocity = 0;
            input.lastPointerX = event.clientX;
            input.lastPointerTime = performance.now();
            container.setPointerCapture(event.pointerId);
        };

        const handlePointerMove = (event: PointerEvent) => {
            const input = orbitInputRef.current;
            if (!input.isDragging) return;

            const now = performance.now();
            const deltaSeconds = Math.max((now - input.lastPointerTime) / 1000, 1 / 240);
            const deltaX = event.clientX - input.lastPointerX;

            input.angleOffset += deltaX * LANDING_CAMERA.dragSensitivity;
            input.velocity = clamp(
                (deltaX * LANDING_CAMERA.dragSensitivity) / deltaSeconds,
                -LANDING_CAMERA.maxInputVelocity,
                LANDING_CAMERA.maxInputVelocity
            );
            input.lastPointerX = event.clientX;
            input.lastPointerTime = now;
        };

        const handlePointerUp = () => {
            orbitInputRef.current.isDragging = false;
        };

        container.addEventListener("wheel", handleWheel, { passive: false });
        container.addEventListener("pointerdown", handlePointerDown);
        container.addEventListener("pointermove", handlePointerMove);
        container.addEventListener("pointerup", handlePointerUp);
        container.addEventListener("pointercancel", handlePointerUp);

        return () => {
            container.removeEventListener("wheel", handleWheel);
            container.removeEventListener("pointerdown", handlePointerDown);
            container.removeEventListener("pointermove", handlePointerMove);
            container.removeEventListener("pointerup", handlePointerUp);
            container.removeEventListener("pointercancel", handlePointerUp);
        };
    }, []);

    const isInteractionLocked = enteringRealmLabel !== null || isLoadingFeatured;

    return (
        <div className="landing-container" ref={containerRef}>
            <Canvas
                shadows="percentage"
                frameloop="never"
                dpr={pixelRatio}
                camera={{
                    fov: LANDING_CAMERA.fov,
                    near: LANDING_CAMERA.near,
                    far: LANDING_CAMERA.far,
                }}
                gl={{
                    antialias: false,
                    toneMapping: NoToneMapping,
                    toneMappingExposure: POST_PROCESSING.exposure,
                }}
            >
                <LandingFrameLimitDriver />
                <SkyDome environment={manifest.environment} />
                <SceneLighting environment={manifest.environment} />
                <LandingStars />
                <LandingMountains />
                <LandingClouds />
                <LandingIsland environment={manifest.environment} />
                <LandingEmbers />
                <LandingFireflies />
                <LandingCameraRig
                    orbitInputRef={orbitInputRef}
                    bearingLabelRef={bearingLabelRef}
                    compassRingRef={compassRingRef}
                    isDiving={isDiving}
                    onDiveComplete={handleDiveComplete}
                />
                <PostProcessing environment={manifest.environment} />
                <PerformanceOverlay />
            </Canvas>

            <FrameRateMeter />

            <div className="landing-overlay">
                <LandingHero
                    heroRef={heroRef}
                    repoInputValue={repoInputValue}
                    onRepoInputChange={setRepoInputValue}
                    validationError={validationError}
                    isInteractionLocked={isInteractionLocked}
                    isLoadingFeatured={isLoadingFeatured}
                    onRepoSubmit={handleRepoSubmit}
                    onQuickPlay={handleQuickPlay}
                />

                <LandingHud bearingLabelRef={bearingLabelRef} compassRingRef={compassRingRef} />
            </div>

            {enteringRealmLabel && (
                <div className="landing-status">
                    <InlineLoader variant="matrix" size={32} color="#fff" />
                    <p>opening realm/{enteringRealmLabel}</p>
                </div>
            )}

            <button
                type="button"
                className="landing-settings-trigger"
                onClick={() => setIsSettingsOpen(true)}
            >
                Settings
            </button>

            {isSettingsOpen && (
                <PauseMenu
                    title="Settings"
                    dismissLabel="Close"
                    onResume={() => setIsSettingsOpen(false)}
                />
            )}
        </div>
    );
};

export default Landing;
