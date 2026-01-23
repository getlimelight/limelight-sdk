import { LimelightConfig, LimelightMessage } from "@/types";
import {
  StateLibrary,
  StatePhase,
  StateInitEvent,
  StateUpdateEvent,
  StateAction,
} from "@/types/state";

interface RegisteredStore {
  name: string;
  library: StateLibrary;
  unsubscribe: () => void;
}

export class StateInterceptor {
  private sendMessage: (message: LimelightMessage) => void;
  private getSessionId: () => string;

  private stores: Map<string, RegisteredStore> = new Map();
  private config: LimelightConfig | null = null;

  constructor(
    sendMessage: (message: LimelightMessage) => void,
    getSessionId: () => string,
  ) {
    this.sendMessage = sendMessage;
    this.getSessionId = getSessionId;
  }

  setup(config: LimelightConfig): void {
    this.config = config;

    if (!config.stores) return;
    if (config.enableStateInspector === false) return;

    for (const [name, store] of Object.entries(config.stores)) {
      this.registerStore(name, store);
    }
  }

  /**
   * Register a store for inspection.
   * Can be called manually via Limelight.addStore() for dynamic registration.
   */
  registerStore(name: string, store: unknown): void {
    if (this.stores.has(name)) {
      //always log warning if store already registered
      console.warn(`[Limelight] Store "${name}" already registered`);
      return;
    }

    const library = this.detectLibrary(store);

    if (!library) {
      //always log warning if store type cannot be detected
      console.warn(
        `[Limelight] Could not detect store type for "${name}". Expected Zustand or Redux store.`,
      );
      return;
    }

    const state = this.getState(store, library);

    // Send initial state
    const initEvent: StateInitEvent = {
      phase: StatePhase.INIT,
      sessionId: this.getSessionId(),
      timestamp: Date.now(),
      data: {
        storeId: name,
        library,
        state,
      },
    };
    this.emitEvent(initEvent);

    // Subscribe to changes
    const unsubscribe = this.subscribe(store, library, name);

    this.stores.set(name, { name, library, unsubscribe });
  }

  /**
   * Unregister a store and stop listening to changes.
   */
  unregisterStore(name: string): void {
    const store = this.stores.get(name);
    if (store) {
      store.unsubscribe();
      this.stores.delete(name);
    }
  }

  /**
   * Emit an event, applying beforeSend hook if configured
   */
  private emitEvent(event: StateInitEvent | StateUpdateEvent): void {
    if (this.config?.beforeSend) {
      const modifiedEvent = this.config.beforeSend(event);

      if (!modifiedEvent) {
        return;
      }

      if (
        modifiedEvent.phase !== StatePhase.INIT &&
        modifiedEvent.phase !== StatePhase.UPDATE
      ) {
        // always log an error if beforeSend returns wrong type
        console.error("[Limelight] beforeSend must return same event type");
        return;
      }

      this.sendMessage(modifiedEvent);
    } else {
      this.sendMessage(event);
    }
  }

  /**
   * Detect whether a store is Zustand or Redux
   */
  private detectLibrary(store: unknown): StateLibrary | null {
    if (!store || (typeof store !== "function" && typeof store !== "object")) {
      return null;
    }

    // Redux stores have dispatch, getState, subscribe, and replaceReducer
    if (
      typeof store === "object" &&
      "dispatch" in store &&
      "getState" in store &&
      "subscribe" in store &&
      typeof (store as any).dispatch === "function"
    ) {
      return StateLibrary.REDUX;
    }

    // Zustand stores are functions with getState and subscribe
    if (
      typeof store === "function" &&
      "getState" in store &&
      "subscribe" in store &&
      typeof (store as any).getState === "function"
    ) {
      return StateLibrary.ZUSTAND;
    }

    // Vanilla Zustand stores (created with createStore instead of create)
    if (
      typeof store === "object" &&
      "getState" in store &&
      "setState" in store &&
      "subscribe" in store &&
      !("dispatch" in store)
    ) {
      return StateLibrary.ZUSTAND;
    }

    return null;
  }

  /**
   * Get current state from a store
   */
  private getState(store: unknown, library: StateLibrary): unknown {
    const storeAny = store as any;
    return storeAny.getState();
  }

  /**
   * Subscribe to store changes
   */
  private subscribe(
    store: unknown,
    library: StateLibrary,
    storeName: string,
  ): () => void {
    const storeAny = store as any;

    if (library === StateLibrary.ZUSTAND) {
      return this.subscribeZustand(storeAny, storeName);
    } else {
      return this.subscribeRedux(storeAny, storeName);
    }
  }

  /**
   * Subscribe to Zustand store changes
   */
  private subscribeZustand(store: any, storeName: string): () => void {
    return store.subscribe((state: unknown, prevState: unknown) => {
      const action = this.inferZustandAction(state, prevState);
      const stackTrace = this.captureStackTrace();

      const updateEvent: StateUpdateEvent = {
        phase: StatePhase.UPDATE,
        sessionId: this.getSessionId(),
        timestamp: Date.now(),
        data: {
          storeId: storeName,
          library: StateLibrary.ZUSTAND,
          state,
          action,
          stackTrace,
        },
      };

      this.emitEvent(updateEvent);
    });
  }

  /**
   * Subscribe to Redux store changes
   */
  private subscribeRedux(store: any, storeName: string): () => void {
    let lastAction: StateAction = { type: "@@INIT" };

    const originalDispatch = store.dispatch;
    store.dispatch = (action: any) => {
      lastAction = {
        type: action?.type || "unknown",
        payload: action?.payload,
      };
      return originalDispatch(action);
    };

    const unsubscribe = store.subscribe(() => {
      const newState = store.getState();
      const stackTrace = this.captureStackTrace();

      const updateEvent: StateUpdateEvent = {
        phase: StatePhase.UPDATE,
        sessionId: this.getSessionId(),
        timestamp: Date.now(),
        data: {
          storeId: storeName,
          library: StateLibrary.REDUX,
          state: newState,
          action: lastAction,
          stackTrace,
        },
      };

      this.emitEvent(updateEvent);
    });

    return () => {
      unsubscribe();
      store.dispatch = originalDispatch;
    };
  }

  /**
   * Infer action name from stack trace for Zustand
   */
  private inferZustandAction(state: unknown, prevState: unknown): StateAction {
    const actionType = this.parseActionFromStack(this.captureStackTrace());
    const payload = this.computePartialState(state, prevState);

    return {
      type: actionType,
      payload,
    };
  }

  /**
   * Parse function name from stack trace
   */
  private parseActionFromStack(stack?: string): string {
    if (!stack) return "set";

    const lines = stack.split("\n");

    for (const line of lines) {
      if (line.includes("node_modules/zustand")) continue;
      if (line.includes("node_modules/immer")) continue;
      if (line.includes("StateInterceptor")) continue;
      if (line.includes("limelight")) continue;

      // V8 format
      const v8Match =
        line.match(/at\s+(?:Object\.)?(\w+)\s+\(/) ||
        line.match(/at\s+(\w+)\s*\[/) ||
        line.match(/at\s+(\w+)/);

      // Hermes format
      const hermesMatch = line.match(/^(\w+)@/);

      const match = v8Match || hermesMatch;

      if (match && match[1]) {
        const name = match[1];
        if (
          ![
            "anonymous",
            "Object",
            "Array",
            "Function",
            "eval",
            "Error",
          ].includes(name)
        ) {
          return name;
        }
      }
    }

    return "set";
  }

  /**
   * Compute what keys changed between states (shallow)
   */
  private computePartialState(state: unknown, prevState: unknown): unknown {
    if (
      typeof state !== "object" ||
      state === null ||
      typeof prevState !== "object" ||
      prevState === null
    ) {
      return state;
    }

    const partial: Record<string, unknown> = {};
    const stateObj = state as Record<string, unknown>;
    const prevObj = prevState as Record<string, unknown>;

    for (const key of Object.keys(stateObj)) {
      if (stateObj[key] !== prevObj[key]) {
        partial[key] = stateObj[key];
      }
    }

    if (Object.keys(partial).length === 0) {
      return state;
    }

    return partial;
  }

  /**
   * Capture current stack trace
   */
  private captureStackTrace(): string | undefined {
    try {
      const err = new Error();
      return err.stack;
    } catch {
      return undefined;
    }
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    for (const [, store] of this.stores) {
      store.unsubscribe();
    }
    this.stores.clear();
  }
}
