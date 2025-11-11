const axios = require("axios");
const cheerio = require("cheerio");
const net = require("net");
const https = require("https");
const { log } = require("../../src/util");

const DEVICE_WSDL = "http://www.onvif.org/ver10/device/wsdl";
const MEDIA_WSDL = "http://www.onvif.org/ver10/media/wsdl";
const MEDIA_SCHEMA = "http://www.onvif.org/ver10/schema";

/**
 * Build a SOAP envelope for an ONVIF request.
 * @param {string} body SOAP body content
 * @param {Record<string, string>} extraNamespaces Additional namespaces to include on the envelope element
 * @returns {string} SOAP envelope XML
 */
function buildSoapEnvelope(body, extraNamespaces = {}) {
    const namespaces = [
        "xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\"",
    ];

    for (const [ prefix, uri ] of Object.entries(extraNamespaces)) {
        namespaces.push(`xmlns:${prefix}="${uri}"`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<soap:Envelope ${namespaces.join(" ")}><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

/**
 * Find the first occurrence of a tag regardless of namespace.
 * @param {cheerio.CheerioAPI} $ Cheerio instance
 * @param {string} tagName Tag suffix (without namespace prefix)
 * @returns {string|undefined} Text content if found
 */
function findFirstTag($, tagName) {
    let value;

    $("*").each((_, el) => {
        if (!el.name) {
            return;
        }

        if (el.name === tagName || el.name.endsWith(`:${tagName}`)) {
            const text = $(el).text().trim();
            if (text) {
                value = text;
                return false;
            }
        }

        return undefined;
    });

    return value;
}

/**
 * Find all elements that match a tag suffix regardless of namespace.
 * @param {cheerio.CheerioAPI} $ Cheerio instance
 * @param {string} tagName Tag suffix
 * @returns {cheerio.Element[]} Matching elements
 */
function findAllTags($, tagName) {
    const matches = [];

    $("*").each((_, el) => {
        if (!el.name) {
            return;
        }

        if (el.name === tagName || el.name.endsWith(`:${tagName}`)) {
            matches.push(el);
        }
    });

    return matches;
}

/**
 * Attempt to connect to the provided hostname via SSH and read the banner.
 * @param {object} options Options
 * @param {string} options.hostname Hostname
 * @param {number} options.port SSH port
 * @param {number} options.timeout Connection timeout (ms)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function attemptSSH({ hostname, port, timeout }) {
    if (!hostname) {
        return { success: false };
    }

    return await new Promise((resolve) => {
        const socket = net.createConnection({ host: hostname, port, timeout });
        let settled = false;

        const finish = (result) => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(result);
            }
        };

        socket.once("error", (error) => {
            finish({ success: false, error: `SSH connection failed: ${error.message}` });
        });

        socket.once("timeout", () => {
            finish({ success: false, error: "SSH connection timed out" });
        });

        socket.once("data", (data) => {
            const banner = data.toString("utf8").trim();
            if (banner.startsWith("SSH-")) {
                finish({
                    success: true,
                    data: {
                        type: "network-device",
                        ssh: {
                            banner,
                            port,
                        },
                    },
                });
            } else {
                finish({ success: false, error: "SSH banner not received" });
            }
        });

        socket.once("connect", () => {
            // Immediately end the connection after handshake so that we receive the banner.
            socket.write("\n");
        });
    });
}

/**
 * Attempt to retrieve ONVIF metadata from a device.
 * @param {object} options Options
 * @param {string[]} options.urls Candidate service URLs
 * @param {string|undefined} options.username Username for basic authentication
 * @param {string|undefined} options.password Password for basic authentication
 * @param {number} options.timeout Timeout in milliseconds
 * @returns {Promise<{success: boolean, data?: object, errors?: string[]}>}
 */
async function attemptOnvif({ urls, username, password, timeout }) {
    const errors = [];

    const axiosConfig = {
        headers: {
            "Content-Type": "application/soap+xml; charset=utf-8",
        },
        timeout,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: () => true,
    };

    if (username) {
        axiosConfig.auth = {
            username,
            password: password || "",
        };
    }

    for (const url of urls) {
        try {
            const deviceInfoResponse = await axios.post(url, buildSoapEnvelope("<tds:GetDeviceInformation/>", { tds: DEVICE_WSDL }), axiosConfig);

            if (deviceInfoResponse.status !== 200) {
                errors.push(`${url}: HTTP ${deviceInfoResponse.status}`);
                continue;
            }

            const $deviceInfo = cheerio.load(deviceInfoResponse.data, { xmlMode: true });
            const manufacturer = findFirstTag($deviceInfo, "Manufacturer");

            if (!manufacturer) {
                errors.push(`${url}: Missing manufacturer in response`);
                continue;
            }

            const model = findFirstTag($deviceInfo, "Model");
            const firmwareVersion = findFirstTag($deviceInfo, "FirmwareVersion");
            const serialNumber = findFirstTag($deviceInfo, "SerialNumber");
            const hardwareId = findFirstTag($deviceInfo, "HardwareId");

            const capabilitiesResponse = await axios.post(url, buildSoapEnvelope("<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>", { tds: DEVICE_WSDL }), axiosConfig);

            if (capabilitiesResponse.status !== 200) {
                errors.push(`${url}: HTTP ${capabilitiesResponse.status} (capabilities)`);
                continue;
            }

            const $capabilities = cheerio.load(capabilitiesResponse.data, { xmlMode: true });
            const mediaXAddr = findFirstTag($capabilities, "XAddr");

            let streamUri;
            let profileToken;

            if (mediaXAddr) {
                try {
                    const profilesResponse = await axios.post(mediaXAddr, buildSoapEnvelope("<trt:GetProfiles/>", { trt: MEDIA_WSDL }), axiosConfig);

                    if (profilesResponse.status === 200) {
                        const $profiles = cheerio.load(profilesResponse.data, { xmlMode: true });
                        const profiles = findAllTags($profiles, "Profiles");

                        if (profiles.length > 0) {
                            const firstProfile = profiles[0];
                            profileToken = firstProfile.attribs?.token;

                            if (profileToken) {
                                try {
                                    const streamUriEnvelope = buildSoapEnvelope(
                                        `<trt:GetStreamUri>` +
                                        `<trt:StreamSetup>` +
                                        `<tt:Stream>RTP-Unicast</tt:Stream>` +
                                        `<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>` +
                                        `</trt:StreamSetup>` +
                                        `<trt:ProfileToken>${profileToken}</trt:ProfileToken>` +
                                        `</trt:GetStreamUri>`,
                                        { trt: MEDIA_WSDL, tt: MEDIA_SCHEMA }
                                    );

                                    const streamUriResponse = await axios.post(mediaXAddr, streamUriEnvelope, axiosConfig);

                                    if (streamUriResponse.status === 200) {
                                        const $stream = cheerio.load(streamUriResponse.data, { xmlMode: true });
                                        streamUri = findFirstTag($stream, "Uri");
                                    } else {
                                        errors.push(`${mediaXAddr}: HTTP ${streamUriResponse.status} (stream uri)`);
                                    }
                                } catch (error) {
                                    errors.push(`${mediaXAddr}: ${error.message}`);
                                }
                            }
                        }
                    } else {
                        errors.push(`${mediaXAddr}: HTTP ${profilesResponse.status} (profiles)`);
                    }
                } catch (error) {
                    errors.push(`${mediaXAddr}: ${error.message}`);
                }
            }

            return {
                success: true,
                data: {
                    type: "camera",
                    manufacturer,
                    model,
                    firmwareVersion,
                    serialNumber,
                    hardwareId,
                    onvif: {
                        serviceUrl: url,
                        mediaXAddr,
                        profileToken,
                        streamUri,
                    },
                },
            };
        } catch (error) {
            const message = error.response?.status ? `HTTP ${error.response.status}` : error.message;
            log.debug("device-identity", `ONVIF detection error for ${url}: ${message}`);
            errors.push(`${url}: ${message}`);
        }
    }

    return {
        success: false,
        errors,
    };
}

/**
 * Resolve candidate ONVIF URLs based on the provided payload.
 * @param {object} payload Payload from the client
 * @returns {string[]} Candidate URLs
 */
function resolveCandidateUrls(payload) {
    const urls = new Set();

    if (payload.url) {
        urls.add(payload.url);
    }

    if (payload.hostname) {
        const protocols = payload.protocol ? [ payload.protocol ] : [ "http", "https" ];
        const servicePath = payload.onvifPath || "/onvif/device_service";

        for (const protocol of protocols) {
            const defaultPort = protocol === "https" ? 443 : 80;
            const port = payload.port || defaultPort;
            const authority = port ? `${payload.hostname}:${port}` : payload.hostname;
            urls.add(`${protocol}://${authority}${servicePath}`);
        }
    }

    return Array.from(urls);
}

/**
 * Probe a device to identify its capabilities.
 * @param {object} payload Payload received from the frontend
 * @returns {Promise<object>} Detection result
 */
async function probeDeviceIdentity(payload) {
    const attempts = [];

    if (!payload.hostname && !payload.url) {
        const error = new Error("Hostname or URL required");
        error.attempts = attempts;
        throw error;
    }

    const timeout = Number(payload.timeout) || 8000;
    const candidateUrls = resolveCandidateUrls(payload);

    const onvifResult = await attemptOnvif({
        urls: candidateUrls,
        username: payload.username,
        password: payload.password,
        timeout,
    });

    let identity = null;
    const capabilities = [];
    let onvif = null;

    if (onvifResult.success) {
        identity = onvifResult.data;
        capabilities.push("onvif");
        onvif = onvifResult.data.onvif;
    } else if (onvifResult.errors?.length) {
        attempts.push(...onvifResult.errors);
    }

    const sshPort = Number(payload.sshPort) || Number(payload.port) || 22;
    const sshResult = await attemptSSH({
        hostname: payload.hostname,
        port: sshPort,
        timeout,
    });

    let ssh;

    if (sshResult.success) {
        if (!identity) {
            identity = sshResult.data;
        } else {
            identity = {
                ...identity,
                ssh: sshResult.data.ssh,
            };
        }
        capabilities.push("ssh");
        ssh = sshResult.data.ssh;
    } else if (sshResult.error) {
        attempts.push(sshResult.error);
    }

    if (!identity) {
        const error = new Error(attempts.length ? attempts.join("; ") : "Unable to detect device");
        error.attempts = attempts;
        throw error;
    }

    return {
        type: identity.type || "unknown",
        manufacturer: identity.manufacturer,
        model: identity.model,
        firmwareVersion: identity.firmwareVersion,
        serialNumber: identity.serialNumber,
        hardwareId: identity.hardwareId,
        onvif,
        ssh,
        capabilities,
        attempts,
    };
}

module.exports = {
    probeDeviceIdentity,
};
