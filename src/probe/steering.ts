/**
 * Steering module — translates dashboard steering actions to AWOC stdin strings.
 */

/**
 * Build an AWOC stdin command string from a steering action.
 * Returns the string to write to the child process stdin, or null if invalid.
 */
export function buildSteeringCommand(
  action: "stoprun" | "steer",
  content?: string,
): string | null {
  if (!content || content.trim().length === 0) return null;

  switch (action) {
    case "stoprun":
      return `/stoprun ${content.trim()}\n`;
    case "steer":
      return `/steer ${content.trim()}\n`;
    default:
      return null;
  }
}
