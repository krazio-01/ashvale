import { Vector3 } from "three";
import type { ISkeletonDescriptor, SkeletonSide } from "@/constants/characters";
import type { AssetBuild, IBuildRecipe, IDetectionReport } from "./AssetBuilds";
import type { CharacterJoints, IResolvedCharacterRecipe } from "./AssetManifest";

export const VALIDATION_LIMITS = {
    rigidityMaxMm: 0.5,
    seamGapMm: 0.1,
    triangleTolerance: 0.01,
    jointMissMm: 1,
    limbOwnership: 0.9,
    kneeBackwardMetres: 0.005,
    colliderRadiusMinMetres: 0.02,
    colliderRadiusMaxMetres: 0.35,
    latticeBindMillimetres: 0.5,
};

interface IGarmentMeasurements {
    rimVertices: number;
    mantleVertices: number;
    drapeVertices: number;
    detachedNodes: number;
    maxDrapeArmShare: number;
    liftMm: number;
}

interface IPhysicsMeasurements {
    bodies: number;
    latticeBones: number;
    colliders: number;
    colliderRadiusMin: number;
    colliderRadiusMax: number;
    clothVertices: number;
    strayLatticeInfluences: number;
    seamNodes: number;
    seamWeightMismatches: number;
    garment?: IGarmentMeasurements;
}

interface ICharacterMeasurements {
    triangles: number;
    jointMissMm: number;
    limbOwnership: Record<string, number>;
    poses: number;
    rigidity: Record<string, { maxMm: number; rmsMm: number }>;
    seamGapMm: number;
    stretch: Record<string, { worst: number; mean: number }>;
    edges: { total: number; over3: number; over5: number; propBoundary: number };
    physics?: IPhysicsMeasurements;
}

export abstract class BuildValidator<TRecipe extends IBuildRecipe, TMeasurements = unknown> {
    validate(build: AssetBuild<TRecipe>): void {
        const measurements = build.readJson<TMeasurements>("validation", "measurements.json");
        const failures = this.findFailures(build, measurements);
        console.log(`  images: ${build.file("validation")}`);
        if (failures.length > 0)
            throw new Error(`Validation failed:\n  - ${failures.join("\n  - ")}`);
        console.log(
            "Validation passed: look at every image in the validation folder before showing anyone"
        );
    }

    protected abstract findFailures(
        build: AssetBuild<TRecipe>,
        measurements: TMeasurements
    ): string[];
}

const heightFactor = (recipe: IResolvedCharacterRecipe): number =>
    recipe.heightMetres / recipe.referenceHeightMetres;

export class CharacterValidator extends BuildValidator<
    IResolvedCharacterRecipe,
    ICharacterMeasurements
> {
    protected findFailures(
        build: AssetBuild<IResolvedCharacterRecipe>,
        measurements: ICharacterMeasurements
    ): string[] {
        console.log(`\nValidating over ${measurements.poses} poses`);
        return [
            ...this.checkJoints(build),
            ...this.checkSkeletonFit(measurements),
            ...this.checkRigidity(measurements),
            ...this.checkStretch(measurements),
            ...this.checkPhysics(build, measurements),
            ...this.checkTriangles(build.recipe, measurements),
        ];
    }

    private kneeBendMetres(
        positions: CharacterJoints,
        skeleton: ISkeletonDescriptor,
        side: SkeletonSide
    ): number {
        const [hipBone, kneeBone, ankleBone] = skeleton.bones.legs[side];
        const hip = new Vector3(...positions[hipBone!]!);
        const knee = new Vector3(...positions[kneeBone!]!);
        const ankle = new Vector3(...positions[ankleBone!]!);
        const ball = new Vector3(...positions[skeleton.bones.feet[side][1]!]!);

        const legAxis = ankle.clone().sub(hip).normalize();
        const toesForward = new Vector3(ball.x - ankle.x, ball.y - ankle.y, 0);
        toesForward.addScaledVector(legAxis, -toesForward.dot(legAxis));
        const kneeOffset = knee.clone().sub(hip);
        kneeOffset.addScaledVector(legAxis, -kneeOffset.dot(legAxis));
        return kneeOffset.dot(toesForward) / toesForward.length();
    }

    private checkJoints(build: AssetBuild<IResolvedCharacterRecipe>): string[] {
        const confirmed = build.recipe.joints;
        if (!confirmed)
            return [
                "joints are measured but not confirmed: check them against the character and add " +
                    "them to tools/assets/AssetManifest.ts",
            ];

        const failures: string[] = [];
        const built = build.readJson<{ final: Record<string, readonly number[]> }>(
            "joints.json"
        ).final;
        const stale = Object.entries(confirmed.positions)
            .filter(([name, position]) =>
                position.some((value, axis) => built[name]?.[axis] !== value)
            )
            .map(([name]) => name);
        if (stale.length > 0)
            failures.push(
                `the build used joints other than the confirmed ones (${stale.join(", ")}): re-run from the joints stage`
            );
        const skeleton = build.recipe.skeletonDescriptor;
        for (const side of ["left", "right"] as const) {
            const bend = this.kneeBendMetres(confirmed.positions, skeleton, side);
            const kneeBone = skeleton.bones.legs[side][1];
            console.log(`  ${kneeBone} bends ${(bend * 100).toFixed(1)} cm toward the toes`);
            const kneeLimit = VALIDATION_LIMITS.kneeBackwardMetres * heightFactor(build.recipe);
            if (!(bend >= -kneeLimit))
                failures.push(
                    `${kneeBone} bend is ${(bend * 100).toFixed(1)} cm toward the toes (limit ${(-kneeLimit * 100).toFixed(1)} cm): the leg is bent backwards or its joints are degenerate`
                );
        }
        return failures;
    }

    private checkSkeletonFit(measurements: ICharacterMeasurements): string[] {
        const failures: string[] = [];
        console.log(`  joint miss ${measurements.jointMissMm.toFixed(3)} mm`);
        if (measurements.jointMissMm > VALIDATION_LIMITS.jointMissMm)
            failures.push(
                `the fitted skeleton misses its joints by ${measurements.jointMissMm} mm (limit ${VALIDATION_LIMITS.jointMissMm} mm)`
            );
        for (const [limb, share] of Object.entries(measurements.limbOwnership)) {
            console.log(`  limb ${limb.padEnd(6)} own-chain weight ${share.toFixed(3)}`);
            if (share < VALIDATION_LIMITS.limbOwnership)
                failures.push(
                    `${limb} carries only ${share} of its weight on its own bones (limit ${VALIDATION_LIMITS.limbOwnership})`
                );
        }
        return failures;
    }

    private checkRigidity(measurements: ICharacterMeasurements): string[] {
        const failures: string[] = [];
        for (const [group, { maxMm, rmsMm }] of Object.entries(measurements.rigidity)) {
            console.log(
                `  rigid ${group.padEnd(18)} max ${maxMm.toFixed(3)} mm  rms ${rmsMm.toFixed(3)} mm`
            );
            if (maxMm > VALIDATION_LIMITS.rigidityMaxMm)
                failures.push(
                    `${group} deforms by ${maxMm} mm (limit ${VALIDATION_LIMITS.rigidityMaxMm} mm)`
                );
        }
        console.log(`  seam gap ${measurements.seamGapMm.toFixed(3)} mm`);
        if (measurements.seamGapMm > VALIDATION_LIMITS.seamGapMm)
            failures.push(
                `UV seams open by ${measurements.seamGapMm} mm (limit ${VALIDATION_LIMITS.seamGapMm} mm)`
            );
        return failures;
    }

    private checkStretch(measurements: ICharacterMeasurements): string[] {
        for (const [region, { worst, mean }] of Object.entries(measurements.stretch))
            console.log(`  stretch ${region.padEnd(7)} worst x${worst}  mean x${mean}`);
        const { edges } = measurements;
        console.log(`  edges stretched >3x: ${edges.over3}, >5x: ${edges.over5} of ${edges.total}`);
        console.log(`  edges joining a prop to the body: ${edges.propBoundary}`);
        return edges.propBoundary > 0
            ? [
                  `${edges.propBoundary} mesh edges join a rigid prop to the body: the prop is not detached`,
              ]
            : [];
    }

    private checkPhysics(
        build: AssetBuild<IResolvedCharacterRecipe>,
        measurements: ICharacterMeasurements
    ): string[] {
        const detected = build.readJson<IDetectionReport>("detection.json").physics;
        const expectedBodies = detected.length;
        if (expectedBodies === 0) return [];
        const physics = measurements.physics;
        if (!physics) return ["bodies were detected but measurements.json has no physics section"];

        const failures: string[] = [];
        const expectedLattice = detected.reduce((sum, body) => sum + body.columns * body.rows, 0);
        console.log(
            `  physics ${physics.bodies} bodies, ${physics.latticeBones} lattice bones, ${physics.colliders} colliders, ` +
                `radius ${physics.colliderRadiusMin}-${physics.colliderRadiusMax} m`
        );
        if (physics.clothVertices <= 0) failures.push("no vertex was labelled as physics cloth");
        if (physics.strayLatticeInfluences > 0)
            failures.push(
                `physics weights are inconsistent: ${physics.strayLatticeInfluences} non-cloth vertices use lattice bones`
            );
        console.log(
            `  cloth seam ${physics.seamNodes} nodes, ${physics.seamWeightMismatches} weighted unlike their body twin`
        );
        if (physics.seamWeightMismatches > 0)
            failures.push(
                `${physics.seamWeightMismatches} cloth seam nodes are weighted unlike their body twin, so the seam opens when the cloth moves`
            );
        if (physics.bodies !== expectedBodies || physics.latticeBones !== expectedLattice)
            failures.push(
                `physics built ${physics.bodies} bodies and ${physics.latticeBones} lattice bones, detection asks for ${expectedBodies} and ${expectedLattice}`
            );
        const minimumRadius =
            VALIDATION_LIMITS.colliderRadiusMinMetres * heightFactor(build.recipe);
        const maximumRadius =
            VALIDATION_LIMITS.colliderRadiusMaxMetres * heightFactor(build.recipe);
        if (physics.colliderRadiusMin < minimumRadius || physics.colliderRadiusMax > maximumRadius)
            failures.push(
                `collider radii ${physics.colliderRadiusMin}-${physics.colliderRadiusMax} m are outside ${minimumRadius.toFixed(3)}-${maximumRadius.toFixed(3)} m`
            );
        failures.push(...this.checkGarment(build, physics));
        return failures;
    }

    private checkGarment(
        build: AssetBuild<IResolvedCharacterRecipe>,
        physics: IPhysicsMeasurements
    ): string[] {
        const garment = physics.garment;
        if (!garment) return [];
        const { rig, weights } = build.recipe.tuning;
        const liftLimitMm = weights.garmentLiftLimit * 1000 * heightFactor(build.recipe);
        console.log(
            `  garment rim ${garment.rimVertices}, mantle ${garment.mantleVertices}, drape ${garment.drapeVertices}, ` +
                `detached ${garment.detachedNodes}, drape arm share ${garment.maxDrapeArmShare}, lift ${garment.liftMm} mm`
        );
        const failures: string[] = [];
        if (garment.rimVertices > 0 && garment.mantleVertices === 0)
            failures.push(
                "the garment covers an open body rim but no vertex was classed as mantle"
            );
        if (garment.detachedNodes > 0)
            failures.push(
                `${garment.detachedNodes} garment nodes are split from the body, so the rim can open`
            );
        if (garment.maxDrapeArmShare > rig.garmentArmShare + 0.02)
            failures.push(
                `drape arm share ${garment.maxDrapeArmShare} is above the cap ${rig.garmentArmShare}`
            );
        if (garment.liftMm > liftLimitMm)
            failures.push(
                `the drape lifts ${garment.liftMm} mm off the body (limit ${liftLimitMm.toFixed(1)} mm)`
            );
        return failures;
    }

    private checkTriangles(
        recipe: IResolvedCharacterRecipe,
        measurements: ICharacterMeasurements
    ): string[] {
        const drift = Math.abs(measurements.triangles - recipe.triangles) / recipe.triangles;
        return drift > VALIDATION_LIMITS.triangleTolerance
            ? [`${measurements.triangles} triangles, config asks for ${recipe.triangles}`]
            : [];
    }
}
