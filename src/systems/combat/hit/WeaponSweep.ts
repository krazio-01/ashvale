import { Vector3 } from "three";
import { capsulesOverlap } from "@/systems/combat/hit/SweepMath";
import type { CombatRegistry } from "@/systems/combat/services/CombatRegistry";
import type { ICombatant, Team } from "@/types/combat";

const SUBSTEPS = 3;
const scratchStart = new Vector3();
const scratchEnd = new Vector3();
const scratchCenter = new Vector3();
const candidates: ICombatant[] = [];

export class WeaponSweep {
    private readonly previousStart = new Vector3();
    private readonly previousEnd = new Vector3();
    private readonly struck = new Set<ICombatant>();
    private hasPrevious = false;

    begin(): void {
        this.hasPrevious = false;
        this.struck.clear();
    }

    sweep(
        start: Vector3,
        end: Vector3,
        radius: number,
        team: Team,
        registry: CombatRegistry,
        out: ICombatant[]
    ): number {
        out.length = 0;

        if (!this.hasPrevious) {
            this.previousStart.copy(start);
            this.previousEnd.copy(end);
            this.hasPrevious = true;
        }

        scratchCenter.addVectors(start, end).multiplyScalar(0.5);
        const reach =
            radius +
            start.distanceTo(end) +
            this.previousEnd.distanceTo(end) +
            this.previousStart.distanceTo(start);
        registry.collectOpponents(team, scratchCenter, reach, candidates);

        for (const candidate of candidates) {
            if (this.struck.has(candidate) || !this.touches(candidate, start, end, radius))
                continue;

            this.struck.add(candidate);
            out.push(candidate);
        }

        this.previousStart.copy(start);
        this.previousEnd.copy(end);
        return out.length;
    }

    private touches(candidate: ICombatant, start: Vector3, end: Vector3, radius: number): boolean {
        for (let step = 1; step <= SUBSTEPS; step += 1) {
            const blend = step / SUBSTEPS;
            scratchStart.lerpVectors(this.previousStart, start, blend);
            scratchEnd.lerpVectors(this.previousEnd, end, blend);

            for (const hurtbox of candidate.hurtboxes)
                if (
                    capsulesOverlap(
                        scratchStart,
                        scratchEnd,
                        radius,
                        hurtbox.start,
                        hurtbox.end,
                        hurtbox.radius
                    )
                )
                    return true;
        }

        return false;
    }
}
