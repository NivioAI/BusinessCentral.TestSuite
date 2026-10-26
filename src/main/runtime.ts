import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
export { isAllowedBusinessCentralUrl } from "../shared/business-central-url";

const POWERSHELL_NAMES = ["pwsh", "pwsh-preview"] as const;

export async function resolvePowerShellExecutable(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const executableNames =
    platform === "win32" ? POWERSHELL_NAMES.map((name) => `${name}.exe`) : POWERSHELL_NAMES;
  const pathDirectories = (environment.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = [
    ...pathDirectories.flatMap((directory) =>
      executableNames.map((executable) => join(directory, executable)),
    ),
    ...platformSpecificPowerShellPaths(platform),
  ];

  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Continue with the next stable or preview installation location.
    }
  }
  return undefined;
}

export function buildRunnerEnvironment(
  powershellExecutable: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== "darwin") return { ...environment };

  const pathDirectories = [
    dirname(powershellExecutable),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(environment.PATH ?? "").split(delimiter),
  ].filter(Boolean);

  return {
    ...environment,
    PATH: [...new Set(pathDirectories)].join(delimiter),
  };
}

export function resolveBusinessCentralUrl(
  baseUrl: string,
  tenantId: string,
  environmentName: string,
): string {
  const url = new URL(baseUrl);
  if (url.hostname === "businesscentral.dynamics.com" && url.pathname === "/") {
    url.pathname = `/${tenantId}/${environmentName}/`;
  }
  return url.toString();
}

function platformSpecificPowerShellPaths(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [
      "/opt/homebrew/bin/pwsh",
      "/opt/homebrew/bin/pwsh-preview",
      "/usr/local/bin/pwsh",
      "/usr/local/bin/pwsh-preview",
      "/usr/local/microsoft/powershell/7/pwsh",
      "/usr/local/microsoft/powershell/7-preview/pwsh",
    ];
  }
  if (platform === "linux") {
    return [
      "/usr/bin/pwsh",
      "/usr/bin/pwsh-preview",
      "/usr/local/bin/pwsh",
      "/usr/local/bin/pwsh-preview",
      "/opt/microsoft/powershell/7/pwsh",
      "/opt/microsoft/powershell/7-preview/pwsh",
    ];
  }
  return [];
}
