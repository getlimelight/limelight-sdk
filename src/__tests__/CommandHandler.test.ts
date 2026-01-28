import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandType } from "@/types/commands";
import { CommandHandler } from "@/limelight/handlers/CommandHandler";

describe("CommandHandler", () => {
  const mockRenderInterceptor = {
    resetProfiles: vi.fn(),
  };

  const mockSendMessage = vi.fn();
  const mockGetConfig = vi.fn();

  let handler: CommandHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ enableInternalLogging: false });

    handler = new CommandHandler(
      { render: mockRenderInterceptor as any },
      mockSendMessage,
      mockGetConfig,
    );
  });

  describe("CLEAR_RENDERS command", () => {
    it("should call resetProfiles on render interceptor", () => {
      handler.handle({ type: CommandType.CLEAR_RENDERS });

      expect(mockRenderInterceptor.resetProfiles).toHaveBeenCalledOnce();
    });

    it("should send acknowledgment when command has an id", () => {
      handler.handle({ type: CommandType.CLEAR_RENDERS, id: "cmd-123" });

      expect(mockSendMessage).toHaveBeenCalledWith({
        phase: CommandType.ACK,
        commandId: "cmd-123",
        type: CommandType.CLEAR_RENDERS,
        success: true,
      });
    });

    it("should not send acknowledgment when command has no id", () => {
      handler.handle({ type: CommandType.CLEAR_RENDERS });

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe("unknown commands", () => {
    it("should log warning for unknown command when logging enabled", () => {
      mockGetConfig.mockReturnValue({ enableInternalLogging: true });
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      handler.handle({ type: "UNKNOWN_COMMAND" as any });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Limelight] Unknown command:",
        "UNKNOWN_COMMAND",
      );

      consoleSpy.mockRestore();
    });

    it("should not log warning when logging disabled", () => {
      mockGetConfig.mockReturnValue({ enableInternalLogging: false });
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      handler.handle({ type: "UNKNOWN_COMMAND" as any });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("logging", () => {
    it("should log received command when logging enabled", () => {
      mockGetConfig.mockReturnValue({ enableInternalLogging: true });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      handler.handle({ type: CommandType.CLEAR_RENDERS });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Limelight] Received command:",
        CommandType.CLEAR_RENDERS,
      );

      consoleSpy.mockRestore();
    });

    it("should not log when logging disabled", () => {
      mockGetConfig.mockReturnValue({ enableInternalLogging: false });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      handler.handle({ type: CommandType.CLEAR_RENDERS });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("null config", () => {
    it("should handle null config gracefully", () => {
      mockGetConfig.mockReturnValue(null);

      expect(() => {
        handler.handle({ type: CommandType.CLEAR_RENDERS });
      }).not.toThrow();

      expect(mockRenderInterceptor.resetProfiles).toHaveBeenCalledOnce();
    });
  });
});
