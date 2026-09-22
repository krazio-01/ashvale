import { EnemyAction } from "@/constants/characters";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import { metres } from "@/lib/helpers";

const GREMLIN_MAX_HEALTH = 12;
const GREMLIN_ATTACK_DAMAGE = 4;
const GREMLIN_ATTACK_RANGE = metres(0.7);
const GREMLIN_ENGAGE_RANGE = metres(20);
const GREMLIN_FRENZIED_ENGAGE_RANGE = metres(35);

export class Gremlin extends Enemy {
    private isFrenzied = false;

    constructor(id: string) {
        super(id, GREMLIN_MAX_HEALTH);
    }

    takeDamage(amount: number): void {
        super.takeDamage(amount);
        this.isFrenzied = true;
    }

    decideAction(distanceToPlayer: number): EnemyAction {
        const engageRange = this.isFrenzied ? GREMLIN_FRENZIED_ENGAGE_RANGE : GREMLIN_ENGAGE_RANGE;

        if (distanceToPlayer > engageRange) return EnemyAction.Idle;
        if (distanceToPlayer <= GREMLIN_ATTACK_RANGE) return EnemyAction.Attack;

        return EnemyAction.Chase;
    }

    get attackDamage(): number {
        return GREMLIN_ATTACK_DAMAGE;
    }

    get attackRange(): number {
        return GREMLIN_ATTACK_RANGE;
    }
}
