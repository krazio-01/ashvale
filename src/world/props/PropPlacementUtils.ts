export function pickWeightedSpecies<TSpecies>(
    species: TSpecies[],
    nextRandom: () => number
): TSpecies | undefined {
    return species[Math.floor(nextRandom() * species.length)];
}
