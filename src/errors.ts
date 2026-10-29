/**
 * Stable error categories for callers that need to distinguish failure types:
 * invalid config/template data, load failures, path safety, input validation,
 * image decoding, output collisions, and filesystem I/O.
 */
export type FastifestErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_LOAD_FAILED"
  | "TEMPLATE_INVALID"
  | "TEMPLATE_LOAD_FAILED"
  | "TEMPLATE_MISSING"
  | "PATH_INVALID"
  | "UNSAFE_PATH"
  | "INPUT_INVALID"
  | "INPUT_LIMIT"
  | "IMAGE_INVALID"
  | "OUTPUT_CONFLICT"
  | "IO_FAILED";

/**
 * Error raised for expected configuration, template, path, input, image, or I/O failures.
 * Check `code` for a stable machine-readable category; `cause` retains the underlying error.
 */
export class FastifestError extends Error {
  /** Stable category identifying the kind of failure. */
  public readonly code: FastifestErrorCode;
  /** Original underlying error, when one was provided. */
  public override readonly cause: unknown;

  /**
   * @param code - Stable error category.
   * @param message - Human-readable diagnostic suitable for display or logs.
   * @param cause - Optional underlying error or other diagnostic value.
   */
  public constructor(
    code: FastifestErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FastifestError";
    this.code = code;
    this.cause = cause;
  }
}
