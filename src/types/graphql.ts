import { NetworkRequest, NetworkResponse, NetworkType } from "./core";

/**
 * GRAPHQL EXTENSIONS
 */
export interface GraphQLRequest extends NetworkRequest {
  networkType: NetworkType.GRAPHQL;
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
}

/**
 * GRAPHQL Response
 */
export interface GraphQLResponse extends NetworkResponse {
  networkType: NetworkType.GRAPHQL;
  data?: any;
  errors?: any[];
}

export enum GraphqlOprtation {
  QUERY = "QUERY",
  MUTATION = "MUTATION",
  SUB = "SUBSCRIPTION",
}
