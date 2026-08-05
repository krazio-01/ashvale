import "server-only";
import { connectToDatabase } from "@/config/mongo";
import Realm, { CACHE_BUST_COUNTER } from "@/models/Realm";
import { fetchCommitAtPosition } from "@/services/github/GithubService";
import { generateRealm } from "@/services/realm/RealmGenerator";
import { IResolvedRealm } from "@/types/realm";

const NEWEST_COMMIT_POSITION = 0;

export async function resolveRealm(
    requestedOwner: string,
    requestedName: string
): Promise<IResolvedRealm> {
    await connectToDatabase();

    const repositoryOwner = requestedOwner.toLowerCase();
    const repositoryName = requestedName.toLowerCase();

    const [headCommit, storedRealm] = await Promise.all([
        fetchCommitAtPosition(repositoryOwner, repositoryName, NEWEST_COMMIT_POSITION),
        Realm.findOne({ repositoryOwner, repositoryName }).lean(),
    ]);

    const canReuseStoredRealm =
        storedRealm !== null &&
        storedRealm.headCommitSha === headCommit.sha &&
        storedRealm.cacheBustCounter === CACHE_BUST_COUNTER;

    if (canReuseStoredRealm) return storedRealm;

    const { realm, headCommitSha } = await generateRealm(repositoryOwner, repositoryName);

    await Realm.findOneAndUpdate(
        { repositoryOwner, repositoryName },
        {
            $set: {
                repositoryOwner,
                repositoryName,
                repositoryFullName: realm.repositoryFullName,
                headCommitSha,
                cacheBustCounter: CACHE_BUST_COUNTER,
                generationSeed: realm.generationSeed,
                starCount: realm.starCount,
                primaryLanguage: realm.primaryLanguage,
                totalCommitCount: realm.totalCommitCount,
                chapters: realm.chapters,
            },
        },
        { upsert: true, runValidators: true }
    );

    return realm;
}
