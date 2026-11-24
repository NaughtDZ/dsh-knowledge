/**
 * Small HTTP helpers for the dsh-knowledge same-origin API routes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Send a JSON response with no-store caching. */
export declare function sendJson(response: ServerResponse, status: number, body: unknown): void;
/** Send a JSON error response. */
export declare function sendError(response: ServerResponse, status: number, message: string): void;
/** Read and parse a JSON request body; undefined when the body is empty. */
export declare function readJsonBody(request: IncomingMessage): Promise<unknown>;
/** Read a raw (possibly binary) request body. */
export declare function readRawBody(request: IncomingMessage): Promise<Buffer>;
/** Whether a request originates from the page that served it (Origin vs Host). */
export declare function sameOrigin(request: IncomingMessage): boolean;
/** Read the request pathname. */
export declare function pathnameOf(request: IncomingMessage): string;
/** Human-readable error message from an unknown thrown value. */
export declare function errorMessage(error: unknown): string;
/** Parse a body as a record object, or throw. */
export declare function asObject(value: unknown): Record<string, unknown>;
