import { ChapterTheme } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { WOODLAND_PROPS } from "@/themes/woodlandTheme";

export const SETTLEMENT_MANIFEST: IThemeManifest = {
    theme: ChapterTheme.Settlement,
    scatterPropsPerFile: 0.45,
    props: WOODLAND_PROPS,
    environment: {
        sky: {
            zenith: "#56718a",
            middle: "#a2b0b8",
            horizon: "#ded2c0",
            abyss: "#2a2f38",
            glow: "#e8bc90",
            sun: "#ffeacc",
            sunElevation: 0.75,
            sunAzimuth: 2.1,
            sunSize: 0.022,
            glowFalloff: 7,
            hazeStrength: 2.4,
        },
        lighting: {
            keyColor: "#ffeed6",
            keyIntensity: 1.5,
            rimColor: "#a8b6c4",
            rimIntensity: 0.5,
            skyFill: "#bfc6c8",
            groundFill: "#61533e",
            hemisphereIntensity: 0.7,
        },
        fogDensity: 0.0062,
        outlineColor: "#241d16",
        terrain: {
            wildColor: "#63704b",
            rockColor: "#7a7161",
            peakColor: "#b8b09c",
            wildElevation: 8,
            wildRelief: 3,
            mountainHeight: 20,
            featureSize: 110,
            ruggedness: 0.2,
            slopeShade: 0.4,
        },
    },
};
