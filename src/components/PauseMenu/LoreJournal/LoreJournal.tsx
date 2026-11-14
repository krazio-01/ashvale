import { LORE_TEXT } from "@/constants/strings";
import { useGameStore } from "@/hooks/useGameStore";
import { keysOf } from "@/lib/helpers";
import "./loreJournal.scss";

interface LoreJournalProps {
    realmKey: string;
}

export const LoreJournal = ({ realmKey }: LoreJournalProps) => {
    const lore = useGameStore((state) => state.progression.records[realmKey]?.lore);
    const entries = [...(lore ?? [])].sort(
        (first, second) => first.chapterIndex - second.chapterIndex
    );

    if (entries.length === 0)
        return <p className="lore-journal-empty">{LORE_TEXT.journal.empty}</p>;

    return (
        <div className="lore-journal">
            {keysOf(LORE_TEXT.journal.kinds).map((kind) => {
                const group = entries.filter((entry) => entry.kind === kind);
                if (group.length === 0) return null;
                return (
                    <section className="journal-group" key={kind}>
                        <h2 className="journal-group-title">{LORE_TEXT.journal.kinds[kind]}</h2>
                        {group.map((entry) => (
                            <article className="journal-entry" key={entry.id}>
                                <h3 className="journal-entry-title">{entry.title}</h3>
                                {entry.lines.map((line, index) => (
                                    <p className="journal-line" key={index}>
                                        {line}
                                    </p>
                                ))}
                            </article>
                        ))}
                    </section>
                );
            })}
        </div>
    );
};
