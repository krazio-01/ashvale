export interface IVitalsSpec {
    maxHealth: number;
    maxPoise: number;
    maxStamina: number;
    maxFocus: number;
    poiseRegenDelay: number;
    poiseRegenRate: number;
    staminaRegenDelay: number;
    staminaRegenRate: number;
    staggerSeconds: number;
}

interface IDamageResult {
    killed: boolean;
    poiseBroken: boolean;
    dealt: number;
}

export class Vitals {
    health: number;
    poise: number;
    stamina: number;
    focus = 0;

    private readonly spec: IVitalsSpec;
    private readonly damageResult: IDamageResult = { killed: false, poiseBroken: false, dealt: 0 };
    private poiseRegenWait = 0;
    private staminaRegenWait = 0;

    constructor(spec: IVitalsSpec) {
        this.spec = spec;
        this.health = spec.maxHealth;
        this.poise = spec.maxPoise;
        this.stamina = spec.maxStamina;
    }

    get isDead(): boolean {
        return this.health <= 0;
    }

    get staggerSeconds(): number {
        return this.spec.staggerSeconds;
    }

    get maxHealth(): number {
        return this.spec.maxHealth;
    }

    get maxStamina(): number {
        return this.spec.maxStamina;
    }

    get maxFocus(): number {
        return this.spec.maxFocus;
    }

    get healthFraction(): number {
        return this.health / this.spec.maxHealth;
    }

    get poiseFraction(): number {
        return this.spec.maxPoise > 0 ? this.poise / this.spec.maxPoise : 0;
    }

    applyDamage(damage: number, poiseDamage: number, isStaggered: boolean): IDamageResult {
        const result = this.damageResult;
        result.dealt = Math.min(this.health, Math.max(0, damage));
        result.poiseBroken = false;
        this.health -= result.dealt;
        result.killed = this.health <= 0;

        if (result.killed) return result;

        this.poiseRegenWait = this.spec.poiseRegenDelay;
        if (isStaggered) return result;

        this.poise = Math.max(0, this.poise - poiseDamage);
        result.poiseBroken = this.poise === 0;
        return result;
    }

    breakPoise(): void {
        this.poise = 0;
    }

    refillPoise(): void {
        this.poise = this.spec.maxPoise;
    }

    kill(): void {
        this.health = 0;
    }

    trySpendStamina(cost: number): boolean {
        if (cost <= 0) return true;
        if (this.stamina <= 0) return false;

        this.stamina = Math.max(0, this.stamina - cost);
        this.staminaRegenWait = this.spec.staminaRegenDelay;
        return true;
    }

    drainStamina(amount: number): boolean {
        if (this.stamina <= 0) return false;

        this.stamina = Math.max(0, this.stamina - amount);
        this.staminaRegenWait = this.spec.staminaRegenDelay;
        return this.stamina > 0;
    }

    gainFocus(amount: number): void {
        this.focus = Math.min(this.spec.maxFocus, this.focus + amount);
    }

    spendFocus(): number {
        const pips = Math.floor(this.focus);
        this.focus -= pips;
        return pips;
    }

    tick(deltaSeconds: number, isStaggered: boolean): void {
        if (!isStaggered) {
            this.poiseRegenWait = Math.max(0, this.poiseRegenWait - deltaSeconds);
            if (this.poiseRegenWait === 0)
                this.poise = Math.min(
                    this.spec.maxPoise,
                    this.poise + this.spec.poiseRegenRate * deltaSeconds
                );
        }

        this.staminaRegenWait = Math.max(0, this.staminaRegenWait - deltaSeconds);
        if (this.staminaRegenWait === 0)
            this.stamina = Math.min(
                this.spec.maxStamina,
                this.stamina + this.spec.staminaRegenRate * deltaSeconds
            );
    }

    restore(): void {
        this.health = this.spec.maxHealth;
        this.poise = this.spec.maxPoise;
        this.stamina = this.spec.maxStamina;
        this.focus = 0;
        this.poiseRegenWait = 0;
        this.staminaRegenWait = 0;
    }
}
