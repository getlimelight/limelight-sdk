import {
  RenderPhase,
  RenderCauseType,
  RenderConfidence,
  ComponentType,
  MinimalFiber,
  ReactDevToolsHook,
  FiberTag,
  FiberFlags,
  ComponentProfile,
  PropChangeDetail,
  PropChangeSnapshot,
  ComponentProfileSnapshot,
} from "@/types/render";
import { LimelightConfig, LimelightMessage } from "@/types";
import {
  createEmptyPropChangeStats,
  generateRenderId,
  isDevelopment,
} from "@/helpers";
import { getCurrentTransactionId } from "../react/LimelightProvider";
import { createEmptyCauseBreakdown } from "@/helpers/render/createEmptyCauseBreakdown";
import { RENDER_THRESHOLDS } from "@/constants";

/**
 * Intercepts React renders via the DevTools global hook.
 */
export class RenderInterceptor {
  private sendMessage: (message: LimelightMessage) => void;
  private getSessionId: () => string;
  //TODO: use config for thresholds
  private config: LimelightConfig | null = null;
  private isSetup = false;

  private profiles = new Map<string, ComponentProfile>();
  private fiberToComponentId = new WeakMap<MinimalFiber, string>();
  private componentIdCounter = 0;

  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  private currentCommitComponents = new Set<string>();
  private componentsInCurrentCommit = 0;

  private originalHook: ReactDevToolsHook | null = null;
  private originalOnCommitFiberRoot:
    | ReactDevToolsHook["onCommitFiberRoot"]
    | null = null;
  private originalOnCommitFiberUnmount:
    | ReactDevToolsHook["onCommitFiberUnmount"]
    | null = null;

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

    this.snapshotTimer = setInterval(() => {
      this.emitSnapshot();
    }, RENDER_THRESHOLDS.SNAPSHOT_INTERVAL_MS);

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
      this.countRenderedComponents(root.current);
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

    const renderCost =
      this.componentsInCurrentCommit > 0
        ? 1 / this.componentsInCurrentCommit
        : 1;

    let profile = this.profiles.get(componentId);

    if (!profile) {
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
        // NEW
        propChangeStats: createEmptyPropChangeStats(),
        propChangeDelta: [],
      };
      this.profiles.set(componentId, profile);
    }

    profile.totalRenders++;
    profile.totalRenderCost += renderCost;

    profile.causeBreakdown[cause.type]++;
    profile.causeDeltaBreakdown[cause.type]++;

    if (cause.type === RenderCauseType.PROPS_CHANGE && cause.propChanges) {
      this.accumulatePropChanges(profile, cause.propChanges);
    }

    const transactionId = getCurrentTransactionId();
    if (transactionId) {
      profile.lastTransactionId = transactionId;
    }

    if (parentComponentId) {
      const count = (profile.parentCounts.get(parentComponentId) ?? 0) + 1;
      profile.parentCounts.set(parentComponentId, count);

      if (
        !profile.primaryParentId ||
        count > (profile.parentCounts.get(profile.primaryParentId) ?? 0)
      ) {
        profile.primaryParentId = parentComponentId;
      }
    }

    profile.depth = depth;

    const windowStart = now - RENDER_THRESHOLDS.VELOCITY_WINDOW_MS;
    if (profile.velocityWindowStart < windowStart) {
      profile.velocityWindowStart = now;
      profile.velocityWindowCount = 1;
    } else {
      profile.velocityWindowCount++;
    }

    this.updateSuspiciousFlag(profile);
  }

  /**
   * NEW: Accumulate prop change details into the profile.
   */
  private accumulatePropChanges(
    profile: ComponentProfile,
    changes: PropChangeDetail[]
  ): void {
    const stats = profile.propChangeStats;

    for (const change of changes) {
      if (
        stats.changeCount.size >= RENDER_THRESHOLDS.MAX_PROP_KEYS_TO_TRACK &&
        !stats.changeCount.has(change.key)
      ) {
        continue;
      }

      stats.changeCount.set(
        change.key,
        (stats.changeCount.get(change.key) ?? 0) + 1
      );

      if (change.referenceOnly) {
        stats.referenceOnlyCount.set(
          change.key,
          (stats.referenceOnlyCount.get(change.key) ?? 0) + 1
        );
      }
    }

    if (
      profile.propChangeDelta.length <
      RENDER_THRESHOLDS.MAX_PROP_CHANGES_PER_SNAPSHOT
    ) {
      profile.propChangeDelta.push(
        ...changes.slice(
          0,
          RENDER_THRESHOLDS.MAX_PROP_CHANGES_PER_SNAPSHOT -
            profile.propChangeDelta.length
        )
      );
    }
  }

  /**
   *  Build prop change snapshot for emission.
   */
  private buildPropChangeSnapshot(
    profile: ComponentProfile
  ): PropChangeSnapshot | undefined {
    const stats = profile.propChangeStats;

    if (stats.changeCount.size === 0) {
      return undefined;
    }

    const sorted = Array.from(stats.changeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, RENDER_THRESHOLDS.TOP_PROPS_TO_REPORT);

    const topChangedProps = sorted.map(([key, count]) => {
      const refOnlyCount = stats.referenceOnlyCount.get(key) ?? 0;
      return {
        key,
        count,
        referenceOnlyPercent:
          count > 0 ? Math.round((refOnlyCount / count) * 100) : 0,
      };
    });

    return { topChangedProps };
  }

  private updateSuspiciousFlag(profile: ComponentProfile): void {
    const velocity = this.calculateVelocity(profile);

    if (velocity > RENDER_THRESHOLDS.HOT_VELOCITY) {
      profile.isSuspicious = true;
      profile.suspiciousReason = `High render velocity: ${velocity.toFixed(
        1
      )}/sec`;
    } else if (profile.totalRenders > RENDER_THRESHOLDS.HIGH_RENDER_COUNT) {
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

    if (windowAge > RENDER_THRESHOLDS.VELOCITY_WINDOW_MS) {
      return 0;
    }

    const effectiveWindowMs = Math.max(windowAge, 100);
    return (profile.velocityWindowCount / effectiveWindowMs) * 1000;
  }

  /**
   * Emits a snapshot of all profiles with deltas.
   */
  private emitSnapshot(): void {
    const now = Date.now();
    const snapshots: ComponentProfileSnapshot[] = [];

    for (const profile of this.profiles.values()) {
      const rendersDelta =
        profile.totalRenders - profile.lastEmittedRenderCount;

      if (
        rendersDelta < RENDER_THRESHOLDS.MIN_DELTA_TO_EMIT &&
        !profile.isSuspicious
      ) {
        continue;
      }

      const velocity = this.calculateVelocity(profile);
      const isMount = profile.lastEmittedRenderCount === 0;
      const renderCostDelta =
        profile.totalRenderCost - profile.lastEmittedRenderCost;

      const propChanges = this.buildPropChangeSnapshot(profile);

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
        propChanges,
      });

      profile.lastEmittedRenderCount = profile.totalRenders;
      profile.lastEmittedRenderCost = profile.totalRenderCost;
      profile.lastEmitTime = now;
      profile.causeDeltaBreakdown = createEmptyCauseBreakdown();
      profile.propChangeDelta = [];
    }

    for (const profile of this.pendingUnmounts) {
      const propChanges = this.buildPropChangeSnapshot(profile);

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
        propChanges,
      });
    }
    this.pendingUnmounts = [];

    if (snapshots.length === 0) return;

    const message: LimelightMessage = {
      phase: "RENDER_SNAPSHOT",
      sessionId: this.getSessionId(),
      timestamp: now,
      profiles: snapshots,
    };

    this.sendMessage(message);
  }

  /**
   *  Now returns prop change details when applicable.
   */
  private inferRenderCause(
    fiber: MinimalFiber,
    parentComponentId: string | null
  ): {
    type: RenderCauseType;
    confidence: RenderConfidence;
    triggerId?: string;
    propChanges?: PropChangeDetail[]; // NEW
  } {
    const alternate = fiber.alternate;

    if (!alternate) {
      return {
        type: RenderCauseType.UNKNOWN,
        confidence: RenderConfidence.HIGH,
      };
    }

    if (
      parentComponentId &&
      this.currentCommitComponents.has(parentComponentId)
    ) {
      const prevProps = alternate.memoizedProps;
      const nextProps = fiber.memoizedProps;
      const propsChanged = prevProps !== nextProps;

      if (propsChanged) {
        const propChanges = this.diffProps(prevProps, nextProps);

        return {
          type: RenderCauseType.PROPS_CHANGE,
          confidence: RenderConfidence.MEDIUM,
          triggerId: parentComponentId,
          propChanges,
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
   * Diff props to find which keys changed and whether it's reference-only.
   * This is the key insight generator.
   */
  private diffProps(
    prevProps: Record<string, any> | null,
    nextProps: Record<string, any> | null
  ): PropChangeDetail[] {
    if (!prevProps || !nextProps) {
      return [];
    }

    const changes: PropChangeDetail[] = [];
    const allKeys = new Set([
      ...Object.keys(prevProps),
      ...Object.keys(nextProps),
    ]);

    const skipKeys = new Set(["children", "key", "ref"]);

    for (const key of allKeys) {
      if (skipKeys.has(key)) continue;

      const prevValue = prevProps[key];
      const nextValue = nextProps[key];

      if (prevValue === nextValue) {
        continue;
      }

      const referenceOnly = this.isShallowEqual(prevValue, nextValue);

      changes.push({ key, referenceOnly });

      if (changes.length >= 10) {
        break;
      }
    }

    return changes;
  }

  /**
   *  Shallow equality check to determine if a prop is reference-only change.
   * We only go one level deep to keep it fast.
   */
  private isShallowEqual(a: any, b: any): boolean {
    // Same reference (already checked, but for safety)
    if (a === b) return true;

    // Different types
    if (typeof a !== typeof b) return false;

    // Null checks
    if (a === null || b === null) return false;

    // Functions - can't easily compare, assume different
    // But if they're both functions, it's likely a reference-only change
    // (same callback recreated)
    if (typeof a === "function" && typeof b === "function") {
      // We can't compare function bodies easily, but this is almost always
      // a reference-only change (inline callback recreated)
      return true; // Treat as reference-only
    }

    // Arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    if (typeof a === "object" && typeof b === "object") {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (a[key] !== b[key]) return false;
      }
      return true;
    }

    return a === b;
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

    this.emitSnapshot();

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

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
