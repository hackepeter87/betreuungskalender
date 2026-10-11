import type {
  ApiMemberAccessCapabilityCategory,
  ApiMemberAccessCapabilityCode,
  ApiMemberAccessCapabilityGroups,
  ApiMemberAccessGlobalDataCode,
  ApiMemberAccessState
} from "../../shared/api.js";
import {
  workspacePermissionValues,
  workspacePermissionsForRole,
  type WorkspacePermission,
  type WorkspaceRole
} from "../auth.js";
import { normalizeCareDataScope, type CareDataScope } from "./careDataScopes.js";

export const memberAccessRoleModelVersion = "1";

interface CapabilityDefinition {
  code: ApiMemberAccessCapabilityCode;
  category: ApiMemberAccessCapabilityCategory;
}

const capabilityByPermission = {
  "appointments:view": { code: "care_entries_view", category: "view" },
  "appointments:create": { code: "care_entries_create", category: "edit" },
  "appointments:edit": { code: "care_entries_edit", category: "edit" },
  "appointments:delete": { code: "care_entries_delete", category: "edit" },
  "appointments:confirm": { code: "care_entries_confirm", category: "edit" },
  "children:view-basic": { code: "children_basic_view", category: "view" },
  "children:view-sensitive": { code: "children_sensitive_view", category: "view" },
  "children:manage": { code: "children_manage", category: "edit" },
  "notes:view": { code: "care_notes_view", category: "view" },
  "planning:view": { code: "planning_view", category: "view" },
  "planning:manage": { code: "planning_manage", category: "edit" },
  "reports:view": { code: "reports_view", category: "view" },
  "settings:view": { code: "settings_view", category: "view" },
  "settings:manage": { code: "settings_manage", category: "edit" },
  "notifications:manage-own": { code: "own_notifications_manage", category: "administer" },
  "feeds:manage-own": { code: "personal_feeds_manage", category: "administer" },
  "audit:view": { code: "audit_view", category: "view" },
  "instance:inspect": { code: "instance_inspect", category: "view" },
  "members:manage": { code: "members_manage", category: "administer" },
  "exports:run": { code: "exports_run", category: "administer" },
  "admin:destructive": { code: "destructive_operations", category: "administer" }
} as const satisfies Record<WorkspacePermission, CapabilityDefinition>;

const allCapabilityCodes = workspacePermissionValues.map(
  (permission) => capabilityByPermission[permission].code
);

function globalDataForPermissions(
  permissions: ReadonlySet<WorkspacePermission>
): ApiMemberAccessGlobalDataCode[] {
  const result: ApiMemberAccessGlobalDataCode[] = [];
  if (permissions.has("children:view-basic")) result.push("child_identity");
  if (permissions.has("children:view-sensitive")) result.push("sensitive_child_details");
  if (permissions.has("appointments:view")) {
    result.push("holiday_periods", "external_calendar_overlays");
  }
  if (permissions.has("settings:view")) result.push("application_settings");
  if (permissions.has("audit:view")) result.push("audit_history");
  if (permissions.has("instance:inspect")) result.push("instance_information");
  return result;
}

export function memberAccessState(
  role: WorkspaceRole,
  requestedScope: CareDataScope,
  isOwner = false
): ApiMemberAccessState {
  const permissions = new Set(workspacePermissionsForRole(role, isOwner));
  const groups: ApiMemberAccessCapabilityGroups = {
    view: [],
    edit: [],
    administer: [],
    denied: []
  };
  for (const permission of workspacePermissionValues) {
    const definition = capabilityByPermission[permission];
    if (permissions.has(permission)) {
      groups[definition.category].push(definition.code);
    }
  }
  groups.denied = allCapabilityCodes.filter((code) =>
    !groups.view.includes(code) && !groups.edit.includes(code) && !groups.administer.includes(code));
  return {
    role,
    careDataScope: normalizeCareDataScope(role, requestedScope),
    capabilities: groups,
    globalData: globalDataForPermissions(permissions)
  };
}

export function grantedCapabilityCodes(
  state: ApiMemberAccessState | undefined
): ApiMemberAccessCapabilityCode[] {
  if (!state) return [];
  return [
    ...state.capabilities.view,
    ...state.capabilities.edit,
    ...state.capabilities.administer
  ];
}
