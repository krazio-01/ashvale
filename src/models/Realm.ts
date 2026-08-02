import { Schema, model } from "mongoose";
import { IRealmChapter } from "../types/realm";

export const GENERATOR_VERSION = 1;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

const realmSchema = new Schema<IRealmDocument>(
    {
        repositoryOwner: { type: String, required: true, lowercase: true, trim: true },
        repositoryName: { type: String, required: true, lowercase: true, trim: true },
        repositoryFullName: { type: String, required: true, trim: true },
        headCommitSha: { type: String, required: true, match: COMMIT_SHA_PATTERN },
        generationSeed: { type: Number, required: true, min: 0 },
        starCount: { type: Number, required: true, min: 0 },
        primaryLanguage: { type: String, default: null },
        totalCommitCount: { type: Number, required: true, min: 1 },
        chapters: { type: Schema.Types.Mixed, required: true },
        generatorVersion: { type: Number, required: true, min: 1 },
        isFeatured: { type: Boolean, default: false },
    },
    { timestamps: true, versionKey: false },
);

realmSchema.index({ repositoryOwner: 1, repositoryName: 1 }, { unique: true });
realmSchema.index({ isFeatured: 1 }, { partialFilterExpression: { isFeatured: true } });

export const Realm = model<IRealmDocument>("Realm", realmSchema);

interface IRealmDocument {
    repositoryOwner: string;
    repositoryName: string;
    repositoryFullName: string;
    headCommitSha: string;
    generationSeed: number;
    starCount: number;
    primaryLanguage: string | null;
    totalCommitCount: number;
    chapters: IRealmChapter[];
    generatorVersion: number;
    isFeatured: boolean;
}
