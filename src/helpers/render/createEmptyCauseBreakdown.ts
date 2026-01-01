import { RenderCauseType } from "@/types/render";

/**
 * Creates an empty cause breakdown object with all render cause types initialized to zero.
 * @returns {Record<RenderCauseType, number>} An object with render cause types as keys and zero as values.
 */
export const createEmptyCauseBreakdown = (): Record<
  RenderCauseType,
  number
> => {
  return {
    [RenderCauseType.STATE_CHANGE]: 0,
    [RenderCauseType.PROPS_CHANGE]: 0,
    [RenderCauseType.CONTEXT_CHANGE]: 0,
    [RenderCauseType.PARENT_RENDER]: 0,
    [RenderCauseType.FORCE_UPDATE]: 0,
    [RenderCauseType.UNKNOWN]: 0,
  };
};
