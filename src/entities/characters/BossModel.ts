import RAPIER from "@dimforge/rapier3d-compat";
import type { ColliderDesc } from "@dimforge/rapier3d-compat";
import { BufferGeometry, DodecahedronGeometry, Mesh } from "three";
import type { MaterialLibrary } from "@/world/MaterialLibrary";
import type { ICharacterModel } from "@/types/world";
import { BOSS, PALETTE } from "@/constants/game";

class PlaceholderBossModel implements ICharacterModel {
    private geometry: BufferGeometry | null = null;

    build(materialLibrary: MaterialLibrary): Mesh {
        this.geometry = new DodecahedronGeometry(BOSS.radius, 0);
        return new Mesh(this.geometry, materialLibrary.getToonMaterial(PALETTE.ember));
    }

    colliderDesc(): ColliderDesc {
        return RAPIER.ColliderDesc.ball(BOSS.radius);
    }

    dispose(): void {
        this.geometry?.dispose();
    }
}

export function bossModel(): ICharacterModel {
    return new PlaceholderBossModel();
}
