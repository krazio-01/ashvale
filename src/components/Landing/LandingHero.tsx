"use client";
import { useCallback, useRef } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { InlineLoader } from "generative-loaders";

const PortalIcon = () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
        <path
            d="M8 6.75L11.75 10L8 13.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

const DiceIcon = () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="1.1" fill="currentColor" />
        <circle cx="13" cy="7" r="1.1" fill="currentColor" />
        <circle cx="10" cy="10" r="1.1" fill="currentColor" />
        <circle cx="7" cy="13" r="1.1" fill="currentColor" />
        <circle cx="13" cy="13" r="1.1" fill="currentColor" />
    </svg>
);

const LandingHero = ({
    heroRef,
    repoInputValue,
    onRepoInputChange,
    validationError,
    isInteractionLocked,
    isLoadingFeatured,
    onRepoSubmit,
    onQuickPlay,
}: {
    heroRef: RefObject<HTMLDivElement | null>;
    repoInputValue: string;
    onRepoInputChange: (value: string) => void;
    validationError: string | null;
    isInteractionLocked: boolean;
    isLoadingFeatured: boolean;
    onRepoSubmit: (event: FormEvent) => void;
    onQuickPlay: () => void;
}) => {
    const isHeroPressedRef = useRef(false);

    const handleHeroPointerMove = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const hero = heroRef.current;
            if (!hero || isHeroPressedRef.current) return;

            const bounds = hero.getBoundingClientRect();
            const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
            const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;

            hero.style.transition = "none";
            hero.style.transform = `perspective(1100px) rotateX(${offsetY * -4}deg) rotateY(${offsetX * 4}deg)`;
        },
        [heroRef]
    );

    const handleHeroPointerLeave = useCallback(() => {
        const hero = heroRef.current;
        if (!hero) return;

        hero.style.transition = "";
        hero.style.transform = "";
    }, [heroRef]);

    const handleHeroPointerDown = useCallback(() => {
        isHeroPressedRef.current = true;
    }, []);

    const handleHeroPointerUp = useCallback(() => {
        isHeroPressedRef.current = false;
    }, []);

    return (
        <div
            className="landing-hero"
            ref={heroRef}
            onPointerMove={handleHeroPointerMove}
            onPointerLeave={handleHeroPointerLeave}
            onPointerDown={handleHeroPointerDown}
            onPointerUp={handleHeroPointerUp}
        >
            <div className="landing-heading">
                <h1>Ashvale</h1>
                <p>any public repository, rendered as a realm to explore</p>
            </div>

            <form className="landing-repo-form" onSubmit={onRepoSubmit}>
                <div className="landing-repo-field">
                    <span className="landing-repo-prefix">realm/</span>
                    <input
                        type="text"
                        value={repoInputValue}
                        onChange={(event) => onRepoInputChange(event.target.value)}
                        placeholder="owner/repo"
                        disabled={isInteractionLocked}
                        aria-label="GitHub repository"
                    />
                    {repoInputValue && !isInteractionLocked && (
                        <kbd className="landing-repo-kbd">↵</kbd>
                    )}
                </div>
                <button
                    type="submit"
                    className="landing-primary-action"
                    disabled={isInteractionLocked}
                >
                    <PortalIcon />
                    Open the Realm
                </button>
            </form>

            {validationError && <p className="landing-error">{validationError}</p>}

            <div className="landing-divider">
                <span className="landing-divider-line" />
                or
                <span className="landing-divider-line" />
            </div>

            <button
                type="button"
                className="landing-quick-play"
                onClick={onQuickPlay}
                disabled={isInteractionLocked}
            >
                {isLoadingFeatured ? (
                    <InlineLoader variant="matrix" size={18} color="#fff" />
                ) : (
                    <>
                        <DiceIcon />
                        Quick Play
                    </>
                )}
            </button>
        </div>
    );
};

export default LandingHero;
