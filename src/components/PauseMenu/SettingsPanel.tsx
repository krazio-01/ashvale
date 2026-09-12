"use client";
import type { IGameSettings, SettingSection } from "@/types/settings";
import { getControlsForSection } from "@/settings/SettingsCatalogue";
import { SettingControlRow, type SettingChangeHandler } from "./SettingControls";

interface SettingsPanelProps {
    section: SettingSection;
    values: IGameSettings;
    onChange: SettingChangeHandler;
}

export const SettingsPanel = ({ section, values, onChange }: SettingsPanelProps) => (
    <div className="settings-panel-list">
        {getControlsForSection(section).map((descriptor) => (
            <SettingControlRow
                key={String(descriptor.key)}
                descriptor={descriptor}
                currentValue={values[descriptor.key]}
                onChange={onChange}
            />
        ))}
    </div>
);

export default SettingsPanel;
