import "server-only";
import { Model, Schema, model, models } from "mongoose";
import type { IFeaturedRealm, IResolvedRealm } from "@/types/realm";

export const CACHE_BUST_COUNTER = 1;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

interface IRealm extends IResolvedRealm, IFeaturedRealm {
    headCommitSha: string;
    cacheBustCounter: number;
    isFeatured: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const realmSchema = new Schema<IRealm>(
    {
        repositoryOwner: { type: String, required: true, lowercase: true, trim: true },
        repositoryName: { type: String, required: true, lowercase: true, trim: true },
        repositoryFullName: { type: String, required: true, trim: true },
        headCommitSha: { type: String, required: true, match: COMMIT_SHA_PATTERN },
        cacheBustCounter: { type: Number, required: true, min: 1 },
        generationSeed: { type: Number, required: true, min: 0 },
        starCount: { type: Number, required: true, min: 0 },
        primaryLanguage: { type: String, default: null },
        totalCommitCount: { type: Number, required: true, min: 1 },
        chapters: { type: Schema.Types.Mixed, required: true },
        isFeatured: { type: Boolean, default: false },
    },
    { timestamps: true, versionKey: false, strict: "throw" }
);

realmSchema.index({ repositoryOwner: 1, repositoryName: 1 }, { unique: true });
realmSchema.index({ isFeatured: 1 }, { partialFilterExpression: { isFeatured: true } });

const Realm: Model<IRealm> = models.Realm || model<IRealm>("Realm", realmSchema);

export default Realm;
