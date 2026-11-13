"use client";
import type { FormEvent } from "react";
import { InlineLoader } from "generative-loaders";
import { APP_TEXT, LANDING_TEXT } from "@/constants/strings";

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
    repoInputValue,
    onRepoInputChange,
    validationError,
    isInteractionLocked,
    isLoadingFeatured,
    onRepoSubmit,
    onQuickPlay,
}: {
    repoInputValue: string;
    onRepoInputChange: (value: string) => void;
    validationError: string | null;
    isInteractionLocked: boolean;
    isLoadingFeatured: boolean;
    onRepoSubmit: (event: FormEvent) => void;
    onQuickPlay: () => void;
}) => {
    return (
        <div className="landing-hero">
            <div className="landing-heading">
                <h1>{APP_TEXT.title}</h1>
                <p>{LANDING_TEXT.tagline}</p>
            </div>

            <form className="landing-repo-form" onSubmit={onRepoSubmit}>
                <div className="landing-repo-field">
                    <span className="landing-repo-prefix">{LANDING_TEXT.repoPrefix}</span>
                    <input
                        type="text"
                        value={repoInputValue}
                        onChange={(event) => onRepoInputChange(event.target.value)}
                        placeholder={LANDING_TEXT.repoPlaceholder}
                        disabled={isInteractionLocked}
                        aria-label={LANDING_TEXT.repoInputLabel}
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
