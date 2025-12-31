import {
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
 * Cumulative profile for a single component.
 * This is the core data structure - we accumulate here, not in event arrays.
 */
interface ComponentProfile {
  id: string; // Unique profile ID (uses generateRenderId)
  componentId: string;
  componentName: string;
  componentType: ComponentType;

  // Lifecycle
  mountedAt: number;
  unmountedAt?: number;

  // Cumulative stats
  totalRenders: number;
  // Relative render cost (1 unit per render, normalized by components in commit)
  // This is NOT wall-clock time - React doesn't expose per-fiber timing
  totalRenderCost: number;

  // Velocity tracking (cheap: just count + window start, no array allocation)
  velocityWindowStart: number;
  velocityWindowCount: number;

  // Cause breakdown (cumulative since mount)
  causeBreakdown: Record<RenderCauseType, number>;
  // Cause breakdown (delta since last emit)
  causeDeltaBreakdown: Record<RenderCauseType, number>;

  // Last emit state (for delta calculation)
  lastEmittedRenderCount: number;
  lastEmittedRenderCost: number;
  lastEmitTime: number;

  // Hierarchy - track most common parent for stability
  parentCounts: Map<string, number>;
  primaryParentId?: string;
  depth: number;

  // Transaction correlation (last transaction that triggered a render)
  lastTransactionId?: string;

  // Flags
  isSuspicious: boolean;
  suspiciousReason?: string;
}

/**
 * Snapshot of component render stats sent to desktop.
 * Much smaller than individual events.
 */
export interface RenderSnapshot {
  phase: "RENDER_SNAPSHOT";
  sessionId: string;
  timestamp: number;
  profiles: ComponentProfileSnapshot[];
}

export interface ComponentProfileSnapshot {
  id: string; // Profile ID
  componentId: string;
  componentName: string;
  componentType: ComponentType;

  // Cumulative (total since mount)
  totalRenders: number;
  // Relative render cost - NOT wall-clock time
  // Use for comparison between components, not absolute timing
  totalRenderCost: number;
  avgRenderCost: number;

  // Delta since last snapshot
  rendersDelta: number;
  renderCostDelta: number;

  // Velocity (renders per second, calculated from sliding window)
  renderVelocity: number;

  // Cause breakdown (cumulative since mount)
  causeBreakdown: Record<RenderCauseType, number>;
  // Cause breakdown (just this snapshot period)
  causeDeltaBreakdown: Record<RenderCauseType, number>;

  // Hierarchy (most common parent, not last parent)
  parentComponentId?: string;
  depth: number;

  // Transaction correlation
  lastTransactionId?: string;

  // Flags
  isSuspicious: boolean;
  suspiciousReason?: string;

  // Lifecycle
  renderPhase: RenderPhase; // MOUNT on first snapshot, UPDATE thereafter, UNMOUNT on cleanup
  mountedAt: number;
  unmountedAt?: number;
}

/**
 * Thresholds for suspicious render detection.
 */
const THRESHOLDS = {
  // Renders per second that's considered "hot"
  HOT_VELOCITY: 5,
  // Total renders that warrant attention
  HIGH_RENDER_COUNT: 50,
  // Velocity window duration (ms)
  VELOCITY_WINDOW_MS: 2000,
  // How often to emit snapshots (ms)
  SNAPSHOT_INTERVAL_MS: 1000,
  // Minimum delta to emit (avoid noise)
  MIN_DELTA_TO_EMIT: 1,
} as const;

/**
 * Creates an empty cause breakdown record.
 */
function createEmptyCauseBreakdown(): Record<RenderCauseType, number> {
  return {
    [RenderCauseType.STATE_CHANGE]: 0,
    [RenderCauseType.PROPS_CHANGE]: 0,
    [RenderCauseType.CONTEXT_CHANGE]: 0,
    [RenderCauseType.PARENT_RENDER]: 0,
    [RenderCauseType.FORCE_UPDATE]: 0,
    [RenderCauseType.UNKNOWN]: 0,
  };
}

/**
 * Intercepts React renders via the DevTools global hook.
 * PROFILES renders instead of logging them - tracks cumulative stats and emits deltas.
 */
export class RenderInterceptor {
  private sendMessage: (message: LimelightMessage) => void;
  private getSessionId: () => string;
  private config: LimelightConfig | null = null;
  private isSetup = false;

  // Component profiles (the core state)
  private profiles = new Map<string, ComponentProfile>();

  // Fiber to component ID mapping (stable across renders)
  private fiberToComponentId = new WeakMap<MinimalFiber, string>();
  private componentIdCounter = 0;

  // Snapshot scheduling
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  // Track current commit for causality and cost distribution
  private currentCommitComponents = new Set<string>();
  private componentsInCurrentCommit = 0;

  // Original hook preservation
  private originalHook: ReactDevToolsHook | null = null;
  private originalOnCommitFiberRoot:
    | ReactDevToolsHook["onCommitFiberRoot"]
    | null = null;
  private originalOnCommitFiberUnmount:
    | ReactDevToolsHook["onCommitFiberUnmount"]
    | null = null;

  // Pending unmounts (emit in next snapshot)
  private pendingUnmounts: ComponentProfile[] = [];

  constructor(
    sendMessage: (message: LimelightMessage) => void,
    getSessionId: () => string
  ) {
    this.sendMessage = sendMessage;
    this.getSessionId = getSessionId;
  }

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

    // Start snapshot emission loop
    this.snapshotTimer = setInterval(() => {
      this.emitSnapshot();
    }, THRESHOLDS.SNAPSHOT_INTERVAL_MS);

    this.isSetup = true;
  }

  private installHook(): boolean {
    const globalObj =
      typeof window !== "undefined"
        ? window
        : typeof global !== "undefined"
        ? global
        : null;

    if (!globalObj) return false;

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
   * Handles a fiber root commit - walks tree and ACCUMULATES into profiles.
   * Two-pass: first count components, then accumulate with distributed cost.
   */
  private handleCommitFiberRoot(
    _rendererID: number,
    root: { current: MinimalFiber }
  ): void {
    this.currentCommitComponents.clear();
    this.componentsInCurrentCommit = 0;

    try {
      // First pass: count how many components rendered in this commit
      this.countRenderedComponents(root.current);

      // Second pass: accumulate with cost distributed across components
      this.walkFiberTree(root.current, null, 0);
    } catch (error) {
      if (isDevelopment()) {
        console.warn("[Limelight] Error processing fiber tree:", error);
      }
    }
  }

  /**
   * First pass: count rendered components for cost distribution.
   */
  private countRenderedComponents(fiber: MinimalFiber | null): void {
    if (!fiber) return;

    if (this.isUserComponent(fiber) && this.didFiberRender(fiber)) {
      this.componentsInCurrentCommit++;
    }

    this.countRenderedComponents(fiber.child);
    this.countRenderedComponents(fiber.sibling);
  }

  private handleCommitFiberUnmount(
    _rendererID: number,
    fiber: MinimalFiber
  ): void {
    if (!this.isUserComponent(fiber)) return;

    const componentId = this.fiberToComponentId.get(fiber);
    if (!componentId) return;

    const profile = this.profiles.get(componentId);
    if (profile) {
      profile.unmountedAt = Date.now();
      this.pendingUnmounts.push(profile);
      this.profiles.delete(componentId);
    }
  }

  /**
   * Walks fiber tree and accumulates render stats into profiles.
   */
  private walkFiberTree(
    fiber: MinimalFiber | null,
    parentComponentId: string | null,
    depth: number
  ): void {
    if (!fiber) return;

    if (this.isUserComponent(fiber) && this.didFiberRender(fiber)) {
      const componentId = this.getOrCreateComponentId(fiber);
      this.accumulateRender(fiber, componentId, parentComponentId, depth);
      this.currentCommitComponents.add(componentId);
      parentComponentId = componentId;
    }

    this.walkFiberTree(fiber.child, parentComponentId, depth + 1);
    this.walkFiberTree(fiber.sibling, parentComponentId, depth);
  }

  /**
   * Core accumulation logic - this is where we build up the profile.
   */
  private accumulateRender(
    fiber: MinimalFiber,
    componentId: string,
    parentComponentId: string | null,
    depth: number
  ): void {
    const now = Date.now();
    const cause = this.inferRenderCause(fiber, parentComponentId);

    // Cost is distributed: 1 unit per commit, split across all rendered components
    // This keeps totals bounded and comparable
    const renderCost =
      this.componentsInCurrentCommit > 0
        ? 1 / this.componentsInCurrentCommit
        : 1;

    let profile = this.profiles.get(componentId);

    if (!profile) {
      // New component - create profile
      profile = {
        id: generateRenderId(),
        componentId,
        componentName: this.getComponentName(fiber),
        componentType: this.getComponentType(fiber),
        mountedAt: now,
        totalRenders: 0,
        totalRenderCost: 0,
        velocityWindowStart: now,
        velocityWindowCount: 0,
        causeBreakdown: createEmptyCauseBreakdown(),
        causeDeltaBreakdown: createEmptyCauseBreakdown(),
        lastEmittedRenderCount: 0,
        lastEmittedRenderCost: 0,
        lastEmitTime: now,
        parentCounts: new Map(),
        depth,
        isSuspicious: false,
      };
      this.profiles.set(componentId, profile);
    }

    // Accumulate render count and cost
    profile.totalRenders++;
    profile.totalRenderCost += renderCost;

    // Accumulate cause (both lifetime and delta)
    profile.causeBreakdown[cause.type]++;
    profile.causeDeltaBreakdown[cause.type]++;

    // Track transaction for correlation
    const transactionId = getCurrentTransactionId();
    if (transactionId) {
      profile.lastTransactionId = transactionId;
    }

    // Track parent for stability (most common parent wins)
    if (parentComponentId) {
      const count = (profile.parentCounts.get(parentComponentId) ?? 0) + 1;
      profile.parentCounts.set(parentComponentId, count);

      // Update primary parent if this one is now most common
      if (
        !profile.primaryParentId ||
        count > (profile.parentCounts.get(profile.primaryParentId) ?? 0)
      ) {
        profile.primaryParentId = parentComponentId;
      }
    }

    profile.depth = depth;

    // Update velocity window (cheap: no array allocation)
    const windowStart = now - THRESHOLDS.VELOCITY_WINDOW_MS;
    if (profile.velocityWindowStart < windowStart) {
      // Window has shifted - reset count for new window
      profile.velocityWindowStart = now;
      profile.velocityWindowCount = 1;
    } else {
      profile.velocityWindowCount++;
    }

    // Check for suspicious patterns
    this.updateSuspiciousFlag(profile);
  }

  /**
   * Updates the suspicious flag based on current profile state.
   */
  private updateSuspiciousFlag(profile: ComponentProfile): void {
    const velocity = this.calculateVelocity(profile);

    if (velocity > THRESHOLDS.HOT_VELOCITY) {
      profile.isSuspicious = true;
      profile.suspiciousReason = `High render velocity: ${velocity.toFixed(
        1
      )}/sec`;
    } else if (profile.totalRenders > THRESHOLDS.HIGH_RENDER_COUNT) {
      profile.isSuspicious = true;
      profile.suspiciousReason = `High total renders: ${profile.totalRenders}`;
    } else {
      profile.isSuspicious = false;
      profile.suspiciousReason = undefined;
    }
  }

  /**
   * Calculates renders per second from velocity window.
   * Cheap: just count / window duration, no array operations.
   */
  private calculateVelocity(profile: ComponentProfile): number {
    const now = Date.now();
    const windowAge = now - profile.velocityWindowStart;

    // If window is too old, velocity is effectively 0
    if (windowAge > THRESHOLDS.VELOCITY_WINDOW_MS) {
      return 0;
    }

    // Avoid division by zero for very recent windows
    const effectiveWindowMs = Math.max(windowAge, 100);

    return (profile.velocityWindowCount / effectiveWindowMs) * 1000;
  }

  /**
   * Emits a snapshot of all profiles with deltas.
   */
  private emitSnapshot(): void {
    const now = Date.now();
    const snapshots: ComponentProfileSnapshot[] = [];

    // Process active profiles
    for (const profile of this.profiles.values()) {
      const rendersDelta =
        profile.totalRenders - profile.lastEmittedRenderCount;

      // Only emit if there's meaningful change OR it's suspicious
      if (
        rendersDelta < THRESHOLDS.MIN_DELTA_TO_EMIT &&
        !profile.isSuspicious
      ) {
        continue;
      }

      const velocity = this.calculateVelocity(profile);
      const isMount = profile.lastEmittedRenderCount === 0;
      const renderCostDelta =
        profile.totalRenderCost - profile.lastEmittedRenderCost;

      snapshots.push({
        id: profile.id,
        componentId: profile.componentId,
        componentName: profile.componentName,
        componentType: profile.componentType,
        totalRenders: profile.totalRenders,
        totalRenderCost: profile.totalRenderCost,
        avgRenderCost: profile.totalRenderCost / profile.totalRenders,
        rendersDelta,
        renderCostDelta,
        renderVelocity: velocity,
        causeBreakdown: { ...profile.causeBreakdown },
        causeDeltaBreakdown: { ...profile.causeDeltaBreakdown },
        parentComponentId: profile.primaryParentId,
        depth: profile.depth,
        lastTransactionId: profile.lastTransactionId,
        isSuspicious: profile.isSuspicious,
        suspiciousReason: profile.suspiciousReason,
        renderPhase: isMount ? RenderPhase.MOUNT : RenderPhase.UPDATE,
        mountedAt: profile.mountedAt,
      });

      // Update emit state
      profile.lastEmittedRenderCount = profile.totalRenders;
      profile.lastEmittedRenderCost = profile.totalRenderCost;
      profile.lastEmitTime = now;

      // Reset delta breakdown for next snapshot period
      profile.causeDeltaBreakdown = createEmptyCauseBreakdown();
    }

    // Process pending unmounts
    for (const profile of this.pendingUnmounts) {
      snapshots.push({
        id: profile.id,
        componentId: profile.componentId,
        componentName: profile.componentName,
        componentType: profile.componentType,
        totalRenders: profile.totalRenders,
        totalRenderCost: profile.totalRenderCost,
        avgRenderCost:
          profile.totalRenderCost / Math.max(profile.totalRenders, 1),
        rendersDelta: 0,
        renderCostDelta: 0,
        renderVelocity: 0,
        causeBreakdown: { ...profile.causeBreakdown },
        causeDeltaBreakdown: createEmptyCauseBreakdown(),
        parentComponentId: profile.primaryParentId,
        depth: profile.depth,
        lastTransactionId: profile.lastTransactionId,
        isSuspicious: profile.isSuspicious,
        suspiciousReason: profile.suspiciousReason,
        renderPhase: RenderPhase.UNMOUNT,
        mountedAt: profile.mountedAt,
        unmountedAt: profile.unmountedAt,
      });
    }
    this.pendingUnmounts = [];

    // Only send if there's something to report
    if (snapshots.length === 0) return;

    const message: LimelightMessage = {
      phase: "RENDER_SNAPSHOT",
      sessionId: this.getSessionId(),
      timestamp: now,
      profiles: snapshots,
    };

    this.sendMessage(message);
  }

  private inferRenderCause(
    fiber: MinimalFiber,
    parentComponentId: string | null
  ): {
    type: RenderCauseType;
    confidence: RenderConfidence;
    triggerId?: string;
  } {
    const alternate = fiber.alternate;

    if (!alternate) {
      return {
        type: RenderCauseType.UNKNOWN,
        confidence: RenderConfidence.HIGH,
      };
    }

    // Parent rendered in same commit
    if (
      parentComponentId &&
      this.currentCommitComponents.has(parentComponentId)
    ) {
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

    // State change
    if (fiber.memoizedState !== alternate.memoizedState) {
      return {
        type: RenderCauseType.STATE_CHANGE,
        confidence: RenderConfidence.MEDIUM,
      };
    }

    // Props change (could be context)
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

  private didFiberRender(fiber: MinimalFiber): boolean {
    return (fiber.flags & FiberFlags.PerformedWork) !== 0;
  }

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

  private getComponentName(fiber: MinimalFiber): string {
    const type = fiber.type;
    if (!type) return "Unknown";

    if (typeof type === "function") {
      return type.displayName || type.name || "Anonymous";
    }

    if (typeof type === "object" && type !== null) {
      if (type.displayName) return type.displayName;
      if (type.render)
        return type.render.displayName || type.render.name || "ForwardRef";
      if (type.type) {
        const inner = type.type;
        return inner.displayName || inner.name || "Memo";
      }
    }

    return "Unknown";
  }

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
   * Force emit current state (useful for debugging or on-demand refresh).
   */
  forceEmit(): void {
    this.emitSnapshot();
  }

  /**
   * Get current profile for a component (useful for debugging).
   */
  getProfile(componentId: string): ComponentProfile | undefined {
    return this.profiles.get(componentId);
  }

  /**
   * Get all suspicious components.
   */
  getSuspiciousComponents(): ComponentProfile[] {
    return Array.from(this.profiles.values()).filter((p) => p.isSuspicious);
  }

  cleanup(): void {
    if (!this.isSetup) return;

    // Final snapshot
    this.emitSnapshot();

    // Clear interval
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    // Restore original hooks
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
    this.profiles.clear();
    this.pendingUnmounts = [];
    this.currentCommitComponents.clear();
    this.componentIdCounter = 0;
    this.config = null;
    this.isSetup = false;
  }
}
