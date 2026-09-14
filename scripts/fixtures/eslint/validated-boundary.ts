import { isUnknownRecord } from "../../../shared/objects.js";

const payload: unknown = JSON.parse("{}");

export const validatedBoundary = isUnknownRecord(payload) && typeof payload.id === "string"
  ? { id: payload.id }
  : undefined;
