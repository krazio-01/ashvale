import { ResponseWrapper } from "@/lib/ResponseWrapper";
import { FeaturedRealmResponse } from "@/responses/realm/RealmResponse";
import { listFeaturedRealms } from "@/services/realm/RealmService";

export async function GET() {
    try {
        const featuredRealms = await listFeaturedRealms();

        return ResponseWrapper.success(
            featuredRealms.map((realm) => new FeaturedRealmResponse(realm)),
            "Featured realms listed"
        );
    } catch (error) {
        return ResponseWrapper.fromError(error);
    }
}
