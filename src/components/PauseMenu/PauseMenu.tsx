"use client";

import { useEffect, useRef, useState } from "react";
import type { IGameSettings, SettingSection } from "@/types/ui";
import { DEFAULT_SETTINGS, getControlsForSection, SETTING_SECTIONS } from "@/constants/ui";
import { areSettingsEqual, withQualityPreset, withSettingChange } from "@/store/settingsSlice";
import { useStoreState } from "@/hooks/useStoreState";
import { store } from "@/store/store";
import { ControlsReference } from "./ControlsReference/ControlsReference";
import { SettingControlRow } from "./SettingControls";
import "./pauseMenu.scss";
import { PAUSE_TEXT } from "@/constants/strings";
import { useHotkey } from "@/hooks/useHotkey";

interface PauseMenuProps {
    onResume: () => void;
    onQuit?: () => void;
    realmTitle?: string;
    title?: string;
    dismissLabel?: string;
    dismissKey?: string;
}

export const PauseMenu = ({
    onResume,
    onQuit,
    realmTitle,
    title = PAUSE_TEXT.title,
    dismissLabel = PAUSE_TEXT.resume,
    dismissKey,
}: PauseMenuProps) => {
    const committed = useStoreState(store, (state) => state.settings.values);
    const [activeSection, setActiveSection] = useState<SettingSection>("Display");
    const [draft, setDraft] = useState<IGameSettings>(committed);
    const shellRef = useRef<HTMLDivElement>(null);

    const isDirty = !areSettingsEqual(draft, committed);

    useEffect(() => {
        shellRef.current?.focus();
    }, []);

    useEffect(() => {
        const shell = shellRef.current!;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;

            const focusable = shell.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );

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

    const handleChange = (partial: Partial<IGameSettings>) => {
        setDraft((current) => {
            const preset = partial.qualityPreset;

            if (preset !== undefined) {
                if (preset === "custom") return current;
                return withQualityPreset(current, preset);
            }

            return withSettingChange(current, partial);
        });
    };

    const handleSave = () => store.getState().settings.update(draft);

    const attemptClose = (action: () => void) => {
        if (isDirty && !window.confirm(PAUSE_TEXT.discardChanges)) return;
        action();
    };

    useHotkey(
        "Escape",
        (e) => {
            e.preventDefault();
            attemptClose(onResume);
        },
        "document"
    );

    return (
        <div className="pause-menu-backdrop" onClick={() => attemptClose(onResume)}>
            <div
                ref={shellRef}
                tabIndex={-1}
                className="pause-menu-shell"
                role="dialog"
                aria-modal="true"
                aria-label={PAUSE_TEXT.settingsLabel}
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
                    <div className="settings-panel-list">
                        {activeSection === "Controls" && <ControlsReference />}
                        {getControlsForSection(activeSection).map((descriptor) => (
                            <SettingControlRow
                                key={String(descriptor.key)}
                                descriptor={descriptor}
                                currentValue={draft[descriptor.key]}
                                onChange={handleChange}
                            />
                        ))}
                    </div>
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
                        {isDirty && <span className="dirty-note">{PAUSE_TEXT.unsavedChanges}</span>}
                        <button
                            type="button"
                            className="btn-primary"
                            disabled={!isDirty}
                            onClick={handleSave}
                        >
                            Save changes
                        </button>
                        <button
                            type="button"
                            className="btn-quiet"
                            onClick={() => attemptClose(onResume)}
                        >
                            {dismissLabel}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};
