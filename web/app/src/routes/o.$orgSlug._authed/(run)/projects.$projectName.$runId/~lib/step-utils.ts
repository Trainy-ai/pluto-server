/**
 * Find the nearest step value from a list of available steps
 * @param targetStep The target step value to find
 * @param availableSteps Array of available step values
 * @returns The nearest step value, or 0 if no steps available
 */
export function findNearestStep(
  targetStep: number,
  availableSteps: number[],
): number {
  if (availableSteps.length === 0) return 0;

  // Find the step with minimum distance
  let nearest = availableSteps[0];
  let minDistance = Math.abs(targetStep - nearest);

  for (const step of availableSteps) {
    const distance = Math.abs(targetStep - step);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = step;
    }
  }

  return nearest;
}

/**
 * Find the index of the nearest step value
 * @param targetStep The target step value to find
 * @param availableSteps Array of available step values
 * @returns The index of the nearest step, or 0 if no steps available
 */
export function findNearestStepIndex(
  targetStep: number,
  availableSteps: number[],
): number {
  const nearestStep = findNearestStep(targetStep, availableSteps);
  const index = availableSteps.indexOf(nearestStep);
  return index !== -1 ? index : 0;
}
