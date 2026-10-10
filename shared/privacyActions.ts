export type PrivacySubjectType = "user" | "care_party" | "child";
export type PrivacyActionKind = "revoke" | "detach" | "anonymize" | "delete";
export type PrivacyActionCategoryCode =
  | "access"
  | "authentication_identity"
  | "profile"
  | "domain_relationships"
  | "domain_records"
  | "historical_attribution"
  | "transfer_state"
  | "runtime_channels";

export interface PrivacyActionSelection {
  category: PrivacyActionCategoryCode;
  action: PrivacyActionKind;
}

export interface PrivacyActionPreviewRequest {
  subjectType: PrivacySubjectType;
  subjectId: string;
  actions: PrivacyActionSelection[];
}

export interface PrivacyActionCategoryPreview {
  code: PrivacyActionCategoryCode;
  count: number;
  availableActions: PrivacyActionKind[];
  selectedAction?: PrivacyActionKind;
  status: "ready" | "warning" | "manual_review" | "blocked";
}

export interface PrivacyActionPreviewResponse {
  fingerprint: string;
  result: "ready" | "warnings" | "blocked";
  subject: { type: PrivacySubjectType; id: string };
  categories: PrivacyActionCategoryPreview[];
  warningCodes: string[];
  blockerCodes: string[];
  externalFollowUpCodes: string[];
}
