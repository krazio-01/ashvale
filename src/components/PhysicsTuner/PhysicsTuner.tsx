"use client";

import { useState } from "react";
import { PHYSICS } from "@/constants/physics";
import { degreesToRadians, metresToUnits, clamp, lerp } from "@/lib/helpers";
import "./physicsTuner.scss";
import { PHYSICS_TUNER_TEXT } from "@/constants/strings";
import { useHotkey } from "@/hooks/useHotkey";

const UNITS: Record<string, SliderUnit> = {
    "cloth.maxDriftAtHem": "metres",
    "cloth.bodyGuardRadius": "metres",
    "cloth.bodyGuardDepth": "metres",
    "cloth.collisionThickness": "metres",
    "cloth.targetClearance": "metres",
    "cloth.targetClearanceBlend": "metres",
    "reference.maxLagMoveSpeed": "metres",
    "reference.maxLagTurnSpeed": "degrees",
    "reference.teleportDistance": "metres",
    "reference.teleportAngle": "degrees",
    "environment.gravity": "metres",
    "environment.wind.base": "metres",
    "environment.wind.gustAmplitude": "metres",
};

const UNIT_SCALE: Record<SliderUnit, (value: number) => number> = {
    plain: (value) => value,
    metres: metresToUnits,
    degrees: degreesToRadians,
};

const EXPONENTIAL_BELOW = 0.01;

const RECIPROCAL_TOLERANCE = 1e-12;

const POSITIONS = 1000;

const SLIDERS: readonly ISlider[] = [
    slider("cloth.damping", 0, 6),
    slider("cloth.bendSoftness", 1e-8, 1e-3, {
        logarithmic: true,
    }),
    slider("cloth.stretchSoftness", 0, 1e-6),
    slider("cloth.gravityScale", 0, 2),
    slider("cloth.windExposure", 0, 3),
    slider("cloth.pinSlack", 1, 1.15),
    slider("cloth.maxDriftAtHem", 0.05, 1.5),
    slider("cloth.driftCurve", 0.3, 3),
    slider("cloth.bodyGuardRadius", 0, 1),
    slider("cloth.bodyGuardDepth", 0, 0.1),
    slider("cloth.collisionThickness", 0, 0.05),
    slider("cloth.targetClearance", 0, 0.1),
    slider("cloth.targetClearanceBlend", 0, 0.3),
    slider("cloth.friction", 0, 20),
    slider("reference.moveLag", 0, 1),
    slider("reference.turnLag", 0, 1),
    slider("reference.turnFlingScale", 0, 2),
    slider("reference.maxLagMoveSpeed", 1, 15),
    slider("reference.maxLagTurnSpeed", 90, 1080),
    slider("restart.dampingSeconds", 0, 4),
    slider("restart.dampingScale", 1, 30),
    slider("environment.wind.base", 0, 2),
    slider("environment.wind.gustAmplitude", 0, 2),
    slider("step.substepsPerFrame", 2, 24, {
        integer: true,
    }),
];

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

export const PhysicsTuner = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [, setRevision] = useState(0);

    useHotkey("F8", (event) => {
        event.preventDefault();
        if (!isOpen) document.exitPointerLock();
        setIsOpen(!isOpen);
    });

    if (!isOpen) return null;

    return (
        <div className="physics-tuner" onKeyDown={(event) => event.stopPropagation()}>
            <div className="physics-tuner-header">
                <span>{PHYSICS_TUNER_TEXT.title}</span>
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

function slider(path: string, min: number, max: number, options: ISliderOptions = {}): ISlider {
    const keys = path.split(".");
    const key = keys.pop() as string;
    const target = keys.reduce(
        (node, name) => node[name] as Record<string, unknown>,
        PHYSICS as unknown as Record<string, unknown>
    );
    return {
        label: PHYSICS_TUNER_TEXT.sliders[path],
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
    return Math.round(clamp(share, 0, 1) * POSITIONS);
}

function fromPosition(entry: ISlider, position: number): number {
    const share = position / POSITIONS;
    return entry.logarithmic
        ? entry.min * (entry.max / entry.min) ** share
        : lerp(entry.min, entry.max, share);
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
