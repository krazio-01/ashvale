import { EnemyAction } from "@/constants/characters";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import { metres } from "@/lib/helpers";

const WRAITH_MAX_HEALTH = 24;
const WRAITH_ATTACK_DAMAGE = 6;
const WRAITH_ATTACK_RANGE = metres(5);
const WRAITH_ENGAGE_RANGE = metres(24);
const WRAITH_RETREAT_RANGE = metres(3.4);

export class Wraith extends Enemy {
    constructor(id: string) {
        super(id, WRAITH_MAX_HEALTH);
    }

    decideAction(distanceToPlayer: number): EnemyAction {
        if (distanceToPlayer < WRAITH_RETREAT_RANGE) return EnemyAction.Retreat;
        if (distanceToPlayer > WRAITH_ENGAGE_RANGE) return EnemyAction.Idle;
        if (distanceToPlayer <= WRAITH_ATTACK_RANGE) return EnemyAction.Attack;

        return EnemyAction.Chase;
    }

    get attackDamage(): number {
        return WRAITH_ATTACK_DAMAGE;
    }

    get attackRange(): number {
        return WRAITH_ATTACK_RANGE;
    }
}
