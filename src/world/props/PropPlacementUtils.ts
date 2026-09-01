import { FULL_TURN } from "@/lib/helpers";

export function pickWeightedSpecies<TSpecies>(
    species: TSpecies[],
    nextRandom: () => number
): TSpecies | undefined {
    return species[Math.floor(nextRandom() * species.length)];
}

export function hasClearFootprint(
    centerX: number,
    centerZ: number,
    clearanceRadius: number,
    steepnessAt: (worldX: number, worldZ: number) => number,
    slopeLimit: number,
    probeCount = 6
): boolean {
    if (steepnessAt(centerX, centerZ) > slopeLimit) return false;
    if (clearanceRadius <= 0) return true;

    for (let probe = 0; probe < probeCount; probe += 1) {
        const angle = (probe / probeCount) * FULL_TURN;
        const rimX = centerX + Math.cos(angle) * clearanceRadius;
        const rimZ = centerZ + Math.sin(angle) * clearanceRadius;

        if (steepnessAt(rimX, rimZ) > slopeLimit) return false;
    }

    return true;
}
