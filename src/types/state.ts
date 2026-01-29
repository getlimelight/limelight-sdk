// ============================================================================
// STATE INSPECTION TYPES
// ============================================================================

/**
 * Supported state management libraries
 */
export enum StateLibrary {
  ZUSTAND = "zustand",
  REDUX = "redux",
}

/**
 * State event phases
 */
export enum StatePhase {
  INIT = "STATE:INIT",
  UPDATE = "STATE:UPDATE",
}

/**
 * Action info captured during state updates
 */
export interface StateAction {
  /**
   * Action type/name
   * - Redux: action.type
   * - Zustand: inferred from stack trace or 'set'
   */
  type: string;

  /**
   * Action payload
   * - Redux: action.payload
   * - Zustand: partial state passed to set()
   */
  payload?: unknown;
}

/**
 * Base shape for state events
 */
interface BaseStateEvent {
  phase: StatePhase;
  sessionId: string;
  timestamp: number;
}

/**
 * Initial state snapshot sent when store is registered
 */
export interface StateInitEvent extends BaseStateEvent {
  phase: StatePhase.INIT;
  data: {
    storeId: string;
    library: StateLibrary;
    state: unknown;
  };
}

/**
 * State update event sent on every state change
 */
export interface StateUpdateEvent extends BaseStateEvent {
  phase: StatePhase.UPDATE;
  data: {
    storeId: string;
    library: StateLibrary;
    state: unknown;
    action: StateAction;
    stackTrace?: string;
  };
}

/**
 * Union of all state events
 */
export type StateEvent = StateInitEvent | StateUpdateEvent;
