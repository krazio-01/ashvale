import { ChapterTheme } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { WOODLAND_PROPS } from "@/themes/woodlandTheme";

export const RUINS_MANIFEST: IThemeManifest = {
    theme: ChapterTheme.Ruins,
    scatterPropsPerFile: 0.35,
    props: WOODLAND_PROPS,
    environment: {
        sky: {
            zenith: "#3b4b56",
            middle: "#7c8a88",
            horizon: "#c6bcae",
            abyss: "#1d242a",
            glow: "#d09a70",
            sun: "#f4d6ae",
            sunElevation: 0.52,
            sunAzimuth: 4.2,
            sunSize: 0.03,
            glowFalloff: 10,
            hazeStrength: 3.6,
        },
        lighting: {
            keyColor: "#f0d8b8",
            keyIntensity: 1.4,
            rimColor: "#7f95a0",
            rimIntensity: 0.65,
            skyFill: "#9caaa8",
            groundFill: "#463f33",
            hemisphereIntensity: 0.6,
        },
        fogDensity: 0.0078,
        outlineColor: "#1c1a16",
        terrain: {
            wildColor: "#525d44",
            rockColor: "#6e6a62",
            peakColor: "#a49c8e",
            wildElevation: 10,
            wildRelief: 4,
            mountainHeight: 26,
            featureSize: 75,
            ruggedness: 0.6,
            slopeShade: 0.55,
        },
    },
};
