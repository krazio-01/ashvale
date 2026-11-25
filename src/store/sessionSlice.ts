import type { GetState, ISessionSlice, IStoreState, SetState } from "@/types/store";

export function createSessionSlice(
    set: SetState<IStoreState>,
    get: GetState<IStoreState>
): ISessionSlice {
    return {
        phase: "loading",
        chapterIndex: 0,
        isPaused: false,
        qualityReport: null,

        beginChapter(chapterIndex) {
            set((state) => ({
                session: { ...state.session, phase: "loading", chapterIndex, isPaused: false },
            }));
        },

        setPhase(phase) {
            if (get().session.phase !== phase)
                set((state) => ({ session: { ...state.session, phase } }));
        },

        setPaused(isPaused) {
            if (get().session.isPaused !== isPaused)
                set((state) => ({ session: { ...state.session, isPaused } }));
        },

        clearChapter(realmKey, chapterCount) {
            const { session, progression } = get();
            const nextChapterIndex = session.chapterIndex + 1;

            progression.reachChapter(realmKey, nextChapterIndex);
            if (nextChapterIndex < chapterCount) session.beginChapter(nextChapterIndex);
            else session.setPhase("ended");
        },

        setQualityReport(qualityReport) {
            if (get().session.qualityReport === qualityReport) return;
            set((state) => ({ session: { ...state.session, qualityReport } }));
        },
    };
}
