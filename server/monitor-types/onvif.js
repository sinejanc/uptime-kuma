const { MonitorType } = require("./monitor-type");
const { probeDeviceIdentity } = require("../modules/device-identity");
const { log, UP } = require("../../src/util");

/**
 * Parse a monitor URL and ensure it points at an ONVIF device service path.
 * @param {string} rawUrl Raw URL string from the monitor configuration
 * @returns {{normalizedUrl: string, hostname: string, protocol: string, port: number|undefined, path: string}|null} Parsed URL details or null when invalid
 */
function parseMonitorUrl(rawUrl) {
    if (!rawUrl || rawUrl === "http://" || rawUrl === "https://") {
        return null;
    }

    try {
        const parsed = new URL(rawUrl);
        const result = {
            normalizedUrl: parsed.toString(),
            hostname: parsed.hostname,
            protocol: parsed.protocol.replace(":", ""),
            port: parsed.port ? Number(parsed.port) : undefined,
            path: parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/onvif/device_service",
        };

        // Ensure the URL includes the ONVIF service path.
        if (!parsed.pathname || parsed.pathname === "/") {
            parsed.pathname = "/onvif/device_service";
            parsed.search = "";
            parsed.hash = "";
            result.normalizedUrl = parsed.toString();
        }

        return result;
    } catch (error) {
        log.warn("onvif-monitor", `Failed to parse ONVIF URL '${rawUrl}': ${error.message}`);
        return null;
    }
}

/**
 * Build a device identity probe payload from a monitor record.
 * @param {import("../model/monitor") } monitor Monitor bean
 * @returns {object} Payload for the device identity module
 */
function buildProbePayload(monitor) {
    const payload = {
        hostname: monitor.hostname || undefined,
        port: monitor.port || undefined,
        username: monitor.basic_auth_user || undefined,
        password: monitor.basic_auth_pass || undefined,
    };

    const parsed = parseMonitorUrl(monitor.url);

    if (parsed) {
        payload.url = parsed.normalizedUrl;
        payload.onvifPath = parsed.path;
        payload.protocol = parsed.protocol;

        if (!payload.hostname) {
            payload.hostname = parsed.hostname;
        }

        if (!payload.port) {
            payload.port = parsed.port || (parsed.protocol === "https" ? 443 : 80);
        }
    }

    if (!payload.onvifPath) {
        payload.onvifPath = "/onvif/device_service";
    }

    const timeoutSeconds = Number(monitor.timeout);
    if (timeoutSeconds && timeoutSeconds > 0) {
        payload.timeout = timeoutSeconds * 1000;
    }

    return payload;
}

class OnvifMonitorType extends MonitorType {
    name = "onvif";

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat) {
        const payload = buildProbePayload(monitor);
        const summaryParts = [];

        try {
            const identity = await probeDeviceIdentity(payload);

            if (identity.model) {
                summaryParts.push(identity.model);
            }

            if (identity.manufacturer) {
                summaryParts.push(identity.manufacturer);
            }

            if (!summaryParts.length) {
                summaryParts.push("ONVIF reachable");
            }

            heartbeat.status = UP;
            heartbeat.msg = summaryParts.join(" – ");
            heartbeat.meta = {
                deviceIdentity: identity,
            };
        } catch (error) {
            if (error?.attempts?.length) {
                heartbeat.meta = {
                    deviceIdentityAttempts: error.attempts,
                };
            }

            throw error;
        }
    }
}

module.exports = {
    OnvifMonitorType,
};
