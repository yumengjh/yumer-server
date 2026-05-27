export function getAllowedCorsHeaders(): string[] {
  return ["Content-Type", "Authorization", "x-system-admin-token", "x-operator-id"];
}
