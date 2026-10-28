import type { Object3D } from "three";
import { PHYSICS } from "@/constants/physics";
import type { PhysicsSimulation } from "@/systems/physics/PhysicsSimulation";

interface IRegisteredSimulation {
    root: Object3D;
    simulation: PhysicsSimulation;
}

interface IPhysicsDiagnostics {
    simulations: IRegisteredSimulation[];
    measuring: boolean;
    tuning: typeof PHYSICS;
    measure(on: boolean): void;
}

declare global {
    var __ashvalePhysics: IPhysicsDiagnostics | undefined;
}

export class PhysicsDiagnostics {
    static register(root: Object3D, simulation: PhysicsSimulation): void {
        globalThis.__ashvalePhysics ??= PhysicsDiagnostics.createRecord();
        simulation.measuring = globalThis.__ashvalePhysics.measuring;
        globalThis.__ashvalePhysics.simulations.push({ root, simulation });
    }

    static unregister(simulation: PhysicsSimulation): void {
        const record = globalThis.__ashvalePhysics;
        if (!record) return;
        record.simulations = record.simulations.filter((entry) => entry.simulation !== simulation);
    }

    private static createRecord(): IPhysicsDiagnostics {
        const record: IPhysicsDiagnostics = {
            simulations: [],
            measuring: false,
            tuning: PHYSICS,
            measure(on) {
                record.measuring = on;
                for (const entry of record.simulations) entry.simulation.measuring = on;
            },
        };
        return record;
    }
}
