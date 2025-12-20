/**
 * Determines if a given request is a GraphQL request based on the URL and body content.
 */
export const isGraphQLRequest = (url: string, body: any): boolean => {
  const isGraphqlUrl = url.toLowerCase().includes("graphql");

  const rawBody = typeof body === "object" && body !== null ? body.raw : body;

  if (typeof rawBody !== "string") return isGraphqlUrl;

  try {
    if (rawBody.includes('"query"') || rawBody.includes('"operationName"')) {
      return true;
    }
  } catch {}

  return isGraphqlUrl;
};
