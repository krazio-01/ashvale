import { Character } from "@/entities/characters/Character";
import { IWeapon } from "@/types/entities";

const PLAYER_MAX_HEALTH = 100;
const PLAYER_MOVE_SPEED = 5;
const UNARMED_ATTACK_DAMAGE = 5;

export class Player extends Character {
    moveSpeed: number;
    equippedWeapon: IWeapon | null;

    constructor(id: string) {
        super(id, PLAYER_MAX_HEALTH);
        this.moveSpeed = PLAYER_MOVE_SPEED;
        this.equippedWeapon = null;
    }

    get attackDamage(): number {
        return this.equippedWeapon?.damage ?? UNARMED_ATTACK_DAMAGE;
    }
}
