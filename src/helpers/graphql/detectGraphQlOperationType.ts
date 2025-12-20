import { GraphqlOprtation } from "../..";

/**
 * Detects the GraphQL operation type from a query string.
 * @param query - The GraphQL query string.
 * @returns The detected GraphQL operation type or null if not detectable.
 */
export const detectGraphQlOperationType = (
  query?: string
): GraphqlOprtation | null => {
  if (!query) return null;
  if (query.trim().startsWith("mutation")) return GraphqlOprtation.MUTATION;
  if (query.trim().startsWith("subscription")) return GraphqlOprtation.SUB;

  return GraphqlOprtation.QUERY;
};
