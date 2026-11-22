import { Vector3 } from "three";
import type { ICombatant, Team } from "@/types/combat";

const OPPOSING_TEAM: Record<Team, Team> = { player: "enemy", enemy: "player" };

export class CombatRegistry {
    static collectLivingWithin(
        candidates: readonly ICombatant[],
        center: Vector3,
        radius: number,
        out: ICombatant[]
    ): ICombatant[] {
        out.length = 0;

        for (let index = 0; index < candidates.length; index += 1) {
            const combatant = candidates[index];
            if (combatant.isDead) continue;

            const reach = radius + combatant.boundingRadius;
            if (combatant.sceneObject.position.distanceToSquared(center) <= reach * reach)
                out.push(combatant);
        }

        return out;
    }

    readonly detailCentre = new Vector3();
    frameIndex = 0;
    private readonly combatants: ICombatant[] = [];
    private readonly teammates: Record<Team, ICombatant[]> = { player: [], enemy: [] };

    beginFrame(centre: Vector3): void {
        this.detailCentre.copy(centre);
        this.frameIndex += 1;
    }

    register(combatant: ICombatant): void {
        if (this.combatants.includes(combatant)) return;

        this.combatants.push(combatant);
        this.teammates[combatant.team].push(combatant);
    }

    unregister(combatant: ICombatant): void {
        const index = this.combatants.indexOf(combatant);
        if (index < 0) return;

        const lastIndex = this.combatants.length - 1;
        if (index === lastIndex) {
            this.combatants.pop();
            this.teammates[combatant.team].pop();
            return;
        }
        this.combatants[index] = this.combatants[lastIndex];
        this.combatants.pop();
        this.rebuildTeamLists();
    }

    collectOpponents(team: Team, center: Vector3, radius: number, out: ICombatant[]): ICombatant[] {
        return CombatRegistry.collectLivingWithin(
            this.teammates[OPPOSING_TEAM[team]],
            center,
            radius,
            out
        );
    }

    collectTeammates(team: Team, center: Vector3, radius: number, out: ICombatant[]): ICombatant[] {
        return CombatRegistry.collectLivingWithin(this.teammates[team], center, radius, out);
    }

    private rebuildTeamLists(): void {
        for (const teammates of Object.values(this.teammates)) teammates.length = 0;
        for (const combatant of this.combatants) this.teammates[combatant.team].push(combatant);
    }
}
