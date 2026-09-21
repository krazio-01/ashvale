import { EnemyAction } from "@/constants/characters";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import { metres } from "@/lib/helpers";

const GOLEM_MAX_HEALTH = 90;
const GOLEM_ATTACK_DAMAGE = 18;
const GOLEM_ATTACK_RANGE = metres(2.6);
const GOLEM_ENGAGE_RANGE = metres(7);
const GOLEM_WIND_UP_TICKS = 2;

export class Golem extends Enemy {
    private ticksInAttackRange = 0;

    constructor(id: string) {
        super(id, GOLEM_MAX_HEALTH);
    }

    decideAction(distanceToPlayer: number): EnemyAction {
        if (distanceToPlayer > GOLEM_ENGAGE_RANGE) {
            this.ticksInAttackRange = 0;
            return EnemyAction.Idle;
        }

        if (distanceToPlayer > GOLEM_ATTACK_RANGE) {
            this.ticksInAttackRange = 0;
            return EnemyAction.Chase;
        }

        this.ticksInAttackRange++;

        return this.ticksInAttackRange >= GOLEM_WIND_UP_TICKS
            ? EnemyAction.Attack
            : EnemyAction.Idle;
    }

    get attackDamage(): number {
        return GOLEM_ATTACK_DAMAGE;
    }
}
