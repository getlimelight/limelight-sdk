/**
 * Render lifecycle phases
 */
export enum RenderPhase {
  MOUNT = "mount",
  UPDATE = "update",
  UNMOUNT = "unmount",
}

/**
 * What triggered this render
 */
export enum RenderCauseType {
  STATE_CHANGE = "state_change",
  PROPS_CHANGE = "props_change",
  CONTEXT_CHANGE = "context_change",
  PARENT_RENDER = "parent_render",
  FORCE_UPDATE = "force_update",
  UNKNOWN = "unknown",
}

/**
 * Confidence level for render cause attribution
 */
export enum RenderConfidence {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  UNKNOWN = "unknown",
}

/**
 * Component type classification
 */
export type ComponentType =
  | "function"
  | "class"
  | "memo"
  | "forwardRef"
  | "unknown";

/**
 * High-resolution timing data
 */
export interface RenderTiming {
  start: number; // performance.now() at render start
  end: number; // performance.now() at render end
}

/**
 * Render cause with confidence scoring
 */
export interface RenderCause {
  type: RenderCauseType;
  confidence: RenderConfidence;
  triggerId?: string; // componentId of the component that triggered this render
}

/**
 * A single component render event
 */
export interface RenderEvent {
  id: string;
  componentId: string;
  componentName: string;
  componentType: ComponentType;
  sessionId: string;
  timestamp: number; // Date.now() for wall-clock correlation
  duration: RenderTiming; // High-res timing
  durationMs: number; // Convenience: duration.end - duration.start
  renderPhase: RenderPhase;
  cause: RenderCause;
  parentComponentId?: string;
  depth?: number;
  transactionId?: string;
  metadata?: {
    batchedCount?: number;
    totalDurationMs?: number;
  };
}

/**
 * Batched render events sent over WebSocket
 */
export interface RenderBatch {
  phase: "RENDER_BATCH";
  sessionId: string;
  timestamp: number;
  events: RenderEvent[];
}

/**
 * Transaction boundary markers (emitted by LimelightProvider)
 */
export interface TransactionEvent {
  phase: "TRANSACTION_START" | "TRANSACTION_END";
  transactionId: string;
  sessionId: string;
  timestamp: number;
  trigger?: string; // "press", "navigation", "network_response", etc.
}

/**
 * Internal: Fiber node shape (minimal subset we care about)
 * Based on React's internal FiberNode structure
 */
export interface MinimalFiber {
  tag: number;
  key: string | null;
  type: any;
  stateNode: any;
  return: MinimalFiber | null; // parent fiber
  child: MinimalFiber | null;
  sibling: MinimalFiber | null;
  alternate: MinimalFiber | null; // previous fiber (for diffing)
  memoizedProps: any;
  memoizedState: any;
  flags: number;
  _debugHookTypes?: string[] | null;
}

/**
 * Internal: React DevTools hook shape
 */
export interface ReactDevToolsHook {
  supportsFiber: boolean;
  inject: (renderer: any) => number;
  onCommitFiberRoot: (
    rendererID: number,
    root: { current: MinimalFiber },
    priorityLevel?: number,
  ) => void;
  onCommitFiberUnmount: (rendererID: number, fiber: MinimalFiber) => void;
  onPostCommitFiberRoot?: (
    rendererID: number,
    root: { current: MinimalFiber },
  ) => void;
}

/**
 * Fiber tags (React internal constants)
 * @see https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactWorkTags.js
 */
export enum FiberTag {
  FunctionComponent = 0,
  ClassComponent = 1,
  IndeterminateComponent = 2,
  HostRoot = 3,
  HostPortal = 4,
  HostComponent = 5,
  HostText = 6,
  Fragment = 7,
  Mode = 8,
  ContextConsumer = 9,
  ContextProvider = 10,
  ForwardRef = 11,
  Profiler = 12,
  SuspenseComponent = 13,
  MemoComponent = 14,
  SimpleMemoComponent = 15,
  LazyComponent = 16,
}

/**
 * Fiber flags for detecting work performed
 * @see https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberFlags.js
 */
export enum FiberFlags {
  NoFlags = 0,
  PerformedWork = 1,
  Placement = 2,
  Update = 4,
  Deletion = 8,
  ChildDeletion = 16,
}

/**
 * Details about which props changed and how.
 * This is the key insight that transforms "props changed" into "onPress changed (same value, new reference)"
 */
export interface PropChangeDetail {
  key: string;
  referenceOnly: boolean; // true = same value, new reference (needs useMemo/useCallback)
}

/**
 * Aggregated prop change stats for a component profile.
 * We track frequency per prop key to identify the most problematic props.
 */
export interface PropChangeStats {
  // How many times each prop key has changed
  changeCount: Map<string, number>;
  // How many of those were reference-only changes
  referenceOnlyCount: Map<string, number>;
}

/**
 * Snapshot of prop change stats sent to desktop.
 */
export interface PropChangeSnapshot {
  // Top props that changed, sorted by frequency
  topChangedProps: {
    key: string;
    count: number;
    referenceOnlyPercent: number; // 0-100
  }[];
}

/**
 * Cumulative profile for a single component.
 * This is the core data structure - we accumulate here, not in event arrays.
 */
export interface ComponentProfile {
  id: string;
  componentId: string;
  componentName: string;
  componentType: ComponentType;

  mountedAt: number;
  unmountedAt?: number;

  totalRenders: number;
  totalRenderCost: number;

  velocityWindowStart: number;
  velocityWindowCount: number;

  causeBreakdown: Record<RenderCauseType, number>;
  causeDeltaBreakdown: Record<RenderCauseType, number>;

  lastEmittedRenderCount: number;
  lastEmittedRenderCost: number;
  lastEmitTime: number;

  parentCounts: Map<string, number>;
  primaryParentId?: string;
  depth: number;

  lastTransactionId?: string;

  isSuspicious: boolean;
  suspiciousReason?: string;

  // NEW: Prop change tracking
  propChangeStats: PropChangeStats;
  // Delta for current snapshot period
  propChangeDelta: PropChangeDetail[];
}

/**
 * Snapshot of component render stats sent to desktop.
 */
export interface RenderSnapshot {
  phase: "RENDER_SNAPSHOT";
  sessionId: string;
  timestamp: number;
  profiles: ComponentProfileSnapshot[];
}

export interface ComponentProfileSnapshot {
  id: string;
  componentId: string;
  componentName: string;
  componentType: ComponentType;

  totalRenders: number;
  totalRenderCost: number;
  avgRenderCost: number;

  rendersDelta: number;
  renderCostDelta: number;

  renderVelocity: number;

  causeBreakdown: Record<RenderCauseType, number>;
  causeDeltaBreakdown: Record<RenderCauseType, number>;

  parentComponentId?: string;
  depth: number;

  lastTransactionId?: string;

  isSuspicious: boolean;
  suspiciousReason?: string;

  renderPhase: RenderPhase;
  mountedAt: number;
  unmountedAt?: number;

  // NEW: Prop change insights
  propChanges?: PropChangeSnapshot;
}
