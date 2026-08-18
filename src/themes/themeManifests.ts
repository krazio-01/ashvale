import { ChapterTheme } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { WOODLAND_MANIFEST } from "@/themes/woodlandTheme";

export function resolveThemeManifest(theme: ChapterTheme): IThemeManifest {
    switch (theme) {
        case ChapterTheme.Woodland:
        case ChapterTheme.Settlement:
        case ChapterTheme.Ruins:
        case ChapterTheme.Highlands:
            return WOODLAND_MANIFEST;
    }
}
