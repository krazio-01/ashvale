import { ChapterTheme } from "@/types/realm";
import type { IThemeManifest, IThemeProp } from "@/types/theme";
import {
    PINE_TREES,
    TWISTED_TREES,
    DEAD_TREES,
    BOULDERS,
    ROCK_SLABS,
    ROCK_CHUNKS,
    GRASS_TUFTS,
    PEBBLES,
} from "@/themes/woodlandTheme";

export const HIGHLANDS_PROPS: IThemeProp[] = [
    ...PINE_TREES,
    ...TWISTED_TREES,
    ...DEAD_TREES,
    ...BOULDERS,
    ...ROCK_SLABS,
    ...ROCK_CHUNKS,
    ...GRASS_TUFTS,
    ...PEBBLES,
];

export const HIGHLANDS_MANIFEST: IThemeManifest = {
    theme: ChapterTheme.Highlands,
    scatterPropsPerFile: 0.4,
    props: HIGHLANDS_PROPS,
    environment: {
        sky: {
            zenith: "#24548c",
            middle: "#6b96be",
            horizon: "#e4ecef",
            abyss: "#1a2734",
            glow: "#ffd7a4",
            sun: "#fff4dc",
            sunElevation: 0.85,
            sunAzimuth: 5.4,
            sunSize: 0.02,
            glowFalloff: 6,
            hazeStrength: 2,
        },
        lighting: {
            keyColor: "#ffffff",
            keyIntensity: 1.8,
            rimColor: "#8fb6d8",
            rimIntensity: 0.7,
            skyFill: "#cfdee6",
            groundFill: "#4c5a60",
            hemisphereIntensity: 0.7,
        },
        fogDensity: 0.0042,
        outlineColor: "#1a2028",
        terrain: {
            wildColor: "#43563e",
            rockColor: "#5f6a70",
            peakColor: "#e2e9ee",
            wildElevation: 15,
            wildRelief: 7,
            mountainHeight: 46,
            featureSize: 80,
            ruggedness: 0.7,
            slopeShade: 0.5,
        },
    },
};
