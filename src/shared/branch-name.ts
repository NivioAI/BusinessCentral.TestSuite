/** The branch an agent is asked to use for one round of an investigation. */
export function branchName(testId: string, iterationNumber: number): string {
  return `fix/${testId}-${iterationNumber}`.replace(/[^A-Za-z0-9/_.-]+/g, "-");
}
