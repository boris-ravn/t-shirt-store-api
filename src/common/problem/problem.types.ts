// Shapes docs/api/components/schemas/common.yaml#/Problem — RFC 9457
// problem details, the one error body every operation in the contract uses.
export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

export const PROBLEM_BASE_URI = 'https://api.tshirt-store.example/problems';
