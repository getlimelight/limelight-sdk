import {
  RenderEvent,
  RenderBatch,
  RenderPhase,
  RenderCauseType,
  RenderConfidence,
  ComponentType,
  MinimalFiber,
  ReactDevToolsHook,
  FiberTag,
  FiberFlags,
} from "@/types/render";
import { LimelightConfig, LimelightMessage } from "@/types";
import { generateRenderId, isDevelopment } from "@/helpers";
import { getCurrentTransactionId } from "../react/LimelightProvider";

/**
 * Intercepts React renders via the DevTools global hook.
 * Captures mount, update, and unmount events with timing and causality data.
 */
export class RenderInterceptor {
  private sendMessage: (message: LimelightMessage) => void;
  private getSessionId: () => string;
  private config: LimelightConfig | null = null;
  private isSetup = false;

  // Component ID tracking (stable IDs across renders)
  private fiberToComponentId = new WeakMap<MinimalFiber, string>();
  private componentIdCounter = 0;

  // Batching
  private eventBatch: RenderEvent[] = [];
  private flushScheduled = false;
  private flushInterval = 16; // ~1 frame

  // Original hook preservation
  private originalHook: ReactDevToolsHook | null = null;
  private originalOnCommitFiberRoot:
    | ReactDevToolsHook["onCommitFiberRoot"]
    | null = null;
  private originalOnCommitFiberUnmount:
    | ReactDevToolsHook["onCommitFiberUnmount"]
    | null = null;

  // Track renders within current commit for causality
  private currentCommitRenders: Map<string, RenderEvent> = new Map();

  constructor(
    sendMessage: (message: LimelightMessage) => void,
    getSessionId: () => string
  ) {
    this.sendMessage = sendMessage;
    this.getSessionId = getSessionId;
  }

  /**
   * Sets up the render interceptor by hooking into React DevTools global hook.
   */
  setup(config: LimelightConfig): void {
    if (this.isSetup) {
      console.warn("[Limelight] Render interceptor already set up");
      return;
    }

    this.config = config;

    if (!this.installHook()) {
      console.warn("[Limelight] Failed to install render hook");
      return;
    }

    this.isSetup = true;
  }

  /**
   * Installs or wraps the React DevTools global hook.
   */
  private installHook(): boolean {
    const globalObj =
      typeof window !== "undefined"
        ? window
        : typeof global !== "undefined"
        ? global
        : null;

    if (!globalObj) {
      return false;
    }

    const hookKey = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
    const existingHook = (globalObj as any)[hookKey] as
      | ReactDevToolsHook
      | undefined;

    if (existingHook) {
      this.wrapExistingHook(existingHook);
    } else {
      this.createHook(globalObj, hookKey);
    }

    return true;
  }

  /**
   * Wraps an existing DevTools hook, preserving its functionality.
   */
  private wrapExistingHook(hook: ReactDevToolsHook): void {
    this.originalHook = hook;
    this.originalOnCommitFiberRoot = hook.onCommitFiberRoot?.bind(hook);
    this.originalOnCommitFiberUnmount = hook.onCommitFiberUnmount?.bind(hook);

    hook.onCommitFiberRoot = (rendererID, root, priorityLevel) => {
      this.originalOnCommitFiberRoot?.(rendererID, root, priorityLevel);
      this.handleCommitFiberRoot(rendererID, root);
    };

    hook.onCommitFiberUnmount = (rendererID, fiber) => {
      this.originalOnCommitFiberUnmount?.(rendererID, fiber);
      this.handleCommitFiberUnmount(rendererID, fiber);
    };
  }

  /**
   * Creates a new DevTools hook if none exists.
   */
  private createHook(globalObj: any, hookKey: string): void {
    const renderers = new Map<number, any>();
    let rendererIdCounter = 0;

    const hook: ReactDevToolsHook = {
      supportsFiber: true,

      inject: (renderer) => {
        const id = ++rendererIdCounter;
        renderers.set(id, renderer);
        return id;
      },

      onCommitFiberRoot: (rendererID, root, priorityLevel) => {
        this.handleCommitFiberRoot(rendererID, root);
      },

      onCommitFiberUnmount: (rendererID, fiber) => {
        this.handleCommitFiberUnmount(rendererID, fiber);
      },
    };

    globalObj[hookKey] = hook;
  }

  /**
   * Handles a fiber root commit (React finished rendering a tree).
   */
  private handleCommitFiberRoot(
    _rendererID: number,
    root: { current: MinimalFiber }
  ): void {
    const commitStart = performance.now();
    this.currentCommitRenders.clear();

    try {
      this.walkFiberTree(root.current, null, 0, commitStart);
    } catch (error) {
      if (isDevelopment()) {
        console.warn("[Limelight] Error processing fiber tree:", error);
      }
    }

    this.scheduleFlush();
  }

  /**
   * Handles a fiber unmount.
   */
  private handleCommitFiberUnmount(
    _rendererID: number,
    fiber: MinimalFiber
  ): void {
    if (!this.isUserComponent(fiber)) {
      return;
    }

    const componentId = this.getOrCreateComponentId(fiber);
    const componentName = this.getComponentName(fiber);

    const event: RenderEvent = {
      id: generateRenderId(),
      componentId,
      componentName,
      componentType: this.getComponentType(fiber),
      sessionId: this.getSessionId(),
      timestamp: Date.now(),
      duration: { start: 0, end: 0 },
      durationMs: 0,
      renderPhase: RenderPhase.UNMOUNT,
      cause: {
        type: RenderCauseType.UNKNOWN,
        confidence: RenderConfidence.HIGH,
      },
    };

    this.eventBatch.push(event);
    this.scheduleFlush();
  }

  /**
   * Recursively walks the fiber tree to find components that rendered.
   */
  private walkFiberTree(
    fiber: MinimalFiber | null,
    parentComponentId: string | null,
    depth: number,
    commitStart: number
  ): void {
    if (!fiber) return;

    if (this.isUserComponent(fiber) && this.didFiberRender(fiber)) {
      const event = this.createRenderEvent(
        fiber,
        parentComponentId,
        depth,
        commitStart
      );
      this.eventBatch.push(event);
      this.currentCommitRenders.set(event.componentId, event);

      parentComponentId = event.componentId;
    }

    this.walkFiberTree(fiber.child, parentComponentId, depth + 1, commitStart);
    this.walkFiberTree(fiber.sibling, parentComponentId, depth, commitStart);
  }

  /**
   * Creates a RenderEvent for a fiber that rendered.
   */
  private createRenderEvent(
    fiber: MinimalFiber,
    parentComponentId: string | null,
    depth: number,
    commitStart: number
  ): RenderEvent {
    const componentId = this.getOrCreateComponentId(fiber);
    const now = performance.now();

    const renderPhase =
      fiber.alternate === null ? RenderPhase.MOUNT : RenderPhase.UPDATE;

    const cause = this.inferRenderCause(fiber, parentComponentId);
    const transactionId = getCurrentTransactionId() ?? undefined;

    return {
      id: generateRenderId(),
      componentId,
      componentName: this.getComponentName(fiber),
      componentType: this.getComponentType(fiber),
      sessionId: this.getSessionId(),
      timestamp: Date.now(),
      duration: {
        start: commitStart,
        end: now,
      },
      durationMs: now - commitStart,
      renderPhase,
      cause,
      parentComponentId: parentComponentId ?? undefined,
      depth,
      transactionId,
    };
  }

  /**
   * Infers what caused a component to render.
   */
  private inferRenderCause(
    fiber: MinimalFiber,
    parentComponentId: string | null
  ): RenderEvent["cause"] {
    const alternate = fiber.alternate;

    if (!alternate) {
      return {
        type: RenderCauseType.UNKNOWN,
        confidence: RenderConfidence.HIGH,
      };
    }

    if (parentComponentId && this.currentCommitRenders.has(parentComponentId)) {
      const propsChanged = fiber.memoizedProps !== alternate.memoizedProps;

      if (propsChanged) {
        return {
          type: RenderCauseType.PROPS_CHANGE,
          confidence: RenderConfidence.MEDIUM,
          triggerId: parentComponentId,
        };
      }

      return {
        type: RenderCauseType.PARENT_RENDER,
        confidence: RenderConfidence.MEDIUM,
        triggerId: parentComponentId,
      };
    }

    if (fiber.memoizedState !== alternate.memoizedState) {
      return {
        type: RenderCauseType.STATE_CHANGE,
        confidence: RenderConfidence.MEDIUM,
      };
    }

    if (fiber.memoizedProps !== alternate.memoizedProps) {
      return {
        type: RenderCauseType.CONTEXT_CHANGE,
        confidence: RenderConfidence.LOW,
      };
    }

    return {
      type: RenderCauseType.UNKNOWN,
      confidence: RenderConfidence.UNKNOWN,
    };
  }

  /**
   * Checks if a fiber represents a user component (not host/internal).
   */
  private isUserComponent(fiber: MinimalFiber): boolean {
    const tag = fiber.tag;
    return (
      tag === FiberTag.FunctionComponent ||
      tag === FiberTag.ClassComponent ||
      tag === FiberTag.ForwardRef ||
      tag === FiberTag.MemoComponent ||
      tag === FiberTag.SimpleMemoComponent
    );
  }

  /**
   * Checks if a fiber actually performed render work.
   */
  private didFiberRender(fiber: MinimalFiber): boolean {
    return (fiber.flags & FiberFlags.PerformedWork) !== 0;
  }

  /**
   * Gets or creates a stable component ID for a fiber.
   */
  private getOrCreateComponentId(fiber: MinimalFiber): string {
    let id = this.fiberToComponentId.get(fiber);

    if (id) return id;

    if (fiber.alternate) {
      id = this.fiberToComponentId.get(fiber.alternate);

      if (id) {
        this.fiberToComponentId.set(fiber, id);
        return id;
      }
    }

    id = `c_${++this.componentIdCounter}`;
    this.fiberToComponentId.set(fiber, id);

    return id;
  }

  /**
   * Extracts the component name from a fiber.
   */
  private getComponentName(fiber: MinimalFiber): string {
    const type = fiber.type;

    if (!type) {
      return "Unknown";
    }

    if (typeof type === "function") {
      return type.displayName || type.name || "Anonymous";
    }

    if (typeof type === "object" && type !== null) {
      if (type.displayName) {
        return type.displayName;
      }

      if (type.render) {
        return type.render.displayName || type.render.name || "ForwardRef";
      }

      if (type.type) {
        const inner = type.type;
        return inner.displayName || inner.name || "Memo";
      }
    }

    return "Unknown";
  }

  /**
   * Determines the component type from a fiber.
   */
  private getComponentType(fiber: MinimalFiber): ComponentType {
    switch (fiber.tag) {
      case FiberTag.FunctionComponent:
        return "function";
      case FiberTag.ClassComponent:
        return "class";
      case FiberTag.ForwardRef:
        return "forwardRef";
      case FiberTag.MemoComponent:
      case FiberTag.SimpleMemoComponent:
        return "memo";
      default:
        return "unknown";
    }
  }

  /**
   * Schedules a flush of the event batch.
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;

    this.flushScheduled = true;

    setTimeout(() => {
      this.flush();
      this.flushScheduled = false;
    }, this.flushInterval);
  }

  /**
   * Flushes the event batch to the server.
   */
  private flush(): void {
    if (this.eventBatch.length === 0) return;

    const batch: RenderBatch = {
      phase: "RENDER_BATCH",
      sessionId: this.getSessionId(),
      timestamp: Date.now(),
      events: [...this.eventBatch],
    };

    this.eventBatch = [];
    this.sendMessage(batch);
  }

  /**
   * Cleans up the render interceptor.
   */
  cleanup(): void {
    if (!this.isSetup) return;

    this.flush();

    if (this.originalHook) {
      if (this.originalOnCommitFiberRoot) {
        this.originalHook.onCommitFiberRoot = this.originalOnCommitFiberRoot;
      }

      if (this.originalOnCommitFiberUnmount) {
        this.originalHook.onCommitFiberUnmount =
          this.originalOnCommitFiberUnmount;
      }
    }

    this.originalHook = null;
    this.originalOnCommitFiberRoot = null;
    this.originalOnCommitFiberUnmount = null;
    this.eventBatch = [];
    this.currentCommitRenders.clear();
    this.componentIdCounter = 0;
    this.config = null;
    this.isSetup = false;
  }
}
