import { ResponseWrapper } from "@/lib/ResponseWrapper";
import { FeaturedRealmResponse } from "@/responses/realm/RealmResponse";
import { listFeaturedRealms } from "@/services/realm/RealmService";
import { API_MESSAGES } from "@/constants/strings";

export async function GET() {
    try {
        const featuredRealms = await listFeaturedRealms();

        return ResponseWrapper.success(
            featuredRealms.map((realm) => new FeaturedRealmResponse(realm)),
            API_MESSAGES.featuredRealmsListed
        );
    } catch (error) {
        return ResponseWrapper.fromError(error);
    }
}
