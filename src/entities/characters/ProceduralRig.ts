import { Bone, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { PROCEDURAL, PROCEDURAL_DETAIL_RANK, SKELETON_BONES } from "@/constants/characters";
import type { ImpactProfileName } from "@/constants/characters";
import { PHYSICS } from "@/constants/physics";
import {
    AmbientLayer,
    BladeContactLayer,
    FootLayer,
    GripLayer,
    ImpactSpringLayer,
    type ProceduralLayer,
} from "@/entities/characters/ProceduralLayers";
import { PhysicsLayer } from "@/systems/physics/PhysicsLayer";
import type { ICapsuleSource } from "@/types/physics";
import type { IBladeSource, IGroundProbe, IProceduralFrame } from "@/types/procedural";
import type { Handedness } from "@/types/weapons";

export class ProceduralRig {
    private readonly model: Object3D;
    private readonly pelvis: Object3D | null;
    private readonly impactSprings: ImpactSpringLayer;
    private readonly bladeContact: BladeContactLayer | null;
    private readonly layers: ProceduralLayer[];
    private readonly physics: PhysicsLayer | null;
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
        this.bladeContact = BladeContactLayer.create(model);
        const layers: (ProceduralLayer | null)[] = [
            this.impactSprings,
            new AmbientLayer(model, body),
            FootLayer.create(model, probe),
            this.bladeContact,
            GripLayer.create(model),
        ];
        this.layers = layers.filter((layer): layer is ProceduralLayer => layer !== null);
        this.physics = PhysicsLayer.create(model, body, probe);
    }

    impact(push: Vector3, profile: ImpactProfileName): void {
        this.impactSprings.kick(push, profile);
        this.physics?.impact(push, PROCEDURAL.impacts[profile].strength);
    }

    beginBladeContact(
        own: IBladeSource,
        other: IBladeSource,
        hand: Handedness,
        maxCorrection: number
    ): void {
        this.bladeContact?.begin(own, other, hand, maxCorrection);
    }

    restore(): void {
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
        if (rank !== PROCEDURAL_DETAIL_RANK.none) this.updatePose(frame, rank, previousRank);
        this.physics?.update(frame.deltaSeconds, frame.physicsDetail);
    }

    attachCapsule(slot: number, source: ICapsuleSource | null): void {
        this.physics?.attachCapsule(slot, source);
    }

    resetPhysics(): void {
        this.physics?.reset();
    }

    dispose(): void {
        this.physics?.dispose();
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
