export function requireUnattendedDeliveryAuthorization(authorized: boolean | undefined): void {
  if (!authorized) {
    throw new Error(
      "brown delivery run is non-interactive and requires explicit --yolo authorization; production approval remains a separate human gate",
    );
  }
}

const PRE_WORKSPACE_MUTATING_TOOLS = [
  "write_file",
  "edit_file",
  "multi_edit",
  "apply_patch",
  "create_directory",
  "move_file",
  "delete_file",
  "delete_directory",
  "copy_file",
  "run_command",
  "run_background",
  "stop_job",
  "remember",
  "forget",
  "install_skill",
  "create_skill",
  "add_mcp_server",
] as const;

export function restrictPreWorkspaceTools(tools: { unregister(name: string): unknown }): void {
  for (const name of PRE_WORKSPACE_MUTATING_TOOLS) tools.unregister(name);
}
