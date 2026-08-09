import { Entity } from "@/entities/Entity";

export abstract class Character extends Entity {
    protected health: number;
    protected readonly maxHealth: number;

    constructor(id: string, maxHealth: number) {
        super(id);
        this.maxHealth = maxHealth;
        this.health = maxHealth;
    }

    takeDamage(amount: number): void {
        this.health = Math.max(0, this.health - amount);
    }

    get isDead(): boolean {
        return this.health <= 0;
    }
}
