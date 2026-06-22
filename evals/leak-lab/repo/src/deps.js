// Minimal stubs so the fixture is self-consistent (not meant to run).
export const fetch = globalThis.fetch;
export const torAgent = { proxy: 'socks5h://127.0.0.1:9050' };
export const logger = { info() {} };
export const redact = () => '<redacted>';
export const stableDeviceId = () => 'device-stable-123';
export const requestUuid = () => 'req-0000';
