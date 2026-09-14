type WithoutUndefinedValues<T extends object> = {
  [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key];
} & {
  [Key in keyof T as undefined extends T[Key] ? Key : never]?: Exclude<T[Key], undefined>;
};

export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function omitUndefinedValues<T extends object>(value: T): WithoutUndefinedValues<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as WithoutUndefinedValues<T>;
}
