import { ResponseWrapper } from "@/lib/ResponseWrapper";
import { RealmResponse } from "@/responses/realm/RealmResponse";
import { resolveRealm } from "@/services/realm/RealmService";
import { API_MESSAGES } from "@/constants/strings";

export async function GET(_request: Request, { params }: IRealmRouteContext) {
    try {
        const { owner, name } = await params;
        const realm = await resolveRealm(owner, name);

        return ResponseWrapper.success(new RealmResponse(realm), API_MESSAGES.realmForged);
    } catch (error) {
        return ResponseWrapper.fromError(error);
    }
}

interface IRealmRouteContext {
    params: Promise<{ owner: string; name: string }>;
}
