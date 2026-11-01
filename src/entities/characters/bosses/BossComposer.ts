import type { IBoss } from "@/types/combat";
import { ARCHETYPES } from "@/constants/enemies";
import type { IChapterBoss } from "@/types/realm";

const bossArchetype = ARCHETYPES.boss;

const BASE_BOSS_HEALTH = 150;
const HEALTH_PER_APPEARANCE = 40;
const FRENZY_COMMIT_GAP_VARIATION_THRESHOLD = 0.5;
const FRENZY_BELOW_HEALTH = 0.5;
const FRENZY_COOLDOWN_SCALE = 0.5;

export function buildBossFromChapter(bossData: IChapterBoss, chapterIndex: number): IBoss {
    const unlocksFrenzy = bossData.commitGapVariation > FRENZY_COMMIT_GAP_VARIATION_THRESHOLD;
    return {
        id: `${bossData.contributorLogin}-chapter-${chapterIndex}`,
        archetype: {
            ...bossArchetype,
            label: bossData.contributorLogin,
            vitals: {
                ...bossArchetype.vitals,
                maxHealth:
                    BASE_BOSS_HEALTH + bossData.chapterAppearanceCount * HEALTH_PER_APPEARANCE,
            },
            tactics: unlocksFrenzy
                ? {
                      ...bossArchetype.tactics,
                      frenzyBelowHealth: FRENZY_BELOW_HEALTH,
                      frenzyCooldownScale: FRENZY_COOLDOWN_SCALE,
                  }
                : bossArchetype.tactics,
        },
    };
}
