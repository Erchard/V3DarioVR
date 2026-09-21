import sirv from 'sirv';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Only built assets are exposed. Missing routes stay 404; no catch-all HTML fallback. */
export function staticHandler(directory: string) {
  const serve = sirv(directory, {
    etag: true,
    maxAge: 0,
    setHeaders(response, filename) {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      response.setHeader('Permissions-Policy', 'xr-spatial-tracking=(self)');
      response.setHeader(
        'Cache-Control',
        /[\\/]assets[\\/]/.test(filename) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  return (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    serve(request, response, () => {
      response.writeHead(404);
      response.end('Not found');
    });
  };
}
