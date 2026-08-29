export function pickWeightedSpecies<TSpecies>(
    species: TSpecies[],
    nextRandom: () => number
): TSpecies | undefined {
    return species[Math.floor(nextRandom() * species.length)];
}

export function attemptPlacement<TCandidate, TResult>(
    attempts: number,
    proposeCandidate: () => TCandidate | null,
    evaluate: (candidate: TCandidate) => TResult | null
): TResult | null {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const candidate = proposeCandidate();
        if (candidate === null) continue;

        const result = evaluate(candidate);
        if (result !== null) return result;
    }

    return null;
}
