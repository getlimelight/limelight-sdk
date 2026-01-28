// limelight/CommandHandler.ts
import { Command, CommandType, LimelightMessage } from "@/types";
import { RenderInterceptor } from "../interceptors";

export class CommandHandler {
  constructor(
    private interceptors: {
      render: RenderInterceptor;
    },
    private sendMessage: (message: LimelightMessage) => void,
    private getConfig: () => { enableInternalLogging?: boolean } | null,
  ) {
    // No-op
  }

  /**
   * Handles an incoming command.
   * @param command - The command to handle
   */
  handle(command: Command): void {
    const config = this.getConfig();

    if (config?.enableInternalLogging) {
      console.log("[Limelight] Received command:", command.type);
    }

    switch (command.type) {
      case CommandType.CLEAR_RENDERS:
        this.interceptors.render.resetProfiles();
        break;

      default:
        if (config?.enableInternalLogging) {
          console.warn("[Limelight] Unknown command:", command.type);
        }
    }

    if (command.id) {
      this.sendMessage({
        phase: CommandType.ACK,
        commandId: command.id,
        type: command.type,
        success: true,
      });
    }
  }
}
