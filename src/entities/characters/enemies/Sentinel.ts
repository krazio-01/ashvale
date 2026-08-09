import { Enemy } from "@/entities/characters/Enemy";
import { EnemyAction } from "@/constants/game";

const SENTINEL_MAX_HEALTH = 40;
const SENTINEL_ATTACK_DAMAGE = 8;
const SENTINEL_ATTACK_RANGE = 2;
const SENTINEL_ENGAGE_RANGE = 8;
const SENTINEL_DISENGAGE_RANGE = 3;

export class Sentinel extends Enemy {
    private hasJustAttacked = false;

    constructor(id: string) {
        super(id, SENTINEL_MAX_HEALTH);
    }

    decideAction(distanceToPlayer: number): EnemyAction {
        if (distanceToPlayer > SENTINEL_ENGAGE_RANGE) {
            this.hasJustAttacked = false;
            return EnemyAction.Idle;
        }

        if (this.hasJustAttacked && distanceToPlayer < SENTINEL_DISENGAGE_RANGE)
            return EnemyAction.Retreat;

        this.hasJustAttacked = false;

        if (distanceToPlayer <= SENTINEL_ATTACK_RANGE) {
            this.hasJustAttacked = true;
            return EnemyAction.Attack;
        }

        return EnemyAction.Chase;
    }

    get attackDamage(): number {
        return SENTINEL_ATTACK_DAMAGE;
    }
}
