import { Vector3 } from "three";
import { ChapterSeason, ChapterTheme } from "@/types/realm";
import type {
    ISeasonProfile,
    ISeasonTint,
    ISkyGradient,
    IThemeEnvironment,
    IThemeLighting,
    IThemeManifest,
} from "@/types/theme";
import { WOODLAND_MANIFEST } from "@/themes/woodlandTheme";
import { SETTLEMENT_MANIFEST } from "@/themes/settlementTheme";
import { RUINS_MANIFEST } from "@/themes/ruinsTheme";
import { HIGHLANDS_MANIFEST } from "@/themes/highlandsTheme";
import {
    AUTUMN_SEASON,
    SPRING_SEASON,
    SUMMER_SEASON,
    WINTER_SEASON,
} from "@/themes/seasonProfiles";
import { blendColors, clamp, shiftColorHsl } from "@/lib/helpers";

const BIOME_MANIFESTS: Record<ChapterTheme, IThemeManifest> = {
    [ChapterTheme.Woodland]: WOODLAND_MANIFEST,
    [ChapterTheme.Settlement]: SETTLEMENT_MANIFEST,
    [ChapterTheme.Ruins]: RUINS_MANIFEST,
    [ChapterTheme.Highlands]: HIGHLANDS_MANIFEST,
};

const SEASON_PROFILES: Record<ChapterSeason, ISeasonProfile> = {
    [ChapterSeason.Spring]: SPRING_SEASON,
    [ChapterSeason.Summer]: SUMMER_SEASON,
    [ChapterSeason.Autumn]: AUTUMN_SEASON,
    [ChapterSeason.Winter]: WINTER_SEASON,
};

const composedManifests = new Map<string, IThemeManifest>();

export function resolveThemeManifest(theme: ChapterTheme, season: ChapterSeason): IThemeManifest {
    const pairingKey = `${theme}:${season}`;
    const cached = composedManifests.get(pairingKey);
    if (cached) return cached;

    const biomeManifest = BIOME_MANIFESTS[theme];
    const composed: IThemeManifest = {
        ...biomeManifest,
        environment: applySeasonToEnvironment(biomeManifest.environment, SEASON_PROFILES[season]),
    };

    composedManifests.set(pairingKey, composed);

    return composed;
}

function applySeasonToEnvironment(
    environment: IThemeEnvironment,
    season: ISeasonProfile
): IThemeEnvironment {
    return {
        ...environment,
        sky: applySeasonToSky(environment.sky, season),
        lighting: applySeasonToLighting(environment.lighting, season),
        fogDensity: Math.max(environment.fogDensity * season.fogDensityScale, 0),
        terrain: {
            ...environment.terrain,
            wildColor: shiftGround(environment.terrain.wildColor, season),
            rockColor: shiftGround(environment.terrain.rockColor, season),
            peakColor: shiftGround(environment.terrain.peakColor, season),
        },
    };
}

const shiftGround = (hex: string, season: ISeasonProfile): string =>
    shiftColorHsl(
        hex,
        season.ground.hueShift,
        season.ground.saturationScale,
        season.ground.lightnessShift
    );

const applyTint = (hex: string, tint: ISeasonTint): string =>
    blendColors(hex, tint.color, tint.strength);

function applySeasonToSky(sky: ISkyGradient, season: ISeasonProfile): ISkyGradient {
    return {
        ...sky,
        zenith: applyTint(sky.zenith, season.skyTint),
        middle: applyTint(sky.middle, season.skyTint),
        horizon: applyTint(sky.horizon, season.skyTint),
        abyss: applyTint(sky.abyss, season.skyTint),
        glow: applyTint(sky.glow, season.skyTint),
        sun: applyTint(sky.sun, season.skyTint),
        sunElevation: clamp(sky.sunElevation + season.sunElevationDelta, 0.15, 1.3),
    };
}

function applySeasonToLighting(lighting: IThemeLighting, season: ISeasonProfile): IThemeLighting {
    return {
        ...lighting,
        keyColor: applyTint(lighting.keyColor, season.lightTint),
        rimColor: applyTint(lighting.rimColor, season.lightTint),
        skyFill: applyTint(lighting.skyFill, season.lightTint),
        groundFill: applyTint(lighting.groundFill, season.lightTint),
        keyIntensity: Math.max(lighting.keyIntensity * season.keyIntensityScale, 0),
        hemisphereIntensity: Math.max(
            lighting.hemisphereIntensity * season.hemisphereIntensityScale,
            0
        ),
    };
}

export function sunDirectionOf(sky: ISkyGradient): Vector3 {
    const horizontalScale = Math.cos(sky.sunElevation);

    return new Vector3(
        horizontalScale * Math.sin(sky.sunAzimuth),
        Math.sin(sky.sunElevation),
        horizontalScale * Math.cos(sky.sunAzimuth)
    ).normalize();
}
