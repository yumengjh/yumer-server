export class BatchOperationError extends Error {
  constructor(
    message: string,
    public readonly diagnosticCode?: string,
  ) {
    super(message);
    this.name = "BatchOperationError";
  }
}
