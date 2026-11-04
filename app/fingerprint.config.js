/** Native widget sources are copied by a config plugin; explicitly fingerprint the originals. */
module.exports = {
  extraSources: [
    { type: 'dir', filePath: 'native', reasons: ['Agent WidgetKit extension'] },
    { type: 'dir', filePath: 'modules/agent-native', reasons: ['Agent native bridge and shared contracts'] },
    { type: 'dir', filePath: 'plugins', reasons: ['Native target generation'] },
  ],
};
