import type { Object3D } from "three";
import { MeleeWeapon } from "@/entities/weapons/MeleeWeapon";
import type { Weapon } from "@/entities/weapons/Weapon";
import type { ICarryRig, IHandRig, WeaponDefinition } from "@/types/weapons";
import type { IModelTemplate } from "@/types/world";

export function createWeapon(
    definition: WeaponDefinition,
    template: IModelTemplate,
    handRig: IHandRig,
    effectsRoot: Object3D,
    carryRig?: ICarryRig
): Weapon {
    switch (definition.kind) {
        case "melee":
            return new MeleeWeapon(template, definition, handRig, effectsRoot, carryRig);
    }
}
