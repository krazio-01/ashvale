import { Enemy } from "@/entities/characters/Enemy";
import { EnemyAction } from "@/constants/game";

const GREMLIN_MAX_HEALTH = 12;
const GREMLIN_ATTACK_DAMAGE = 4;
const GREMLIN_ATTACK_RANGE = 1.5;
const GREMLIN_ENGAGE_RANGE = 8;
const GREMLIN_FRENZIED_ENGAGE_RANGE = 16;

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
}
