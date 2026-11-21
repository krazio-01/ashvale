"use client";
import type { IRepoReference } from "@/types/realm";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CanvasProps } from "@react-three/fiber";
import { useRouter } from "next/navigation";
import {
    LandingEmbers,
    LandingFireflies,
    LandingStars,
} from "@/components/Landing/LandingParticles/LandingParticles";
import type { IOrbitInput } from "@/components/Landing/LandingCameraRig/LandingCameraRig";
import { RenderCanvas } from "@/components/RenderCanvas/RenderCanvas";
import { PauseMenu } from "@/components/PauseMenu/PauseMenu";
import {
    BIOME_ENVIRONMENTS,
    overrideEnvironment,
    seasonFor,
    seasonalEnvironment,
} from "@/themes/Environment";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { LANDING_TEXT } from "@/constants/strings";
import { QUICK_PLAY_FALLBACK_REPOS } from "@/constants/realm";
import { LANDING_CAMERA, LANDING_ENVIRONMENT, LANDING_LOOK } from "@/constants/ui";
import type { FeaturedRealmResponse } from "@/responses/realm/RealmResponse";
import { clamp, pickRandom } from "@/lib/helpers";
import { InlineLoader } from "generative-loaders";
import LandingIsland from "@/components/Landing/LandingIsland/LandingIsland";
import LandingMountains from "@/components/Landing/LandingMountains/LandingMountains";
import LandingClouds from "@/components/Landing/LandingClouds/LandingClouds";
import LandingCameraRig from "@/components/Landing/LandingCameraRig/LandingCameraRig";
import LandingHero from "@/components/Landing/LandingHero/LandingHero";
import LandingHud from "@/components/Landing/LandingHud/LandingHud";
import { useHotkey } from "@/hooks/useHotkey";
import "generative-loaders/styles.css";
import "./landing.scss";

const REPO_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i;

const SHORTHAND_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

const GIT_SUFFIX_PATTERN = /\.git$/i;

const LANDING_CANVAS_CAMERA: CanvasProps["camera"] = {
    fov: LANDING_CAMERA.fov,
    near: LANDING_CAMERA.near,
    far: LANDING_CAMERA.far,
};

const LANDING_BIOME_ENVIRONMENT = BIOME_ENVIRONMENTS[LANDING_LOOK.themeId];

const LANDING_SEASONAL_ENVIRONMENT = overrideEnvironment(
    seasonalEnvironment(
        LANDING_BIOME_ENVIRONMENT,
        seasonFor(LANDING_BIOME_ENVIRONMENT, LANDING_LOOK.seasonId)
    ),
    LANDING_ENVIRONMENT
);

const Landing = () => {
    const router = useRouter();
    const { isPending: isLoadingFeatured, sendRequest } = useRequest();
    const [validationError, setValidationError] = useState<string | null>(null);
    const [pendingRealm, setPendingRealm] = useState<IRepoReference | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const bearingLabelRef = useRef<HTMLSpanElement>(null);
    const compassRingRef = useRef<HTMLDivElement>(null);
    const orbitInputRef = useOrbitInput(containerRef);

    useHotkey("F10", (e) => {
        e.preventDefault();
        setIsSettingsOpen((prev) => !prev);
    });

    const enterRealm = (owner: string, name: string) => {
        if (pendingRealm) return;

        setPendingRealm({ owner, name });
        router.prefetch(`/realm/${owner}/${name}`);
    };

    const handleDiveComplete = () => {
        if (pendingRealm) router.push(`/realm/${pendingRealm.owner}/${pendingRealm.name}`);
    };

    const handleRepoSubmit = (rawInput: string) => {
        const parsedRepo = parseRepoInput(rawInput);
        if (!parsedRepo) {
            setValidationError(LANDING_TEXT.invalidRepo);
            return;
        }

        setValidationError(null);
        enterRealm(parsedRepo.owner, parsedRepo.name);
    };

    const handleQuickPlay = async () => {
        setValidationError(null);

        let pool: IRepoReference[] = QUICK_PLAY_FALLBACK_REPOS;
        try {
            const featuredRealms = await sendRequest<FeaturedRealmResponse[]>("/realms/featured");
            if (featuredRealms.length > 0) pool = featuredRealms;
        } catch (caughtError) {
            if (isRequestCancellation(caughtError)) return;
        }

        const { owner, name } = pickRandom(pool);
        enterRealm(owner, name);
    };

    const isInteractionLocked = pendingRealm !== null || isLoadingFeatured;

    return (
        <div className="landing-container" ref={containerRef}>
            <RenderCanvas environment={LANDING_SEASONAL_ENVIRONMENT} camera={LANDING_CANVAS_CAMERA}>
                <LandingStars />
                <LandingMountains />
                <LandingClouds />
                <LandingIsland environment={LANDING_SEASONAL_ENVIRONMENT} />
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
                    <p>{LANDING_TEXT.openingRealm(pendingRealm.owner, pendingRealm.name)}</p>
                </div>
            )}

            <button
                type="button"
                className="btn-quiet landing-settings-trigger"
                onClick={() => setIsSettingsOpen(true)}
            >
                {LANDING_TEXT.settings}
            </button>

            {isSettingsOpen && (
                <PauseMenu
                    title={LANDING_TEXT.settings}
                    dismissLabel={LANDING_TEXT.closeSettings}
                    onResume={() => setIsSettingsOpen(false)}
                />
            )}
        </div>
    );
};

export default Landing;

function useOrbitInput(containerRef: RefObject<HTMLDivElement | null>): RefObject<IOrbitInput> {
    const orbitInputRef = useRef<IOrbitInput>({
        angleOffset: 0,
        velocity: 0,
        isDragging: false,
        lastPointerX: 0,
        lastPointerTime: 0,
    });

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
                event.target instanceof Element &&
                event.target.closest(
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
    }, [containerRef]);

    return orbitInputRef;
}

function parseRepoInput(rawInput: string): IRepoReference | null {
    const trimmed = rawInput.trim().replace(/\/+$/, "");
    if (!trimmed) return null;

    const match = trimmed.match(REPO_URL_PATTERN) ?? trimmed.match(SHORTHAND_PATTERN);
    const [, owner, rawName] = match ?? [];
    if (!owner || !rawName) return null;

    const name = rawName.replace(GIT_SUFFIX_PATTERN, "");
    if (!name) return null;

    return { owner, name };
}
