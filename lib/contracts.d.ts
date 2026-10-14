/** Stable image extension contracts. Runtime validation lives in model-registry. */
export type ImageMode = "generate" | "edit";
export type ImageParameterRule = {
  type: "boolean" | "integer" | "string";
  wire: string;
  cli?: string;
  default?: boolean | number | string;
  min?: number;
  max?: number;
  enum?: (boolean | number | string)[];
};
export interface ImageRequest {
  schema: "art/image-request-v1";
  api: string;
  adapter: string;
  contractHash: string;
  module: ImageMode;
  model: string;
  prompt: string;
  negativePrompt: string;
  images: string[];
  transport: {
    adapter: string;
    version: number;
    mode: string;
    path?: string;
    timeoutMilliseconds?: number;
  };
  inputPolicy?: {
    maxBytes: number;
    formats: string[];
    minAxis?: number;
    maxAxis?: number;
    minRatio?: number;
    maxRatio?: number;
    alpha?: boolean;
  };
  parameters: Record<string, boolean | number | string>;
  size: string;
  seed: number;
  count: number;
  adjustments: { parameter: string; action: string; message: string }[];
}
export interface RemoteReceipt {
  schema: "art/remote-receipt-v1";
  adapter: string;
  adapterVersion: number;
  requestHash: string;
  baseUrl: string;
  submittedAt: string;
  state: "dispatching" | "accepted" | "completed" | "failed" | "cancelled";
  taskId?: string;
  urls?: string[];
  message?: string;
}
export type RemoteTransition = Pick<RemoteReceipt, "state"> &
  Partial<Pick<RemoteReceipt, "taskId" | "urls" | "message">>;
export interface ImageAdapter {
  id: string;
  label?: string;
  version: number;
  cancellation: "unsupported" | "supported";
  prepare(request: ImageRequest, context: object): Promise<object>;
  submit(request: ImageRequest, context: object): Promise<RemoteTransition>;
  query(receipt: RemoteReceipt, context: object): Promise<RemoteTransition>;
  preview?(request: ImageRequest): object;
}
