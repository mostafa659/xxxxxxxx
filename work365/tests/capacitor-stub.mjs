export const Capacitor = { isNativePlatform: () => false };
export const CapacitorHttp = { request: async () => { throw new Error("native stub"); } };
