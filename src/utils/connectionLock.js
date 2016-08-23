let currentP = Promise.resolve();

export function lock<X>(fn: () => Promise<X>): Promise<X> {
    const res = currentP.then(() => fn());
    currentP = res.catch(() => true);
    return res;
}
