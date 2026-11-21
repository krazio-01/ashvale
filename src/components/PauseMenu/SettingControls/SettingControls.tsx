"use client";

import type {
    IGameSettings,
    ISettingsSlice,
    ISettingControlDescriptor,
    ISliderControlDescriptor,
    IChoiceControlDescriptor,
} from "@/types/ui";
import { PAUSE_TEXT } from "@/constants/strings";

type SettingChangeHandler = ISettingsSlice["update"];

type SettingKey = keyof IGameSettings;

type SettingValue = IGameSettings[SettingKey];

interface IControlRowProps {
    descriptor: ISettingControlDescriptor;
    currentValue: SettingValue;
    onChange: SettingChangeHandler;
}

const RowHeader = ({ label, description }: { label: string; description: string }) => (
    <div className="setting-info">
        <span className="setting-label">{label}</span>
        <span className="setting-desc">{description}</span>
    </div>
);

const SliderRow = ({
    descriptor,
    currentValue,
    onChange,
}: {
    descriptor: ISliderControlDescriptor<SettingKey>;
    currentValue: number;
    onChange: SettingChangeHandler;
}) => {
    const formatted = descriptor.formatValue(currentValue);

    return (
        <div className="setting-row">
            <RowHeader label={descriptor.label} description={descriptor.description} />
            <div className="slider-control-group">
                <input
                    type="range"
                    aria-label={descriptor.label}
                    min={descriptor.min}
                    max={descriptor.max}
                    step={descriptor.step}
                    value={currentValue}
                    onChange={(e) => onChange(settingPatch(descriptor.key, Number(e.target.value)))}
                />
                <span className="slider-value">{formatted}</span>
            </div>
        </div>
    );
};

const ChoiceRow = ({
    descriptor,
    currentValue,
    onChange,
}: {
    descriptor: IChoiceControlDescriptor<SettingKey>;
    currentValue: SettingValue;
    onChange: SettingChangeHandler;
}) => (
    <div className="setting-row">
        <RowHeader label={descriptor.label} description={descriptor.description} />
        <div className="segmented-control" role="group" aria-label={descriptor.label}>
            {descriptor.options.map((option) => {
                const isDerivedOnly = option.isDerivedOnly === true;

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        aria-pressed={option.value === currentValue}
                        disabled={isDerivedOnly}
                        title={isDerivedOnly ? PAUSE_TEXT.presetSetAutomatically : undefined}
                        className={option.value === currentValue ? "active" : ""}
                        onClick={() => onChange(settingPatch(descriptor.key, option.value))}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

export const SettingControlRow = ({ descriptor, currentValue, onChange }: IControlRowProps) => {
    switch (descriptor.type) {
        case "slider":
            return (
                typeof currentValue === "number" && (
                    <SliderRow
                        descriptor={descriptor}
                        currentValue={currentValue}
                        onChange={onChange}
                    />
                )
            );
        case "toggle":
            return (
                <ChoiceRow
                    descriptor={{
                        ...descriptor,
                        type: "choice",
                        options: [
                            { label: descriptor.offLabel, value: false },
                            { label: descriptor.onLabel, value: true },
                        ],
                    }}
                    currentValue={currentValue}
                    onChange={onChange}
                />
            );
        case "choice":
            return (
                <ChoiceRow
                    descriptor={descriptor}
                    currentValue={currentValue}
                    onChange={onChange}
                />
            );
    }
};

function settingPatch<Key extends SettingKey>(
    key: Key,
    value: IGameSettings[Key]
): Partial<IGameSettings> {
    const patch: Partial<IGameSettings> = {};
    patch[key] = value;
    return patch;
}
