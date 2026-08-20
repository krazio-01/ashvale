import { Vector3 } from "three";
import { ChapterTheme } from "@/types/realm";
import type { ISkyGradient, IThemeManifest } from "@/types/theme";
import { WOODLAND_MANIFEST } from "@/themes/woodlandTheme";
import { SETTLEMENT_MANIFEST } from "@/themes/settlementTheme";
import { RUINS_MANIFEST } from "@/themes/ruinsTheme";
import { HIGHLANDS_MANIFEST } from "@/themes/highlandsTheme";

export function resolveThemeManifest(theme: ChapterTheme): IThemeManifest {
    switch (theme) {
        case ChapterTheme.Woodland:
            return WOODLAND_MANIFEST;
        case ChapterTheme.Settlement:
            return SETTLEMENT_MANIFEST;
        case ChapterTheme.Ruins:
            return RUINS_MANIFEST;
        case ChapterTheme.Highlands:
            return HIGHLANDS_MANIFEST;
    }
}

export function sunDirectionOf(sky: ISkyGradient): Vector3 {
    const horizontalScale = Math.cos(sky.sunElevation);

    return new Vector3(
        horizontalScale * Math.sin(sky.sunAzimuth),
        Math.sin(sky.sunElevation),
        horizontalScale * Math.cos(sky.sunAzimuth)
    ).normalize();
}
