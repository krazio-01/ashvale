import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SKELETONS, type ISkeletonDescriptor, type SkeletonName } from "@/constants/characters";
import type { IClothFeel } from "@/types/physics";
import { PIPELINE_CONFIG, assertExists } from "../pipeline";
import {
    assertTuning,
    REFERENCE_HEIGHT_METRES,
    resolveTuning,
    type DeepPartial,
    type IPipelineTuning,
} from "./PipelineTuning";

const CHARACTER_SOURCE_DIRECTORY = path.join(PIPELINE_CONFIG.sourceRoot, "characters");
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const SNAKE_AND_SIDE = /^[a-z][a-z0-9_]*$/;
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;
const MINIMUM_LATTICE_SIZE = 2;

export const SKELETON = {
    ual: {
        file: path.join(CHARACTER_SOURCE_DIRECTORY, "UAL1_Standard.glb"),
        clipLibraries: [
            path.join(CHARACTER_SOURCE_DIRECTORY, "UAL1_Standard.glb"),
            path.join(CHARACTER_SOURCE_DIRECTORY, "CombatClips.glb"),
        ],
    },
} as const satisfies Record<SkeletonName, { file: string; clipLibraries: readonly string[] }>;

export const CHARACTER_ROLE_DEFAULTS = {
    player: { triangles: 36_000, textureSize: 2048 },
    enemy: { triangles: 15_000, textureSize: 1024 },
    boss: { triangles: 45_000, textureSize: 2048 },
} as const satisfies Record<string, ICharacterBudget>;

const NEUTRAL_ALBEDO_GRADE: IAlbedoGrade = { saturationScale: 1, valueExponent: 1 };
const ALBEDO_GRADE_RANGE = { minimum: 0.3, maximum: 1.5 };

export type SkeletonBone = string;
export type CharacterVector = [number, number, number];
export type CharacterJoint = string;
export type CharacterJoints = Record<CharacterJoint, CharacterVector>;
export type CharacterRole = keyof typeof CHARACTER_ROLE_DEFAULTS;

export interface IConfirmedJoints {
    sourceSha256: string;
    positions: CharacterJoints;
}

export interface ICharacterBudget {
    triangles: number;
    textureSize: number;
}

export interface IAlbedoGrade {
    saturationScale: number;
    valueExponent: number;
}

export interface IRigidProp {
    segmentedParts: readonly number[];
    name?: string;
    bone?: SkeletonBone;
}

export interface IBodyOverride {
    exclude?: true;
    attachBone?: SkeletonBone;
    segmentedParts?: readonly number[];
    clothSeed?: CharacterVector;
    columns?: number;
    rows?: number;
    feel?: Partial<IClothFeel>;
}

export interface ICharacterReferences {
    riggedModel: string;
    segmentedModel: string;
    jointsFromRiggedModel: readonly CharacterJoint[];
}

export interface ICharacterRecipe {
    name: string;
    role: CharacterRole;
    source: string;
    skeleton: SkeletonName;
    fit: { facingYawDegrees: number; heightMetres: number };
    budget?: Partial<ICharacterBudget>;
    albedoGrade?: IAlbedoGrade;
    tuning?: DeepPartial<IPipelineTuning>;
    props?: readonly IRigidProp[];
    overrides?: Record<string, IBodyOverride>;
    references: ICharacterReferences;
    joints?: IConfirmedJoints;
}

export interface IResolvedCharacterRecipe {
    name: string;
    role: CharacterRole;
    source: string;
    skeleton: string;
    skeletonDescriptor: ISkeletonDescriptor;
    clipLibraries: readonly string[];
    facingYawDegrees: number;
    heightMetres: number;
    triangles: number;
    textureSize: number;
    albedoGrade: IAlbedoGrade;
    tuning: IPipelineTuning;
    referenceHeightMetres: number;
    props: readonly IRigidProp[];
    overrides: Record<string, IBodyOverride>;
    references: ICharacterReferences;
    jointNames: readonly CharacterJoint[];
    joints: IConfirmedJoints | null;
}

const fromGameAssets = (file: string): string => path.join(PIPELINE_CONFIG.gameAssetsRoot, file);

const CHARACTER_RECIPES: readonly ICharacterRecipe[] = [
    {
        name: "Player",
        role: "player",
        source: "Charaters/models/player/carachter_texture.glb",
        skeleton: "ual",
        fit: { facingYawDegrees: -90, heightMetres: 1.78 },
        references: {
            riggedModel: "Charaters/models/player/character_rig.glb",
            segmentedModel: "Charaters/models/player/character_meshed.glb",
            jointsFromRiggedModel: [
                "upperarm_l",
                "lowerarm_l",
                "hand_l",
                "middle_01_l",
                "upperarm_r",
                "lowerarm_r",
                "hand_r",
                "middle_01_r",
            ],
        },
        tuning: { physics: { latticeTop: 0.1 } },
        props: [{ segmentedParts: [34, 40, 55, 57] }],
        overrides: {
            cloth_cloak: { segmentedParts: [0, 8, 12], attachBone: "spine_03" },
        },
        joints: {
            sourceSha256: "9ecfc326cd5bf7d06bacd1e45ca622b7de3055bdaed7f17746be6204a69d67aa",
            positions: {
                pelvis: [-0.0099, 0.0296, 0.8931],
                spine_01: [-0.0091, 0.0165, 1.0233],
                spine_02: [-0.0084, 0.0157, 1.1431],
                spine_03: [-0.0077, 0.028, 1.2806],
                neck_01: [-0.0069, 0.039, 1.4487],
                Head: [-0.0066, 0.029, 1.5277],
                head_top: [-0.0043, 0.0112, 1.7684],
                upperarm_l: [0.1717, 0.0808, 1.4388],
                lowerarm_l: [0.2745, 0.0602, 1.1921],
                hand_l: [0.3784, -0.0159, 0.9908],
                middle_01_l: [0.4327, -0.0475, 0.8822],
                upperarm_r: [-0.1847, 0.0808, 1.4388],
                lowerarm_r: [-0.2874, 0.0602, 1.1921],
                hand_r: [-0.4112, -0.0195, 0.9901],
                middle_01_r: [-0.4506, -0.0471, 0.8849],
                thigh_l: [0.0767, 0.0296, 0.908],
                calf_l: [0.1152, -0.0124, 0.5168],
                foot_l: [0.1599, 0.0615, 0.1015],
                ball_l: [0.1558, -0.0621, 0.0148],
                thigh_r: [-0.0965, 0.0296, 0.908],
                calf_r: [-0.1343, -0.0105, 0.5165],
                foot_r: [-0.1765, 0.0687, 0.1019],
                ball_r: [-0.1742, -0.062, 0.0148],
            },
        },
    },
];

export class AssetManifest {
    static get characterNames(): string[] {
        return CHARACTER_RECIPES.map((recipe) => recipe.name);
    }

    static findCharacter(name: string): IResolvedCharacterRecipe | undefined {
        const recipe = CHARACTER_RECIPES.find((candidate) => candidate.name === name);
        return recipe && AssetManifest.resolveCharacter(recipe);
    }

    static findCharacterOwningFile(fileName: string): IResolvedCharacterRecipe | undefined {
        const recipe = CHARACTER_RECIPES.find((candidate) =>
            fileName.startsWith(`${candidate.name}_`)
        );
        return recipe && AssetManifest.resolveCharacter(recipe);
    }

    static assertCharacterReady(recipe: IResolvedCharacterRecipe): void {
        if (!PASCAL_CASE.test(recipe.name))
            throw new Error(`character name ${recipe.name} must be PascalCase letters and digits`);
        assertExists(recipe.source, `${recipe.name}: source model not found: ${recipe.source}`);
        assertExists(recipe.skeleton, `${recipe.name}: skeleton not found: ${recipe.skeleton}`);
        for (const reference of [recipe.references.riggedModel, recipe.references.segmentedModel])
            assertExists(reference, `${recipe.name}: reference model not found: ${reference}`);
        AssetManifest.assertBonesExist(recipe);
        assertTuning(recipe.name, recipe.tuning);
        AssetManifest.assertAlbedoGrade(recipe);
        AssetManifest.assertOverrides(recipe);
        AssetManifest.assertJointsMatchSource(recipe);
    }

    private static resolveCharacter(recipe: ICharacterRecipe): IResolvedCharacterRecipe {
        const budget = { ...CHARACTER_ROLE_DEFAULTS[recipe.role], ...recipe.budget };
        return {
            name: recipe.name,
            role: recipe.role,
            source: fromGameAssets(recipe.source),
            skeleton: SKELETON[recipe.skeleton].file,
            skeletonDescriptor: SKELETONS[recipe.skeleton],
            clipLibraries: SKELETON[recipe.skeleton].clipLibraries,
            facingYawDegrees: recipe.fit.facingYawDegrees,
            heightMetres: recipe.fit.heightMetres,
            triangles: budget.triangles,
            textureSize: budget.textureSize,
            albedoGrade: recipe.albedoGrade ?? NEUTRAL_ALBEDO_GRADE,
            tuning: resolveTuning(recipe.role, recipe.tuning),
            referenceHeightMetres: REFERENCE_HEIGHT_METRES,
            props: recipe.props ?? [],
            overrides: recipe.overrides ?? {},
            references: {
                riggedModel: fromGameAssets(recipe.references.riggedModel),
                segmentedModel: fromGameAssets(recipe.references.segmentedModel),
                jointsFromRiggedModel: recipe.references.jointsFromRiggedModel,
            },
            jointNames: SKELETONS[recipe.skeleton].measuredJoints,
            joints: recipe.joints ?? null,
        };
    }

    private static assertBonesExist(recipe: IResolvedCharacterRecipe): void {
        const skeleton = recipe.skeletonDescriptor;
        const known = new Set<string>([...skeleton.measuredJoints, ...skeleton.rig.coreBones]);
        known.delete(skeleton.bones.headTop);
        const requireBone = (field: string, bone: string): void => {
            if (!known.has(bone))
                throw new Error(
                    `${recipe.name}: ${field} ${bone} is not a bone of skeleton ${recipe.skeleton}`
                );
        };
        for (const bone of recipe.references.jointsFromRiggedModel)
            requireBone("references.jointsFromRiggedModel", bone);
        for (const prop of recipe.props)
            if (prop.bone) requireBone(`prop ${prop.name ?? prop.segmentedParts} bone`, prop.bone);
        for (const [name, override] of Object.entries(recipe.overrides))
            if (override.attachBone)
                requireBone(`override ${name} attachBone`, override.attachBone);
        if (!recipe.joints) return;
        const confirmed = Object.keys(recipe.joints.positions).sort().join(",");
        if (confirmed !== [...skeleton.measuredJoints].sort().join(","))
            throw new Error(
                `${recipe.name}: confirmed joints ${confirmed} differ from the skeleton's measured joints`
            );
    }

    private static assertAlbedoGrade(recipe: IResolvedCharacterRecipe): void {
        for (const [key, value] of Object.entries(recipe.albedoGrade))
            if (!(value >= ALBEDO_GRADE_RANGE.minimum && value <= ALBEDO_GRADE_RANGE.maximum))
                throw new Error(
                    `${recipe.name}: albedoGrade.${key} ${value} is outside ${ALBEDO_GRADE_RANGE.minimum} to ${ALBEDO_GRADE_RANGE.maximum}`
                );
    }

    private static assertOverrides(recipe: IResolvedCharacterRecipe): void {
        for (const [name, override] of Object.entries(recipe.overrides)) {
            if (!CAMEL_CASE.test(name) && !SNAKE_AND_SIDE.test(name))
                throw new Error(`${recipe.name}: override name ${name} is not a body name`);
            if (override.segmentedParts?.length && override.clothSeed)
                throw new Error(
                    `${recipe.name}: override ${name} has both segmentedParts and clothSeed`
                );
            if (override.segmentedParts?.length && (override.columns || override.rows))
                throw new Error(
                    `${recipe.name}: override ${name} is a garment; its lattice is sized by physics.nodeSpacing, not columns/rows`
                );
            if (override.clothSeed && !override.clothSeed.every(Number.isFinite))
                throw new Error(`${recipe.name}: override ${name} has a non-finite clothSeed`);
            for (const [field, value] of [
                ["columns", override.columns],
                ["rows", override.rows],
            ] as const)
                if (
                    value !== undefined &&
                    (!Number.isInteger(value) || value < MINIMUM_LATTICE_SIZE)
                )
                    throw new Error(
                        `${recipe.name}: override ${name} ${field} must be a whole number of at least ${MINIMUM_LATTICE_SIZE}`
                    );
        }
        for (const prop of recipe.props)
            if (!prop.segmentedParts.length)
                throw new Error(`${recipe.name}: a prop needs at least one segmented part`);
    }

    private static assertJointsMatchSource(recipe: IResolvedCharacterRecipe): void {
        if (!recipe.joints) return;
        const sourceSha256 = createHash("sha256")
            .update(fs.readFileSync(recipe.source))
            .digest("hex");
        if (sourceSha256 !== recipe.joints.sourceSha256)
            throw new Error(
                `${recipe.name}: the source model changed since its joints were confirmed ` +
                    `(sha256 ${sourceSha256}); remove its joints from tools/assets/AssetManifest.ts, ` +
                    "rebuild, check them against the character and add them again"
            );
    }
}
