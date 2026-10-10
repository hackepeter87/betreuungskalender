import type {
  PrivacyActionCategoryCode,
  PrivacyActionKind,
  PrivacyActionSelection,
  PrivacySubjectType
} from "../../shared/privacyActions";

export interface PrivacyCategoryOption {
  code: PrivacyActionCategoryCode;
  actions: PrivacyActionKind[];
}

const userCategories: PrivacyCategoryOption[] = [
  { code: "access", actions: ["revoke"] },
  { code: "authentication_identity", actions: ["detach", "anonymize"] },
  { code: "runtime_channels", actions: ["revoke", "delete"] },
  { code: "domain_relationships", actions: ["delete"] },
  { code: "historical_attribution", actions: ["anonymize"] },
  { code: "transfer_state", actions: ["anonymize", "delete"] }
];

const domainSubjectCategories: PrivacyCategoryOption[] = [
  { code: "profile", actions: ["anonymize", "delete"] },
  { code: "domain_relationships", actions: ["delete"] },
  { code: "domain_records", actions: ["delete"] },
  { code: "historical_attribution", actions: ["anonymize"] }
];

export function privacyCategoryOptions(subjectType: PrivacySubjectType): PrivacyCategoryOption[] {
  return subjectType === "user" ? userCategories : domainSubjectCategories;
}

export function setPrivacyActionSelection(
  current: PrivacyActionSelection[],
  category: PrivacyActionCategoryCode,
  action: PrivacyActionKind | "retain"
): PrivacyActionSelection[] {
  const existingIndex = current.findIndex((selection) => selection.category === category);
  if (action === "retain") {
    return current.filter((selection) => selection.category !== category);
  }
  if (existingIndex < 0) return [...current, { category, action }];
  return current.map((selection, index) =>
    index === existingIndex ? { category, action } : selection
  );
}
