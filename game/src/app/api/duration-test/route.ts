export const maxDuration = 300;

export async function GET() {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 90_000));
    return Response.json({ ranFor: Date.now() - start });
}
