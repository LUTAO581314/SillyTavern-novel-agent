import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.NOVEL_RUNTIME_FIXTURE_PORT || 8787);

function json(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer fixture-runtime-token') {
        return json(response, 401, {
            schemaVersion: 1,
            ok: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Fixture credential missing.',
                retryable: false,
                correlationId: 'fixture-auth',
            },
        });
    }
    if (request.method === 'GET' && request.url === '/api/health') {
        return json(response, 200, { ok: true, service: 'novel-runtime' });
    }
    if (request.method === 'GET' && request.url === '/api/v1/turns/turn-recovery/snapshot') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: {
                turnId: 'turn-recovery',
                lastEventId: 'event-2',
                seq: 2,
                events: [
                    {
                        schema_version: 1,
                        event_id: 'event-0',
                        turn_id: 'turn-recovery',
                        seq: 0,
                        audience: 'author',
                        render: {
                            schemaVersion: 1,
                            type: 'prose.delta',
                            payload: {
                                blockId: 'block-1',
                                delta: 'Recovered committed passage.',
                                provisional: true,
                            },
                        },
                    },
                    {
                        schema_version: 1,
                        event_id: 'event-1',
                        turn_id: 'turn-recovery',
                        seq: 1,
                        audience: 'author',
                        render: {
                            schemaVersion: 1,
                            type: 'turn.committed',
                            payload: {
                                commitId: 'commit-restored',
                                committedAt: '2026-07-17T00:00:00.000Z',
                            },
                        },
                    },
                ],
            },
        });
    }
    return json(response, 404, {
        schemaVersion: 1,
        ok: false,
        error: {
            code: 'NOT_FOUND',
            message: 'Fixture route not found.',
            retryable: false,
            correlationId: 'fixture-not-found',
        },
    });
});

server.listen(port, host, () => {
    console.log(`Novel Runtime snapshot fixture listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
