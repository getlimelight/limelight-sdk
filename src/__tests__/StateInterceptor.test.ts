import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LimelightConfig, LimelightMessage } from "@/types";
import { StateLibrary, StatePhase } from "@/types/state";
import { StateInterceptor } from "@/limelight/interceptors/StateInterceptor";

const createMockZustandStore = (
  initialState: Record<string, unknown> = { count: 0 },
) => {
  let state = { ...initialState };
  const listeners = new Set<(state: unknown, prevState: unknown) => void>();

  const store = Object.assign(() => state, {
    getState: () => state,
    setState: (
      partial:
        | Partial<typeof state>
        | ((s: typeof state) => Partial<typeof state>),
    ) => {
      const prevState = state;
      const nextPartial =
        typeof partial === "function" ? partial(state) : partial;

      state = { ...state, ...nextPartial };
      listeners.forEach((listener) => listener(state, prevState));
    },
    subscribe: (listener: (state: unknown, prevState: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  return store;
};

const createMockVanillaZustandStore = (
  initialState: Record<string, unknown> = { count: 0 },
) => {
  let state = { ...initialState };
  const listeners = new Set<(state: unknown, prevState: unknown) => void>();

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const prevState = state;
      state = { ...state, ...partial };
      listeners.forEach((listener) => listener(state, prevState));
    },
    subscribe: (listener: (state: unknown, prevState: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const createMockReduxStore = (
  initialState: Record<string, unknown> = { count: 0 },
) => {
  let state = { ...initialState };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: (action: { type: string; payload?: unknown }) => {
      if (action.type === "INCREMENT") {
        state = { ...state, count: (state.count as number) + 1 };
      } else if (action.type === "SET_VALUE") {
        if (
          action.payload &&
          typeof action.payload === "object" &&
          !Array.isArray(action.payload)
        ) {
          state = { ...state, ...action.payload };
        } else {
          state = { ...state };
        }
      }
      listeners.forEach((listener) => listener());
      return action;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replaceReducer: vi.fn(),
  };
};

describe("StateInterceptor", () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let getSessionId: ReturnType<typeof vi.fn>;
  let interceptor: StateInterceptor;

  beforeEach(() => {
    sendMessage = vi.fn();
    getSessionId = vi.fn().mockReturnValue("test-session-123");
    interceptor = new StateInterceptor(sendMessage, getSessionId);
  });

  afterEach(() => {
    interceptor.cleanup();
    vi.restoreAllMocks();
  });

  describe("setup", () => {
    it("should not register stores when enableStateInspector is false", () => {
      const store = createMockZustandStore();
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
        enableStateInspector: false,
        stores: { myStore: store },
      };

      interceptor.setup(config);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should not register stores when stores config is undefined", () => {
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
      };

      interceptor.setup(config);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should register all stores from config", () => {
      const store1 = createMockZustandStore({ count: 1 });
      const store2 = createMockZustandStore({ count: 2 });
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
        stores: { store1, store2 },
      };

      interceptor.setup(config);

      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("registerStore", () => {
    it("should send INIT event when registering a Zustand store", () => {
      const store = createMockZustandStore({ count: 5, name: "test" });

      interceptor.registerStore("myStore", store);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.phase).toBe(StatePhase.INIT);
      expect(message.sessionId).toBe("test-session-123");
      expect(message.data.storeId).toBe("myStore");
      expect(message.data.library).toBe(StateLibrary.ZUSTAND);
      expect(message.data.state).toEqual({ count: 5, name: "test" });
    });

    it("should send INIT event when registering a vanilla Zustand store", () => {
      const store = createMockVanillaZustandStore({ value: "hello" });

      interceptor.registerStore("vanillaStore", store);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.library).toBe(StateLibrary.ZUSTAND);
      expect(message.data.state).toEqual({ value: "hello" });
    });

    it("should send INIT event when registering a Redux store", () => {
      const store = createMockReduxStore({ count: 10 });

      interceptor.registerStore("reduxStore", store);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.phase).toBe(StatePhase.INIT);
      expect(message.data.storeId).toBe("reduxStore");
      expect(message.data.library).toBe(StateLibrary.REDUX);
      expect(message.data.state).toEqual({ count: 10 });
    });

    it("should warn and skip when store is already registered", () => {
      const consoleSpy = vi.spyOn(console, "warn");
      const store = createMockZustandStore();

      interceptor.setup({
        enableInternalLogging: true,
      });

      interceptor.registerStore("myStore", store);
      interceptor.registerStore("myStore", store);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Store "myStore" already registered'),
      );
      expect(sendMessage).toHaveBeenCalledTimes(1); // Only first registration
    });

    it("should warn when store type cannot be detected", () => {
      const consoleSpy = vi.spyOn(console, "warn");
      const invalidStore = { foo: "bar" };

      interceptor.registerStore("invalidStore", invalidStore);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Could not detect store type for "invalidStore"',
        ),
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should warn for null store", () => {
      const consoleSpy = vi.spyOn(console, "warn");

      interceptor.registerStore("nullStore", null);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not detect store type"),
      );
    });

    it("should warn for primitive values", () => {
      const consoleSpy = vi.spyOn(console, "warn");

      interceptor.registerStore("primitiveStore", "string");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not detect store type"),
      );
    });
  });

  describe("Zustand subscription", () => {
    it("should send UPDATE event when Zustand state changes", () => {
      const store = createMockZustandStore({ count: 0 });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      store.setState({ count: 1 });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.phase).toBe(StatePhase.UPDATE);
      expect(message.data.storeId).toBe("myStore");
      expect(message.data.library).toBe(StateLibrary.ZUSTAND);
      expect(message.data.state).toEqual({ count: 1 });
      expect(message.data.action).toBeDefined();
      expect(message.data.action.payload).toEqual({ count: 1 });
    });

    it("should track multiple state changes", () => {
      const store = createMockZustandStore({ count: 0 });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      store.setState({ count: 1 });
      store.setState({ count: 2 });
      store.setState({ count: 3 });

      expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    it("should compute partial state for changed keys only", () => {
      const store = createMockZustandStore({
        count: 0,
        name: "test",
        active: true,
      });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      store.setState({ count: 1 }); // Only count changes

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.action.payload).toEqual({ count: 1 });
    });
  });

  describe("Redux subscription", () => {
    it("should send UPDATE event when Redux state changes", () => {
      const store = createMockReduxStore({ count: 0 });
      interceptor.registerStore("reduxStore", store);
      sendMessage.mockClear();

      store.dispatch({ type: "INCREMENT" });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.phase).toBe(StatePhase.UPDATE);
      expect(message.data.library).toBe(StateLibrary.REDUX);
      expect(message.data.state).toEqual({ count: 1 });
      expect(message.data.action.type).toBe("INCREMENT");
    });

    it("should capture action payload for Redux", () => {
      const store = createMockReduxStore({ count: 0, value: null });
      interceptor.registerStore("reduxStore", store);
      sendMessage.mockClear();

      store.dispatch({ type: "SET_VALUE", payload: { value: "hello" } });

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.action.type).toBe("SET_VALUE");
      expect(message.data.action.payload).toEqual({ value: "hello" });
    });

    it("should restore original dispatch on unregister", () => {
      const store = createMockReduxStore({ count: 0 });
      const originalDispatch = store.dispatch;
      interceptor.registerStore("reduxStore", store);

      expect(store.dispatch).not.toBe(originalDispatch);

      interceptor.unregisterStore("reduxStore");

      expect(store.dispatch).toBe(originalDispatch);
    });
  });

  describe("unregisterStore", () => {
    it("should stop receiving updates after unregistering", () => {
      const store = createMockZustandStore({ count: 0 });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      interceptor.unregisterStore("myStore");
      store.setState({ count: 1 });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should handle unregistering non-existent store gracefully", () => {
      expect(() => interceptor.unregisterStore("nonExistent")).not.toThrow();
    });
  });

  describe("beforeSend hook", () => {
    it("should apply beforeSend transformation to INIT events", () => {
      const store = createMockZustandStore({ secret: "password123", count: 0 });
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
        stores: { myStore: store },
        beforeSend: (event: LimelightMessage): LimelightMessage | null => {
          if (event.phase === StatePhase.INIT) {
            const state = (event.data as any).state as Record<string, unknown>;
            return {
              ...event,
              data: {
                ...event.data,
                state: { ...state, secret: "[REDACTED]" },
              },
            } as LimelightMessage;
          }
          if (event.phase === StatePhase.UPDATE) {
            const state = (event.data as any).state as Record<string, unknown>;
            return {
              ...event,
              data: {
                ...event.data,
                state: { ...state, secret: "[REDACTED]" },
                action: (event.data as any).action,
                stackTrace: (event.data as any).stackTrace,
              },
            } as LimelightMessage;
          }
          return event;
        },
      };

      interceptor.setup(config);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.state.secret).toBe("[REDACTED]");
      expect(message.data.state.count).toBe(0);
    });

    it("should filter out events when beforeSend returns null", () => {
      const store = createMockZustandStore({ count: 0 });
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
        stores: { myStore: store },
        beforeSend: () => null,
      };

      interceptor.setup(config);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should filter out events when beforeSend returns undefined", () => {
      const store = createMockZustandStore({ count: 0 });
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
        stores: { myStore: store },
        beforeSend: () => undefined as any,
      };

      interceptor.setup(config);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should log error when beforeSend returns wrong event type", () => {
      const consoleSpy = vi.spyOn(console, "error");
      const store = createMockZustandStore({ count: 0 });
      const config: LimelightConfig = {
        serverUrl: "ws://localhost",
        projectKey: "test",
        stores: { myStore: store },
        beforeSend: () => ({ phase: "WRONG_TYPE" }) as any,
      };

      interceptor.setup(config);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Limelight] beforeSend must return same event type",
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("should unsubscribe from all stores", () => {
      const store1 = createMockZustandStore({ count: 0 });
      const store2 = createMockZustandStore({ value: "test" });
      const store3 = createMockReduxStore({ items: [] });

      interceptor.registerStore("store1", store1);
      interceptor.registerStore("store2", store2);
      interceptor.registerStore("store3", store3);
      sendMessage.mockClear();

      interceptor.cleanup();

      store1.setState({ count: 1 });
      store2.setState({ value: "changed" });
      store3.dispatch({ type: "INCREMENT" });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should allow re-registering stores after cleanup", () => {
      const store = createMockZustandStore({ count: 0 });

      interceptor.registerStore("myStore", store);
      interceptor.cleanup();
      interceptor.registerStore("myStore", store);

      expect(sendMessage).toHaveBeenCalledTimes(2); // Two INIT events
    });
  });

  describe("detectLibrary", () => {
    it("should detect Zustand function store", () => {
      const store = createMockZustandStore();
      interceptor.registerStore("test", store);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.library).toBe(StateLibrary.ZUSTAND);
    });

    it("should detect vanilla Zustand object store", () => {
      const store = createMockVanillaZustandStore();
      interceptor.registerStore("test", store);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.library).toBe(StateLibrary.ZUSTAND);
    });

    it("should detect Redux store", () => {
      const store = createMockReduxStore();
      interceptor.registerStore("test", store);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.library).toBe(StateLibrary.REDUX);
    });

    it("should return null for objects without required methods", () => {
      const consoleSpy = vi.spyOn(console, "warn");
      interceptor.registerStore("test", { subscribe: () => {} });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not detect store type"),
      );
    });
  });

  describe("computePartialState", () => {
    it("should return full state for non-object states", () => {
      const store = createMockZustandStore({ count: 0 });

      const primitiveStore = {
        ...store,
        getState: () => 42,
        subscribe: (cb: any) => {
          setTimeout(() => cb(43, 42), 0);
          return () => {};
        },
      };

      interceptor.registerStore("primitiveStore", primitiveStore);
    });

    it("should return full state when no keys changed", () => {
      const store = createMockZustandStore({ count: 0 });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      const currentState = store.getState();
      store.setState({ ...currentState });

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.action.payload).toEqual({ count: 0 });
    });
  });

  describe("timestamp and sessionId", () => {
    it("should include timestamp in all events", () => {
      const store = createMockZustandStore({ count: 0 });
      const beforeTime = Date.now();

      interceptor.registerStore("myStore", store);

      const afterTime = Date.now();
      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(message.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it("should call getSessionId for each event", () => {
      const store = createMockZustandStore({ count: 0 });

      interceptor.registerStore("myStore", store);
      store.setState({ count: 1 });

      expect(getSessionId).toHaveBeenCalledTimes(2);
    });

    it("should use current sessionId value", () => {
      const store = createMockZustandStore({ count: 0 });
      getSessionId.mockReturnValue("session-1");

      interceptor.registerStore("myStore", store);

      getSessionId.mockReturnValue("session-2");
      store.setState({ count: 1 });

      expect(sendMessage.mock.calls[0]?.[0].sessionId).toBe("session-1");
      expect(sendMessage.mock.calls[1]?.[0].sessionId).toBe("session-2");
    });
  });

  describe("stack trace capture", () => {
    it("should include stackTrace in UPDATE events", () => {
      const store = createMockZustandStore({ count: 0 });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      store.setState({ count: 1 });

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.stackTrace).toBeDefined();
      expect(typeof message.data.stackTrace).toBe("string");
    });

    it("should include stackTrace in Redux UPDATE events", () => {
      const store = createMockReduxStore({ count: 0 });
      interceptor.registerStore("reduxStore", store);
      sendMessage.mockClear();

      store.dispatch({ type: "INCREMENT" });

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.stackTrace).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle store with action without type", () => {
      const store = createMockReduxStore({ count: 0 });
      interceptor.registerStore("reduxStore", store);
      sendMessage.mockClear();

      store.dispatch({} as any);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.action.type).toBe("unknown");
    });

    it("should handle rapid successive state changes", () => {
      const store = createMockZustandStore({ count: 0 });
      interceptor.registerStore("myStore", store);
      sendMessage.mockClear();

      for (let i = 1; i <= 100; i++) {
        store.setState({ count: i });
      }

      expect(sendMessage).toHaveBeenCalledTimes(100);
    });

    it("should handle deeply nested state objects", () => {
      const store = createMockZustandStore({
        level1: {
          level2: {
            level3: {
              value: "deep",
            },
          },
        },
      });

      interceptor.registerStore("deepStore", store);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.state.level1.level2.level3.value).toBe("deep");
    });

    it("should handle state with arrays", () => {
      const store = createMockZustandStore({ items: [1, 2, 3] });
      interceptor.registerStore("arrayStore", store);
      sendMessage.mockClear();

      store.setState({ items: [1, 2, 3, 4] });

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.state.items).toEqual([1, 2, 3, 4]);
    });

    it("should handle state with null values", () => {
      const store = createMockZustandStore({ user: null });
      interceptor.registerStore("nullStore", store);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.state.user).toBeNull();
    });

    it("should handle state with undefined values", () => {
      const store = createMockZustandStore({ optional: undefined });
      interceptor.registerStore("undefinedStore", store);

      const message = sendMessage.mock.calls[0]?.[0];

      expect(message.data.state.optional).toBeUndefined();
    });
  });
});
