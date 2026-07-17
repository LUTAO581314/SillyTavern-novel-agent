import { readRuntimeConfig } from './config.js';
import { createPublicHealthPayload } from './health-fixture.js';

export const info = Object.freeze({
    id: 'novel-runtime-bridge',
    name: 'Novel Runtime Bridge',
    description: 'Server-owned bridge boundary for SillyTavern Novel Mode.',
});

let runtimeConfig = readRuntimeConfig({});

export async function init(router, { environment = process.env } = {}) {
    runtimeConfig = readRuntimeConfig(environment);
    router.get('/health', (_request, response) => {
        response.json(createPublicHealthPayload(runtimeConfig));
    });
}

export async function exit() {
    runtimeConfig = readRuntimeConfig({});
}
