"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
    LandingEmbers,
    LandingFireflies,
    LandingStars,
} from "@/components/Landing/LandingParticles";
import type { IOrbitInput } from "@/components/Landing/LandingCameraRig";
import { RenderCanvas } from "@/components/RenderCanvas/RenderCanvas";
import { PauseMenu } from "@/components/PauseMenu/PauseMenu";
import { resolveTheme, withEnvironmentOverrides } from "@/themes/Themes";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { LANDING_TEXT } from "@/constants/strings";
import { QUICK_PLAY_FALLBACK_REPOS } from "@/constants/realm";
import { LANDING_CAMERA, LANDING_ENVIRONMENT } from "@/constants/ui";
import { ChapterSeason, ChapterTheme } from "@/types/realm";
import type { FeaturedRealmResponse } from "@/responses/realm/RealmResponse";
import { clamp, parseRepoInput, pickRandom } from "@/lib/helpers";
import { InlineLoader } from "generative-loaders";
import LandingIsland from "@/components/Landing/LandingIsland";
import LandingMountains from "@/components/Landing/LandingMountains";
import LandingClouds from "@/components/Landing/LandingClouds";
import LandingCameraRig from "@/components/Landing/LandingCameraRig";
import LandingHero from "@/components/Landing/LandingHero";
import LandingHud from "@/components/Landing/LandingHud";
import { useHotkey } from "@/hooks/useHotkey";
import "generative-loaders/styles.css";
import "./landing.scss";

const LANDING_MANIFEST = withEnvironmentOverrides(
    resolveTheme(ChapterTheme.Woodland, ChapterSeason.Summer),
    LANDING_ENVIRONMENT
);

const Landing = () => {
    const router = useRouter();
    const { isPending: isLoadingFeatured, sendRequest } = useRequest();
    const [repoInputValue, setRepoInputValue] = useState("");
    const [validationError, setValidationError] = useState<string | null>(null);
    const [pendingRealm, setPendingRealm] = useState<{ owner: string; name: string } | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    useHotkey("F10", (e) => {
        e.preventDefault();
        setIsSettingsOpen((prev) => !prev);
    });
    const hasNavigatedRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const bearingLabelRef = useRef<HTMLSpanElement>(null);
    const compassRingRef = useRef<HTMLDivElement>(null);
    const orbitInputRef = useRef<IOrbitInput>({
        angleOffset: 0,
        velocity: 0,
        isDragging: false,
        lastPointerX: 0,
        lastPointerTime: 0,
    });

    const enterRealm = (owner: string, name: string) => {
        if (hasNavigatedRef.current) return;

        hasNavigatedRef.current = true;
        setPendingRealm({ owner, name });
        router.prefetch(`/realm/${owner}/${name}`);
    };

    const handleDiveComplete = () => {
        if (pendingRealm) router.push(`/realm/${pendingRealm.owner}/${pendingRealm.name}`);
    };

    const handleRepoSubmit = (event: FormEvent) => {
        event.preventDefault();

        const parsedRepo = parseRepoInput(repoInputValue);
        if (!parsedRepo) {
            setValidationError(LANDING_TEXT.invalidRepo);
            return;
        }

        setValidationError(null);
        enterRealm(parsedRepo.owner, parsedRepo.name);
    };

    const handleQuickPlay = async () => {
        setValidationError(null);

        let pool: { owner: string; name: string }[] = QUICK_PLAY_FALLBACK_REPOS;
        try {
            const featuredRealms = await sendRequest<FeaturedRealmResponse[]>("/realms/featured");
            if (featuredRealms.length > 0) pool = featuredRealms;
        } catch (caughtError) {
            if (isRequestCancellation(caughtError)) return;
        }

        const { owner, name } = pickRandom(pool);
        enterRealm(owner, name);
    };

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

    const isInteractionLocked = pendingRealm !== null || isLoadingFeatured;

    return (
        <div className="landing-container" ref={containerRef}>
            <RenderCanvas
                environment={LANDING_MANIFEST.environment}
                camera={{
                    fov: LANDING_CAMERA.fov,
                    near: LANDING_CAMERA.near,
                    far: LANDING_CAMERA.far,
                }}
            >
                <LandingStars />
                <LandingMountains />
                <LandingClouds />
                <LandingIsland environment={LANDING_MANIFEST.environment} />
                <LandingEmbers />
                <LandingFireflies />
                <LandingCameraRig
                    orbitInputRef={orbitInputRef}
                    bearingLabelRef={bearingLabelRef}
                    compassRingRef={compassRingRef}
                    isDiving={pendingRealm !== null}
                    onDiveComplete={handleDiveComplete}
                />
            </RenderCanvas>

            <div className="landing-overlay">
                <LandingHero
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

            {pendingRealm && (
                <div className="landing-status">
                    <InlineLoader variant="matrix" size={32} color="#fff" />
                    <p>
                        opening realm/{pendingRealm.owner}/{pendingRealm.name}
                    </p>
                </div>
            )}

            <button
                type="button"
                className="btn-quiet landing-settings-trigger"
                onClick={() => setIsSettingsOpen(true)}
            >
                Settings
            </button>

            {isSettingsOpen && (
                <PauseMenu
                    title={LANDING_TEXT.settingsTitle}
                    dismissLabel={LANDING_TEXT.closeSettings}
                    onResume={() => setIsSettingsOpen(false)}
                />
            )}
        </div>
    );
};

export default Landing;
