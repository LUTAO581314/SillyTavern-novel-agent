export class NovelModeLifecycle {
    #active = false;
    #mount;
    #resource = null;
    #unmount;

    constructor({ mount, unmount }) {
        if (typeof mount !== 'function' || typeof unmount !== 'function') {
            throw new TypeError('Mengdie lifecycle requires mount and unmount functions.');
        }
        this.#mount = mount;
        this.#unmount = unmount;
    }

    get active() {
        return this.#active;
    }

    async activate() {
        if (this.#active) {
            return this.#resource;
        }
        const resource = await this.#mount();
        this.#resource = resource;
        this.#active = true;
        return resource;
    }

    async deactivate() {
        if (!this.#active) {
            return false;
        }
        const resource = this.#resource;
        this.#active = false;
        this.#resource = null;
        await this.#unmount(resource);
        return true;
    }
}
