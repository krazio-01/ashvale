import { Vector3 } from "three";
import type { Object3D } from "three";
import type { ICombatEventMap } from "@/events/CombatEvents";
import type { GameEvents } from "@/events/EventEmitter";
import { HEARING } from "@/constants/enemies";
import { SKELETON_BONES } from "@/constants/characters";
import { BoneMath } from "@/lib/boneMath";
import { FootContact } from "@/lib/footContact";

export type FootstepGait = keyof typeof HEARING.footstepRadius;

interface IFoot {
    bone: Object3D;
    contact: FootContact;
    isPlanted: boolean;
}

export class Footsteps {
    private readonly events: GameEvents;
    private readonly onStep: (strength: number, point: Vector3) => void;
    private readonly noise: ICombatEventMap["noise"] = { position: new Vector3(), radius: 0 };
    private readonly contactPoint = new Vector3();
    private readonly feet: IFoot[];

    constructor(
        events: GameEvents,
        model: Object3D,
        onStep: (strength: number, point: Vector3) => void
    ) {
        this.events = events;
        this.onStep = onStep;
        const legs = BoneMath.findLimbs(model, SKELETON_BONES.legs);
        this.feet = legs
            ? [legs.left.end, legs.right.end].map((bone) => ({
                  bone,
                  contact: new FootContact(Number.POSITIVE_INFINITY),
                  isPlanted: true,
              }))
            : [];
    }

    tick(deltaSeconds: number, gait: FootstepGait, feetElevation: number): void {
        const radius = HEARING.footstepRadius[gait];
        for (const foot of this.feet) {
            BoneMath.worldPosition(foot.bone, this.contactPoint);
            const isPlanted = foot.contact.track(this.contactPoint.y - feetElevation, deltaSeconds);
            const justPlanted = isPlanted && !foot.isPlanted;
            foot.isPlanted = isPlanted;
            if (justPlanted && radius > 0) this.step(radius, feetElevation);
        }
    }

    private step(radius: number, feetElevation: number): void {
        this.noise.position.copy(this.contactPoint);
        this.noise.radius = radius;
        this.events.emit("noise", this.noise);
        this.contactPoint.setY(feetElevation);
        this.onStep(radius / HEARING.footstepRadius.sprint, this.contactPoint);
    }
}
