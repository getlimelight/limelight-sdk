import type { IncomingMessage, ServerResponse } from "http";
import { LimelightConfig, LimelightMessage } from "@/types";
import { captureRequest, MiddlewareOptions } from "./httpMiddleware";
import { getTraceContext } from "@/limelight/context";

type NextApiHandler = (
  req: IncomingMessage & { body?: unknown; query?: Record<string, unknown> },
  res: ServerResponse,
) => void | Promise<void>;

/**
 * Wraps a Next.js Pages API route handler with Limelight request/response capture.
 *
 * NOTE: This works with Next.js Pages Router API routes (`pages/api/`)
 * which use the Node.js `(req, res)` signature. It does NOT work with
 * App Router route handlers (`app/api/`) which use the Web Standard
 * `Request`/`Response` objects. App Router support is planned for a future release.
 *
 * @example
 * ```ts
 * // pages/api/users.ts
 * import { Limelight } from '@getlimelight/sdk';
 *
 * export default Limelight.withLimelight((req, res) => {
 *   res.json({ ok: true });
 * });
 * ```
 *
 * @param sendMessage Function to send Limelight messages to the server
 * @param getSessionId Function to retrieve the current Limelight session ID
 * @param getConfig Function to retrieve the current Limelight configuration
 * @param options Optional middleware options (e.g. maxBodySize)
 * @returns A function that wraps a Next.js API route handler with Limelight capture
 */
export const createWithLimelight = (
  sendMessage: (message: LimelightMessage) => void,
  getSessionId: () => string,
  getConfig: () => LimelightConfig | null,
  options?: MiddlewareOptions,
) => {
  return (handler: NextApiHandler): NextApiHandler => {
    return (req, res) => {
      captureRequest(req, res, sendMessage, getSessionId, getConfig(), options);

      const traceId = (req as any).limelightTraceId as string | undefined;
      const ctx = getTraceContext();

      if (ctx && traceId) {
        return ctx.run({ traceId }, () => handler(req, res));
      }

      return handler(req, res);
    };
  };
};
