import type { Vector3 } from "three";
import type { ICombatant, Team } from "@/types/combat";

export class CombatRegistry {
    private readonly combatants: ICombatant[] = [];

    register(combatant: ICombatant): void {
        if (!this.combatants.includes(combatant)) this.combatants.push(combatant);
    }

    unregister(combatant: ICombatant): void {
        const index = this.combatants.indexOf(combatant);
        if (index < 0) return;

        const last = this.combatants.pop();
        if (last && index < this.combatants.length) this.combatants[index] = last;
    }

    collectOpponents(team: Team, center: Vector3, radius: number, out: ICombatant[]): ICombatant[] {
        return this.collectLiving(team, false, center, radius, out);
    }

    collectTeammates(team: Team, center: Vector3, radius: number, out: ICombatant[]): ICombatant[] {
        return this.collectLiving(team, true, center, radius, out);
    }

    private collectLiving(
        team: Team,
        sameTeam: boolean,
        center: Vector3,
        radius: number,
        out: ICombatant[]
    ): ICombatant[] {
        out.length = 0;

        const combatants = this.combatants;
        for (let index = 0; index < combatants.length; index += 1) {
            const combatant = combatants[index];
            if (!combatant || (combatant.team === team) !== sameTeam || combatant.isDead) continue;

            const reach = radius + combatant.broadRadius;
            if (combatant.sceneObject.position.distanceToSquared(center) <= reach * reach)
                out.push(combatant);
        }

        return out;
    }
}
