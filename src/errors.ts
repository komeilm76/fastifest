/** Stable error categories for callers that need to distinguish failure types. */
export type FastifestErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_LOAD_FAILED"
  | "TEMPLATE_INVALID"
  | "TEMPLATE_LOAD_FAILED"
  | "PATH_INVALID"
  | "UNSAFE_PATH"
  | "INPUT_INVALID"
  | "INPUT_LIMIT"
  | "IMAGE_INVALID"
  | "IO_FAILED";

/** Error raised for expected configuration, path, or I/O failures. */
export class FastifestError extends Error {
  public readonly code: FastifestErrorCode;
  public override readonly cause: unknown;

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
