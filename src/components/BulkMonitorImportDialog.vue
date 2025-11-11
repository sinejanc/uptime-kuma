<template>
    <div ref="modal" class="modal fade bulk-import-dialog" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">{{ $t("bulkImportTitle") }}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" :disabled="processing" />
                </div>
                <div class="modal-body">
                    <div class="mb-3">
                        <label for="bulk-import-file" class="form-label">{{ $t("bulkImportFileLabel") }}</label>
                        <input
                            id="bulk-import-file"
                            ref="fileInput"
                            class="form-control"
                            type="file"
                            accept=".txt"
                            :disabled="processing"
                            @change="onFileChange"
                        >
                        <div class="form-text">{{ $t("bulkImportFileHelp") }}</div>
                    </div>

                    <div class="mb-3">
                        <label for="bulk-import-text" class="form-label">{{ $t("bulkImportPreviewLabel") }}</label>
                        <textarea
                            id="bulk-import-text"
                            v-model="rawText"
                            class="form-control"
                            rows="6"
                            :disabled="processing"
                        ></textarea>
                        <div class="form-text">{{ $t("bulkImportFormatExample") }}</div>
                    </div>

                    <div v-if="parseErrors.length" class="alert alert-danger" role="alert">
                        <p class="mb-2">{{ $t("bulkImportParseErrors") }}</p>
                        <ul class="mb-0 ps-3">
                            <li v-for="error in parseErrors" :key="`parse-error-${error.line}`">
                                {{ $t("bulkImportErrorLine", [ error.line, error.message ]) }}
                            </li>
                        </ul>
                    </div>

                    <div v-if="entries.length" class="table-responsive mb-3">
                        <table class="table table-sm align-middle mb-0">
                            <thead>
                                <tr>
                                    <th scope="col">{{ $t("bulkImportColumnLine") }}</th>
                                    <th scope="col">{{ $t("bulkImportColumnType") }}</th>
                                    <th scope="col">{{ $t("bulkImportColumnName") }}</th>
                                    <th scope="col">{{ $t("bulkImportColumnTarget") }}</th>
                                    <th scope="col">{{ $t("bulkImportColumnStatus") }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="entry in entries" :key="`entry-${entry.line}`">
                                    <td>{{ entry.line }}</td>
                                    <td>{{ entry.summary.type }}</td>
                                    <td>{{ entry.summary.name }}</td>
                                    <td>{{ entry.summary.target }}</td>
                                    <td>
                                        <span v-if="processing && !resultLookup[entry.line]" class="text-muted">
                                            <i class="fas fa-spinner fa-spin"></i>
                                        </span>
                                        <span
                                            v-else-if="resultLookup[entry.line]"
                                            :class="resultLookup[entry.line].success ? 'text-success' : 'text-danger'"
                                        >
                                            <font-awesome-icon
                                                :icon="resultLookup[entry.line].success ? 'check-circle' : 'times-circle'"
                                                class="me-1"
                                            />
                                            {{ resultLookup[entry.line].message }}
                                        </span>
                                        <span v-else class="text-muted">{{ $t("bulkImportPending") }}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div v-if="resultsSummary" class="alert" :class="resultsSummary.failed ? 'alert-warning' : 'alert-success'">
                        {{ $t("bulkImportSummary", [ resultsSummary.success, resultsSummary.total ]) }}
                    </div>

                    <div v-else-if="!entries.length" class="text-muted">
                        {{ $t("bulkImportEmptyMessage") }}
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" :disabled="processing">
                        {{ $t("Cancel") }}
                    </button>
                    <button
                        type="button"
                        class="btn btn-primary"
                        :disabled="!canImport || processing"
                        @click="importMonitors"
                    >
                        <i v-if="processing" class="fas fa-spinner fa-spin me-1"></i>
                        {{ $t("bulkImportAction") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";
import { useToast } from "vue-toastification";
import { createMonitorDefaults } from "../util/monitor-defaults";

const toast = useToast();

export default {
    name: "BulkMonitorImportDialog",
    data() {
        return {
            modal: null,
            rawText: "",
            entries: [],
            parseErrors: [],
            processing: false,
            resultLookup: {},
        };
    },
    computed: {
        canImport() {
            return this.entries.length > 0 && this.parseErrors.length === 0 && !this.processing;
        },
        allResultsReceived() {
            if (!this.entries.length) {
                return false;
            }
            return this.entries.every((entry) => Boolean(this.resultLookup[entry.line]));
        },
        resultsSummary() {
            if (!this.allResultsReceived) {
                return null;
            }
            const total = this.entries.length;
            let success = 0;
            for (const entry of this.entries) {
                if (this.resultLookup[entry.line]?.success) {
                    success++;
                }
            }
            const failed = total - success;
            return {
                total,
                success,
                failed,
            };
        },
    },
    watch: {
        rawText() {
            this.parseEntries();
        },
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal, {
            backdrop: "static",
            keyboard: false,
        });
        this.$refs.modal.addEventListener("hidden.bs.modal", this.onHidden);
    },
    beforeUnmount() {
        if (this.modal) {
            try {
                this.modal.hide();
            } catch (error) {
                console.warn("Failed to hide modal", error);
            }
        }
        if (this.$refs.modal) {
            this.$refs.modal.removeEventListener("hidden.bs.modal", this.onHidden);
        }
    },
    methods: {
        show() {
            this.resetState();
            this.modal.show();
        },
        onHidden() {
            this.resetState();
        },
        resetState() {
            this.rawText = "";
            this.entries = [];
            this.parseErrors = [];
            this.processing = false;
            this.resultLookup = {};
            if (this.$refs.fileInput) {
                this.$refs.fileInput.value = "";
            }
        },
        onFileChange(event) {
            const file = event.target.files?.[0];
            if (!file) {
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                this.rawText = reader.result?.toString() || "";
            };
            reader.onerror = () => {
                toast.error(this.$t("bulkImportFileReadError"));
            };
            reader.readAsText(file);
            event.target.value = "";
        },
        parseEntries() {
            if (this.processing) {
                return;
            }

            const text = this.rawText || "";
            const lines = text.split(/\r?\n/);
            const entries = [];
            const errors = [];

            lines.forEach((line, index) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) {
                    return;
                }

                const parts = trimmed.split(",").map((part) => part.trim());

                if (parts.length < 3) {
                    errors.push({
                        line: index + 1,
                        message: this.$t("bulkImportErrorMissingColumns"),
                    });
                    return;
                }

                const result = this.buildMonitorPayload(parts);

                if (result.ok) {
                    entries.push({
                        line: index + 1,
                        summary: result.summary,
                        monitor: result.monitor,
                    });
                } else {
                    errors.push({
                        line: index + 1,
                        message: result.error,
                    });
                }
            });

            this.entries = entries;
            this.parseErrors = errors;
            this.resultLookup = {};
        },
        buildMonitorPayload(parts) {
            const [ rawType, rawName, rawTarget, rawExtra, rawExtra2 ] = parts;
            const type = (rawType || "").toLowerCase();
            const normalizedType = this.normalizeMonitorType(type);
            const summaryType = rawType ? rawType.trim() : normalizedType;

            if (!type) {
                return {
                    ok: false,
                    error: this.$t("bulkImportErrorMissingType"),
                };
            }

            const target = (rawTarget || "").trim();
            if (!target) {
                return {
                    ok: false,
                    error: this.$t("bulkImportErrorMissingTarget"),
                };
            }

            const monitor = this.createMonitorBase();
            let summaryTarget = target;

            switch (normalizedType) {
                case "ping":
                case "tailscale-ping":
                    monitor.type = normalizedType;
                    monitor.hostname = target;
                    delete monitor.url;
                    break;
                case "port": {
                    monitor.type = normalizedType;
                    let host = target;
                    let port = rawExtra ? Number(rawExtra) : null;

                    if (!port || Number.isNaN(port)) {
                        const bracketMatch = host.match(/^\[(.*)]:(\d+)$/);
                        if (bracketMatch) {
                            host = bracketMatch[1];
                            port = Number(bracketMatch[2]);
                        } else {
                            const colonCount = (host.match(/:/g) || []).length;
                            if (colonCount === 1 && host.includes(":")) {
                                const lastColon = host.lastIndexOf(":");
                                const possiblePort = Number(host.slice(lastColon + 1));
                                if (!Number.isNaN(possiblePort)) {
                                    port = possiblePort;
                                    host = host.slice(0, lastColon);
                                }
                            }
                        }
                    }

                    if (!port || Number.isNaN(port) || port < 1 || port > 65535) {
                        return {
                            ok: false,
                            error: this.$t("bulkImportErrorInvalidPort"),
                        };
                    }

                    host = host.replace(/^\[(.*)]$/, "$1").trim();

                    monitor.hostname = host;
                    monitor.port = port;
                    delete monitor.url;
                    const needsBrackets = host.includes(":");
                    const displayHost = needsBrackets ? `[${host}]` : host;
                    summaryTarget = `${displayHost}:${port}`;
                    break;
                }
                case "http":
                case "keyword":
                case "json-query":
                case "real-browser": {
                    monitor.type = normalizedType;
                    let url = target;
                    url = this.ensureUrlWithProtocol(url, type);
                    monitor.url = url;
                    delete monitor.hostname;
                    summaryTarget = url;

                    if (normalizedType === "keyword") {
                        const keyword = (rawExtra || "").trim();
                        if (!keyword) {
                            return {
                                ok: false,
                                error: this.$t("bulkImportErrorMissingKeyword"),
                            };
                        }
                        monitor.keyword = keyword;
                    }

                    if (normalizedType === "json-query") {
                        const jsonPath = (rawExtra || "").trim();
                        if (!jsonPath) {
                            return {
                                ok: false,
                                error: this.$t("bulkImportErrorMissingJsonPath"),
                            };
                        }
                        monitor.jsonPath = jsonPath;
                        if (rawExtra2) {
                            monitor.expectedValue = rawExtra2;
                        }
                    }
                    break;
                }
                default:
                    return {
                        ok: false,
                        error: this.$t("bulkImportErrorUnsupportedType", [ rawType ]),
                    };
            }

            monitor.name = (rawName && rawName.trim()) || summaryTarget;
            monitor.active = true;

            return {
                ok: true,
                monitor,
                summary: {
                    type: summaryType || monitor.type,
                    name: monitor.name,
                    target: summaryTarget,
                },
            };
        },
        normalizeMonitorType(type) {
            switch (type) {
                case "https":
                    return "http";
                case "icmp":
                    return "ping";
                case "camera":
                    return "ping";
                case "tcp":
                    return "port";
                default:
                    return type;
            }
        },
        ensureUrlWithProtocol(rawUrl, originalType) {
            const trimmedUrl = rawUrl || "";

            if (!trimmedUrl) {
                return trimmedUrl;
            }

            const desiredScheme = originalType === "https" ? "https" : null;
            const hasScheme = trimmedUrl.includes("://");

            if (!hasScheme) {
                return `${desiredScheme || "http"}://${trimmedUrl}`;
            }

            if (desiredScheme) {
                try {
                    const parsed = new URL(trimmedUrl);
                    if (parsed.protocol.replace(":", "") !== desiredScheme) {
                        parsed.protocol = `${desiredScheme}:`;
                        return parsed.toString();
                    }
                    return trimmedUrl;
                } catch (error) {
                    const withoutProtocol = trimmedUrl.replace(/^\w+:\/\//, "");
                    return `${desiredScheme}://${withoutProtocol}`;
                }
            }

            return trimmedUrl;
        },
        createMonitorBase() {
            const monitor = createMonitorDefaults();
            this.applyDefaultNotifications(monitor);
            return monitor;
        },
        applyDefaultNotifications(monitor) {
            if (!monitor.notificationIDList) {
                monitor.notificationIDList = {};
            }

            const notificationList = this.$root?.notificationList || [];
            notificationList.forEach((notification) => {
                if (notification.isDefault) {
                    monitor.notificationIDList[notification.id] = true;
                }
            });
        },
        async importMonitors() {
            if (!this.canImport) {
                return;
            }

            this.processing = true;
            this.resultLookup = {};

            let results;

            try {
                results = await this.runImportQueue();
            } catch (error) {
                const message = error?.message
                    ? `${this.$t("bulkImportFailedToast")}: ${error.message}`
                    : this.$t("bulkImportFailedToast");
                toast.error(message);
                return;
            } finally {
                this.processing = false;
            }

            const successCount = results.filter((result) => result.success).length;

            if (successCount === this.entries.length) {
                toast.success(this.$t("bulkImportSuccessToast", [ this.entries.length ]));
            } else if (successCount > 0) {
                toast.warning(this.$t("bulkImportPartialToast", [ successCount, this.entries.length - successCount ]));
            } else {
                const failureMessages = results
                    .filter((result) => !result.success && result.message)
                    .map((result) => result.message);
                const fallback = this.$t("bulkImportFailedToast");
                toast.error(failureMessages[0] || fallback);
            }
        },
        async runImportQueue() {
            const entries = this.entries.slice();
            const concurrency = Math.min(5, Math.max(1, entries.length));
            const results = [];
            let cursor = 0;

            const worker = async () => {
                while (true) {
                    if (cursor >= entries.length) {
                        break;
                    }

                    const entry = entries[cursor];
                    cursor++;
                    const result = await this.importSingleEntry(entry);
                    results.push(result);
                }
            };

            const workers = [];
            for (let i = 0; i < concurrency; i++) {
                workers.push(worker());
            }

            await Promise.all(workers);

            return results;
        },
        async importSingleEntry(entry) {
            try {
                const payload = JSON.parse(JSON.stringify(entry.monitor));
                const response = await new Promise((resolve, reject) => {
                    try {
                        this.$root.add(payload, resolve);
                    } catch (error) {
                        reject(error);
                    }
                });

                const success = Boolean(response?.ok);
                const message = success
                    ? this.$t("bulkImportStatusSuccess")
                    : this.formatResponseMessage(response, "bulkImportStatusFailed");

                this.recordResult(entry.line, success, message);

                return {
                    line: entry.line,
                    success,
                    message,
                };
            } catch (error) {
                const message = error?.message
                    ? `${this.$t("bulkImportStatusFailed")}: ${error.message}`
                    : this.$t("bulkImportStatusFailed");

                this.recordResult(entry.line, false, message);

                return {
                    line: entry.line,
                    success: false,
                    message,
                };
            }
        },
        recordResult(line, success, message) {
            this.resultLookup[line] = {
                success,
                message,
            };
        },
        formatResponseMessage(response, fallbackKey) {
            if (!response) {
                return this.$t(fallbackKey);
            }

            if (response.msgi18n) {
                if (response.msg != null && typeof response.msg === "object") {
                    return this.$t(response.msg.key, response.msg.values);
                }
                return this.$t(response.msg);
            }

            return response.msg || this.$t(fallbackKey);
        },
    },
};
</script>

<style scoped>
.bulk-import-dialog textarea {
    font-family: var(--bs-font-monospace);
}
</style>
