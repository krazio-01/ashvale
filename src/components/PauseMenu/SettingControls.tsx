"use client";

import type {
    IGameSettings,
    ISettingsSlice,
    ISettingControlDescriptor,
    ISliderControlDescriptor,
    IChoiceControlDescriptor,
} from "@/types/ui";
import { PAUSE_TEXT } from "@/constants/strings";

export type SettingChangeHandler = ISettingsSlice["update"];

interface ControlRowProps<K extends keyof IGameSettings> {
    descriptor: ISettingControlDescriptor<K>;
    currentValue: IGameSettings[K];
    onChange: SettingChangeHandler;
}

const RowHeader = ({ label, description }: { label: string; description: string }) => (
    <div className="setting-info">
        <span className="setting-label">{label}</span>
        <span className="setting-desc">{description}</span>
    </div>
);

const SliderRow = <K extends keyof IGameSettings>({
    descriptor,
    currentValue,
    onChange,
}: {
    descriptor: ISliderControlDescriptor<K>;
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
                    onChange={(e) =>
                        onChange({
                            [descriptor.key]: Number(e.target.value),
                        } as Partial<IGameSettings>)
                    }
                />
                <span className="slider-value">{formatted}</span>
            </div>
        </div>
    );
};

const ChoiceRow = <K extends keyof IGameSettings>({
    descriptor,
    currentValue,
    onChange,
}: {
    descriptor: IChoiceControlDescriptor<K>;
    currentValue: IGameSettings[K];
    onChange: SettingChangeHandler;
}) => (
    <div className="setting-row">
        <RowHeader label={descriptor.label} description={descriptor.description} />
        <div className="segmented-control" role="group" aria-label={descriptor.label}>
            {descriptor.options.map((option) => {
                const isDerivedOnly =
                    descriptor.key === "qualityPreset" && option.value === "custom";

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        aria-pressed={option.value === currentValue}
                        disabled={isDerivedOnly}
                        title={isDerivedOnly ? PAUSE_TEXT.presetSetAutomatically : undefined}
                        className={option.value === currentValue ? "active" : ""}
                        onClick={() =>
                            onChange({ [descriptor.key]: option.value } as Partial<IGameSettings>)
                        }
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

export const SettingControlRow = <K extends keyof IGameSettings>({
    descriptor,
    currentValue,
    onChange,
}: ControlRowProps<K>) => {
    switch (descriptor.type) {
        case "slider":
            return (
                <SliderRow
                    descriptor={descriptor}
                    currentValue={currentValue as number}
                    onChange={onChange}
                />
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
                        ] as IChoiceControlDescriptor<K>["options"],
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
