"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphicsQuality, IGameSettings, SettingSection } from "@/types/settings";
import { SETTING_SECTIONS } from "@/settings/SettingsCatalogue";
import {
    DEFAULT_SETTINGS,
    draftWithChange,
    draftWithPreset,
    settingsMatch,
    updateSettings,
    useSettings,
} from "@/settings/SettingsStore";
import { SettingsPanel } from "./SettingsPanel";
import "./pauseMenu.scss";

export interface PauseMenuProps {
    onResume: () => void;
    onQuit?: () => void;
    realmTitle?: string;
    title?: string;
    dismissLabel?: string;
    /** Key that closes the menu, shown as a hint. Omit when no key is bound. */
    dismissKey?: string;
}

export const PauseMenu = ({
    onResume,
    onQuit,
    realmTitle,
    title = "Paused",
    dismissLabel = "Resume",
    dismissKey,
}: PauseMenuProps) => {
    const committed = useSettings();
    const [activeSection, setActiveSection] = useState<SettingSection>("Display");
    const [draft, setDraft] = useState<IGameSettings>(committed);
    const shellRef = useRef<HTMLDivElement>(null);

    const isDirty = useMemo(() => !settingsMatch(draft, committed), [draft, committed]);

    // The host page's own Tab handler only lets Tab navigate inside the dialog
    // once focus is already there, so the dialog has to claim focus on open or
    // the very first Tab press would fall through and dismiss it.
    useEffect(() => {
        shellRef.current?.focus();
    }, []);

    // Traps Tab/Shift+Tab within the dialog since the host page has no
    // consistent Tab-interception of its own (Landing's F10 settings surface
    // has none at all).
    useEffect(() => {
        const shell = shellRef.current;
        if (!shell) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;

            const focusable = shell.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        shell.addEventListener("keydown", handleKeyDown);
        return () => shell.removeEventListener("keydown", handleKeyDown);
    }, []);

    const handleChange = useCallback((partial: Partial<IGameSettings>) => {
        setDraft((current) => {
            const preset = partial.qualityPreset;

            if (preset !== undefined) {
                if (preset === "custom") return current;
                return draftWithPreset(current, preset as Exclude<GraphicsQuality, "custom">);
            }

            return draftWithChange(current, partial);
        });
    }, []);

    const handleSave = useCallback(() => {
        updateSettings(draft);
    }, [draft]);

    const attemptClose = useCallback(
        (action: () => void) => {
            if (isDirty && !window.confirm("Discard unsaved changes?")) return;
            action();
        },
        [isDirty]
    );

    // Escape is the near-universal dialog-dismiss convention; it's handled
    // independently of any host page's own open/close key binding (Tab, F10, …).
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            attemptClose(onResume);
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [attemptClose, onResume]);

    return (
        <div className="pause-menu-backdrop" onClick={() => attemptClose(onResume)}>
            <div
                ref={shellRef}
                tabIndex={-1}
                className="pause-menu-shell"
                role="dialog"
                aria-modal="true"
                aria-label="Game settings"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="pause-menu-header">
                    <div className="pause-title-group">
                        <h1>{title}</h1>
                        {realmTitle && <span className="realm-tag">{realmTitle}</span>}
                    </div>
                    {dismissKey && (
                        <span className="resume-hint">
                            <kbd>{dismissKey}</kbd> {dismissLabel.toLowerCase()}
                        </span>
                    )}
                </header>

                <nav className="pause-menu-tabs">
                    {SETTING_SECTIONS.map((section) => (
                        <button
                            key={section}
                            type="button"
                            aria-current={activeSection === section}
                            className={`tab-item ${activeSection === section ? "active" : ""}`}
                            onClick={() => setActiveSection(section)}
                        >
                            {section}
                        </button>
                    ))}
                </nav>

                <div className="pause-menu-body">
                    <SettingsPanel
                        section={activeSection}
                        values={draft}
                        onChange={handleChange}
                    />
                </div>

                <footer className="pause-menu-footer">
                    <div className="footer-left">
                        <button
                            type="button"
                            className="btn-quiet"
                            onClick={() => setDraft(DEFAULT_SETTINGS)}
                        >
                            Reset to defaults
                        </button>
                        {onQuit && (
                            <button
                                type="button"
                                className="btn-quiet"
                                onClick={() => attemptClose(onQuit)}
                            >
                                Quit to title
                            </button>
                        )}
                    </div>

                    <div className="footer-right">
                        {isDirty && <span className="dirty-note">Unsaved changes</span>}
                        <button
                            type="button"
                            className="btn-primary"
                            disabled={!isDirty}
                            onClick={handleSave}
                        >
                            Save changes
                        </button>
                        <button type="button" className="btn-quiet" onClick={() => attemptClose(onResume)}>
                            {dismissLabel}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default PauseMenu;
