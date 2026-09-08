/**
 * Same-origin HTTP API for dsh-knowledge. Registers a single `/knowledge`
 * prefix route on the host web server and dispatches REST sub-routes to the
 * engine. Writes are same-origin-only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KnowledgeEngine } from './core/engine.ts';
/** Structural slice of the host web server route-registration surface. */
interface WebServerLike {
    register(route: {
        kind: string;
        path: string;
        handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
    }): () => void;
}
/**
 * Mount the knowledge API routes on the web server.
 * @returns a disposer removing the routes, or undefined when no web server.
 */
export declare function mountKnowledgeRoutes(webServer: WebServerLike | undefined, engine: KnowledgeEngine): (() => void) | undefined;
export {};
