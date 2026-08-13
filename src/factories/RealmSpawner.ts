import type { Camera } from "three";
import { Ground } from "@/entities/environment/Ground";
import { Prop } from "@/entities/environment/Prop";
import { Player } from "@/entities/characters/Player";
import type { World } from "@/world/World";
import type { IPropPlacement } from "@/types/world";
import { PALETTE, PropShape } from "@/constants/game";

const placements: IPropPlacement[] = [
    {
        shape: PropShape.Pillar,
        position: [-8, 3, -6],
        rotationY: 0.2,
        scale: 1,
        color: PALETTE.stoneLight,
    },
    {
        shape: PropShape.Pillar,
        position: [8, 2.4, -9],
        rotationY: -0.4,
        scale: 0.8,
        color: PALETTE.stone,
    },
    {
        shape: PropShape.Pillar,
        position: [-14, 3.6, -14],
        rotationY: 0.7,
        scale: 1.2,
        color: PALETTE.stoneLight,
    },
    {
        shape: PropShape.Pillar,
        position: [13, 3, -18],
        rotationY: -0.9,
        scale: 1,
        color: PALETTE.stoneDark,
    },
    {
        shape: PropShape.Boulder,
        position: [-4, 1.1, 2],
        rotationY: 0.5,
        scale: 0.9,
        color: PALETTE.moss,
    },
    {
        shape: PropShape.Boulder,
        position: [5, 1.4, -2],
        rotationY: -1.1,
        scale: 1.2,
        color: PALETTE.stone,
    },
    {
        shape: PropShape.Boulder,
        position: [-11, 0.9, -20],
        rotationY: 2.2,
        scale: 0.75,
        color: PALETTE.moss,
    },
    {
        shape: PropShape.Boulder,
        position: [17, 1.8, -6],
        rotationY: 1.4,
        scale: 1.5,
        color: PALETTE.stoneDark,
    },
    {
        shape: PropShape.Slab,
        position: [0, 0.45, -12],
        rotationY: 0.1,
        scale: 1.4,
        color: PALETTE.stone,
    },
    {
        shape: PropShape.Slab,
        position: [-6, 0.4, -16],
        rotationY: -0.6,
        scale: 1,
        color: PALETTE.stoneLight,
    },
    {
        shape: PropShape.Slab,
        position: [9, 0.5, 4],
        rotationY: 1.2,
        scale: 1.1,
        color: PALETTE.moss,
    },
];

export function spawnTestRealm(world: World, camera: Camera): void {
    world.addEntity(new Ground("ground", world.context));

    placements.forEach((placement, index) => {
        world.addEntity(new Prop(`prop-${index}`, world.context, placement));
    });

    world.addEntity(new Player("player", world.context, camera));
}
