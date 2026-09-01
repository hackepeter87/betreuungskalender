import type { ApiCreatedInvitation } from "../../shared/api.js";
import type { CreatedInvitation } from "./invitations.js";
import { invitationUrl } from "./invitationEmail.js";

export function toApiCreatedInvitation(
  created: CreatedInvitation,
  publicBaseUrl: string,
  emailDelivery?: ApiCreatedInvitation["emailDelivery"]
): ApiCreatedInvitation {
  return {
    invitation: created.invitation,
    invitationUrl: invitationUrl(created.token, publicBaseUrl),
    ...(emailDelivery ? { emailDelivery } : {})
  };
}
