export class BenchError extends Error {}

export class SelectionCancelled extends Error {}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
