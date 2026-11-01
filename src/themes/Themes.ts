import { Vector3 } from "three";
import { WEAPONS } from "@/constants/combat";
import { ATMOSPHERE } from "@/constants/world";
import { ChapterSeason, ChapterTheme } from "@/types/realm";
import type {
    IEnvironmentOverrides,
    ISeasonProfile,
    ISeasonTint,
    ISkyGradient,
    IThemeConfig,
    IThemeEnvironment,
    IThemeLighting,
} from "@/types/world";
import { BIOME_THEMES } from "@/themes/Biomes";
import { SEASONS } from "@/themes/Seasons";
import { blendColors, clamp, mapFields, shiftColorHsl, tintKeepingLightness } from "@/lib/helpers";

const SKY_TINTED_KEYS = [
    "zenith",
    "middle",
    "horizon",
    "belowHorizonColor",
    "glow",
    "sun",
] as const satisfies readonly (keyof ISkyGradient)[];

const LIGHT_TINTED_KEYS = [
    "sunLightColor",
    "rimColor",
    "hemisphereSkyColor",
    "hemisphereGroundColor",
] as const satisfies readonly (keyof IThemeLighting)[];

const GROUND_SHIFTED_KEYS = ["grassColor", "rockColor", "peakColor"] as const;

const seasonalThemes = new Map<string, IThemeConfig>();

export function resolveTheme(theme: ChapterTheme, season: ChapterSeason): IThemeConfig {
    const pairingKey = `${theme}:${season}`;
    const cached = seasonalThemes.get(pairingKey);
    if (cached) return cached;

    const biomeTheme = BIOME_THEMES[theme];
    const composed: IThemeConfig = {
        ...biomeTheme,
        environment: seasonalEnvironment(biomeTheme.environment, SEASONS[season]),
        extraPreloadModelPaths: [
            ...(biomeTheme.extraPreloadModelPaths ?? []),
            ...Object.values(WEAPONS).map((weapon) => weapon.modelPath),
        ],
    };

    seasonalThemes.set(pairingKey, composed);

    return composed;
}

export function withEnvironmentOverrides(
    theme: IThemeConfig,
    { sky, lighting, ...rest }: IEnvironmentOverrides
): IThemeConfig {
    const environment = theme.environment;

    return {
        ...theme,
        environment: {
            ...environment,
            sky: { ...environment.sky, ...sky },
            lighting: { ...environment.lighting, ...lighting },
            ...rest,
        },
    };
}

function seasonalEnvironment(
    environment: IThemeEnvironment,
    season: ISeasonProfile
): IThemeEnvironment {
    const soilTint = season.soilTint;

    return {
        ...environment,
        sky: seasonalSky(environment.sky, season),
        lighting: seasonalLighting(environment.lighting, season),
        fogDensity: environment.fogDensity * season.fogDensityScale,
        terrain: {
            ...mapFields(environment.terrain, GROUND_SHIFTED_KEYS, (hex) =>
                shiftColorHsl(hex, season.groundColorShift)
            ),
            soilColor: tintKeepingLightness(
                environment.terrain.soilColor,
                soilTint.color,
                soilTint.strength,
                soilTint.lightnessShift
            ),
        },
    };
}

const applyTint = (tint: ISeasonTint) => (hex: string) =>
    blendColors(hex, tint.color, tint.strength);

function seasonalSky(sky: ISkyGradient, season: ISeasonProfile): ISkyGradient {
    return {
        ...mapFields(sky, SKY_TINTED_KEYS, applyTint(season.skyTint)),
        sunElevation: clamp(
            sky.sunElevation + season.sunElevationDelta,
            ...ATMOSPHERE.seasonalSunElevationRange
        ),
    };
}

function seasonalLighting(lighting: IThemeLighting, season: ISeasonProfile): IThemeLighting {
    return {
        ...mapFields(lighting, LIGHT_TINTED_KEYS, applyTint(season.lightTint)),
        sunLightIntensity: lighting.sunLightIntensity * season.keyIntensityScale,
        hemisphereIntensity: lighting.hemisphereIntensity * season.hemisphereIntensityScale,
    };
}

export function sunDirectionFromSky(sky: ISkyGradient): Vector3 {
    const horizontalScale = Math.cos(sky.sunElevation);

    return new Vector3(
        horizontalScale * Math.sin(sky.sunAzimuth),
        Math.sin(sky.sunElevation),
        horizontalScale * Math.cos(sky.sunAzimuth)
    ).normalize();
}
