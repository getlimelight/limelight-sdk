import { NetworkRequest } from "@/types";
import { detectGraphQlOperationType } from "./detectGraphQlOperationType";

/**
 * WARNING: Do NOT include raw variables or query literals in production payloads.
 * Variables and literals may contain sensitive user information.
 * Only operationName and operationType are safe to send at launch.
 *
 * Parses a GraphQL request body and extracts relevant information.
 * @param body - The request body to parse.
 * @returns An object containing GraphQL operation details or null if parsing fails.
 */
export const parseGraphQL = (body: any): NetworkRequest["graphql"] | null => {
  try {
    // 1. Get the JSON object regardless of what's passed
    const parsed = typeof body === "string" ? JSON.parse(body) : body;

    // 2. Defensive check: ensure 'parsed' is an object and not null
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    // 3. Only return if there is at least a query (standard GraphQL)
    if (!parsed.query && !parsed.operationName) {
      return null;
    }

    return {
      operationName: parsed.operationName || undefined,
      operationType: detectGraphQlOperationType(parsed.query),
      variables: parsed.variables || undefined,
      query: parsed.query || undefined,
    };
  } catch {
    return null;
  }
};
