"use client";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { PHYSICS } from "@/constants/physics";
import { degrees, metres } from "@/lib/helpers";
import "./physicsTuner.scss";

type SliderUnit = "plain" | "metres" | "degrees";

interface ISlider {
    label: string;
    path: string;
    min: number;
    max: number;
    unit: SliderUnit;
    logarithmic: boolean;
    integer: boolean;
    read(): number;
    write(value: number): void;
}

interface ISliderOptions {
    logarithmic?: boolean;
    integer?: boolean;
}

const UNITS: Record<string, SliderUnit> = {
    "cloth.leashMax": "metres",
    "cloth.backstopRadius": "metres",
    "cloth.backstopOffset": "metres",
    "cloth.collisionThickness": "metres",
    "cloth.deflectionMargin": "metres",
    "cloth.deflectionSoftness": "metres",
    "reference.maxLinearSpeed": "metres",
    "reference.maxAngularSpeed": "degrees",
    "reference.teleportDistance": "metres",
    "reference.teleportAngle": "degrees",
    "environment.gravity": "metres",
    "environment.wind.base": "metres",
    "environment.wind.gustAmplitude": "metres",
};
const UNIT_SCALE: Record<SliderUnit, (value: number) => number> = {
    plain: (value) => value,
    metres,
    degrees,
};
const EXPONENTIAL_BELOW = 0.01;
const RECIPROCAL_TOLERANCE = 1e-12;
const POSITIONS = 1000;
const GLASS_BLUR: CSSProperties = {
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
};

function slider(
    path: string,
    label: string,
    min: number,
    max: number,
    options: ISliderOptions = {}
): ISlider {
    const keys = path.split(".");
    const key = keys.pop() as string;
    const target = keys.reduce(
        (node, name) => node[name] as Record<string, unknown>,
        PHYSICS as unknown as Record<string, unknown>
    );
    return {
        label,
        path,
        min,
        max,
        unit: UNITS[path] ?? "plain",
        logarithmic: options.logarithmic ?? false,
        integer: options.integer ?? false,
        read: () => target[key] as number,
        write: (value) => {
            target[key] = value;
        },
    };
}

const SLIDERS: readonly ISlider[] = [
    slider("cloth.damping", "Damping /s", 0, 6),
    slider("cloth.bendCompliance", "Bend compliance", 1e-8, 1e-3, {
        logarithmic: true,
    }),
    slider("cloth.stretchCompliance", "Stretch compliance", 0, 1e-6),
    slider("cloth.gravityScale", "Gravity", 0, 2),
    slider("cloth.windExposure", "Wind exposure", 0, 3),
    slider("cloth.tetherScale", "Tether slack", 1, 1.15),
    slider("cloth.leashMax", "Leash at hem", 0.05, 1.5),
    slider("cloth.leashCurve", "Leash curve", 0.3, 3),
    slider("cloth.backstopRadius", "Backstop radius", 0, 1),
    slider("cloth.backstopOffset", "Backstop offset", 0, 0.1),
    slider("cloth.collisionThickness", "Collision thickness", 0, 0.05),
    slider("cloth.deflectionMargin", "Deflection margin", 0, 0.1),
    slider("cloth.deflectionSoftness", "Deflection softness", 0, 0.3),
    slider("cloth.friction", "Friction /s", 0, 20),
    slider("reference.linearInertia", "Linear inertia", 0, 1),
    slider("reference.angularInertia", "Angular inertia", 0, 1),
    slider("reference.flingScale", "Turn fling", 0, 2),
    slider("reference.maxLinearSpeed", "Speed cap", 1, 15),
    slider("reference.maxAngularSpeed", "Turn cap", 90, 1080),
    slider("restart.calmSeconds", "Restart calm s", 0, 4),
    slider("restart.dampingScale", "Restart calm damping x", 1, 30),
    slider("environment.wind.base", "Wind", 0, 2),
    slider("environment.wind.gustAmplitude", "Wind gusts", 0, 2),
    slider("step.substepsPerFrame", "Substeps / 60 Hz frame", 2, 24, {
        integer: true,
    }),
];

function shown(entry: ISlider): number {
    return entry.read() / UNIT_SCALE[entry.unit](1);
}

function toRaw(entry: ISlider, value: number): number {
    return UNIT_SCALE[entry.unit](entry.integer ? Math.round(value) : value);
}

function toPosition(entry: ISlider): number {
    const value = shown(entry);
    const share = entry.logarithmic
        ? Math.log(value / entry.min) / Math.log(entry.max / entry.min)
        : (value - entry.min) / (entry.max - entry.min);
    return Math.round(Math.min(Math.max(share, 0), 1) * POSITIONS);
}

function fromPosition(entry: ISlider, position: number): number {
    const share = position / POSITIONS;
    return entry.logarithmic
        ? entry.min * (entry.max / entry.min) ** share
        : entry.min + (entry.max - entry.min) * share;
}

function format(entry: ISlider): string {
    const value = shown(entry);
    if (entry.integer) return String(Math.round(value));
    return value !== 0 && Math.abs(value) < EXPONENTIAL_BELOW
        ? value.toExponential(2)
        : value.toFixed(3);
}

function numberLiteral(raw: number, unit: SliderUnit): string {
    const reciprocal = Math.round(1 / raw);
    if (
        unit === "plain" &&
        reciprocal > 1 &&
        reciprocal <= 1000 &&
        Math.abs(raw * reciprocal - 1) < RECIPROCAL_TOLERANCE
    )
        return `1 / ${reciprocal}`;
    const text = String(Number((raw / UNIT_SCALE[unit](1)).toPrecision(6)));
    return unit === "plain" ? text : `${unit}(${text})`;
}

function literal(value: unknown, path: string, indent: string): string {
    if (typeof value === "number") return numberLiteral(value, UNITS[path] ?? "plain");
    if (Array.isArray(value))
        return `[${value.map((item) => literal(item, path, indent)).join(", ")}]`;
    const inner = `${indent}    `;
    const lines = Object.entries(value as Record<string, unknown>).map(
        ([key, item]) => `${inner}${key}: ${literal(item, `${path}.${key}`, inner)},`
    );
    return `{\n${lines.join("\n")}\n${indent}}`;
}

function snippet(): string {
    const { cloth, reference, environment, step } = PHYSICS;
    return Object.entries({ cloth, reference, environment, step })
        .map(([name, value]) => `${name}: ${literal(value, name, "")},`)
        .join("\n");
}

export const PhysicsTuner = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [, setRevision] = useState(0);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "F8") return;
            event.preventDefault();
            setIsOpen((open) => !open);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        if (isOpen) document.exitPointerLock();
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className="physics-tuner"
            style={GLASS_BLUR}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <div className="physics-tuner-header">
                <span>Cloth physics</span>
                <span className="physics-tuner-hint">F8</span>
            </div>
            {SLIDERS.map((entry) => (
                <label key={entry.path} className="physics-tuner-row">
                    <span className="physics-tuner-name">{entry.label}</span>
                    <input
                        type="range"
                        min={0}
                        max={POSITIONS}
                        step={1}
                        value={toPosition(entry)}
                        onChange={(event) => {
                            entry.write(
                                toRaw(entry, fromPosition(entry, Number(event.target.value)))
                            );
                            setRevision((revision) => revision + 1);
                        }}
                    />
                    <span className="physics-tuner-value">{format(entry)}</span>
                </label>
            ))}
            <div className="physics-tuner-actions">
                <button type="button" onClick={() => void navigator.clipboard.writeText(snippet())}>
                    Copy values
                </button>
                <button
                    type="button"
                    onClick={() =>
                        globalThis.__ashvalePhysics?.simulations.forEach((entry) =>
                            entry.simulation.reset()
                        )
                    }
                >
                    Reset cloth
                </button>
            </div>
        </div>
    );
};
