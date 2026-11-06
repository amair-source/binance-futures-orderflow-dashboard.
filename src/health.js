import http from 'node:http';

export function startHealthServer(port, getInfo) {
  if (!port) return null;
  const server = http.createServer((request, response) => {
    if (request.url === '/' || request.url === '/health') {
      const body = {
        ok: true,
        service: 'kronos-apex',
        uptimeSeconds: Math.round(process.uptime()),
        ...getInfo(),
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  server.listen(port, () => {
    console.log(`[health] listening on port ${port}`);
  });
  return server;
}
