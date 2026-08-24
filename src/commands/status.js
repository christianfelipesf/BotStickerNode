const pingCmd = require('./ping');

module.exports = {
    name: 'status',
    aliases: [],
    category: pingCmd.category,
    description: pingCmd.description,
    execute: pingCmd.execute
};
