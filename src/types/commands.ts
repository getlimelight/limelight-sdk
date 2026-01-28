export enum CommandType {
  CLEAR_RENDERS = "CLEAR_RENDERS",
  ACK = "ACK",
}

export interface BaseCommand {
  type: CommandType;
  id?: string;
}

export interface ClearRendersCommand extends BaseCommand {
  type: CommandType.CLEAR_RENDERS;
}

export type Command = ClearRendersCommand;

export interface CommandAckEvent {
  phase: CommandType.ACK;
  commandId: string;
  type: CommandType;
  success: boolean;
}
