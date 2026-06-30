/** @odoo-module **/

import { TUS_FABRIC_CUSTOM_PROPS } from "./constants";

export function registerFabricFinishProperties() {
    if (typeof fabric === "undefined" || fabric._tusFinishPropsRegistered) {
        return;
    }
    TUS_FABRIC_CUSTOM_PROPS.forEach((prop) => {
        if (!fabric.Object.prototype.stateProperties.includes(prop)) {
            fabric.Object.prototype.stateProperties.push(prop);
        }
    });
    fabric._tusFinishPropsRegistered = true;
}
