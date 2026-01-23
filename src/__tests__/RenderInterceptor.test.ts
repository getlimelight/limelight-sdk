import { RENDER_THRESHOLDS } from "@/constants";
import { RenderInterceptor } from "@/limelight";
import {
  FiberFlags,
  FiberTag,
  MinimalFiber,
  RenderCauseType,
  RenderPhase,
} from "@/types/render";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LimelightMessage } from "..";

/**
 * Helper to create mock fibers
 * @param overrides Partial properties to override on the mock fiber
 * @returns A mock MinimalFiber object
 */
const createMockFiber = (
  overrides: Partial<MinimalFiber> & { type?: any } = {},
): MinimalFiber => {
  const defaultType = function TestComponent() {};
  return {
    tag: FiberTag.FunctionComponent,
    flags: FiberFlags.PerformedWork,
    type: defaultType,
    key: null,
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    alternate: null,
    memoizedProps: {},
    memoizedState: null,
    ...overrides,
  };
};

/**
 * Helper to create a fiber tree root
 * @param rootFiber The root fiber of the tree
 * @returns An object representing the root with a current property
 */
const createMockRoot = (rootFiber: MinimalFiber): { current: MinimalFiber } => {
  return { current: rootFiber };
};

/**
 * Helper to create a named function component
 * @param name The desired name of the component
 * @returns A function with the specified name
 */
const createNamedComponent = (name: string): Function => {
  const fn = function () {};
  Object.defineProperty(fn, "name", { value: name });
  return fn;
};

describe("RenderInterceptor", () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let getSessionId: ReturnType<typeof vi.fn>;
  let interceptor: RenderInterceptor;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage = vi.fn();
    getSessionId = vi.fn().mockReturnValue("test-session-123");

    // Clear any existing hook
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

    interceptor = new RenderInterceptor(sendMessage, getSessionId);
  });

  afterEach(() => {
    interceptor.cleanup();
    vi.useRealTimers();
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  });

  describe("setup", () => {
    it("should install hook when no existing hook present", () => {
      expect(
        (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__,
      ).toBeUndefined();

      interceptor.setup({ projectKey: "test-key", enabled: true });

      expect((globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
      expect(
        (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.supportsFiber,
      ).toBe(true);
    });

    it("should wrap existing hook without breaking it", () => {
      const originalOnCommitFiberRoot = vi.fn();
      const originalOnCommitFiberUnmount = vi.fn();

      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        inject: vi.fn().mockReturnValue(1),
        onCommitFiberRoot: originalOnCommitFiberRoot,
        onCommitFiberUnmount: originalOnCommitFiberUnmount,
      };

      interceptor.setup({ projectKey: "test-key", enabled: true });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const fiber = createMockFiber();
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      expect(originalOnCommitFiberRoot).toHaveBeenCalled();
    });

    it("should warn if setup called twice", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      interceptor.setup({
        projectKey: "test-key",
        enabled: true,
        internalLoggingEnabled: true,
      });

      interceptor.setup({
        projectKey: "test-key",
        enabled: true,
        internalLoggingEnabled: true,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        "[Limelight] Render interceptor already set up",
      );

      warnSpy.mockRestore();
    });
  });

  describe("snapshot emission", () => {
    it("should emit snapshots at regular intervals", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("MyComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
      const message = sendMessage.mock.calls[0]![0];
      expect(message.phase).toBe("RENDER_SNAPSHOT");
      expect(message.sessionId).toBe("test-session-123");
    });

    it("should not emit empty snapshots", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should include render delta in snapshots", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("Counter"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      // First render (mount)
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);
      sendMessage.mockClear();

      // Create alternate to simulate update
      const updatedFiber = createMockFiber({
        type: fiber.type,
        alternate: fiber,
        memoizedState: { count: 1 },
      });

      hook.onCommitFiberRoot(1, createMockRoot(updatedFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].rendersDelta).toBeGreaterThan(0);
    });
  });

  describe("component tracking", () => {
    it("should track function components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        tag: FiberTag.FunctionComponent,
        type: createNamedComponent("MyFunctionComponent"),
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].componentName).toBe("MyFunctionComponent");
    });

    it("should track class components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      class MyClassComponent {}
      const fiber = createMockFiber({
        tag: FiberTag.ClassComponent,
        type: MyClassComponent,
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].componentType).toBe("class");
    });

    it("should track memo components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const InnerComponent = createNamedComponent("MemoizedComponent");
      const fiber = createMockFiber({
        tag: FiberTag.MemoComponent,
        type: { type: InnerComponent },
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].componentType).toBe("memo");
    });

    it("should use displayName if available", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const Component = function () {};
      (Component as any).displayName = "CustomDisplayName";

      const fiber = createMockFiber({ type: Component });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].componentName).toBe("CustomDisplayName");
    });

    it("should return Anonymous for unnamed components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      // Create a fiber with a function that has no name property
      const anonymousFn = Function("return function(){}")();
      const fiber = createMockFiber({ type: anonymousFn });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].componentName).toBe("Anonymous");
    });
  });

  describe("render cause inference", () => {
    it("should detect mount as initial render", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("NewComponent"),
        alternate: null,
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].renderPhase).toBe(RenderPhase.MOUNT);
    });

    it("should detect state change", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const prevFiber = createMockFiber({
        type: createNamedComponent("StatefulComponent"),
        memoizedState: { count: 0 },
      });

      const nextFiber = createMockFiber({
        type: prevFiber.type,
        alternate: prevFiber,
        memoizedState: { count: 1 },
        memoizedProps: prevFiber.memoizedProps,
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      // Mount
      hook.onCommitFiberRoot(1, createMockRoot(prevFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);
      sendMessage.mockClear();

      // Update with state change
      hook.onCommitFiberRoot(1, createMockRoot(nextFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      expect(
        message.profiles[0].causeBreakdown[RenderCauseType.STATE_CHANGE],
      ).toBeGreaterThan(0);
    });
  });

  describe("prop diffing", () => {
    it("should identify changed props", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      // Create parent that will trigger child render
      const parentType = createNamedComponent("Parent");
      const childType = createNamedComponent("Child");

      const prevChildFiber = createMockFiber({
        type: childType,
        memoizedProps: { name: "Alice", age: 25 },
      });

      const prevParentFiber = createMockFiber({
        type: parentType,
        child: prevChildFiber,
      });
      prevChildFiber.return = prevParentFiber;

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      // Mount
      hook.onCommitFiberRoot(1, createMockRoot(prevParentFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);
      sendMessage.mockClear();

      // Update with prop change
      const nextChildFiber = createMockFiber({
        type: childType,
        alternate: prevChildFiber,
        memoizedProps: { name: "Bob", age: 25 },
      });

      const nextParentFiber = createMockFiber({
        type: parentType,
        alternate: prevParentFiber,
        child: nextChildFiber,
      });
      nextChildFiber.return = nextParentFiber;

      hook.onCommitFiberRoot(1, createMockRoot(nextParentFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
    });

    it("should detect reference-only changes for objects", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const componentType = createNamedComponent("ObjectPropComponent");

      const prevFiber = createMockFiber({
        type: componentType,
        memoizedProps: { data: { id: 1, value: "test" } },
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(prevFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);
      sendMessage.mockClear();

      // New object with same values (reference-only change)
      const nextFiber = createMockFiber({
        type: componentType,
        alternate: prevFiber,
        memoizedProps: { data: { id: 1, value: "test" } },
        memoizedState: prevFiber.memoizedState,
      });

      hook.onCommitFiberRoot(1, createMockRoot(nextFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      // Should have tracked the prop change
      expect(sendMessage).toHaveBeenCalled();
    });

    it("should detect reference-only changes for callbacks", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const componentType = createNamedComponent("CallbackComponent");

      const prevFiber = createMockFiber({
        type: componentType,
        memoizedProps: { onClick: () => console.log("click") },
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(prevFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);
      sendMessage.mockClear();

      // New callback (common pattern causing unnecessary rerenders)
      const nextFiber = createMockFiber({
        type: componentType,
        alternate: prevFiber,
        memoizedProps: { onClick: () => console.log("click") },
        memoizedState: prevFiber.memoizedState,
      });

      hook.onCommitFiberRoot(1, createMockRoot(nextFiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
    });
  });

  describe("suspicious component detection", () => {
    it("should flag high velocity renders as suspicious", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const componentType = createNamedComponent("RapidComponent");
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      // Simulate many rapid renders
      let prevFiber = createMockFiber({ type: componentType });

      for (let i = 0; i < 20; i++) {
        const nextFiber = createMockFiber({
          type: componentType,
          alternate: prevFiber,
          memoizedState: { count: i },
        });

        hook.onCommitFiberRoot(1, createMockRoot(nextFiber), 0);
        prevFiber = nextFiber;

        // Small time advance to keep within velocity window
        vi.advanceTimersByTime(50);
      }

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      expect(message.profiles[0].isSuspicious).toBe(true);
      expect(message.profiles[0].suspiciousReason).toContain("velocity");
    });

    it("should flag high total render count as suspicious", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const componentType = createNamedComponent("FrequentComponent");
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      let prevFiber = createMockFiber({ type: componentType });

      // Simulate many renders over time
      for (let i = 0; i < RENDER_THRESHOLDS.HIGH_RENDER_COUNT + 10; i++) {
        const nextFiber = createMockFiber({
          type: componentType,
          alternate: prevFiber,
          memoizedState: { count: i },
        });

        hook.onCommitFiberRoot(1, createMockRoot(nextFiber), 0);
        prevFiber = nextFiber;

        // Advance time beyond velocity window to avoid velocity flag
        vi.advanceTimersByTime(RENDER_THRESHOLDS.VELOCITY_WINDOW_MS + 100);
      }

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const lastCall =
        sendMessage.mock.calls[sendMessage.mock.calls.length - 1];
      const message = lastCall?.[0];
      const profile = message.profiles.find(
        (p: any) => p.componentName === "FrequentComponent",
      );

      expect(profile.isSuspicious).toBe(true);
      expect(profile.suspiciousReason).toMatch(/velocity|renders/);
    });
  });

  describe("unmount handling", () => {
    it("should track unmounted components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const componentType = createNamedComponent("UnmountingComponent");
      const fiber = createMockFiber({ type: componentType });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      // Mount
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);
      sendMessage.mockClear();

      // Unmount
      hook.onCommitFiberUnmount(1, fiber);
      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(sendMessage).toHaveBeenCalled();
      const message = sendMessage.mock.calls[0]![0];
      const unmountedProfile = message.profiles.find(
        (p: any) => p.renderPhase === RenderPhase.UNMOUNT,
      );

      expect(unmountedProfile).toBeDefined();
      expect(unmountedProfile.unmountedAt).toBeDefined();
    });
  });

  describe("beforeSend hook", () => {
    it("should allow modifying message before send", () => {
      const beforeSend = vi.fn((message: LimelightMessage) => ({
        ...message,
        customField: "added",
      })) as any;

      interceptor.setup({
        projectKey: "test-key",
        enabled: true,
        beforeSend,
      });

      const fiber = createMockFiber({
        type: createNamedComponent("TestComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(beforeSend).toHaveBeenCalled();
      expect(sendMessage.mock.calls[0]![0].customField).toBe("added");
    });

    it("should allow dropping message by returning null", () => {
      const beforeSend = vi.fn(() => null);

      interceptor.setup({
        projectKey: "test-key",
        enabled: true,
        beforeSend,
      });

      const fiber = createMockFiber({
        type: createNamedComponent("DroppedComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      expect(beforeSend).toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should allow filtering specific profiles", () => {
      const beforeSend = vi.fn((message) => ({
        ...message,
        profiles: message.profiles.filter(
          (p: any) => !p.componentName.startsWith("Internal"),
        ),
      }));

      interceptor.setup({
        projectKey: "test-key",
        enabled: true,
        beforeSend,
      });

      const publicFiber = createMockFiber({
        type: createNamedComponent("PublicComponent"),
      });
      const internalFiber = createMockFiber({
        type: createNamedComponent("InternalHelper"),
        sibling: null,
      });
      publicFiber.sibling = internalFiber;

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(publicFiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      expect(
        message.profiles.every(
          (p: any) => !p.componentName.startsWith("Internal"),
        ),
      ).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("should emit final snapshot on cleanup", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("CleanupComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      interceptor.cleanup();

      expect(sendMessage).toHaveBeenCalled();
    });

    it("should restore original hooks on cleanup", () => {
      const originalOnCommitFiberRoot = vi.fn();
      const originalOnCommitFiberUnmount = vi.fn();

      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        inject: vi.fn().mockReturnValue(1),
        onCommitFiberRoot: originalOnCommitFiberRoot,
        onCommitFiberUnmount: originalOnCommitFiberUnmount,
      };

      interceptor.setup({ projectKey: "test-key", enabled: true });
      interceptor.cleanup();

      // Verify originals are restored by calling them
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(createMockFiber()), 0);

      expect(originalOnCommitFiberRoot).toHaveBeenCalled();
    });

    it("should clear interval timer on cleanup", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("TimerComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      interceptor.cleanup();
      sendMessage.mockClear();

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS * 5);

      // No new messages after cleanup
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("forceEmit", () => {
    it("should emit snapshot immediately when called", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("ForceEmitComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      // Don't wait for interval
      interceptor.forceEmit();

      expect(sendMessage).toHaveBeenCalled();
    });
  });

  describe("getProfile", () => {
    it("should return profile for tracked component", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const fiber = createMockFiber({
        type: createNamedComponent("TrackedComponent"),
      });
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(fiber), 0);

      const profile = interceptor.getProfile("c_1");

      expect(profile).toBeDefined();
      expect(profile?.totalRenders).toBe(1);
    });

    it("should return undefined for unknown component", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const profile = interceptor.getProfile("unknown-id");

      expect(profile).toBeUndefined();
    });
  });

  describe("getSuspiciousComponents", () => {
    it("should return only suspicious components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const normalType = createNamedComponent("NormalComponent");
      const suspiciousType = createNamedComponent("SuspiciousComponent");
      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      // Normal component - one render
      const normalFiber = createMockFiber({ type: normalType });
      hook.onCommitFiberRoot(1, createMockRoot(normalFiber), 0);

      // Suspicious component - many rapid renders
      let prevFiber = createMockFiber({ type: suspiciousType });
      for (let i = 0; i < 20; i++) {
        const nextFiber = createMockFiber({
          type: suspiciousType,
          alternate: prevFiber,
          memoizedState: { count: i },
        });
        hook.onCommitFiberRoot(1, createMockRoot(nextFiber), 0);
        prevFiber = nextFiber;
        vi.advanceTimersByTime(10);
      }

      const suspicious = interceptor.getSuspiciousComponents();

      expect(suspicious.length).toBeGreaterThan(0);
      expect(suspicious.every((p) => p.isSuspicious)).toBe(true);
      expect(
        suspicious.some((p) => p.componentName === "SuspiciousComponent"),
      ).toBe(true);
    });

    it("should return empty array when no suspicious components", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      // Don't trigger any renders - just check empty state
      const suspicious = interceptor.getSuspiciousComponents();

      expect(suspicious).toHaveLength(0);
    });
  });

  describe("fiber tree walking", () => {
    it("should walk child fibers", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const parentType = createNamedComponent("Parent");
      const childType = createNamedComponent("Child");

      const childFiber = createMockFiber({ type: childType });
      const parentFiber = createMockFiber({
        type: parentType,
        child: childFiber,
      });
      childFiber.return = parentFiber;

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(parentFiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      const names = message.profiles.map((p: any) => p.componentName);

      expect(names).toContain("Parent");
      expect(names).toContain("Child");
    });

    it("should walk sibling fibers", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const firstType = createNamedComponent("FirstSibling");
      const secondType = createNamedComponent("SecondSibling");

      const secondFiber = createMockFiber({ type: secondType });
      const firstFiber = createMockFiber({
        type: firstType,
        sibling: secondFiber,
      });

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(firstFiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      const names = message.profiles.map((p: any) => p.componentName);

      expect(names).toContain("FirstSibling");
      expect(names).toContain("SecondSibling");
    });

    it("should track depth correctly", () => {
      interceptor.setup({ projectKey: "test-key", enabled: true });

      const grandparentType = createNamedComponent("Grandparent");
      const parentType = createNamedComponent("Parent");
      const childType = createNamedComponent("Child");

      const childFiber = createMockFiber({ type: childType });
      const parentFiber = createMockFiber({
        type: parentType,
        child: childFiber,
      });
      const grandparentFiber = createMockFiber({
        type: grandparentType,
        child: parentFiber,
      });

      childFiber.return = parentFiber;
      parentFiber.return = grandparentFiber;

      const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.onCommitFiberRoot(1, createMockRoot(grandparentFiber), 0);

      vi.advanceTimersByTime(RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

      const message = sendMessage.mock.calls[0]![0];
      const childProfile = message.profiles.find(
        (p: any) => p.componentName === "Child",
      );

      expect(childProfile.depth).toBeGreaterThan(0);
    });
  });
});
