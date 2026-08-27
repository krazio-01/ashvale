import { EnemyAction } from "@/constants/characters";
import { Enemy } from "@/entities/characters/Enemy";

const WRAITH_MAX_HEALTH = 24;
const WRAITH_ATTACK_DAMAGE = 6;
const WRAITH_ATTACK_RANGE = 6;
const WRAITH_ENGAGE_RANGE = 10;
const WRAITH_RETREAT_RANGE = 3;

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
}
