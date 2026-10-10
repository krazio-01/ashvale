import { Vector3 } from "three";
import type { Object3D } from "three";
import { PHYSICS } from "@/constants/physics";
import { SkeletonBinding } from "@/systems/physics/bindings/SkeletonBinding";
import { PhysicsSimulation, type IPhysicsFrame } from "@/systems/physics/PhysicsSimulation";
import { PhysicsDiagnostics } from "@/systems/physics/services/PhysicsDiagnostics";
import type { ICapsuleSource, IPhysicsDefinition, PhysicsDetail } from "@/types/physics";
import type { IGroundProbe } from "@/types/procedural";

export class PhysicsLayer {
    private static readonly scratch = {
        origin: new Vector3(),
        push: new Vector3(),
    };
    private readonly simulation: PhysicsSimulation;
    private readonly body: Object3D;
    private readonly probe: IGroundProbe;
    private readonly frame: IPhysicsFrame = {
        deltaSeconds: 0,
        detail: "frozen",
        floorY: null,
    };

    private constructor(
        model: Object3D,
        body: Object3D,
        probe: IGroundProbe,
        definition: IPhysicsDefinition
    ) {
        this.body = body;
        this.probe = probe;
        this.simulation = new PhysicsSimulation(definition, new SkeletonBinding(model, definition));
        PhysicsDiagnostics.register(body, this.simulation);
    }

    static create(model: Object3D, body: Object3D, probe: IGroundProbe): PhysicsLayer | null {
        const definition = model.userData[PHYSICS.dataKey] as IPhysicsDefinition | undefined;
        return definition ? new PhysicsLayer(model, body, probe, definition) : null;
    }

    impact(push: Vector3, strength: number): void {
        if (push.lengthSq() < PHYSICS.impulse.minimumPushLengthSquared) return;
        const speed = strength * PHYSICS.impulse.speedPerStrength;
        const scaled = PhysicsLayer.scratch.push.copy(push).normalize().multiplyScalar(speed);
        this.simulation.solver.kick(scaled.x, scaled.y, scaled.z);
    }

    attachCapsule(slot: number, source: ICapsuleSource | null): void {
        this.simulation.attachCapsule(slot, source);
    }

    update(deltaSeconds: number, detail: PhysicsDetail): void {
        const origin = this.body.getWorldPosition(PhysicsLayer.scratch.origin);
        this.frame.deltaSeconds = deltaSeconds;
        this.frame.detail = detail;
        this.frame.floorY = this.probe.groundHeightAt(origin.x, origin.z, origin.y);
        this.simulation.update(this.frame);
    }

    reset(): void {
        this.simulation.reset();
    }

    dispose(): void {
        PhysicsDiagnostics.unregister(this.simulation);
    }
}
