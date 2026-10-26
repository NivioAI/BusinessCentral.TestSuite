import type { ParameterProfile, ParameterProfileInput } from "../../shared/models";

export function legacyParameterProfileKey(testDefinitionId: string): string {
  return `nivio.test-studio.parameter-profiles.${testDefinitionId}`;
}

export function readLegacyParameterProfiles(testDefinitionId: string): ParameterProfileInput[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(legacyParameterProfileKey(testDefinitionId)) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        typeof (item as { name?: unknown }).name !== "string" ||
        !(item as { values?: unknown }).values ||
        typeof (item as { values?: unknown }).values !== "object"
      )
        return [];
      return [
        {
          testDefinitionId,
          name: (item as { name: string }).name,
          values: (item as { values: ParameterProfile["values"] }).values,
        },
      ];
    });
  } catch {
    return [];
  }
}
