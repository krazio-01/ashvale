import {
    AdditiveBlending,
    Color,
    DataTexture,
    Group,
    RGBAFormat,
    Sprite,
    SpriteMaterial,
    Vector3,
} from "three";
import type {
    CombatEvents,
    ICombatEventMap,
    ITelegraphSource,
} from "@/systems/combat/services/CombatEvents";
import { TELEGRAPH_FLARES } from "@/constants/combat";
import type { HitShape, IStrikeSegment, TelegraphDanger } from "@/types/combat";
import type { IWorldEntity } from "@/types/world";

const TEXTURE_SIZE = 32;
const PARRYABLE_COLOR = new Color(TELEGRAPH_FLARES.parryableColor);
const PERILOUS_COLOR = new Color(TELEGRAPH_FLARES.perilousColor);

interface IFlareSlot {
    sprite: Sprite;
    material: SpriteMaterial;
    source: ITelegraphSource | null;
    shape: HitShape;
    readonly socketShape: Extract<HitShape, { kind: "socket" }>;
    danger: TelegraphDanger;
    age: number;
}

function createGlowTexture(): DataTexture {
    const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
    const centre = (TEXTURE_SIZE - 1) / 2;
    for (let y = 0; y < TEXTURE_SIZE; y += 1)
        for (let x = 0; x < TEXTURE_SIZE; x += 1) {
            const radius = Math.min(1, Math.hypot(x - centre, y - centre) / centre);
            const offset = (y * TEXTURE_SIZE + x) * 4;
            pixels.fill(255, offset, offset + 3);
            pixels[offset + 3] = Math.round(255 * (1 - radius) ** 2);
        }
    const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE, RGBAFormat);
    texture.needsUpdate = true;
    return texture;
}

export class TelegraphFlares implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly texture = createGlowTexture();
    private readonly slots: IFlareSlot[] = [];
    private readonly segment: IStrikeSegment = {
        start: new Vector3(),
        end: new Vector3(),
        radius: 0,
    };
    private readonly unsubscribe: () => void;

    constructor(events: CombatEvents) {
        for (let index = 0; index < TELEGRAPH_FLARES.poolSize; index += 1) {
            const material = new SpriteMaterial({
                map: this.texture,
                blending: AdditiveBlending,
                depthWrite: false,
                transparent: true,
            });
            const sprite = new Sprite(material);
            sprite.visible = false;
            sprite.renderOrder = 12;
            this.sceneObject.add(sprite);
            this.slots.push({
                sprite,
                material,
                source: null,
                shape: { kind: "weapon" },
                socketShape: { kind: "socket", bone: "", radius: 0 },
                danger: "parryable",
                age: 0,
            });
        }

        this.unsubscribe = events.on("telegraph", (event) => this.ignite(event));
    }

    update(deltaSeconds: number): void {
        for (const slot of this.slots) {
            const source = slot.source;
            if (!source) continue;

            slot.age += deltaSeconds;
            if (
                slot.age >= TELEGRAPH_FLARES.seconds ||
                source.isDead ||
                !source.sampleHitShape(slot.shape, this.segment)
            ) {
                this.release(slot);
                continue;
            }

            const size =
                slot.danger === "perilous"
                    ? TELEGRAPH_FLARES.perilousSize
                    : TELEGRAPH_FLARES.parryableSize;
            slot.sprite.position.copy(this.segment.end);
            slot.sprite.scale.setScalar(
                size * Math.sin((Math.PI * slot.age) / TELEGRAPH_FLARES.seconds)
            );
            slot.sprite.visible = true;
        }
    }

    dispose(): void {
        this.unsubscribe();
        for (const slot of this.slots) slot.material.dispose();
        this.texture.dispose();
    }

    private ignite(event: ICombatEventMap["telegraph"]): void {
        if (event.combatant.team === "player") return;

        let chosen = this.slots[0];
        if (!chosen) return;
        for (const slot of this.slots) {
            if (!slot.source) {
                chosen = slot;
                break;
            }
            if (slot.age > chosen.age) chosen = slot;
        }

        chosen.source = event.combatant;
        if (event.shape.kind === "socket") {
            chosen.socketShape.bone = event.shape.bone;
            chosen.socketShape.radius = event.shape.radius;
            chosen.shape = chosen.socketShape;
        } else chosen.shape = event.shape;
        chosen.danger = event.danger;
        chosen.age = 0;
        chosen.material.color.copy(event.danger === "perilous" ? PERILOUS_COLOR : PARRYABLE_COLOR);
    }

    private release(slot: IFlareSlot): void {
        slot.source = null;
        slot.sprite.visible = false;
    }
}
