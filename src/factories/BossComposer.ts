import { FrenzyCombo } from "@/entities/attacks/FrenzyCombo";
import { SteadyStrike } from "@/entities/attacks/SteadyStrike";
import { Boss } from "@/entities/characters/Boss";
import { IAttackModule } from "@/types/entities";
import { IChapterBoss } from "@/types/realm";

const BASE_BOSS_HEALTH = 150;
const HEALTH_PER_APPEARANCE = 40;
const GAP_VARIATION_BURST_THRESHOLD = 0.5;

export function composeBoss(bossData: IChapterBoss, chapterIndex: number): Boss {
    const id = `${bossData.contributorLogin}-chapter-${chapterIndex}`;
    const maxHealth = BASE_BOSS_HEALTH + bossData.chapterAppearanceCount * HEALTH_PER_APPEARANCE;
    const aggression = bossData.commitShare;
    const attackModules = resolveAttackModules(bossData.commitGapVariation);

    return new Boss(id, bossData.contributorLogin, maxHealth, attackModules, aggression);
}

function resolveAttackModules(commitGapVariation: number): IAttackModule[] {
    const modules: IAttackModule[] = [new SteadyStrike()];

    if (commitGapVariation > GAP_VARIATION_BURST_THRESHOLD) modules.push(new FrenzyCombo());

    return modules;
}
