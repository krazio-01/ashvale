import { Line3, Vector3 } from "three";
import type { CombatRegistry } from "@/systems/combat/CombatRegistry";
import type { ICombatant, Team } from "@/types/combat";

export class SweptHitDetector {
    private static readonly SUBSTEPS = 3;

    private static readonly substepStarts = Array.from(
        { length: SweptHitDetector.SUBSTEPS },
        () => new Vector3()
    );

    private static readonly substepEnds = Array.from(
        { length: SweptHitDetector.SUBSTEPS },
        () => new Vector3()
    );

    private static readonly sweepLine = new Line3();

    private static readonly hurtboxLine = new Line3();

    private static readonly scratchCenter = new Vector3();

    private static readonly candidates: ICombatant[] = [];

    private static overlapsSubsteps(candidate: ICombatant, radius: number): boolean {
        for (let step = 0; step < SweptHitDetector.SUBSTEPS; step += 1) {
            for (const hurtbox of candidate.hurtboxes) {
                const reach = radius + hurtbox.radius;
                const distanceSquared = SweptHitDetector.sweepLine
                    .set(SweptHitDetector.substepStarts[step], SweptHitDetector.substepEnds[step])
                    .distanceSqToLine3(
                        SweptHitDetector.hurtboxLine.set(hurtbox.start, hurtbox.end)
                    );
                if (distanceSquared <= reach * reach) return true;
            }
        }

        return false;
    }

    private readonly previousStart = new Vector3();
    private readonly previousEnd = new Vector3();
    private readonly alreadyHit = new Set<ICombatant>();
    private hasPrevious = false;

    begin(): void {
        this.hasPrevious = false;
        this.alreadyHit.clear();
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

        SweptHitDetector.scratchCenter.addVectors(start, end).multiplyScalar(0.5);
        const reach =
            radius +
            start.distanceTo(end) +
            this.previousEnd.distanceTo(end) +
            this.previousStart.distanceTo(start);
        registry.collectOpponents(
            team,
            SweptHitDetector.scratchCenter,
            reach,
            SweptHitDetector.candidates
        );

        if (SweptHitDetector.candidates.length > 0) this.interpolateSubsteps(start, end);
        for (const candidate of SweptHitDetector.candidates) {
            if (
                this.alreadyHit.has(candidate) ||
                !SweptHitDetector.overlapsSubsteps(candidate, radius)
            )
                continue;

            this.alreadyHit.add(candidate);
            out.push(candidate);
        }

        this.previousStart.copy(start);
        this.previousEnd.copy(end);
        return out.length;
    }

    private interpolateSubsteps(start: Vector3, end: Vector3): void {
        for (let step = 0; step < SweptHitDetector.SUBSTEPS; step += 1) {
            const blend = (step + 1) / SweptHitDetector.SUBSTEPS;
            SweptHitDetector.substepStarts[step].lerpVectors(this.previousStart, start, blend);
            SweptHitDetector.substepEnds[step].lerpVectors(this.previousEnd, end, blend);
        }
    }
}
