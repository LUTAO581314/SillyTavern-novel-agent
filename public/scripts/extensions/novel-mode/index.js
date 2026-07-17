import { getRequestHeaders, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { NovelModeLifecycle } from './lifecycle.js';

const MODULE_NAME = 'novel-mode';
const HEALTH_ENDPOINT = '/api/plugins/novel-runtime-bridge/health';
let healthController = null;

function loadSettings() {
    if (!extension_settings.novel_mode || typeof extension_settings.novel_mode !== 'object') {
        extension_settings.novel_mode = { enabled: false };
    }
    extension_settings.novel_mode.enabled = Boolean(extension_settings.novel_mode.enabled);
    return extension_settings.novel_mode;
}

function setStatus(value) {
    const status = document.getElementById('novel_mode_runtime_status');
    if (status) {
        status.textContent = value;
    }
}

async function refreshBridgeHealth() {
    const settings = loadSettings();
    if (!settings.enabled) {
        setStatus('Disabled');
        return;
    }

    healthController?.abort();
    healthController = new AbortController();
    setStatus('Checking');

    try {
        const response = await fetch(HEALTH_ENDPOINT, {
            method: 'GET',
            headers: getRequestHeaders(),
            signal: healthController.signal,
        });
        if (!response.ok) {
            throw new Error(`Runtime bridge health returned ${response.status}.`);
        }
        const payload = await response.json();
        const validShell = payload?.service === 'novel-runtime-bridge'
            && payload?.status === 'shell'
            && payload?.canonicalWrite === false;
        if (!validShell) {
            throw new Error('Runtime bridge returned an incompatible health response.');
        }
        setStatus(payload.runtimeConfigured ? 'Configured' : 'Not configured');
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('Novel Mode Runtime bridge is unavailable.', error);
            setStatus('Unavailable');
        }
    }
}

async function mount() {
    const existing = document.getElementById('novel_mode_settings');
    if (existing) {
        return existing;
    }

    const target = document.getElementById('extensions_settings2');
    if (!target) {
        throw new Error('Novel Mode settings target is unavailable.');
    }

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    target.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById('novel_mode_settings');
    const enabled = document.getElementById('novel_mode_enabled');
    const refresh = document.getElementById('novel_mode_refresh');
    if (!root || !(enabled instanceof HTMLInputElement) || !(refresh instanceof HTMLButtonElement)) {
        root?.remove();
        throw new Error('Novel Mode settings shell failed to mount.');
    }

    const settings = loadSettings();
    enabled.checked = settings.enabled;
    refresh.disabled = !settings.enabled;
    enabled.addEventListener('change', async () => {
        settings.enabled = enabled.checked;
        refresh.disabled = !settings.enabled;
        saveSettingsDebounced();
        await refreshBridgeHealth();
    });
    refresh.addEventListener('click', refreshBridgeHealth);
    await refreshBridgeHealth();
    return root;
}

async function unmount(root) {
    healthController?.abort();
    healthController = null;
    root?.remove();
}

const lifecycle = new NovelModeLifecycle({ mount, unmount });

export async function init() {
    return lifecycle.activate();
}

export async function enable() {
    return lifecycle.activate();
}

export async function disable() {
    return lifecycle.deactivate();
}
