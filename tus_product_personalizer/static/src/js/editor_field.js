/** @odoo-module **/

import { registry } from "@web/core/registry";
import { X2ManyField, x2ManyField } from "@web/views/fields/x2many/x2many_field";
import { BackendFabricDialog } from "./backend_fabric_dialog";
import { useService } from "@web/core/utils/hooks";
import { isMobileOS } from "@web/core/browser/feature_detection";
import { EditorListRenderer } from "./editor_listrenderer";

export class EditorProductLineIdsOne2Many extends X2ManyField {

    static components = {
        ...X2ManyField.components,
        ListRenderer: EditorListRenderer
    };

    setup() {
        super.setup();
        this.dialog = useService("dialog");
        this.isMobile = isMobileOS();
    }
    async onAdd({ context, editable } = {}) {
        this.dialog.add(BackendFabricDialog, {record: this.props.record});
    }
}

export const EditorProductLineIds = {
    ...x2ManyField,
    component: EditorProductLineIdsOne2Many,
}

registry.category("fields").add("editor_product_ids", EditorProductLineIds);
