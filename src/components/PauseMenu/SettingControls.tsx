"use client";
import type {
    IGameSettings,
    ISettingControlDescriptor,
    ISliderControlDescriptor,
    IToggleControlDescriptor,
    IChoiceControlDescriptor,
} from "@/types/settings";

export interface SettingChangeHandler {
    (partial: Partial<IGameSettings>): void;
}

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
    const formatted = descriptor.formatValue
        ? descriptor.formatValue(currentValue)
        : String(currentValue);

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
                        onChange({ [descriptor.key]: Number(e.target.value) } as Partial<IGameSettings>)
                    }
                />
                <span className="slider-value">{formatted}</span>
            </div>
        </div>
    );
};

const ToggleRow = <K extends keyof IGameSettings>({
    descriptor,
    currentValue,
    onChange,
}: {
    descriptor: IToggleControlDescriptor<K>;
    currentValue: boolean;
    onChange: SettingChangeHandler;
}) => {
    const choices: { label: string; value: boolean }[] = [
        { label: descriptor.offLabel || "Off", value: false },
        { label: descriptor.onLabel || "On", value: true },
    ];

    return (
        <div className="setting-row">
            <RowHeader label={descriptor.label} description={descriptor.description} />
            <div className="segmented-control" role="group" aria-label={descriptor.label}>
                {choices.map((choice) => (
                    <button
                        key={String(choice.value)}
                        type="button"
                        aria-pressed={currentValue === choice.value}
                        className={currentValue === choice.value ? "active" : ""}
                        onClick={() =>
                            onChange({ [descriptor.key]: choice.value } as Partial<IGameSettings>)
                        }
                    >
                        {choice.label}
                    </button>
                ))}
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
                // "Custom" is a derived state (set automatically when individual
                // graphics options diverge from a named preset), not a real choice.
                const isDerivedOnly = descriptor.key === "qualityPreset" && option.value === "custom";

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        aria-pressed={option.value === currentValue}
                        disabled={isDerivedOnly}
                        title={isDerivedOnly ? "Set automatically when options don't match a preset" : undefined}
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
                <ToggleRow
                    descriptor={descriptor}
                    currentValue={currentValue as boolean}
                    onChange={onChange}
                />
            );
        case "choice":
            return (
                <ChoiceRow descriptor={descriptor} currentValue={currentValue} onChange={onChange} />
            );
    }
};

export default SettingControlRow;
