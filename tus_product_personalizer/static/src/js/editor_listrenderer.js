/** @odoo-module **/

import { ListRenderer } from "@web/views/list/list_renderer";
import { BackendFabricDialog } from "./backend_fabric_dialog";
import { useService } from "@web/core/utils/hooks";

export class EditorListRenderer extends ListRenderer {

    setup() {
        super.setup();
        this.dialog = useService("dialog");
    }

    async onCellClicked(record, column, ev) {
        if (ev.target.special_click) {
            return;
        }
        const recordAfterResequence = async () => {
            const recordIndex = this.props.list.records.indexOf(record);
            await this.resequencePromise;
            // row might have changed record after resequence
            record = this.props.list.records[recordIndex] || record;
        };

        if ((this.props.list.model.multiEdit && record.selected) || this.isInlineEditable(record)) {
            if (record.isInEdition && this.editedRecord === record) {
                const cell = this.tableRef.el.querySelector(
                    `.o_selected_row td[name='${column.name}']`
                );
                if (cell && containsActiveElement(cell)) {
                    this.lastEditedCell = { column, record };
                    // Cell is already focused.
                    return;
                }
                this.focusCell(column);
                this.cellToFocus = null;
            } else {
                await recordAfterResequence();
                await this.props.list.enterEditMode(record);
                this.cellToFocus = { column, record };
                if (
                    column.type === "field" &&
                    record.fields[column.name].type === "boolean" &&
                    (!column.widget || column.widget === "boolean")
                ) {
                    if (
                        !this.isCellReadonly(column, record) &&
                        !this.evalInvisible(column.invisible, record)
                    ) {
                        await record.update({ [column.name]: !record.data[column.name] });
                    }
                }
            }
        } else if (this.editedRecord && this.editedRecord !== record) {
            this.props.list.leaveEditMode();
        } else if (!this.props.archInfo.noOpen) {
            this.dialog.add(BackendFabricDialog, {record: record, is_edit: true });
        }
    }
}