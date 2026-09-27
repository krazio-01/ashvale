import type { IBoss } from "@/types/combat";
import { BOSS_ARCHETYPE } from "@/constants/enemies";
import type { IChapterBoss } from "@/types/realm";

const BASE_BOSS_HEALTH = 150;
const HEALTH_PER_APPEARANCE = 40;
const GAP_VARIATION_BURST_THRESHOLD = 0.5;
const FRENZY_BELOW_HEALTH = 0.5;
const FRENZY_COOLDOWN_SCALE = 0.5;

export function composeBoss(bossData: IChapterBoss, chapterIndex: number): IBoss {
    const unlocksFrenzy = bossData.commitGapVariation > GAP_VARIATION_BURST_THRESHOLD;
    return {
        id: `${bossData.contributorLogin}-chapter-${chapterIndex}`,
        archetype: {
            ...BOSS_ARCHETYPE,
            label: bossData.contributorLogin,
            vitals: {
                ...BOSS_ARCHETYPE.vitals,
                maxHealth:
                    BASE_BOSS_HEALTH + bossData.chapterAppearanceCount * HEALTH_PER_APPEARANCE,
            },
            tactics: unlocksFrenzy
                ? {
                      ...BOSS_ARCHETYPE.tactics,
                      frenzyBelowHealth: FRENZY_BELOW_HEALTH,
                      frenzyCooldownScale: FRENZY_COOLDOWN_SCALE,
                  }
                : BOSS_ARCHETYPE.tactics,
        },
    };
}
