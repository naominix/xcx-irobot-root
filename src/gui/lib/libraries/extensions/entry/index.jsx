/**
 * This is an extension for Xcratch.
 */

import iconURL from './entry-icon.png';
import insetIconURL from './inset-icon.png';
import translations from './translations.json';
import {version as packageVersion} from '../../../../../../package.json';

/**
 * Formatter to translate the messages in this extension.
 * This will be replaced which is used in the React component.
 * @param {object} messageData - data for format-message
 * @returns {string} - translated message for the current locale
 */
let formatMessage = messageData => messageData.defaultMessage;

const version = `v${packageVersion}`;

const entry = {
    get name () {
        return formatMessage({
            id: 'irobotRoot.entry.name',
            defaultMessage: 'iRobot Root',
            description: 'name of the extension'
        });
    },
    extensionId: 'irobotRoot',
    extensionURL: 'https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs',
    collaborator: 'naominix',
    iconURL: iconURL,
    insetIconURL: insetIconURL,
    get description () {
        return `${formatMessage({
            defaultMessage: 'Control an iRobot Root robot over Bluetooth',
            description: 'Description for this extension',
            id: 'irobotRoot.entry.description'
        })} (${version})`;
    },
    tags: [],
    featured: true,
    disabled: false,
    bluetoothRequired: false,
    internetConnectionRequired: false,
    helpLink: 'https://naominix.github.io/xcx-irobot-root/',
    setFormatMessage: formatter => {
        formatMessage = formatter;
    },
    translationMap: translations
};

export {entry}; // loadable-extension needs this line.
export default entry;
