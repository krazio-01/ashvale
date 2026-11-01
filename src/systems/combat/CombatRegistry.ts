import { Vector3 } from "three";
import type { ICombatant, Team } from "@/types/combat";

export class CombatRegistry {
    private static collectLivingWithin(
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
    private readonly combatants: ICombatant[] = [];
    private teammates: Record<Team, ICombatant[]> = { player: [], enemy: [] };
    private opponents: Record<Team, ICombatant[]> = { player: [], enemy: [] };

    register(combatant: ICombatant): void {
        if (this.combatants.includes(combatant)) return;

        this.combatants.push(combatant);
        this.rebuildTeamLists();
    }

    unregister(combatant: ICombatant): void {
        const index = this.combatants.indexOf(combatant);
        if (index < 0) return;

        const last = this.combatants.pop();
        if (last && index < this.combatants.length) this.combatants[index] = last;
        this.rebuildTeamLists();
    }

    collectOpponents(team: Team, center: Vector3, radius: number, out: ICombatant[]): ICombatant[] {
        return CombatRegistry.collectLivingWithin(this.opponents[team], center, radius, out);
    }

    collectTeammates(team: Team, center: Vector3, radius: number, out: ICombatant[]): ICombatant[] {
        return CombatRegistry.collectLivingWithin(this.teammates[team], center, radius, out);
    }

    private rebuildTeamLists(): void {
        for (const team of Object.keys(this.teammates) as Team[]) {
            this.teammates[team] = this.combatants.filter((combatant) => combatant.team === team);
            this.opponents[team] = this.combatants.filter((combatant) => combatant.team !== team);
        }
    }
}
