import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { TransactionEvent } from "@/types/render";
import { LimelightMessage } from "@/types";
import { generateRenderId } from "@/helpers";

/**
 * Transaction context shape
 */
interface TransactionContextValue {
  /** Current active transaction ID, if any */
  transactionId: string | null;
  /** Start a new transaction with optional trigger description */
  startTransaction: (trigger?: string) => string;
  /** End the current transaction */
  endTransaction: () => void;
}

/**
 * Internal context for render interceptor to read transaction ID
 */
interface RenderContextValue {
  getTransactionId: () => string | null;
}

// Contexts
const TransactionContext = createContext<TransactionContextValue | null>(null);
const RenderContext = createContext<RenderContextValue | null>(null);

// Global accessor for render interceptor (avoids hook requirements)
let globalGetTransactionId: (() => string | null) | null = null;

/**
 * Gets the current transaction ID from anywhere (for render interceptor use).
 * Returns null if no provider is mounted or no transaction is active.
 */
export function getCurrentTransactionId(): string | null {
  return globalGetTransactionId?.() ?? null;
}

/**
 * Props for LimelightProvider
 */
interface LimelightProviderProps {
  children: ReactNode;
  /**
   * Optional: Callback to send messages. If not provided, uses internal queue
   * that the SDK will drain when connected.
   */
  sendMessage?: (message: LimelightMessage) => void;
  /**
   * Optional: Session ID getter. If not provided, transactions won't include sessionId.
   */
  getSessionId?: () => string;
  /**
   * Optional: Auto-instrument common triggers (press, navigation).
   * @default true
   */
  autoInstrument?: boolean;
}

/**
 * LimelightProvider - Optional wrapper for improved render tracking accuracy.
 *
 * Provides:
 * - Explicit transaction boundaries
 * - Higher confidence render cause attribution
 * - Context change tracking
 *
 * Usage:
 * ```tsx
 * import { LimelightProvider } from "@getlimelight/sdk/react"
 *
 * <LimelightProvider>
 *   <App />
 * </LimelightProvider>
 * ```
 *
 * The provider causes NO re-renders and has NO required props.
 */
export function LimelightProvider({
  children,
  sendMessage,
  getSessionId,
  autoInstrument = true,
}: LimelightProviderProps) {
  const transactionRef = useRef<{
    id: string | null;
    trigger?: string;
    startTime: number;
  }>({
    id: null,
    startTime: 0,
  });

  const messageQueueRef = useRef<TransactionEvent[]>([]);

  const send = useCallback(
    (event: TransactionEvent) => {
      if (sendMessage) {
        sendMessage(event);
      } else {
        messageQueueRef.current.push(event);
      }
    },
    [sendMessage]
  );

  const getTransactionId = useCallback((): string | null => {
    return transactionRef.current.id;
  }, []);

  const startTransaction = useCallback(
    (trigger?: string): string => {
      if (transactionRef.current.id) {
        endTransactionInternal();
      }

      const id = `tx_${generateRenderId()}`;
      const now = Date.now();

      transactionRef.current = {
        id,
        trigger,
        startTime: now,
      };

      const event: TransactionEvent = {
        phase: "TRANSACTION_START",
        transactionId: id,
        sessionId: getSessionId?.() ?? "",
        timestamp: now,
        trigger,
      };

      send(event);

      scheduleAutoEnd();

      return id;
    },
    [send, getSessionId]
  );

  const endTransactionInternal = () => {
    const { id } = transactionRef.current;

    if (!id) return;

    const event: TransactionEvent = {
      phase: "TRANSACTION_END",
      transactionId: id,
      sessionId: getSessionId?.() ?? "",
      timestamp: Date.now(),
    };

    send(event);

    transactionRef.current = {
      id: null,
      startTime: 0,
    };
  };

  const endTransaction = useCallback(() => {
    endTransactionInternal();
  }, []);

  const autoEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoEndDelay = 100; // ms of idle before auto-ending transaction

  const scheduleAutoEnd = useCallback(() => {
    if (autoEndTimerRef.current) {
      clearTimeout(autoEndTimerRef.current);
    }

    autoEndTimerRef.current = setTimeout(() => {
      endTransactionInternal();
      autoEndTimerRef.current = null;
    }, autoEndDelay);
  }, []);

  const extendTransaction = useCallback(() => {
    if (transactionRef.current.id) {
      scheduleAutoEnd();
    }
  }, [scheduleAutoEnd]);

  useEffect(() => {
    globalGetTransactionId = getTransactionId;

    return () => {
      globalGetTransactionId = null;
      if (autoEndTimerRef.current) {
        clearTimeout(autoEndTimerRef.current);
      }
    };
  }, [getTransactionId]);

  useEffect(() => {
    if (!autoInstrument) return;

    const patchTouchable = () => {
      try {
        const originalAddEventListener = global.addEventListener;

        if (typeof originalAddEventListener === "function") {
          // TODO patch other events like navigation, focus, etc.
        }
      } catch {
        // Silent fail
      }
    };

    patchTouchable();
  }, [autoInstrument, startTransaction]);

  const transactionContextValue = useMemo<TransactionContextValue>(
    () => ({
      transactionId: null,
      startTransaction,
      endTransaction,
    }),
    [startTransaction, endTransaction]
  );

  const renderContextValue = useMemo<RenderContextValue>(
    () => ({
      getTransactionId,
    }),
    [getTransactionId]
  );

  return (
    <TransactionContext.Provider value={transactionContextValue}>
      <RenderContext.Provider value={renderContextValue}>
        {children}
      </RenderContext.Provider>
    </TransactionContext.Provider>
  );
}

/**
 * Hook to access transaction controls.
 * Use this to manually start/end transactions for custom interactions.
 *
 * @example
 * ```tsx
 * const MyButton = () => {
 *   const { startTransaction } = useTransaction();
 *
 *   const handlePress = () => {
 *     startTransaction("button_press");
 *     // ... do work
 *   };
 *
 *   return <Button onPress={handlePress} />;
 * }
 * ```
 */
export const useTransaction = (): TransactionContextValue => {
  const context = useContext(TransactionContext);

  if (!context) {
    // Return no-op implementation if no provider
    return {
      transactionId: null,
      startTransaction: () => "",
      endTransaction: () => {},
    };
  }

  return context;
};

/**
 * HOC to wrap a component with automatic transaction tracking.
 * Starts a transaction on mount, ends on unmount.
 *
 * @example
 * ```tsx
 * const TrackedScreen = withTransaction(MyScreen, "screen_view");
 * ```
 */
export const withTransaction = <P extends object>(
  Component: React.ComponentType<P>,
  trigger: string
): React.FC<P> => {
  return function WrappedComponent(props: P) {
    const { startTransaction, endTransaction } = useTransaction();

    useEffect(() => {
      startTransaction(trigger);
      return () => endTransaction();
    }, []);

    return <Component {...props} />;
  };
};

/**
 * Hook that automatically wraps a callback in a transaction.
 *
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const handlePress = useTrackedCallback(
 *     () => {
 *       // do work
 *     },
 *     "button_press"
 *   );
 *
 *   return <Button onPress={handlePress} />;
 * }
 * ```
 */
export const useTrackedCallback = <T extends (...args: any[]) => any>(
  callback: T,
  trigger: string,
  deps: React.DependencyList = []
): T => {
  const { startTransaction } = useTransaction();

  return useCallback(
    ((...args: Parameters<T>) => {
      startTransaction(trigger);
      return callback(...args);
    }) as T,
    [startTransaction, trigger, ...deps]
  );
};

// Export context for advanced use cases
export { TransactionContext, RenderContext };
