'use strict';

var programClientCore = require('@solana/program-client-core');



Object.keys(programClientCore).forEach(function (k) {
	if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
		enumerable: true,
		get: function () { return programClientCore[k]; }
	});
});
//# sourceMappingURL=program-client-core.browser.cjs.map
//# sourceMappingURL=program-client-core.browser.cjs.map