import { Vector3 } from "three";
import { keysOf } from "@/lib/helpers";
import type { ICombatant, Team } from "@/types/combat";

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
    private readonly opponents: Record<Team, ICombatant[]> = { player: [], enemy: [] };
    private readonly teams = keysOf(this.teammates);

    beginFrame(centre: Vector3): void {
        this.detailCentre.copy(centre);
        this.frameIndex += 1;
    }

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
        const combatants = this.combatants;
        for (let teamIndex = 0; teamIndex < this.teams.length; teamIndex += 1) {
            const team = this.teams[teamIndex];
            const teammates = this.teammates[team];
            const opponents = this.opponents[team];
            let teammateCount = 0;
            let opponentCount = 0;
            for (let index = 0; index < combatants.length; index += 1) {
                const combatant = combatants[index];
                if (combatant.team === team) teammates[teammateCount++] = combatant;
                else opponents[opponentCount++] = combatant;
            }
            teammates.length = teammateCount;
            opponents.length = opponentCount;
        }
    }
}
