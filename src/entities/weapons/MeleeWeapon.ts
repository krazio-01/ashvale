import { Vector3 } from "three";
import type { Object3D } from "three";
import { Weapon } from "@/entities/weapons/Weapon";
import { SlashTrail } from "@/world/effects/combat/SlashTrail";
import type { IStrikeSegment } from "@/types/combat";
import type { IHandRig, IMeleeWeaponSpec } from "@/types/weapons";
import type { IModelTemplate } from "@/types/world";

export class MeleeWeapon extends Weapon<IMeleeWeaponSpec> {
    private readonly trail: SlashTrail;
    private readonly localGuard = new Vector3();
    private readonly localTip = new Vector3();
    private readonly trailSegment: IStrikeSegment = {
        start: new Vector3(),
        end: new Vector3(),
        radius: 0,
    };

    constructor(
        template: IModelTemplate,
        spec: IMeleeWeaponSpec,
        handRig: IHandRig,
        effectsRoot: Object3D
    ) {
        super(template, spec, handRig);

        this.localTip[this.lengthAxis] = this.tipCoordinate;
        this.localGuard[this.lengthAxis] =
            this.pommelCoordinate +
            (this.tipCoordinate - this.pommelCoordinate) * spec.guardFraction;

        this.trail = new SlashTrail(spec.trailColor);
        effectsRoot.add(this.trail.mesh);
    }

    sampleStrike(segment: IStrikeSegment): boolean {
        this.model.updateWorldMatrix(true, false);
        segment.start.copy(this.localGuard).applyMatrix4(this.model.matrixWorld);
        segment.end.copy(this.localTip).applyMatrix4(this.model.matrixWorld);
        segment.radius = this.spec.bladeRadius;
        return true;
    }

    update(deltaSeconds: number, isStriking: boolean): void {
        if (isStriking) {
            this.sampleStrike(this.trailSegment);
            this.trail.push(this.trailSegment.start, this.trailSegment.end);
        }

        this.trail.update(deltaSeconds, isStriking);
    }

    dispose(): void {
        this.trail.dispose();
        super.dispose();
    }
}
