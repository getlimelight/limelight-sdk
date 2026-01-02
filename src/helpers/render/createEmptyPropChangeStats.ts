import { PropChangeStats } from "@/types/render";

/**
 * Creates and returns an empty PropChangeStats object.
 * @returns {PropChangeStats} An object with initialized changeCount and referenceOnlyCount maps.
 */
export const createEmptyPropChangeStats = (): PropChangeStats => {
  return {
    changeCount: new Map(),
    referenceOnlyCount: new Map(),
  };
};
