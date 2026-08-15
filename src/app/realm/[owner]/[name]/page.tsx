import GameCanvas from "@/components/GameCanvas";

const RealmPage = async ({ params }: { params: Promise<{ owner: string; name: string }> }) => {
    const { owner, name } = await params;

    return <GameCanvas owner={owner} name={name} />;
};

export default RealmPage;
