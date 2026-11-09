export const passwordRules = [
  { text: "At least 12 characters", test: (value: string) => value.length >= 12 },
  { text: "An uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { text: "A lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { text: "A number", test: (value: string) => /[0-9]/.test(value) },
  { text: "A special character", test: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
];
export function strongPassword(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && passwordRules.every(({ test }) => test(value));
}
