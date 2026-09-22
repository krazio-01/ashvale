import { EnemyAction } from "@/constants/characters";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import { metres } from "@/lib/helpers";

const SENTINEL_MAX_HEALTH = 40;
const SENTINEL_ATTACK_DAMAGE = 8;
const SENTINEL_ATTACK_RANGE = metres(0.9);
const SENTINEL_ENGAGE_RANGE = metres(20);
const SENTINEL_DISENGAGE_RANGE = metres(1.2);

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

    get attackRange(): number {
        return SENTINEL_ATTACK_RANGE;
    }
}
