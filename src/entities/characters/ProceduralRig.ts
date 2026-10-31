import { Bone, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import {
    PROCEDURAL_ANIMATION,
    PROCEDURAL_DETAIL_RANK,
    SKELETON_BONES,
} from "@/constants/characters";
import type { ImpactProfileName } from "@/constants/characters";
import { PHYSICS } from "@/constants/physics";
import { BoneMath } from "@/lib/boneMath";
import {
    BreathingAndLookLayer,
    BladeContactLayer,
    FootPlantingLayer,
    OffHandGripLayer,
    ImpactSpringLayer,
    type ProceduralLayer,
} from "@/entities/characters/ProceduralLayers";
import { ClothSimulation } from "@/systems/physics/ClothSimulation";
import type { ICapsuleSource } from "@/types/physics";
import type { IBladeSource, IGroundProbe, IProceduralFrame } from "@/types/characters";
import type { Handedness } from "@/types/combat";

export class ProceduralRig {
    private readonly model: Object3D;
    private readonly pelvis: Object3D | null;
    private readonly impactSprings: ImpactSpringLayer;
    private readonly bladeContact: BladeContactLayer | null;
    private readonly layers: ProceduralLayer[];
    private readonly cloth: ClothSimulation | null;
    private readonly activeLayers: ProceduralLayer[] = [];
    private readonly bones: Bone[] = [];
    private readonly animatedRotations: Quaternion[] = [];
    private readonly animatedPelvisPosition = new Vector3();
    private isPoseModified = false;
    private previousRank = PROCEDURAL_DETAIL_RANK.none;

    constructor(model: Object3D, body: Object3D, probe: IGroundProbe) {
        this.model = model;
        model.traverse((object) => {
            if (!(object instanceof Bone)) return;
            if (object.name.startsWith(PHYSICS.boneNamePrefix)) return;
            this.bones.push(object);
            this.animatedRotations.push(new Quaternion());
        });
        this.pelvis = model.getObjectByName(SKELETON_BONES.pelvis) ?? null;
        this.impactSprings = new ImpactSpringLayer(model);
        const bladeArms = BoneMath.findLimbs(model, SKELETON_BONES.arms);
        this.bladeContact = bladeArms ? new BladeContactLayer(bladeArms) : null;
        const gripArms = BoneMath.findLimbs(model, SKELETON_BONES.arms);
        const layers: (ProceduralLayer | null)[] = [
            this.impactSprings,
            new BreathingAndLookLayer(model, body),
            FootPlantingLayer.create(model, probe),
            this.bladeContact,
            gripArms ? new OffHandGripLayer(gripArms) : null,
        ];
        this.layers = layers.filter((layer): layer is ProceduralLayer => layer !== null);
        this.cloth = ClothSimulation.create(model, body, probe);
    }

    applyImpact(push: Vector3, profile: ImpactProfileName): void {
        this.impactSprings.addImpulse(push, profile);
        this.cloth?.applyHitImpulse(push, PROCEDURAL_ANIMATION.impacts[profile].strength);
    }

    beginBladeContact(
        own: IBladeSource,
        other: IBladeSource,
        hand: Handedness,
        maxCorrection: number
    ): void {
        this.bladeContact?.begin(own, other, hand, maxCorrection);
    }

    restoreAnimatedPose(): void {
        if (!this.isPoseModified) return;
        for (let index = 0; index < this.bones.length; index++)
            this.bones[index].quaternion.copy(this.animatedRotations[index]);
        if (this.pelvis) this.pelvis.position.copy(this.animatedPelvisPosition);
        this.isPoseModified = false;
    }

    update(frame: IProceduralFrame): void {
        const rank = PROCEDURAL_DETAIL_RANK[frame.detail];
        const previousRank = this.previousRank;
        this.previousRank = rank;
        const isPoseCurrent = rank !== PROCEDURAL_DETAIL_RANK.none;
        if (isPoseCurrent) this.updatePose(frame, rank, previousRank);
        this.cloth?.update(frame.deltaSeconds, frame.physicsDetail, isPoseCurrent);
    }

    attachCapsule(slot: number, source: ICapsuleSource): void {
        this.cloth?.attachCapsule(slot, source);
    }

    resetPhysics(): void {
        this.cloth?.reset();
    }

    dispose(): void {
        this.cloth?.dispose();
    }

    private updatePose(frame: IProceduralFrame, rank: number, previousRank: number): void {
        for (let index = 0; index < this.bones.length; index++)
            this.animatedRotations[index].copy(this.bones[index].quaternion);
        if (this.pelvis) this.animatedPelvisPosition.copy(this.pelvis.position);
        this.isPoseModified = true;
        this.model.updateWorldMatrix(true, true);

        this.activeLayers.length = 0;
        for (const layer of this.layers) {
            const minimumRank = PROCEDURAL_DETAIL_RANK[layer.minimumDetail];
            if (rank < minimumRank) continue;
            if (previousRank < minimumRank) layer.reset();
            layer.captureAnimatedPose(frame);
            this.activeLayers.push(layer);
        }
        for (const layer of this.activeLayers) layer.apply(frame);
    }
}
