export interface IEnemyAttack {
    id: string;
    openingMove: string;
    range: readonly [number, number];
    weight: number;
    cooldownSeconds: number;
    tokenCost: number;
    chain: readonly string[];
    continueChance: number;
}

const REPEAT_WEIGHT_SCALE = 0.5;

export class AttackPlanner {
    private readonly attacks: readonly IEnemyAttack[];
    private readonly random: () => number;
    private readonly cooldowns = new Map<string, number>();
    private lastAttackId: string | null = null;

    constructor(attacks: readonly IEnemyAttack[], random: () => number) {
        this.attacks = attacks;
        this.random = random;
    }

    tick(deltaSeconds: number, cooldownRate = 1): void {
        for (const [id, remaining] of this.cooldowns) {
            const next = remaining - deltaSeconds * cooldownRate;
            if (next <= 0) this.cooldowns.delete(id);
            else this.cooldowns.set(id, next);
        }
    }

    pick(gap: number): IEnemyAttack | null {
        let totalWeight = 0;
        for (const attack of this.attacks)
            if (this.isAvailable(attack, gap)) totalWeight += this.weightOf(attack);
        if (totalWeight === 0) return null;

        let roll = this.random() * totalWeight;
        let chosen: IEnemyAttack | null = null;
        for (const attack of this.attacks) {
            if (!this.isAvailable(attack, gap)) continue;
            chosen = attack;
            roll -= this.weightOf(attack);
            if (roll < 0) break;
        }
        return chosen;
    }

    commit(attack: IEnemyAttack): void {
        if (attack.cooldownSeconds > 0) this.cooldowns.set(attack.id, attack.cooldownSeconds);
        this.lastAttackId = attack.id;
    }

    private isAvailable(attack: IEnemyAttack, gap: number): boolean {
        return gap >= attack.range[0] && gap <= attack.range[1] && !this.cooldowns.has(attack.id);
    }

    private weightOf(attack: IEnemyAttack): number {
        return attack.id === this.lastAttackId
            ? attack.weight * REPEAT_WEIGHT_SCALE
            : attack.weight;
    }
}
