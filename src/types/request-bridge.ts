import { HttpMethod } from "./core";
import { GraphqlOprtation } from "./graphql";

/**
 * Configuration for making a request.
 */
export interface RequestBridgeConfig {
  url: string;
  method?: HttpMethod | string;
  headers?: Record<string, string>;
  body?: any;
  name?: string;
  graphql?: {
    operationName?: string;
    operationType?: GraphqlOprtation | "query" | "mutation" | "subscription";
    variables?: any;
    query?: string;
  };
}

/**
 * Configuration for mocking a response.
 */
export interface ResponseBridgeConfig {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: any;
}
