<template>
    <div class="container-fluid">
        <div class="row">
            <div v-if="!$root.isMobile" class="col-12 col-md-5 col-xl-4">
                <div class="mb-3 d-flex flex-wrap gap-2">
                    <router-link to="/add" class="btn btn-primary"><font-awesome-icon icon="plus" /> {{ $t("Add New Monitor") }}</router-link>
                    <button class="btn btn-outline-primary" type="button" @click="openBulkImport">
                        <font-awesome-icon icon="upload" class="me-1" />
                        {{ $t("bulkImportButton") }}
                    </button>
                </div>
                <MonitorList :scrollbar="true" />
            </div>

            <div ref="container" class="col-12 col-md-7 col-xl-8 mb-3">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :calculatedHeight="height" />
            </div>
        </div>
        <BulkMonitorImportDialog ref="bulkDialog" />
    </div>
</template>

<script>

import MonitorList from "../components/MonitorList.vue";
import BulkMonitorImportDialog from "../components/BulkMonitorImportDialog.vue";

export default {
    components: {
        MonitorList,
        BulkMonitorImportDialog,
    },
    data() {
        return {
            height: 0
        };
    },
    mounted() {
        this.height = this.$refs.container.offsetHeight;
    },
    methods: {
        openBulkImport() {
            if (this.$refs.bulkDialog) {
                this.$refs.bulkDialog.show();
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.container-fluid {
    width: 98%;
}
</style>
