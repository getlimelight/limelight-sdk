import { GraphqlOprtation } from "@/types";

/**
 * Normalizes various GraphQL operation type representations to a standard form.
 * @param type The operation type to normalize
 * @returns The normalized operation type or null if not provided
 */
export const normalizeOperationType = (
  type?: GraphqlOprtation | "query" | "mutation" | "subscription" | null,
): GraphqlOprtation | null => {
  if (!type) return null;
  if (type === "query") return GraphqlOprtation.QUERY;
  if (type === "mutation") return GraphqlOprtation.MUTATION;
  if (type === "subscription") return GraphqlOprtation.SUB;

  return type;
};
